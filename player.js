/* Wspólna logika odtwarzacza: łącza, kodowanie zestawu, plakaty, okno filmu. */
(function (global) {
  "use strict";

  var CANONICAL = "https://gladiator2201.github.io/odtwarzacz/";

  function viewerBase() {
    try {
      var loc = global.location;
      if (!loc || loc.protocol === "file:") return CANONICAL;
      var path = loc.pathname.replace(/\/[^/]*$/, "/");
      if (!path) path = "/";
      return loc.origin + path;
    } catch (e) {
      return CANONICAL;
    }
  }

  function b64urlEncode(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function b64urlDecode(str) {
    var s = String(str).replace(/-/g, "+").replace(/_/g, "/");
    var pad = s.length % 4;
    if (pad) s += "=".repeat(4 - pad);
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function compact(set) {
    return {
      v: 1,
      d: set.dedication || "",
      n: set.name || "",
      a: set.autoNext ? 1 : 0,
      i: (set.videos || []).map(function (vid) {
        var item = { t: vid.title || "" };
        if (vid.type === "yt") item.y = vid.id;
        else if (vid.type === "drive") item.g = vid.id;
        else item.u = vid.url;
        return item;
      })
    };
  }

  function expand(obj) {
    if (!obj || typeof obj !== "object") return null;
    var videos = (obj.i || []).map(inflateItem).filter(Boolean);
    return {
      dedication: obj.d || "",
      name: obj.n || "",
      autoNext: !!obj.a,
      videos: videos
    };
  }

  function inflateItem(item) {
    if (!item || typeof item !== "object") return null;
    if (item.y) {
      var id = String(item.y).trim();
      if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
      return { type: "yt", id: id, url: "https://www.youtube.com/watch?v=" + id, title: item.t || "", thumb: youtubeThumb(id) };
    }
    if (item.g) {
      var gid = String(item.g).trim();
      if (!/^[A-Za-z0-9_-]+$/.test(gid)) return null;
      return { type: "drive", id: gid, url: "https://drive.google.com/file/d/" + gid + "/view", title: item.t || "", thumb: "" };
    }
    if (item.u) {
      var parsed = parseLink(String(item.u));
      if (!parsed) return null;
      parsed.title = item.t || parsed.title || "";
      return parsed;
    }
    return null;
  }

  async function deflateBytes(bytes) {
    var cs = new CompressionStream("deflate-raw");
    var packed = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer());
    return packed;
  }

  async function inflateBytes(bytes) {
    var ds = new DecompressionStream("deflate-raw");
    var raw = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
    return raw;
  }

  async function encodeSet(set) {
    var json = JSON.stringify(compact(set));
    var bytes = new TextEncoder().encode(json);
    try {
      var packed = await deflateBytes(bytes);
      if (packed.length < bytes.length) return "z." + b64urlEncode(packed);
    } catch (e) { /* brak kompresji — zwykły zapis */ }
    return "j." + b64urlEncode(bytes);
  }

  async function decodeHash(hash) {
    var raw = String(hash || "").replace(/^#/, "").trim();
    if (!raw) return null;
    try {
      var payload;
      if (raw.indexOf("z.") === 0) {
        payload = new TextDecoder().decode(await inflateBytes(b64urlDecode(raw.slice(2))));
      } else if (raw.indexOf("j.") === 0) {
        payload = new TextDecoder().decode(b64urlDecode(raw.slice(2)));
      } else {
        return null;
      }
      return expand(JSON.parse(payload));
    } catch (e) {
      return null;
    }
  }

  function shareUrlFor(hashPart) {
    var base = viewerBase();
    if (base.indexOf("github.io") === -1 && global.location && global.location.protocol !== "http:" && global.location.protocol !== "https:") {
      base = CANONICAL;
    }
    return base + "#" + hashPart;
  }

  function extractYouTubeId(s) {
    var t = String(s).trim();
    var patterns = [
      /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/,
      /youtube\.com\/attribution_link\?.*?v(?:=|%3D)([A-Za-z0-9_-]{11})/i
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = t.match(patterns[i]);
      if (m) return m[1];
    }
    if (/^[A-Za-z0-9_-]{11}$/.test(t)) return t;
    return null;
  }

  function extractDriveId(s) {
    var t = String(s).trim();
    var m = t.match(/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/)
      || t.match(/drive\.google\.com\/(?:open|uc|thumbnail).*[?&]id=([A-Za-z0-9_-]+)/)
      || t.match(/docs\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  }

  function isHttpUrl(s) {
    try {
      var u = new URL(s);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch (e) {
      return false;
    }
  }

  function parseLink(raw) {
    var s = String(raw || "").trim().replace(/[.,;]+$/, "");
    if (!s) return null;
    var yt = extractYouTubeId(s);
    if (yt && (isHttpUrl(s) || /^[A-Za-z0-9_-]{11}$/.test(s))) {
      return { type: "yt", id: yt, url: "https://www.youtube.com/watch?v=" + yt, title: "", thumb: youtubeThumb(yt) };
    }
    var gd = extractDriveId(s);
    if (gd) {
      return { type: "drive", id: gd, url: "https://drive.google.com/file/d/" + gd + "/view", title: "", thumb: "" };
    }
    if (isHttpUrl(s)) {
      return { type: "file", url: s, title: "", thumb: "" };
    }
    return null;
  }

  function extractLinksFromText(text) {
    var found = [];
    var seen = {};
    var src = String(text || "");
    var urlRe = /https?:\/\/[^\s<>"')\]]+/gi;
    var m;
    while ((m = urlRe.exec(src))) {
      var chunk = m[0].replace(/[.,;:!?]+$/, "");
      var parsed = parseLink(chunk);
      if (parsed) {
        var key = parsed.type + ":" + (parsed.id || parsed.url);
        if (!seen[key]) { seen[key] = true; found.push(parsed); }
      }
    }
    if (!found.length) {
      var lines = src.split(/\s+/);
      for (var i = 0; i < lines.length; i++) {
        var p = parseLink(lines[i]);
        if (p) {
          var k = p.type + ":" + (p.id || p.url);
          if (!seen[k]) { seen[k] = true; found.push(p); }
        }
      }
    }
    return found;
  }

  function youtubeThumb(id) {
    return "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg";
  }

  function kindLabel(vid) {
    if (vid.type === "yt") return "YouTube";
    if (vid.type === "drive") return "Google Drive";
    return "Film";
  }

  function fallbackTitle(vid, index) {
    if (vid.title && String(vid.title).trim()) return String(vid.title).trim();
    return "Film " + (index + 1);
  }

  async function fetchTitle(vid) {
    if (vid.type !== "yt" || !vid.id) return vid;
    try {
      var url = "https://noembed.com/embed?url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + vid.id);
      var res = await fetch(url);
      if (!res.ok) return vid;
      var data = await res.json();
      if (data && data.title && !vid.title) vid.title = data.title;
      if (data && data.thumbnail_url) vid.thumb = data.thumbnail_url;
    } catch (e) { /* zostaje tytuł użytkownika albo zastępczy */ }
    return vid;
  }

  function clearEl(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function text(el, value) {
    el.textContent = value == null ? "" : String(value);
  }

  var ytApiPromise = null;
  function loadYouTubeApi() {
    if (global.YT && global.YT.Player) return Promise.resolve(global.YT);
    if (ytApiPromise) return ytApiPromise;
    ytApiPromise = new Promise(function (resolve) {
      var prev = global.onYouTubeIframeAPIReady;
      global.onYouTubeIframeAPIReady = function () {
        if (typeof prev === "function") prev();
        resolve(global.YT);
      };
      if (!document.getElementById("yt-iframe-api")) {
        var s = document.createElement("script");
        s.id = "yt-iframe-api";
        s.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(s);
      }
      if (global.YT && global.YT.Player) resolve(global.YT);
    });
    return ytApiPromise;
  }

  function createPlayer(stageEl, captionEl, options) {
    var opts = options || {};
    var currentIndex = -1;
    var currentList = [];
    var ytPlayer = null;
    var ytHostId = "yt-host";
    var autoplayOnStart = false;

    function shouldAutoNext() {
      return typeof opts.autoNext === "function" ? !!opts.autoNext() : !!opts.autoNext;
    }

    function ended() {
      if (shouldAutoNext() && currentList.length) {
        var next = (currentIndex + 1) % currentList.length;
        play(currentList, next, true);
      }
    }

    function resetStage(kind) {
      if (ytPlayer && typeof ytPlayer.destroy === "function") {
        try { ytPlayer.destroy(); } catch (e) {}
        ytPlayer = null;
      }
      clearEl(stageEl);
      if (kind === "empty") {
        var ph = document.createElement("div");
        ph.className = "placeholder";
        var mark = document.createElement("span");
        mark.className = "mark";
        mark.setAttribute("aria-hidden", "true");
        mark.textContent = "▶";
        var p = document.createElement("p");
        text(p, opts.emptyText || "Kurtyna jest jeszcze zasunięta.");
        ph.appendChild(mark);
        ph.appendChild(p);
        stageEl.appendChild(ph);
        if (captionEl) text(captionEl, "");
        currentIndex = -1;
        return;
      }
    }

    function play(list, index, autoplay) {
      currentList = list || [];
      if (!currentList.length || index < 0 || index >= currentList.length) {
        resetStage("empty");
        if (opts.onChange) opts.onChange(-1);
        return Promise.resolve();
      }
      currentIndex = index;
      autoplayOnStart = !!autoplay;
      var vid = currentList[index];
      if (captionEl) text(captionEl, fallbackTitle(vid, index));
      if (opts.onChange) opts.onChange(index);

      if (vid.type === "yt") return playYouTube(vid, autoplayOnStart);
      if (vid.type === "drive") return playDrive(vid);
      return playFile(vid, autoplayOnStart);
    }

    function playYouTube(vid, autoplay) {
      resetStage();
      var host = document.createElement("div");
      host.id = ytHostId;
      stageEl.appendChild(host);
      return loadYouTubeApi().then(function (YT) {
        ytPlayer = new YT.Player(ytHostId, {
          host: "https://www.youtube-nocookie.com",
          width: "100%",
          height: "100%",
          videoId: vid.id,
          playerVars: {
            autoplay: autoplay ? 1 : 0,
            rel: 0,
            modestbranding: 1,
            hl: "pl",
            playsinline: 1,
            fs: 1,
            enablejsapi: 1,
            origin: (global.location && global.location.origin && global.location.origin !== "null")
              ? global.location.origin
              : "https://gladiator2201.github.io"
          },
          events: {
            onStateChange: function (e) {
              if (e.data === YT.PlayerState.ENDED) ended();
            }
          }
        });
      }).catch(function () {
        var ifr = document.createElement("iframe");
        ifr.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(vid.id) +
          "?rel=0&modestbranding=1&hl=pl&playsinline=1" + (autoplay ? "&autoplay=1" : "");
        ifr.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen";
        ifr.setAttribute("allowfullscreen", "true");
        ifr.title = fallbackTitle(vid, currentIndex);
        stageEl.appendChild(ifr);
      });
    }

    function playDrive(vid) {
      resetStage();
      var ifr = document.createElement("iframe");
      ifr.src = "https://drive.google.com/file/d/" + encodeURIComponent(vid.id) + "/preview";
      ifr.allow = "autoplay; fullscreen";
      ifr.setAttribute("allowfullscreen", "true");
      ifr.title = fallbackTitle(vid, currentIndex);
      stageEl.appendChild(ifr);
      return Promise.resolve();
    }

    function playFile(vid, autoplay) {
      resetStage();
      var v = document.createElement("video");
      v.controls = true;
      v.playsInline = true;
      v.setAttribute("playsinline", "");
      v.preload = "metadata";
      v.src = vid.url;
      v.addEventListener("ended", ended);
      stageEl.appendChild(v);
      if (autoplay) {
        var p = v.play();
        if (p && typeof p.catch === "function") p.catch(function () {});
      }
      return Promise.resolve();
    }

    function playNext() {
      if (!currentList.length) return;
      var next = (currentIndex + 1) % currentList.length;
      return play(currentList, next, true);
    }

    function playPrev() {
      if (!currentList.length) return;
      var prev = (currentIndex - 1 + currentList.length) % currentList.length;
      return play(currentList, prev, true);
    }

    function requestFullScreen() {
      var el = stageEl.querySelector("video") || stageEl;
      var req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
      if (req) req.call(el);
      else if (ytPlayer && typeof ytPlayer.getIframe === "function") {
        var ifr = ytPlayer.getIframe();
        if (ifr && ifr.requestFullscreen) ifr.requestFullscreen();
      }
    }

    function getIndex() { return currentIndex; }

    function showEmpty(message) {
      if (message) opts.emptyText = message;
      resetStage("empty");
    }

    return {
      play: play,
      playNext: playNext,
      playPrev: playPrev,
      requestFullScreen: requestFullScreen,
      getIndex: getIndex,
      showEmpty: showEmpty
    };
  }

  function renderPosters(container, videos, opts) {
    var o = opts || {};
    clearEl(container);
    videos.forEach(function (vid, index) {
      var art = document.createElement("article");
      art.className = "tile" + (o.active === index ? " on" : "");
      art.tabIndex = 0;
      art.setAttribute("role", "button");
      var title = fallbackTitle(vid, index);
      art.setAttribute("aria-label", title);
      art.dataset.index = String(index);

      var arch = document.createElement("span");
      arch.className = "arch";
      var th = document.createElement("span");
      th.className = "th";
      if (vid.thumb || (vid.type === "yt" && vid.id)) {
        var img = document.createElement("img");
        img.alt = title;
        img.loading = "lazy";
        img.src = vid.thumb || youtubeThumb(vid.id);
        th.appendChild(img);
      } else {
        var ph = document.createElement("span");
        ph.className = "ph";
        ph.setAttribute("aria-hidden", "true");
        ph.textContent = "▶";
        th.appendChild(ph);
      }
      var shine = document.createElement("i");
      shine.className = "shine";
      var playMark = document.createElement("i");
      playMark.className = "play";
      playMark.setAttribute("aria-hidden", "true");
      playMark.textContent = "▶";
      th.appendChild(shine);
      th.appendChild(playMark);
      arch.appendChild(th);
      art.appendChild(arch);

      var b = document.createElement("b");
      text(b, title);
      art.appendChild(b);
      var sm = document.createElement("small");
      text(sm, kindLabel(vid));
      art.appendChild(sm);

      if (o.editable) {
        var tools = document.createElement("div");
        tools.className = "tile-tools";
        tools.addEventListener("click", function (e) { e.stopPropagation(); });
        tools.appendChild(toolBtn("Wyżej", function () { if (o.onMove) o.onMove(index, -1); }));
        tools.appendChild(toolBtn("Niżej", function () { if (o.onMove) o.onMove(index, 1); }));
        tools.appendChild(toolBtn("Usuń", function () { if (o.onRemove) o.onRemove(index); }));
        art.appendChild(tools);
      }

      art.addEventListener("click", function () { if (o.onSelect) o.onSelect(index); });
      art.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (o.onSelect) o.onSelect(index);
        }
      });
      container.appendChild(art);
    });
  }

  function toolBtn(label, fn) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "btn";
    b.textContent = label;
    b.addEventListener("click", fn);
    return b;
  }

  function sameVideo(a, b) {
    if (!a || !b || a.type !== b.type) return false;
    if (a.id && b.id) return a.id === b.id;
    return a.url === b.url;
  }

  global.Odtwarzacz = {
    CANONICAL: CANONICAL,
    viewerBase: viewerBase,
    encodeSet: encodeSet,
    decodeHash: decodeHash,
    shareUrlFor: shareUrlFor,
    parseLink: parseLink,
    extractLinksFromText: extractLinksFromText,
    fetchTitle: fetchTitle,
    createPlayer: createPlayer,
    renderPosters: renderPosters,
    fallbackTitle: fallbackTitle,
    kindLabel: kindLabel,
    sameVideo: sameVideo,
    youtubeThumb: youtubeThumb
  };
})(window);
