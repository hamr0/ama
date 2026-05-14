/* Sub-paint theme bootstrap. Must run synchronously in <head> before CSS apply,
   so it can't depend on chrome.storage (async). Reads the localStorage mirror
   that theme.js / options.js keep in sync; falls back to OS prefers-color-scheme. */
(function () {
  try {
    var t = localStorage.getItem('ama_theme');
    if (!t && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      t = 'light';
    }
    if (t === 'light') document.documentElement.classList.add('theme-light');
  } catch (e) {}
})();
