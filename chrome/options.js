/* AMA — Dashboard (options page) */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const api = typeof browser !== 'undefined' ? browser : chrome;

let selectedProvider = 'claude-web';
let selectedTheme = 'dark';

/* ── Version readout (single source of truth: manifest.version,
   which the release script keeps in lockstep with package.json) ── */

function paintVersion() {
  const v = (api.runtime.getManifest && api.runtime.getManifest().version) || '?';
  const verEl = document.getElementById('version-display');
  const footEl = document.getElementById('footer-version');
  if (verEl) verEl.textContent = 'v' + v;
  if (footEl) footEl.textContent = 'ama // v' + v;
}

/* ── Provider cards ── */

function selectCard(provider) {
  selectedProvider = provider;
  $$('.provider-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.provider === provider);
  });
}

$$('.provider-card').forEach(card => {
  card.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    selectCard(card.dataset.provider);
  });
});

$$('.btn-login').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (btn.dataset.url) window.open(btn.dataset.url, '_blank');
  });
});

/* ── Theme picker (persists instantly — no "Save" needed for theme) ── */

function applyThemeVisuals(theme) {
  selectedTheme = theme === 'light' ? 'light' : 'dark';
  $$('.theme-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.theme === selectedTheme);
  });
  document.documentElement.classList.toggle('theme-light', selectedTheme === 'light');
  try { localStorage.setItem('ama_theme', selectedTheme); } catch (e) {}
}

async function selectTheme(theme) {
  applyThemeVisuals(theme);
  try { await api.storage.local.set({ theme: selectedTheme }); } catch (e) {}
}

$$('.theme-btn').forEach(btn => {
  btn.addEventListener('click', () => selectTheme(btn.dataset.theme));
});

function systemPrefersLight() {
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
}

/* ── Login status check ── */

async function checkAllProviders() {
  for (const card of $$('.provider-card')) {
    const provider = card.dataset.provider;
    const dot = card.querySelector('.status-dot');
    const text = card.querySelector('.status-text');
    const btn = card.querySelector('.btn-login');

    dot.className = 'status-dot checking';
    text.textContent = 'checking…';
    if (btn) btn.textContent = '…';

    try {
      const result = await api.runtime.sendMessage({ type: 'checkLogin', provider });
      const loggedIn = !!(result && result.loggedIn);
      const providerName = provider.replace('-web', '');
      if (loggedIn) {
        dot.className = 'status-dot green';
        text.textContent = result.user ? `logged in as ${result.user}` : 'logged in';
        if (btn) {
          btn.textContent = 'sign out';
          btn.title = `Opens ${providerName} — use the account menu there to sign out`;
        }
      } else {
        dot.className = 'status-dot gray';
        text.textContent = 'not logged in';
        if (btn) {
          btn.textContent = 'log in';
          btn.title = `Open ${providerName} to sign in`;
        }
      }
    } catch {
      dot.className = 'status-dot gray';
      text.textContent = 'check failed';
      if (btn) {
        btn.textContent = 'log in';
        btn.title = `Open ${provider.replace('-web', '')} to sign in`;
      }
    }
  }
}

/* ── Load / save ── */

async function load() {
  const data = await api.storage.local.get(['provider', 'theme']);
  selectCard(data.provider || 'claude-web');

  let theme = data.theme;
  if (theme !== 'light' && theme !== 'dark') theme = systemPrefersLight() ? 'light' : 'dark';
  applyThemeVisuals(theme);

  paintVersion();
  checkAllProviders();
}

async function save() {
  await api.storage.local.set({ provider: selectedProvider });
  const status = $('#status');
  status.style.display = 'inline';
  setTimeout(() => { status.style.display = 'none'; }, 1800);
}

$('#save').addEventListener('click', save);
document.addEventListener('DOMContentLoaded', load);
