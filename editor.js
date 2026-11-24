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
      if (!raw) return { sets: [], currentId: "" };
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.sets)) return { sets: [], currentId: "" };
      return data;
    } catch (e) {
      return { sets: [], currentId: "" };
    }
  }

  function saveStore(data) {
    localStorage.setItem(STORE, JSON.stringify(data));
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

  async function addLinks() {
    currentFromForm();
    var text = $("links").value;
    var optionalTitle = $("title-input").value.trim();
    var found = O.extractLinksFromText(text);
    if (!found.length) {
      status("Nie rozpoznałem żadnego łącza. Wklej adres YouTube, pliku albo Google Drive.", true);
      return;
    }
    var added = 0, skipped = 0;
    for (var i = 0; i < found.length; i++) {
      var vid = found[i];
      var dup = set.videos.some(function (v) { return O.sameVideo(v, vid); });
      if (dup) { skipped++; continue; }
      if (optionalTitle && found.length === 1) vid.title = optionalTitle;
      if (vid.type === "yt") await O.fetchTitle(vid);
      if (!vid.title && optionalTitle && found.length === 1) vid.title = optionalTitle;
      set.videos.push(vid);
      added++;
    }
    $("links").value = "";
    $("title-input").value = "";
    var parts = [];
    if (added) parts.push("Dodano " + added + (added === 1 ? " film." : " filmy."));
    if (skipped) parts.push("Pominięto " + skipped + " (już były w zestawie).");
    status(parts.join(" ") || "Nic nie dodano.");
    refreshPosters();
    if (added && player.getIndex() < 0) player.play(set.videos, 0, false);
  }

  function saveSet() {
    currentFromForm();
    if (!set.videos.length && !set.dedication && !set.name) {
      status("Nie ma czego zapisać — dodaj choć film albo nazwę.", true);
      return;
    }
    if (!set.id) set.id = uid();
    var store = loadStore();
    var idx = store.sets.findIndex(function (s) { return s.id === set.id; });
    var snap = {
      id: set.id,
      name: set.name,
      dedication: set.dedication,
      autoNext: set.autoNext,
      videos: set.videos
    };
    if (idx >= 0) store.sets[idx] = snap;
    else store.sets.push(snap);
    store.currentId = set.id;
    saveStore(store);
    refreshList();
    status("Zestaw zapisany w tej przeglądarce: " + set.name);
  }

  function newSet() {
    set = { id: "", name: "", dedication: "", autoNext: false, videos: [] };
    applyToForm();
    player.showEmpty("Dodaj łącza, a film pojawi się tutaj.");
    refreshPosters();
    $("set-list").value = "";
    status("Nowy, pusty zestaw.");
  }

  function deleteSet() {
    currentFromForm();
    if (!set.id) { status("Ten zestaw nie był jeszcze zapisany.", true); return; }
    if (!window.confirm("Usunąć zapis „" + (set.name || "bez nazwy") + "” z tej przeglądarki?")) return;
    var store = loadStore();
    store.sets = store.sets.filter(function (s) { return s.id !== set.id; });
    if (store.currentId === set.id) store.currentId = "";
    saveStore(store);
    newSet();
    refreshList();
    status("Zapis usunięty.");
  }

  function loadSet(id) {
    var store = loadStore();
    var found = store.sets.filter(function (s) { return s.id === id; })[0];
    if (!found) return;
    set = {
      id: found.id,
      name: found.name || "",
      dedication: found.dedication || "",
      autoNext: !!found.autoNext,
      videos: (found.videos || []).slice()
    };
    store.currentId = set.id;
    saveStore(store);
    applyToForm();
    if (set.videos.length) player.play(set.videos, 0, false);
    else player.showEmpty("Dodaj łącza, a film pojawi się tutaj.");
    refreshPosters();
    status("Wczytano: " + (set.name || "zestaw"));
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
    });
    $("btn-add").addEventListener("click", addLinks);
    $("btn-save").addEventListener("click", saveSet);
    $("btn-new").addEventListener("click", newSet);
    $("btn-delete").addEventListener("click", deleteSet);
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
    if (store.currentId) loadSet(store.currentId);
    else {
      applyToForm();
      player.showEmpty("Dodaj łącza, a film pojawi się tutaj.");
      refreshPosters();
    }

    // Jeśli ktoś wklei hash do adresu edytora, wczytaj zestaw do pracy (łącze udostępniania i tak prowadzi do odtwarzacza).
    if (location.hash && location.hash.length > 2) {
      O.decodeHash(location.hash).then(function (decoded) {
        if (!decoded || !decoded.videos.length) return;
        set = { id: "", name: decoded.name || "", dedication: decoded.dedication || "", autoNext: !!decoded.autoNext, videos: decoded.videos };
        applyToForm();
        player.play(set.videos, 0, false);
        refreshPosters();
        status("Wczytano zestaw z łącza — możesz go poprawić i znów udostępnić.");
      });
    }
  });
})();
