/* Rift Horizon boot guard (classic script, runs before the game's modules).
 * If the game can't start, the loader used to sit at "2%" forever with no explanation.
 * This prints the reason on the loading screen instead. */
(function () {
  var failed = false;

  function line(stage, msg) {
    var st = document.getElementById('bootStage'), s = document.getElementById('bootStatus');
    if (st) st.textContent = stage;
    if (s) {
      s.textContent = msg;
      s.style.whiteSpace = 'normal';
      s.style.overflow = 'visible';
      s.style.maxHeight = '7em';
    }
  }
  function stillBooting() {
    var boot = document.getElementById('boot');
    return !!boot && !boot.classList.contains('complete');
  }
  function fail(msg) {
    if (failed || !stillBooting()) return;
    failed = true;
    line('Load error', msg);
    try { console.error('[boot-guard]', msg); } catch (e) {}
  }
  function short(u) { return String(u || '').split('/').slice(-2).join('/'); }

  // capture phase so failed <script> downloads are seen too
  window.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t !== window && t.tagName) {
      if (t.tagName === 'SCRIPT') fail('A script failed to download: ' + short(t.src) + ' (or a file it imports). Check your connection.');
      return;
    }
    fail((e.message || 'Unknown error') + (e.filename ? '  [' + short(e.filename) + ':' + (e.lineno || 0) + ']' : ''));
  }, true);

  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    fail('Error: ' + ((r && r.message) || r));
  });

  // nothing has moved after 20 s: say so
  setTimeout(function () {
    if (failed || !stillBooting()) return;
    var bar = document.getElementById('bootBar');
    var w = bar ? parseFloat(bar.style.width) || 0 : 100;
    if (w < 8) line('Still loading', 'Still downloading… slow connection, or a script is stuck. Reload; if it repeats, screenshot this screen.');
  }, 20000);
})();
