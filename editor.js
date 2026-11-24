(function () {
  "use strict";
  var O = window.Odtwarzacz;
  var STORE = "odtwarzacz.zestawy.v1";
  var set = { id: "", name: "", dedication: "", autoNext: false, videos: [] };
  var player;
  var importedFileName = "";

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
    if (src && src.importFileName) importedFileName = sanitizeDownloadName(src.importFileName);
    return set;
  }

  function localSnap(src) {
    var snap = serializeSet(src);
    if (importedFileName) snap.importFileName = importedFileName;
    return snap;
  }

  function persistWorking() {
    try {
      var store = loadStore();
      var snap = localSnap(set);
      store.working = snap;
      // Autozapis uaktualnia nazwany zestaw tylko gdy nadal jesteśmy do niego podpięci
      // i nie nadpisuje go pustką (Nowy zestaw / wyczyszczona praca).
      if (set.id) {
        var idx = store.sets.findIndex(function (s) { return s.id === set.id; });
        if (idx >= 0) {
          var prev = store.sets[idx];
          var wiping = !(snap.videos && snap.videos.length) && prev && prev.videos && prev.videos.length;
          if (!wiping) store.sets[idx] = snap;
        }
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
    set.name = $("set-name").value.trim();
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
        syncLinksTextarea();
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
        syncLinksTextarea();
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

  function videoUrl(v) {
    if (!v) return "";
    if (v.type === "yt" && (v.id || v.y)) return "https://www.youtube.com/watch?v=" + (v.id || v.y);
    if (v.type === "drive" && (v.id || v.g)) return "https://drive.google.com/file/d/" + (v.id || v.g) + "/view";
    return v.url || v.u || "";
  }

  function videoKey(v) {
    if (!v) return "";
    if ((v.type === "yt" || v.y) && (v.id || v.y)) return "yt:" + (v.id || v.y);
    if ((v.type === "drive" || v.g) && (v.id || v.g)) return "drive:" + (v.id || v.g);
    return (v.type || "file") + ":" + (v.url || v.u || "");
  }

  function syncLinksTextarea() {
    var el = $("links");
    if (!el) return;
    el.value = videoList(set).map(videoUrl).filter(Boolean).join("\n");
  }

  function linksFromTextarea() {
    var el = $("links");
    var raw = el ? String(el.value || "") : "";
    var lines = raw.split(/\r?\n/);
    var found = [];
    var seen = {};
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var parsed = O.parseLink(line);
      if (!parsed) {
        var extracted = O.extractLinksFromText(line);
        parsed = extracted && extracted[0] ? extracted[0] : null;
      }
      if (!parsed) continue;
      var key = videoKey(parsed);
      if (!key || seen[key]) continue;
      seen[key] = true;
      found.push(parsed);
    }
    return found;
  }

  /* Zestaw = zawartość pola łączy, w tej samej kolejności.
     Znane filmy (ten sam identyfikator YouTube) zachowują tytuł, miniaturę i proporcje. */
  async function updateSetFromTextarea() {
    currentFromForm();
    if (!Array.isArray(set.videos)) set.videos = videoList(set);
    var incoming = linksFromTextarea();
    if (!incoming.length && set.videos.length) {
      if (!window.confirm("W polu łączy nie ma adresów. Usunąć wszystkie filmy z zestawu?")) {
        syncLinksTextarea();
        return { cancelled: true, added: 0, kept: 0, removed: 0, found: 0, total: set.videos.length };
      }
    }
    var byKey = {};
    set.videos.forEach(function (v) {
      var k = videoKey(v);
      if (k && !byKey[k]) byKey[k] = v;
    });
    var optionalTitle = $("title-input") ? $("title-input").value.trim() : "";
    var next = [];
    var added = 0, kept = 0;
    for (var i = 0; i < incoming.length; i++) {
      var parsed = incoming[i];
      var existing = byKey[videoKey(parsed)];
      if (existing) {
        next.push(existing);
        kept++;
        continue;
      }
      if (optionalTitle && incoming.length === 1) parsed.title = optionalTitle;
      if (parsed.type === "yt") {
        try { await O.fetchTitle(parsed); } catch (e) { /* tytuł opcjonalny */ }
      }
      if (!parsed.title && optionalTitle && incoming.length === 1) parsed.title = optionalTitle;
      next.push(parsed);
      added++;
    }
    var removed = set.videos.length - kept;
    var prevId = null;
    var cur = currentVidSafe();
    if (cur) prevId = videoKey(cur);
    set.videos = next;
    if ($("title-input")) $("title-input").value = "";
    syncLinksTextarea();
    refreshPosters();
    if (!set.videos.length) {
      if (player) player.showEmpty("Dodaj łącza, a film pojawi się tutaj.");
    } else if (player) {
      var idx = 0;
      if (prevId) {
        for (var j = 0; j < set.videos.length; j++) {
          if (videoKey(set.videos[j]) === prevId) { idx = j; break; }
        }
      }
      player.play(set.videos, idx, false);
    }
    persistWorking();
    return { cancelled: false, added: added, kept: kept, removed: removed, found: incoming.length, total: set.videos.length };
  }

  function currentVidSafe() {
    if (!player || typeof player.getIndex !== "function") return null;
    var i = player.getIndex();
    return i >= 0 ? set.videos[i] : null;
  }

  function filmow(n) {
    n = Math.abs(n);
    if (n === 1) return "1 film";
    var mod10 = n % 10, mod100 = n % 100;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return n + " filmy";
    return n + " filmów";
  }

  async function onUpdateSet() {
    var result = await updateSetFromTextarea();
    if (result.cancelled) return result;
    if (!result.found && !result.removed) {
      status("Nie rozpoznałem żadnego łącza. Wklej adres YouTube, pliku albo Google Drive.", true);
      return result;
    }
    var parts = ["Zestaw uaktualniony: " + filmow(result.total) + "."];
    if (result.added) parts.push("Dodano " + filmow(result.added) + ".");
    if (result.removed) parts.push("Usunięto " + filmow(result.removed) + ".");
    status(parts.join(" "));
    return result;
  }

  function sameName(a, b) {
    return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  }

  async function saveSet() {
    currentFromForm();
    await updateSetFromTextarea();
    if (!set.videos.length && !set.dedication && !set.name) {
      status("Nie ma czego zapisać — dodaj choć film albo nazwę.", true);
      return;
    }
    if (!set.name) {
      set.name = set.dedication || "Zestaw";
      $("set-name").value = set.name;
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
    var snap = localSnap(set);
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

  function hasWorkingContent() {
    var name = $("set-name") ? $("set-name").value.trim() : "";
    var ded = $("dedication-input") ? $("dedication-input").value.trim() : "";
    var links = $("links") ? $("links").value.trim() : "";
    return (set.videos && set.videos.length) || !!name || !!ded || !!links;
  }

  function newSet() {
    if (hasWorkingContent()) {
      if (!window.confirm("Wyczyścić bieżącą pracę? Zapisane zestawy zostaną.")) return;
    }
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    set = { id: "", name: "", dedication: "", autoNext: false, videos: [] };
    importedFileName = "";
    applyToForm();
    player.showEmpty("Dodaj łącza, a film pojawi się tutaj.");
    refreshPosters();
    $("set-list").value = "";
    syncLinksTextarea();
    try {
      var store = loadStore();
      store.working = localSnap(set);
      store.currentId = "";
      saveStore(store);
    } catch (e) { /* praca jest już pusta na ekranie */ }
    refreshList();
    $("set-list").value = "";
    status("Nowy, pusty zestaw. Zapisane zestawy są nadal na liście.");
  }

  function deleteSet() {
    currentFromForm();
    var store = loadStore();
    var selId = $("set-list").value || "";
    var target = store.sets.filter(function (s) { return s.id === selId; })[0];
    if (!target) {
      status("Najpierw wybierz zestaw z listy „Zapisane zestawy”, a potem kliknij „Usuń zapis”.", true);
      $("set-list").focus();
      return;
    }
    var label = target.name || target.dedication || "bez nazwy";
    if (!window.confirm("Usunąć zapis „" + label + "” z tej przeglądarki?")) return;
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    store.sets = store.sets.filter(function (s) { return s.id !== target.id; });
    if (store.currentId === target.id) store.currentId = "";
    if (set.id === target.id || sameName(set.name, target.name)) {
      /* bieżąca praca zostaje, ale bez powiązania z usuniętym zapisem */
      set.id = "";
      set.name = "";
      $("set-name").value = "";
    }
    store.working = localSnap(set);
    try { saveStore(store); } catch (e) {
      status("Nie udało się usunąć zapisu w tej przeglądarce.", true);
      return;
    }
    refreshList();
    $("set-list").value = "";
    status("Usunięto zapis „" + label + "”. Filmy na ekranie zostały — możesz je zapisać pod nową nazwą albo kliknąć „Nowy zestaw”.");
  }

  function showLoadedSet() {
    applyToForm();
    if (set.videos.length) player.play(set.videos, 0, false);
    else player.showEmpty("Dodaj łącza, a film pojawi się tutaj.");
    refreshPosters();
    syncLinksTextarea();
  }

  function loadSet(id) {
    var store = loadStore();
    var found = store.sets.filter(function (s) { return s.id === id; })[0];
    if (!found) return;
    importedFileName = "";
    applySerialized(found);
    store.currentId = set.id;
    store.working = localSnap(set);
    try { saveStore(store); } catch (e) {}
    showLoadedSet();
    status("Wczytano: " + (set.name || "zestaw") + " (" + set.videos.length + " " + (set.videos.length === 1 ? "film" : "filmów") + ").");
  }

  function fileSafeName(name) {
    var n = String(name || "zestaw").trim().replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
    return n || "zestaw";
  }

  function sanitizeDownloadName(name) {
    var n = String(name || "").trim().replace(/^.*[\\/]/, "");
    n = n.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
    if (!n || n === "." || n === "..") return "";
    if (!/\.json$/i.test(n)) n += ".json";
    return n;
  }

  function exportDownloadName(payload) {
    if (importedFileName) return importedFileName;
    return "zestaw-" + fileSafeName(payload.name || payload.dedication) + ".json";
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
    await updateSetFromTextarea();
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
    var fname = exportDownloadName(payload);
    downloadJson(fname, text);
    status("Zapisano plik " + fname + " z " + payload.videos.length + " " + (payload.videos.length === 1 ? "filmem" : "filmami") + ".");
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
    status("Wczytano z pliku" + (importedFileName ? " " + importedFileName : "") + ": " + (set.name || "zestaw") + " (" + set.videos.length + " " + (set.videos.length === 1 ? "film" : "filmów") + "). Eksport znów zapisze ten sam plik.");
  }

  function importSetFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var prevName = importedFileName;
      try {
        var data = JSON.parse(String(reader.result || ""));
        var name = sanitizeDownloadName(file && file.name);
        if (name) importedFileName = name;
        importSetFromObject(data);
      } catch (e) {
        importedFileName = prevName;
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
    await updateSetFromTextarea();
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
    await updateSetFromTextarea();
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
    $("btn-update").addEventListener("click", onUpdateSet);
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
