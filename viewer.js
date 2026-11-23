(function () {
  "use strict";
  var O = window.Odtwarzacz;
  var set = { dedication: "", name: "", autoNext: false, videos: [] };
  var player;

  function $(id) { return document.getElementById(id); }

  function applyDedication(text) {
    var el = $("dedication");
    var t = (text || "").trim();
    el.textContent = t;
    document.title = t ? ("Odtwarzacz · " + t) : "Odtwarzacz";
  }

  function refreshPosters() {
    O.renderPosters($("posters"), set.videos, {
      active: player ? player.getIndex() : -1,
      editable: false,
      onSelect: function (i) { player.play(set.videos, i, true); refreshPosters(); }
    });
    $("posters-wrap").hidden = set.videos.length === 0;
    $("empty-msg").hidden = set.videos.length > 0;
  }

  function onChange() {
    refreshPosters();
    var has = set.videos.length > 0;
    $("btn-prev").disabled = !has;
    $("btn-next").disabled = !has;
    $("btn-full").disabled = !has;
  }

  async function loadFromHash() {
    var decoded = await O.decodeHash(location.hash);
    if (!decoded || !decoded.videos.length) {
      set = { dedication: "", name: "", autoNext: false, videos: [] };
      applyDedication("");
      if (!location.hash || location.hash === "#") {
        player.showEmpty("Kurtyna jest jeszcze zasunięta.");
        $("empty-msg").textContent = "Ten odtwarzacz czeka na zestaw filmów.";
      } else {
        player.showEmpty("Nie udało się otworzyć tego zestawu.");
        $("empty-msg").textContent = "Nie udało się otworzyć tego zestawu.";
      }
      $("empty-msg").hidden = false;
      $("posters-wrap").hidden = true;
      $("chk-autonext").checked = false;
      onChange();
      return;
    }
    set = decoded;
    applyDedication(set.dedication);
    $("chk-autonext").checked = !!set.autoNext;
    $("empty-msg").hidden = true;
    await player.play(set.videos, 0, false);
    onChange();
  }

  document.addEventListener("DOMContentLoaded", function () {
    player = O.createPlayer($("stage"), $("now-playing"), {
      emptyText: "Kurtyna jest jeszcze zasunięta.",
      autoNext: function () { return $("chk-autonext").checked; },
      onChange: onChange
    });
    $("btn-prev").addEventListener("click", function () { player.playPrev(); });
    $("btn-next").addEventListener("click", function () { player.playNext(); });
    $("btn-full").addEventListener("click", function () { player.requestFullScreen(); });
    document.addEventListener("keydown", function (e) {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowRight") { e.preventDefault(); player.playNext(); }
      if (e.key === "ArrowLeft") { e.preventDefault(); player.playPrev(); }
    });
    window.addEventListener("hashchange", function () { loadFromHash(); });
    loadFromHash();
  });
})();
