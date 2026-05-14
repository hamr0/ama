/* AMA — theme bootstrap.
   Source of truth: chrome.storage.local.theme ('dark' | 'light').
   localStorage mirror exists only so the inline boot script in sidepanel.html / options.html
   can apply the class synchronously before first paint (no FOUC).
   When neither is set, fall back to the OS's prefers-color-scheme. */

(function () {
  const api = typeof browser !== 'undefined' ? browser : chrome;
  const root = document.documentElement;

  function systemPrefersLight() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
  }

  function apply(t) {
    root.classList.toggle('theme-light', t === 'light');
    try { localStorage.setItem('ama_theme', t === 'light' ? 'light' : 'dark'); } catch (e) {}
  }

  api.storage.local.get(['theme']).then((data) => {
    let t = data && data.theme;
    if (t !== 'light' && t !== 'dark') t = systemPrefersLight() ? 'light' : 'dark';
    apply(t);
  }).catch(() => {});

  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.theme) apply(changes.theme.newValue);
  });
})();
