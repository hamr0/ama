/* WeAreAsking — Options page */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const api = typeof browser !== 'undefined' ? browser : chrome;

let selectedProvider = 'claude-web';

/* ── Provider card selection ── */

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

/* ── Login buttons ── */

$$('.btn-login').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (btn.dataset.url) window.open(btn.dataset.url, '_blank');
  });
});

/* ── Check login status for all providers ── */

async function checkAllProviders() {
  for (const card of $$('.provider-card')) {
    const provider = card.dataset.provider;
    const dot = card.querySelector('.status-dot');
    const text = card.querySelector('.status-text');

    dot.className = 'status-dot checking';
    text.textContent = 'Checking...';

    try {
      const result = await api.runtime.sendMessage({ type: 'checkLogin', provider });
      if (result && result.loggedIn) {
        dot.className = 'status-dot green';
        text.textContent = result.user ? `Logged in as ${result.user}` : 'Logged in';
      } else {
        dot.className = 'status-dot gray';
        text.textContent = 'Not logged in';
      }
    } catch {
      dot.className = 'status-dot gray';
      text.textContent = 'Check failed';
    }
  }
}

/* ── Load settings ── */

async function load() {
  const data = await api.storage.local.get(['provider']);
  selectCard(data.provider || 'claude-web');
  checkAllProviders();
}

/* ── Save settings ── */

async function save() {
  await api.storage.local.set({ provider: selectedProvider });
  $('#status').style.display = 'block';
  setTimeout(() => { $('#status').style.display = 'none'; }, 2000);
}

$('#save').addEventListener('click', save);
document.addEventListener('DOMContentLoaded', load);
