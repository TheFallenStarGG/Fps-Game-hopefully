/* Android MainActivity calls window.__riftNativeBack */
window.__riftNativeBack = function () {
  try {
    const panel = document.getElementById('panel');
    const start = document.getElementById('start');
    if (panel && !panel.classList.contains('on') && start && start.classList.contains('hide')) {
      panel.classList.add('on');
      return;
    }
  } catch (_) {}
};
