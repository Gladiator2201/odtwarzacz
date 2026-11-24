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
        if (vid.ratioOverride === "16:9" || vid.ratioOverride === "4:3" || vid.ratioOverride === "9:16" || vid.ratioOverride === "1:1") {
          item.o = vid.ratioOverride;
        }
        if (typeof vid.ratio === "number" && isFinite(vid.ratio) && vid.ratio > 0.05 && vid.ratio < 20) {
          item.p = Math.round(vid.ratio * 10000) / 10000;
        }
        if (vid.short) item.s = 1;
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

  var RATIO_PRESETS = { "16:9": 16 / 9, "4:3": 4 / 3, "9:16": 9 / 16, "1:1": 1 };

  function applyStoredRatio(vid, item) {
    if (!vid || !item) return vid;
    if (item.o && RATIO_PRESETS[item.o]) vid.ratioOverride = item.o;
    if (typeof item.p === "number" && isFinite(item.p) && item.p > 0.05 && item.p < 20) vid.ratio = item.p;
    if (item.s) vid.short = true;
    return vid;
  }

  function displayRatio(vid) {
    if (!vid) return 16 / 9;
    if (vid.ratioOverride && RATIO_PRESETS[vid.ratioOverride]) return RATIO_PRESETS[vid.ratioOverride];
    if (vid.short) return 9 / 16;
    if (typeof vid.ratio === "number" && isFinite(vid.ratio) && vid.ratio > 0.05) return vid.ratio;
    return 16 / 9;
  }

  function mediaRatio(vid) {
    if (!vid) return 16 / 9;
    if (typeof vid.ratio === "number" && isFinite(vid.ratio) && vid.ratio > 0.05) return vid.ratio;
    if (vid.short) return 9 / 16;
    return 16 / 9;
  }

  function inflateItem(item) {
    if (!item || typeof item !== "object") return null;
    var vid = null;
    if (item.y) {
      var id = String(item.y).trim();
      if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
      vid = { type: "yt", id: id, url: "https://www.youtube.com/watch?v=" + id, title: item.t || "", thumb: youtubeThumb(id) };
    } else if (item.g) {
      var gid = String(item.g).trim();
      if (!/^[A-Za-z0-9_-]+$/.test(gid)) return null;
      vid = { type: "drive", id: gid, url: "https://drive.google.com/file/d/" + gid + "/view", title: item.t || "", thumb: "" };
    } else if (item.u) {
      vid = parseLink(String(item.u));
      if (!vid) return null;
      vid.title = item.t || vid.title || "";
    }
    return applyStoredRatio(vid, item);
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

  function payloadFromLocation(loc) {
    loc = loc || global.location;
    if (!loc) return "";
    try {
      var params = new URLSearchParams(loc.search || "");
      var q = params.get("z") || params.get("j") || params.get("s");
      if (q) {
        q = String(q).trim();
        if (q.indexOf("z.") === 0 || q.indexOf("j.") === 0) return q;
        if (params.has("j") && !params.get("z")) return "j." + q;
        return "z." + q;
      }
    } catch (e) {}
    return String(loc.hash || "").replace(/^#/, "").trim();
  }

  function liveBase() {
    return CANONICAL.replace(/\/?$/, "/");
  }

  function shareUrlQuery(hashPart, base) {
    var b = (base || liveBase()).replace(/[?#].*$/, "");
    if (b.slice(-1) !== "/") b += "/";
    return b + "?z=" + encodeURIComponent(hashPart);
  }

  function facebookShareUrl(hashPart) {
    return "https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(shareUrlQuery(hashPart, liveBase()));
  }

  function openFacebookShare(hashPart) {
    var u = facebookShareUrl(hashPart);
    var w = 640, h = 680;
    var left = 0, top = 0;
    try {
      left = Math.max(0, ((screen.width || 0) - w) / 2);
      top = Math.max(0, ((screen.height || 0) - h) / 2);
    } catch (e) {}
    var win = global.open(u, "fbshare", "width=" + w + ",height=" + h + ",left=" + left + ",top=" + top + ",scrollbars=yes,resizable=yes");
    if (win) try { win.opener = null; } catch (e) {}
    return !!win;
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
      var rec = { type: "yt", id: yt, url: "https://www.youtube.com/watch?v=" + yt, title: "", thumb: youtubeThumb(yt) };
      if (/\/shorts\//i.test(s)) rec.short = true;
      return rec;
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

  function applyOEmbedData(vid, data) {
    if (!data) return;
    if (data.title && !vid.title) vid.title = data.title;
    if (data.thumbnail_url) vid.thumb = data.thumbnail_url;
    var w = Number(data.width), h = Number(data.height);
    if (w > 0 && h > 0) vid.ratio = w / h;
  }

  async function fetchJson(url) {
    var res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  }

  async function fetchTitle(vid) {
    if (vid.type !== "yt" || !vid.id) return vid;
    var watch = "https://www.youtube.com/watch?v=" + vid.id;
    var qs = "url=" + encodeURIComponent(watch) + "&format=json&maxwidth=2000&maxheight=2000";
    var data = null;
    try {
      data = await fetchJson("https://www.youtube.com/oembed?" + qs);
    } catch (e) { data = null; }
    if (!data) {
      try {
        data = await fetchJson("https://noembed.com/embed?" + qs);
      } catch (e) { data = null; }
    }
    applyOEmbedData(vid, data);
    return vid;
  }

  async function ensureRatio(vid) {
    if (!vid) return vid;
    if (vid.type === "yt" && !vid.ratio) await fetchTitle(vid);
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

  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(s).padStart(2, "0");
  }

  function createPlayer(stageEl, captionEl, options) {
    var opts = options || {};
    var currentIndex = -1;
    var currentList = [];
    var ytPlayer = null;
    var ytReady = false;
    var ytHostId = "yt-host";
    var ui = null;
    var uiTimer = null;
    var isEnded = false;
    var dragging = false;
    var coverUntilPlay = true;
    var lastVolume = 100;
    var pendingPlay = false;

    function shouldAutoNext() {
      return typeof opts.autoNext === "function" ? !!opts.autoNext() : !!opts.autoNext;
    }

    function currentVid() {
      return currentList[currentIndex] || null;
    }

    function ytState() {
      try {
        if (ytPlayer && typeof ytPlayer.getPlayerState === "function") return ytPlayer.getPlayerState();
      } catch (e) {}
      return -1;
    }

    function isYtPlaying() {
      return !!global.YT && ytState() === global.YT.PlayerState.PLAYING;
    }

    function stopTimer() {
      if (uiTimer) { clearInterval(uiTimer); uiTimer = null; }
    }

    function startTimer() {
      stopTimer();
      uiTimer = setInterval(syncSeek, 250);
    }

    function syncSeek() {
      if (!ytPlayer || !ui || dragging) return;
      try {
        var dur = ytPlayer.getDuration ? ytPlayer.getDuration() : 0;
        var cur = ytPlayer.getCurrentTime ? ytPlayer.getCurrentTime() : 0;
        if (dur && isFinite(dur)) {
          ui.seek.max = String(dur);
          ui.seek.value = String(cur);
          ui.tDur.textContent = formatTime(dur);
        }
        ui.tCur.textContent = formatTime(cur);
      } catch (e) {}
    }

    function setPlayIcon(playing) {
      if (!ui) return;
      ui.btnPlay.textContent = playing ? "❚❚" : "▶";
      ui.btnPlay.setAttribute("aria-label", playing ? "Pauza" : "Odtwarzaj");
      if (ui.coverBtn) {
        ui.coverBtn.textContent = "▶";
        ui.coverBtn.setAttribute("aria-label", isEnded ? "Jeszcze raz" : "Odtwarzaj");
      }
      if (ui.coverHint) ui.coverHint.textContent = isEnded ? "Jeszcze raz" : "";
    }

    function setMuteIcon() {
      if (!ui || !ytPlayer) return;
      var muted = false;
      try { muted = !!ytPlayer.isMuted() || (ytPlayer.getVolume && ytPlayer.getVolume() === 0); } catch (e) {}
      ui.btnMute.textContent = muted ? "🔇" : "🔊";
      ui.btnMute.setAttribute("aria-label", muted ? "Włącz dźwięk" : "Wycisz");
    }

    function showCover() {
      if (!ui) return;
      ui.cover.hidden = false;
      var vid = currentVid();
      if (vid && ui.coverImg) {
        var src = vid.thumb || (vid.type === "yt" && vid.id ? youtubeThumb(vid.id) : "");
        if (src) {
          ui.coverImg.src = src;
          ui.coverImg.hidden = false;
        } else {
          ui.coverImg.removeAttribute("src");
          ui.coverImg.hidden = true;
        }
      }
      ui.coverBtn.textContent = "▶";
      ui.coverBtn.setAttribute("aria-label", isEnded ? "Jeszcze raz" : "Odtwarzaj");
      if (ui.coverHint) ui.coverHint.textContent = isEnded ? "Jeszcze raz" : "";
    }

    function hideCover() {
      if (!ui) return;
      ui.cover.hidden = true;
    }

    function destroyYouTube() {
      stopTimer();
      if (ytPlayer && typeof ytPlayer.destroy === "function") {
        try { ytPlayer.destroy(); } catch (e) {}
      }
      ytPlayer = null;
      ytReady = false;
      ui = null;
    }

    function ensureInner() {
      var i, inner = null;
      for (i = 0; i < stageEl.children.length; i++) {
        if (stageEl.children[i].classList.contains("stage-inner")) inner = stageEl.children[i];
      }
      if (!inner) {
        inner = el("div", "stage-inner");
        stageEl.appendChild(inner);
      }
      return inner;
    }

    function applyAspect(vid) {
      var ar = displayRatio(vid);
      stageEl.style.setProperty("--ar", String(ar));
      applyMediaCover(vid);
    }

    function isStageFullscreen() {
      var fs = document.fullscreenElement || document.webkitFullscreenElement;
      return !!fs && (fs === stageEl || (stageEl && stageEl.contains(fs)));
    }

    var centerTimer = null;
    function scheduleCenterStage() {
      if (isStageFullscreen()) return;
      if (centerTimer) { clearTimeout(centerTimer); centerTimer = null; }
      function go() {
        if (isStageFullscreen() || !stageEl || typeof stageEl.scrollIntoView !== "function") return;
        stageEl.scrollIntoView({ block: "center", behavior: "smooth", inline: "nearest" });
      }
      requestAnimationFrame(function () {
        requestAnimationFrame(go);
      });
      centerTimer = setTimeout(function () {
        centerTimer = null;
        go();
      }, 480);
    }

    function applyMediaCover(vid) {
      var inner = stageEl.querySelector(".stage-inner") || stageEl;
      var iframe = inner.querySelector("iframe");
      var video = inner.querySelector("video");
      if (video && !iframe) {
        video.style.objectFit = (vid && Math.abs(mediaRatio(vid) - displayRatio(vid)) > 0.04) ? "cover" : "contain";
        video.style.inset = "0";
        video.style.width = "100%";
        video.style.height = "100%";
        return;
      }
      if (!iframe) return;
      iframe.style.inset = "unset";
      iframe.style.right = "auto";
      iframe.style.bottom = "auto";
      iframe.style.transform = "";
      if (!vid || Math.abs(mediaRatio(vid) - displayRatio(vid)) <= 0.04) {
        iframe.style.top = "0";
        iframe.style.left = "0";
        iframe.style.width = "100%";
        iframe.style.height = "100%";
        return;
      }
      var d = displayRatio(vid), src = mediaRatio(vid);
      if (src > d) {
        var w = (src / d) * 100;
        iframe.style.width = w + "%";
        iframe.style.height = "100%";
        iframe.style.left = ((100 - w) / 2) + "%";
        iframe.style.top = "0";
      } else {
        var h = (d / src) * 100;
        iframe.style.height = h + "%";
        iframe.style.width = "100%";
        iframe.style.top = ((100 - h) / 2) + "%";
        iframe.style.left = "0";
      }
    }

    function resetStage(kind) {
      destroyYouTube();
      clearEl(stageEl);
      stageEl.classList.remove("has-yt");
      var inner = ensureInner();
      if (kind === "empty") {
        applyAspect(null);
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
        inner.appendChild(ph);
        if (captionEl) text(captionEl, "");
        currentIndex = -1;
        return;
      }
    }

    function el(tag, cls, attrs) {
      var node = document.createElement(tag);
      if (cls) node.className = cls;
      if (attrs) {
        Object.keys(attrs).forEach(function (k) {
          if (k === "text") node.textContent = attrs[k];
          else node.setAttribute(k, attrs[k]);
        });
      }
      return node;
    }

    function buildShell() {
      stageEl.classList.add("has-yt");
      var layer = el("div", "yt-layer");
      var host = el("div", "", { id: ytHostId });
      layer.appendChild(host);

      var shield = el("div", "yt-shield", { "aria-hidden": "true" });

      var cover = el("div", "yt-cover");
      var coverImg = el("img", "yt-cover-img", { alt: "" });
      var coverBtn = el("button", "yt-cover-btn", { type: "button", "aria-label": "Odtwarzaj", text: "▶" });
      var coverHint = el("span", "yt-cover-hint");
      cover.appendChild(coverImg);
      cover.appendChild(coverBtn);
      cover.appendChild(coverHint);

      var bar = el("div", "yt-bar");
      var btnPlay = el("button", "yt-ctrl", { type: "button", "aria-label": "Odtwarzaj", text: "▶" });
      var tCur = el("span", "yt-time", { text: "0:00" });
      var seek = el("input", "yt-seek", { type: "range", min: "0", max: "0", value: "0", step: "any", "aria-label": "Pozycja filmu" });
      var tDur = el("span", "yt-time", { text: "0:00" });
      var btnMute = el("button", "yt-ctrl", { type: "button", "aria-label": "Wycisz", text: "🔊" });
      var vol = el("input", "yt-vol", { type: "range", min: "0", max: "100", value: "100", step: "1", "aria-label": "Głośność" });
      var btnFs = el("button", "yt-ctrl yt-fs", { type: "button", "aria-label": "Pełny ekran", text: "⛶" });
      bar.appendChild(btnPlay);
      bar.appendChild(tCur);
      bar.appendChild(seek);
      bar.appendChild(tDur);
      bar.appendChild(btnMute);
      bar.appendChild(vol);
      bar.appendChild(btnFs);

      var inner = ensureInner();
      inner.appendChild(layer);
      inner.appendChild(shield);
      inner.appendChild(cover);
      /* Pasek pod kadrem, nie na obrazie — pełna ramka 16:9 zostaje widoczna. */
      stageEl.appendChild(bar);

      ui = {
        layer: layer, shield: shield, cover: cover, coverImg: coverImg,
        coverBtn: coverBtn, bar: bar, btnPlay: btnPlay, seek: seek,
        tCur: tCur, tDur: tDur, btnMute: btnMute, vol: vol, btnFs: btnFs,
        coverHint: coverHint
      };

      shield.addEventListener("click", function () {
        if (isYtPlaying()) pauseYt();
        else playYt();
      });
      shield.addEventListener("dblclick", function (e) {
        e.preventDefault();
        requestFullScreen();
      });
      coverBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        playYt();
      });
      cover.addEventListener("click", function () { playYt(); });
      btnPlay.addEventListener("click", function () { togglePlay(); });
      btnMute.addEventListener("click", function () { toggleMute(); });
      btnFs.addEventListener("click", function () { requestFullScreen(); });

      seek.addEventListener("pointerdown", function () { dragging = true; });
      seek.addEventListener("pointerup", function () { dragging = false; applySeek(); });
      seek.addEventListener("change", function () { dragging = false; applySeek(); });
      seek.addEventListener("input", function () {
        ui.tCur.textContent = formatTime(Number(seek.value) || 0);
      });
      vol.addEventListener("input", function () {
        if (!ytPlayer) return;
        var v = Number(vol.value) || 0;
        lastVolume = v;
        try {
          ytPlayer.setVolume(v);
          if (v === 0) ytPlayer.mute();
          else ytPlayer.unMute();
        } catch (e) {}
        setMuteIcon();
      });
    }

    function applySeek() {
      if (!ytPlayer || !ui) return;
      var t = Number(ui.seek.value) || 0;
      try { ytPlayer.seekTo(t, true); } catch (e) {}
      if (isEnded) {
        isEnded = false;
        playYt();
      }
    }

    function playYt() {
      coverUntilPlay = true;
      if (!ytPlayer || !ytReady) {
        pendingPlay = true;
        return;
      }
      try {
        if (isEnded) {
          isEnded = false;
          ytPlayer.seekTo(0, true);
        }
        pendingPlay = false;
        ytPlayer.playVideo();
      } catch (e) {}
    }

    function pauseYt() {
      if (!ytPlayer) return;
      try { ytPlayer.pauseVideo(); } catch (e) {}
    }

    function togglePlay() {
      if (isYtPlaying()) pauseYt();
      else playYt();
    }

    function toggleMute() {
      if (!ytPlayer) return;
      try {
        if (ytPlayer.isMuted() || ytPlayer.getVolume() === 0) {
          ytPlayer.unMute();
          if (ytPlayer.getVolume() === 0) ytPlayer.setVolume(lastVolume || 100);
          if (ui) ui.vol.value = String(ytPlayer.getVolume() || lastVolume || 100);
        } else {
          lastVolume = ytPlayer.getVolume() || lastVolume;
          ytPlayer.mute();
        }
      } catch (e) {}
      setMuteIcon();
    }

    function onYtState(e) {
      if (!global.YT) return;
      var S = global.YT.PlayerState;
      if (e.data === S.PLAYING) {
        isEnded = false;
        coverUntilPlay = false;
        hideCover();
        startTimer();
        syncSeek();
        setPlayIcon(true);
        setMuteIcon();
      } else if (e.data === S.PAUSED) {
        stopTimer();
        syncSeek();
        setPlayIcon(false);
        if (!dragging) showCover();
      } else if (e.data === S.ENDED) {
        isEnded = true;
        stopTimer();
        syncSeek();
        setPlayIcon(false);
        showCover();
        if (shouldAutoNext() && currentList.length > 1) {
          var next = (currentIndex + 1) % currentList.length;
          play(currentList, next, true);
        } else if (shouldAutoNext() && currentList.length === 1) {
          isEnded = false;
          playYt();
        }
      } else if (e.data === S.CUED || e.data === S.UNSTARTED) {
        setPlayIcon(false);
        if (coverUntilPlay) showCover();
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
      var vid = currentList[index];
      if (captionEl) text(captionEl, fallbackTitle(vid, index));
      if (opts.onChange) opts.onChange(index);
      applyAspect(vid);

      var started;
      if (vid.type === "yt") started = playYouTube(vid, !!autoplay);
      else if (vid.type === "drive") started = playDrive(vid);
      else started = playFile(vid, !!autoplay);
      return Promise.resolve(started).then(function () {
        if (autoplay) scheduleCenterStage();
        return ensureRatio(vid).then(function () {
          applyAspect(vid);
          if (autoplay) scheduleCenterStage();
        });
      });
    }

    function playYouTube(vid, autoplay) {
      isEnded = false;
      coverUntilPlay = true;
      if (!stageEl.classList.contains("has-yt") || !ui) {
        resetStage();
        buildShell();
      }
      showCover();
      setPlayIcon(false);
      if (ui) {
        ui.seek.value = "0";
        ui.tCur.textContent = "0:00";
        ui.tDur.textContent = "0:00";
      }

      if (ytPlayer && ytReady) {
        try {
          if (autoplay) ytPlayer.loadVideoById(vid.id);
          else ytPlayer.cueVideoById(vid.id);
        } catch (e) {
          return createYtPlayer(vid, autoplay);
        }
        return Promise.resolve();
      }
      return createYtPlayer(vid, autoplay);
    }

    function createYtPlayer(vid, autoplay) {
      if (ytPlayer && typeof ytPlayer.destroy === "function") {
        try { ytPlayer.destroy(); } catch (e) {}
        ytPlayer = null;
        ytReady = false;
      }
      if (!ui) {
        resetStage();
        buildShell();
        showCover();
      }
      clearEl(ui.layer);
      ui.layer.appendChild(el("div", "", { id: ytHostId }));
      return loadYouTubeApi().then(function (YT) {
        ytPlayer = new YT.Player(ytHostId, {
          host: "https://www.youtube-nocookie.com",
          width: "100%",
          height: "100%",
          videoId: vid.id,
          playerVars: {
            autoplay: autoplay ? 1 : 0,
            controls: 0,
            rel: 0,
            modestbranding: 1,
            iv_load_policy: 3,
            disablekb: 1,
            fs: 0,
            playsinline: 1,
            enablejsapi: 1,
            cc_load_policy: 0,
            showinfo: 0,
            origin: (global.location && global.location.origin && global.location.origin !== "null")
              ? global.location.origin
              : "https://gladiator2201.github.io"
          },
          events: {
            onReady: function () {
              ytReady = true;
              try {
                ytPlayer.setVolume(lastVolume);
                if (ui) ui.vol.value = String(lastVolume);
              } catch (e) {}
              applyAspect(currentVid());
              syncSeek();
              setMuteIcon();
              if (autoplay || pendingPlay) {
                pendingPlay = false;
                try { ytPlayer.playVideo(); } catch (e) {}
              } else {
                showCover();
              }
            },
            onStateChange: onYtState,
            onError: function () {
              showCover();
              if (ui) {
                ui.coverBtn.textContent = "!";
                ui.coverBtn.setAttribute("aria-label", "Nie udało się odtworzyć tego filmu");
              }
            }
          }
        });
        var ifr = (ytPlayer.getIframe && ytPlayer.getIframe()) || ui.layer.querySelector("iframe");
        if (ifr) {
          ifr.setAttribute("tabindex", "-1");
          ifr.style.pointerEvents = "none";
          ifr.removeAttribute("allowfullscreen");
        }
      }).catch(function () {
        showCover();
      });
    }

    function playDrive(vid) {
      resetStage();
      applyAspect(vid);
      var ifr = document.createElement("iframe");
      ifr.src = "https://drive.google.com/file/d/" + encodeURIComponent(vid.id) + "/preview";
      ifr.allow = "autoplay; fullscreen";
      ifr.setAttribute("allowfullscreen", "true");
      ifr.title = fallbackTitle(vid, currentIndex);
      ensureInner().appendChild(ifr);
      return Promise.resolve();
    }

    function playFile(vid, autoplay) {
      resetStage();
      applyAspect(vid);
      var v = document.createElement("video");
      v.controls = true;
      v.playsInline = true;
      v.setAttribute("playsinline", "");
      v.preload = "metadata";
      v.src = vid.url;
      v.addEventListener("loadedmetadata", function () {
        if (v.videoWidth > 0 && v.videoHeight > 0) {
          vid.ratio = v.videoWidth / v.videoHeight;
          applyAspect(vid);
        }
      });
      v.addEventListener("ended", function () {
        if (shouldAutoNext() && currentList.length) {
          var next = (currentIndex + 1) % currentList.length;
          play(currentList, next, true);
        }
      });
      ensureInner().appendChild(v);
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

    function isFullScreen() {
      var fs = document.fullscreenElement || document.webkitFullscreenElement;
      return fs === stageEl || (stageEl.contains && fs && stageEl.contains(fs));
    }

    function updateFsButton() {
      if (!ui) return;
      var on = isFullScreen();
      ui.btnFs.setAttribute("aria-label", on ? "Zamknij pełny ekran" : "Pełny ekran");
    }

    function requestFullScreen() {
      var doc = document;
      if (isFullScreen()) {
        var exit = doc.exitFullscreen || doc.webkitExitFullscreen || doc.msExitFullscreen;
        if (exit) exit.call(doc);
        return;
      }
      var req = stageEl.requestFullscreen || stageEl.webkitRequestFullscreen || stageEl.msRequestFullscreen;
      if (req) req.call(stageEl);
    }

    document.addEventListener("fullscreenchange", updateFsButton);
    document.addEventListener("webkitfullscreenchange", updateFsButton);

    document.addEventListener("keydown", function (e) {
      var tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === " " || e.code === "Space") {
        if (!stageEl.classList.contains("has-yt") && !stageEl.querySelector("video")) return;
        e.preventDefault();
        if (stageEl.classList.contains("has-yt")) togglePlay();
        else {
          var v = stageEl.querySelector("video");
          if (v) { if (v.paused) v.play(); else v.pause(); }
        }
      } else if (e.key === "f" || e.key === "F") {
        if (tag === "BUTTON") return;
        requestFullScreen();
      } else if (e.key === "m" || e.key === "M") {
        if (stageEl.classList.contains("has-yt")) toggleMute();
      }
    });

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
      togglePlay: togglePlay,
      getIndex: getIndex,
      showEmpty: showEmpty,
      applyAspect: function (vid) { applyAspect(vid || currentVid()); }
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
        var ratioBox = document.createElement("label");
        ratioBox.className = "ratio-fld";
        var ratioLbl = document.createElement("span");
        ratioLbl.textContent = "Proporcje";
        var ratioHint = document.createElement("em");
        ratioHint.className = "ratio-hint";
        ratioHint.textContent = "Auto pokazuje cały kadr. 4:3 przycina boki.";
        var sel = document.createElement("select");
        sel.setAttribute("aria-label", "Proporcje obrazu");
        [["", "Auto (cały kadr)"], ["16:9", "16:9"], ["4:3", "4:3"], ["9:16", "9:16"], ["1:1", "1:1"]].forEach(function (opt) {
          var option = document.createElement("option");
          option.value = opt[0];
          option.textContent = opt[1];
          sel.appendChild(option);
        });
        sel.value = vid.ratioOverride || "";
        sel.addEventListener("change", function () {
          vid.ratioOverride = sel.value || "";
          if (o.onRatio) o.onRatio(index, vid.ratioOverride);
        });
        ratioBox.appendChild(ratioLbl);
        ratioBox.appendChild(sel);
        ratioBox.appendChild(ratioHint);
        tools.appendChild(ratioBox);
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
    shareUrlQuery: shareUrlQuery,
    payloadFromLocation: payloadFromLocation,
    facebookShareUrl: facebookShareUrl,
    openFacebookShare: openFacebookShare,
    parseLink: parseLink,
    extractLinksFromText: extractLinksFromText,
    fetchTitle: fetchTitle,
    ensureRatio: ensureRatio,
    displayRatio: displayRatio,
    RATIO_PRESETS: RATIO_PRESETS,
    createPlayer: createPlayer,
    renderPosters: renderPosters,
    fallbackTitle: fallbackTitle,
    kindLabel: kindLabel,
    sameVideo: sameVideo,
    youtubeThumb: youtubeThumb
  };
})(window);
