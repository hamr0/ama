/* WeAreAsking — Options page */

const $ = (id) => document.getElementById(id);
const api = typeof browser !== 'undefined' ? browser : chrome;

const DEFAULTS = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o-mini'
};

function updateModelHint() {
  const provider = $('provider').value;
  $('modelHint').textContent =
    `Leave blank for default: ${DEFAULTS[provider]}`;
}

async function load() {
  const data = await api.storage.local.get([
    'provider', 'apiKey', 'model', 'maxPages'
  ]);
  if (data.provider) $('provider').value = data.provider;
  if (data.apiKey) $('apiKey').value = data.apiKey;
  if (data.model) $('model').value = data.model;
  $('maxPages').value = data.maxPages || 3;
  updateModelHint();
}

async function save() {
  const maxPages = Math.min(10, Math.max(1,
    parseInt($('maxPages').value, 10) || 3
  ));
  await api.storage.local.set({
    provider: $('provider').value,
    apiKey: $('apiKey').value,
    model: $('model').value,
    maxPages
  });
  $('status').style.display = 'block';
  setTimeout(() => { $('status').style.display = 'none'; }, 2000);
}

$('provider').addEventListener('change', updateModelHint);
$('save').addEventListener('click', save);
document.addEventListener('DOMContentLoaded', load);
