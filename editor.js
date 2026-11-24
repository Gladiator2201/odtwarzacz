(function () {
  "use strict";
  var O = window.Odtwarzacz;
  var STORE = "odtwarzacz.zestawy.v1";
  var set = { id: "", name: "", dedication: "", autoNext: false, videos: [] };
  var player;

  function $(id) { return document.getElementById(id); }

  function uid() {
    return "z" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function loadStore() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return { sets: [], currentId: "", working: null };
      var data = JSON.parse(raw);
      if (!data || typeof data !== "object") return { sets: [], currentId: "", working: null };
      if (!Array.isArray(data.sets)) data.sets = [];
      if (!data.currentId) data.currentId = "";
      return data;
    } catch (e) {
      return { sets: [], currentId: "", working: null };
    }
  }

  function saveStore(data) {
    localStorage.setItem(STORE, JSON.stringify(data));
  }

  function serializeVideo(v) {
    if (!v || typeof v !== "object") return null;
    var type = v.type || "";
    var id = v.id || v.y || "";
    var url = v.url || v.u || "";
    if (!type && v.y) type = "yt";
    if (!type && v.g) { type = "drive"; id = v.g; }
    if (!type && url) type = "file";
    if (type === "yt" && id && !url) url = "https://www.youtube.com/watch?v=" + id;
    if (type === "drive" && id && !url) url = "https://drive.google.com/file/d/" + id + "/view";
    if (!type || (type === "yt" && !id) || (type === "drive" && !id) || (type === "file" && !url)) return null;
    var out = { type: type, title: v.title || v.t || "", url: url, thumb: v.thumb || "" };
    if (id) out.id = id;
    if (typeof v.ratio === "number" && isFinite(v.ratio)) out.ratio = v.ratio;
    else if (typeof v.p === "number" && isFinite(v.p)) out.ratio = v.p;
    if (v.ratioOverride) out.ratioOverride = v.ratioOverride;
    else if (v.o) out.ratioOverride = v.o;
    if (v.short || v.s) out.short = true;
    return out;
  }

  function serializeSet(src) {
    src = src || set;
    return {
      id: src.id || "",
      name: src.name || "",
      dedication: src.dedication || "",
      autoNext: !!src.autoNext,
      videos: videoList(src).map(serializeVideo).filter(Boolean)
    };
  }

  function applySerialized(src) {
    var snap = serializeSet(src);
    set = {
      id: snap.id,
      name: snap.name,
      dedication: snap.dedication,
      autoNext: snap.autoNext,
      videos: snap.videos.slice()
    };
    return set;
  }

  function persistWorking() {
    try {
      var store = loadStore();
      var snap = serializeSet(set);
      store.working = snap;
      if (set.id) {
        var idx = store.sets.findIndex(function (s) { return s.id === set.id; });
        if (idx >= 0) store.sets[idx] = snap;
      }
      saveStore(store);
      return true;
    } catch (e) {
      return false;
    }
  }

  var persistTimer = null;
  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(function () {
      persistTimer = null;
      currentFromForm();
      persistWorking();
    }, 400);
  }

  function currentFromForm() {
    set.dedication = $("dedication-input").value.trim();
    set.name = $("set-name").value.trim() || set.dedication || "Zestaw";
    set.autoNext = $("chk-autonext").checked;
    return set;
  }

  function applyToForm() {
    $("dedication-input").value = set.dedication || "";
    $("set-name").value = set.name || "";
    $("chk-autonext").checked = !!set.autoNext;
    $("dedication").textContent = set.dedication || "";
    document.title = set.dedication
      ? ("Układanie zestawu · " + set.dedication)
      : "Układanie zestawu · Odtwarzacz";
  }

  function refreshList() {
    var store = loadStore();
    var sel = $("set-list");
    var keep = set.id || "";
    sel.innerHTML = "";
    var blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "— wybierz zapisany zestaw —";
    sel.appendChild(blank);
    store.sets.forEach(function (s) {
      var opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name || s.dedication || "Zestaw bez nazwy";
      if (s.id === keep) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function refreshPosters() {
    O.renderPosters($("posters"), set.videos, {
      active: player ? player.getIndex() : -1,
      editable: true,
      onSelect: function (i) { player.play(set.videos, i, true); refreshPosters(); },
      onRemove: function (i) {
        set.videos.splice(i, 1);
        var idx = player.getIndex();
        if (!set.videos.length) player.showEmpty("Dodaj łącza, a film pojawi się tutaj.");
        else {
          if (idx >= set.videos.length) idx = set.videos.length - 1;
          if (idx < 0) idx = 0;
          player.play(set.videos, idx, false);
        }
        refreshPosters();
        onChange();
        persistWorking();
      },
      onMove: function (i, dir) {
        var j = i + dir;
        if (j < 0 || j >= set.videos.length) return;
        var tmp = set.videos[i];
        set.videos[i] = set.videos[j];
        set.videos[j] = tmp;
        var idx = player.getIndex();
        if (idx === i) idx = j;
        else if (idx === j) idx = i;
        if (idx >= 0) player.play(set.videos, idx, false);
        refreshPosters();
        persistWorking();
      },
      onRatio: function (i, value) {
        set.videos[i].ratioOverride = value || "";
        if (player && player.getIndex() === i) player.applyAspect(set.videos[i]);
        persistWorking();
      }
    });
    $("empty-msg").hidden = set.videos.length > 0;
    onChange();
  }

  function onChange() {
    var has = set.videos.length > 0;
    $("btn-prev").disabled = !has;
    $("btn-next").disabled = !has;
    $("btn-full").disabled = !has;
    $("btn-share").disabled = !has;
    var fb = $("btn-fb");
    if (fb) fb.disabled = !has;
  }

  function status(msg, isErr) {
    var el = $("add-status");
    el.textContent = msg || "";
    el.className = "status" + (isErr ? " err" : "");
  }

  function videoList(src) {
    var list = src && src.videos;
    if (Array.isArray(list)) return list;
    if (list && typeof list === "object" && typeof list.length === "number") {
      return Array.prototype.slice.call(list);
    }
    return [];
  }

  /* Wciąga łącza z pola tekstowego do zestawu — też przy zapisie i eksporcie,
     gdy ktoś wklei adresy i kliknie Eksportuj / Zapisz bez „Dodaj do zestawu”. */
  async function incorporatePendingLinks() {
    currentFromForm();
    if (!Array.isArray(set.videos)) set.videos = videoList(set);
    var text = $("links") ? $("links").value : "";
    var optionalTitle = $("title-input") ? $("title-input").value.trim() : "";
    var found = O.extractLinksFromText(text);
    if (!found.length) return { added: 0, skipped: 0, found: 0 };
    var added = 0, skipped = 0;
    for (var i = 0; i < found.length; i++) {
      var vid = found[i];
      var dup = set.videos.some(function (v) { return O.sameVideo(v, vid); });
      if (dup) { skipped++; continue; }
      if (optionalTitle && found.length === 1) vid.title = optionalTitle;
      if (vid.type === "yt") {
        try { await O.fetchTitle(vid); } catch (e) { /* tytuł opcjonalny */ }
      }
      if (!vid.title && optionalTitle && found.length === 1) vid.title = optionalTitle;
      set.videos.push(vid);
      added++;
    }
    if (added || skipped) {
      $("links").value = "";
      $("title-input").value = "";
    }
    if (added) {
      refreshPosters();
      if (player && player.getIndex() < 0) player.play(set.videos, 0, false);
      persistWorking();
    }
    return { added: added, skipped: skipped, found: found.length };
  }

  async function addLinks() {
    var result = await incorporatePendingLinks();
    if (!result.found) {
      status("Nie rozpoznałem żadnego łącza. Wklej adres YouTube, pliku albo Google Drive.", true);
      return;
    }
    var parts = [];
    if (result.added) parts.push("Dodano " + result.added + (result.added === 1 ? " film." : " filmy."));
    if (result.skipped) parts.push("Pominięto " + result.skipped + " (już były w zestawie).");
    status(parts.join(" ") || "Nic nie dodano.");
  }

  function sameName(a, b) {
    return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  }

  async function saveSet() {
    currentFromForm();
    await incorporatePendingLinks();
    if (!set.videos.length && !set.dedication && !set.name) {
      status("Nie ma czego zapisać — dodaj choć film albo nazwę.", true);
      return;
    }
    if (!set.videos.length) {
      if (!window.confirm("Zestaw „" + (set.name || "bez nazwy") + "” nie ma jeszcze filmów. Zapisać pusty?")) return;
    }
    var store = loadStore();
    var other = store.sets.filter(function (s) {
      return s.id !== set.id && sameName(s.name, set.name);
    })[0];
    if (other) {
      if (!window.confirm("Zestaw o nazwie „" + set.name + "” już jest. Zastąpić go tym (wraz z filmami)?")) return;
      set.id = other.id;
    }
    if (!set.id) set.id = uid();
    var snap = serializeSet(set);
    var idx = store.sets.findIndex(function (s) { return s.id === set.id; });
    if (idx >= 0) store.sets[idx] = snap;
    else store.sets.push(snap);
    store.currentId = set.id;
    store.working = snap;
    try {
      saveStore(store);
    } catch (e) {
      status("Nie udało się zapisać w przeglądarce (brak miejsca albo tryb prywatny). Proszę wyeksportować zestaw do pliku.", true);
      return;
    }
    refreshList();
    status("Zestaw zapisany w tej przeglądarce: " + set.name + " (" + snap.videos.length + " " + (snap.videos.length === 1 ? "film" : "filmów") + ").");
  }

  function newSet() {
    set = { id: "", name: "", dedication: "", autoNext: false, videos: [] };
    applyToForm();
    player.showEmpty("Dodaj łącza, a film pojawi się tutaj.");
    refreshPosters();
    $("set-list").value = "";
    persistWorking();
    status("Nowy, pusty zestaw.");
  }

  function deleteSet() {
    currentFromForm();
    if (!set.id) { status("Ten zestaw nie był jeszcze zapisany pod nazwą.", true); return; }
    if (!window.confirm("Usunąć zapis „" + (set.name || "bez nazwy") + "” z tej przeglądarki?")) return;
    var store = loadStore();
    store.sets = store.sets.filter(function (s) { return s.id !== set.id; });
    if (store.currentId === set.id) store.currentId = "";
    set.id = "";
    store.working = serializeSet(set);
    try { saveStore(store); } catch (e) {}
    newSet();
    refreshList();
    status("Zapis usunięty.");
  }

  function showLoadedSet() {
    applyToForm();
    if (set.videos.length) player.play(set.videos, 0, false);
    else player.showEmpty("Dodaj łącza, a film pojawi się tutaj.");
    refreshPosters();
  }

  function loadSet(id) {
    var store = loadStore();
    var found = store.sets.filter(function (s) { return s.id === id; })[0];
    if (!found) return;
    applySerialized(found);
    store.currentId = set.id;
    store.working = serializeSet(set);
    try { saveStore(store); } catch (e) {}
    showLoadedSet();
    status("Wczytano: " + (set.name || "zestaw") + " (" + set.videos.length + " " + (set.videos.length === 1 ? "film" : "filmów") + ").");
  }

  function fileSafeName(name) {
    var n = String(name || "zestaw").trim().replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
    return n || "zestaw";
  }

  function downloadJson(filename, text) {
    var blob = new Blob([text], { type: "application/json;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.setAttribute("download", filename);
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  async function exportSet() {
    currentFromForm();
    await incorporatePendingLinks();
    var videos = serializeSet(set).videos;
    var payload = {
      v: 1,
      name: set.name || "",
      dedication: set.dedication || "",
      autoNext: !!set.autoNext,
      videos: videos,
      links: videos.map(function (v) { return v.url; }).filter(Boolean)
    };
    if (!payload.videos.length) {
      status("Nie ma filmów do eksportu. Wklej łącza i kliknij „Dodaj do zestawu” (albo Eksportuj, gdy łącza są jeszcze w polu).", true);
      return;
    }
    var text;
    try {
      text = JSON.stringify(payload, null, 2);
    } catch (e) {
      status("Nie udało się zapisać pliku JSON.", true);
      return;
    }
    downloadJson("zestaw-" + fileSafeName(payload.name || payload.dedication) + ".json", text);
    status("Zapisano plik zapasowy z " + payload.videos.length + " " + (payload.videos.length === 1 ? "filmem" : "filmami") + ".");
  }

  function importSetFromObject(data) {
    if (!data || typeof data !== "object") throw new Error("bad");
    // full editor export, or a stored snapshot, or a compact share-like object
    var src = data;
    if (data.working && (data.working.videos || data.working.name)) src = data.working;
    if (Array.isArray(data.sets) && !data.videos && !data.i) {
      throw new Error("bundle");
    }
    var videos = videoList(data).length ? videoList(data) : videoList(src);
    if (!videos.length && Array.isArray(data.links)) {
      videos = data.links.map(function (u) { return O.parseLink(String(u)); }).filter(Boolean);
    }
    if (!videos.length && Array.isArray(data.i)) {
      videos = data.i.map(function (item) {
        if (!item || typeof item !== "object") return null;
        var vid = null;
        if (item.y) vid = O.parseLink("https://www.youtube.com/watch?v=" + item.y);
        else if (item.g) vid = O.parseLink("https://drive.google.com/file/d/" + item.g + "/view");
        else if (item.u) vid = O.parseLink(String(item.u));
        if (!vid) return null;
        if (item.t) vid.title = item.t;
        if (typeof item.p === "number") vid.ratio = item.p;
        if (item.o) vid.ratioOverride = item.o;
        if (item.s) vid.short = true;
        return vid;
      }).filter(Boolean);
    }
    applySerialized({
      id: "",
      name: src.name || src.n || data.n || "",
      dedication: src.dedication || src.d || data.d || "",
      autoNext: !!(src.autoNext || src.a || data.a),
      videos: videos
    });
    if (!set.videos.length && !set.name && !set.dedication) throw new Error("empty");
    showLoadedSet();
    persistWorking();
    $("set-list").value = "";
    status("Wczytano z pliku: " + (set.name || "zestaw") + " (" + set.videos.length + " " + (set.videos.length === 1 ? "film" : "filmów") + "). Możesz go teraz zapisać w przeglądarce.");
  }

  function importSetFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result || ""));
        importSetFromObject(data);
      } catch (e) {
        status("Ten plik nie wygląda na zapis zestawu.", true);
      }
    };
    reader.onerror = function () { status("Nie udało się odczytać pliku.", true); };
    reader.readAsText(file);
  }

  function makeQr(url) {
    var box = $("qr-box");
    box.innerHTML = "";
    if (typeof qrcode !== "function") {
      var p = document.createElement("p");
      p.className = "ovhint";
      p.textContent = "Nie udało się narysować kodu QR, ale łącze jest gotowe do skopiowania.";
      box.appendChild(p);
      return;
    }
    try {
      var qr = qrcode(0, "M");
      qr.addData(url);
      qr.make();
      var img = document.createElement("img");
      img.alt = "Kod QR zestawu";
      img.src = qr.createDataURL(6, 4);
      box.appendChild(img);
    } catch (e) {
      var q = document.createElement("p");
      q.className = "ovhint";
      q.textContent = "Zestaw jest zbyt duży na kod QR — proszę skopiować łącze.";
      box.appendChild(q);
    }
  }

  async function share() {
    currentFromForm();
    await incorporatePendingLinks();
    if (!set.videos.length) {
      status("Najpierw dodaj przynajmniej jeden film.", true);
      return;
    }
    var hash = await O.encodeSet(set);
    var url = O.CANONICAL + "#" + hash;
    // Na podglądzie lokalnym łączymy z tą samą kopią strony
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
      url = O.shareUrlFor(hash);
    }
    $("share-url").value = url;
    makeQr(url);
    $("ov").hidden = false;
    $("share-url").focus();
    $("share-url").select();
  }

  async function shareFacebook() {
    currentFromForm();
    await incorporatePendingLinks();
    if (!set.videos.length) {
      status("Najpierw dodaj przynajmniej jeden film.", true);
      return;
    }
    var hash = await O.encodeSet(set);
    var opened = O.openFacebookShare(hash);
    if (!opened) status("Przeglądarka zablokowała okno Facebooka — proszę zezwolić na wyskakujące okna.", true);
  }

  function closeShare() {
    $("ov").hidden = true;
  }

  async function copyLink() {
    var url = $("share-url").value;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        $("share-url").select();
        document.execCommand("copy");
      }
      status("Łącze skopiowane.");
    } catch (e) {
      $("share-url").select();
      status("Proszę skopiować łącze ręcznie (Ctrl+C).", true);
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    player = O.createPlayer($("stage"), $("now-playing"), {
      emptyText: "Dodaj łącza, a film pojawi się tutaj.",
      autoNext: function () { return $("chk-autonext").checked; },
      onChange: function () { refreshPosters(); }
    });

    $("dedication-input").addEventListener("input", function () {
      $("dedication").textContent = $("dedication-input").value.trim();
      schedulePersist();
    });
    $("set-name").addEventListener("input", schedulePersist);
    $("chk-autonext").addEventListener("change", schedulePersist);
    $("btn-add").addEventListener("click", addLinks);
    $("btn-save").addEventListener("click", saveSet);
    $("btn-new").addEventListener("click", newSet);
    $("btn-delete").addEventListener("click", deleteSet);
    $("btn-export").addEventListener("click", exportSet);
    $("btn-import").addEventListener("click", function () { $("import-file").click(); });
    $("import-file").addEventListener("change", function () {
      var f = this.files && this.files[0];
      this.value = "";
      if (f) importSetFile(f);
    });
    $("set-list").addEventListener("change", function () {
      if (this.value) loadSet(this.value);
    });
    $("btn-share").addEventListener("click", share);
    $("btn-fb").addEventListener("click", shareFacebook);
    $("btn-copy").addEventListener("click", copyLink);
    $("btn-fb-modal").addEventListener("click", shareFacebook);
    $("btn-close").addEventListener("click", closeShare);
    $("ov").addEventListener("click", function (e) {
      if (e.target === $("ov")) closeShare();
    });
    $("btn-prev").addEventListener("click", function () { player.playPrev(); });
    $("btn-next").addEventListener("click", function () { player.playNext(); });
    $("btn-full").addEventListener("click", function () { player.requestFullScreen(); });

    refreshList();
    var store = loadStore();
    var restored = false;
    if (store.working && ((store.working.videos && store.working.videos.length) || store.working.name || store.working.dedication)) {
      applySerialized(store.working);
      showLoadedSet();
      if (set.id) $("set-list").value = set.id;
      restored = true;
    } else if (store.currentId) {
      loadSet(store.currentId);
      restored = true;
    }
    if (!restored) {
      applyToForm();
      player.showEmpty("Dodaj łącza, a film pojawi się tutaj.");
      refreshPosters();
    }

    // Jeśli ktoś wklei hash do adresu edytora, wczytaj zestaw do pracy (łącze udostępniania i tak prowadzi do odtwarzacza).
    if (location.hash && location.hash.length > 2) {
      O.decodeHash(location.hash).then(function (decoded) {
        if (!decoded || !decoded.videos.length) return;
        applySerialized({ id: "", name: decoded.name || "", dedication: decoded.dedication || "", autoNext: !!decoded.autoNext, videos: decoded.videos });
        showLoadedSet();
        persistWorking();
        $("set-list").value = "";
        status("Wczytano zestaw z łącza — możesz go poprawić i znów udostępnić.");
      });
    }
  });
})();
