/* weareasking — Side Panel UI
 * Default mode: Research (fetches pages, synthesizes answer)
 * Per-site conversations: auto-follows active tab
 */

(function () {
  'use strict';

  const api = typeof browser !== 'undefined' ? browser : chrome;

  /* ── DOM refs ── */
  const settingsBtn = document.querySelector('.waa-settings');
  const providerSelect = document.getElementById('provider-select');
  const siteName = document.getElementById('site-name');
  const messages = document.getElementById('messages');
  const emptyState = document.getElementById('empty-state');
  const input = document.getElementById('input');
  const sendBtn = document.getElementById('send-btn');
  const pillContainer = document.getElementById('pills');
  const askSitePill = document.getElementById('pill-asksite');

  /* ── State ── */
  let isBusy = false;
  let activeMode = null;
  let lastQuestion = '';
  let currentOrigin = '';

  // Per-site conversation storage: origin → { messages: [{role, html}], history: [] }
  const siteData = new Map();

  function getSite(origin) {
    if (!siteData.has(origin)) {
      siteData.set(origin, { messages: [], history: [] });
    }
    return siteData.get(origin);
  }

  const MODE_CONFIG = {
    search:    { placeholder: 'What are you looking for?', auto: false },
    summarize: { placeholder: null, auto: true, prompt: 'Summarize this page concisely' },
    contact:   { placeholder: null, auto: true, prompt: 'Find contact information, customer service, FAQ, or help pages on this site' },
    asksite:   { placeholder: 'Search this site for...', auto: false },
    compare:   { placeholder: 'Compare with...', auto: false },
  };

  /* ── Load saved provider ── */
  api.storage.local.get('provider').then(data => {
    if (data.provider) providerSelect.value = data.provider;
  });

  providerSelect.addEventListener('change', () => {
    api.storage.local.set({ provider: providerSelect.value });
  });

  /* ── Settings button ── */
  settingsBtn.addEventListener('click', () => {
    api.runtime.sendMessage({ type: 'openSettings' });
  });

  /* ── Send handlers ── */
  sendBtn.addEventListener('click', () => doSubmit());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSubmit();
    }
  });

  /* ── Pill handlers ── */

  function setMode(mode) {
    if (activeMode === mode) {
      activeMode = null;
      input.placeholder = 'Ask anything about this site...';
      pillContainer.querySelectorAll('.waa-pill').forEach(p => p.classList.remove('active'));
      input.focus();
      return;
    }

    activeMode = mode;
    pillContainer.querySelectorAll('.waa-pill').forEach(p => {
      p.classList.toggle('active', p.dataset.action === mode);
    });

    const config = MODE_CONFIG[mode];
    if (config.auto) {
      activeMode = null;
      pillContainer.querySelectorAll('.waa-pill').forEach(p => p.classList.remove('active'));
      submitWithMode(mode, config.prompt);
    } else {
      input.placeholder = config.placeholder;
      input.focus();
    }
  }

  pillContainer.addEventListener('click', (e) => {
    const pill = e.target.closest('.waa-pill');
    if (!pill || pill.classList.contains('disabled') || isBusy) return;
    setMode(pill.dataset.action);
  });

  /* ── Tab tracking + per-site conversations ── */

  async function getActiveTab() {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  function getOrigin(url) {
    try { return new URL(url).origin; } catch { return ''; }
  }

  function getHostname(url) {
    try { return new URL(url).hostname; } catch { return url; }
  }

  async function switchToActiveTab() {
    const tab = await getActiveTab();
    if (!tab || !tab.url) return;

    const origin = getOrigin(tab.url);
    if (!origin || origin === currentOrigin) return;

    // Save scroll position? Not needed — we rebuild from stored messages
    currentOrigin = origin;
    siteName.textContent = getHostname(tab.url);

    // Rebuild messages area from stored conversation
    renderConversation(origin);

    // Check site search capability
    refreshPageInfo(tab);
  }

  function renderConversation(origin) {
    // Clear messages
    messages.innerHTML = '';
    const site = getSite(origin);

    if (site.messages.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'waa-empty';
      empty.innerHTML = 'Ask anything about this site.<br>I\'ll read multiple pages and answer in your language.';
      messages.appendChild(empty);
    } else {
      for (const msg of site.messages) {
        const div = document.createElement('div');
        div.innerHTML = msg.html;
        messages.appendChild(div.firstElementChild);
      }
      // Re-attach retry handlers
      messages.querySelectorAll('.waa-retry').forEach(btn => {
        btn.addEventListener('click', () => {
          if (lastQuestion && !isBusy) {
            storeAndAppendMsg('user', '(trying again...)');
            submitWithMode(null, lastQuestion);
          }
        });
      });
      messages.scrollTop = messages.scrollHeight;
    }
  }

  // Store a message element's HTML so we can rebuild on tab switch
  function storeMsg(origin, el) {
    const site = getSite(origin);
    const wrapper = document.createElement('div');
    wrapper.appendChild(el.cloneNode(true));
    site.messages.push({ html: wrapper.innerHTML });
  }

  function storeAndAppendMsg(role, text) {
    const div = document.createElement('div');
    div.className = `waa-msg waa-msg-${role}`;
    div.innerHTML = `<div class="waa-msg-content">${escHtml(text)}</div>`;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    if (currentOrigin) storeMsg(currentOrigin, div);
    // Remove empty state if present
    const empty = messages.querySelector('.waa-empty');
    if (empty) empty.remove();
  }

  switchToActiveTab();
  api.tabs.onActivated.addListener(() => switchToActiveTab());
  api.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'complete') switchToActiveTab();
  });

  /* ── Page info (site search detection) ── */

  function refreshPageInfo(tab) {
    if (!tab) return;
    try {
      api.tabs.sendMessage(tab.id, { type: 'getPageInfo' }, (response) => {
        if (api.runtime.lastError) return;
        if (response && response.hasSearch) {
          askSitePill.classList.remove('disabled');
          askSitePill.title = 'Search this site';
          askSitePill.style.pointerEvents = '';
        } else {
          askSitePill.classList.add('disabled');
          askSitePill.title = 'No site search detected';
          askSitePill.style.pointerEvents = 'none';
        }
      });
    } catch { /* ignore */ }
  }

  /* ── Get page data from content script (auto-inject if needed) ── */

  async function ensureContentScript(tabId) {
    try {
      await api.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
    } catch { /* may fail on chrome:// pages etc */ }
    // Small delay for script to initialize
    await new Promise(r => setTimeout(r, 200));
  }

  async function getPageData() {
    const tab = await getActiveTab();
    if (!tab) throw new Error('No active tab found.');

    // Try to talk to content script; inject if it's not there
    return new Promise((resolve, reject) => {
      api.tabs.sendMessage(tab.id, { type: 'getPageData' }, async (response) => {
        if (api.runtime.lastError) {
          // Content script not loaded — inject it
          await ensureContentScript(tab.id);
          api.tabs.sendMessage(tab.id, { type: 'getPageData' }, (response2) => {
            if (api.runtime.lastError || !response2?.pageData) {
              reject(new Error('Cannot read this page. Try refreshing the tab.'));
              return;
            }
            const site = getSite(currentOrigin);
            response2.pageData.history = site.history.slice(-5);
            resolve(response2.pageData);
          });
          return;
        }
        if (response && response.pageData) {
          const site = getSite(currentOrigin);
          response.pageData.history = site.history.slice(-5);
          resolve(response.pageData);
        } else {
          reject(new Error('No page data returned. Make sure you are on a web page.'));
        }
      });
    });
  }

  /* ── Submit logic ── */

  async function doSubmit() {
    const text = input.value.trim();
    if (!text && !activeMode) return;
    if (isBusy) return;

    const mode = activeMode || null;
    activeMode = null;
    pillContainer.querySelectorAll('.waa-pill').forEach(p => p.classList.remove('active'));
    input.placeholder = 'Ask anything about this site...';

    submitWithMode(mode, text);
  }

  async function submitWithMode(mode, question) {
    if (!question || isBusy) return;

    isBusy = true;
    sendBtn.disabled = true;
    input.value = '';
    lastQuestion = question;

    storeAndAppendMsg('user', question);
    showProgress('Working...', '');

    try {
      const pageData = await getPageData();

      if (mode === 'search' || mode === 'summarize' || mode === 'contact') {
        showProgress('Finding relevant pages...', '');
        api.runtime.sendMessage({ type: 'ask', question, pageData });
      } else if (mode === 'asksite') {
        showProgress('Searching site...', question);
        api.runtime.sendMessage({
          type: 'asksite',
          query: question,
          searchUrl: pageData._searchUrl || '',
          pageUrl: pageData.url
        });
      } else {
        showProgress('Researching...', 'Finding relevant pages');
        api.runtime.sendMessage({ type: 'research', question, pageData });
      }
    } catch (err) {
      clearProgress();
      appendError(err.message);
      isBusy = false;
      sendBtn.disabled = false;
    }
  }

  /* ── Incoming messages from background ── */

  api.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'progress') {
      showProgress(msg.phase, msg.detail);
    } else if (msg.type === 'answer') {
      clearProgress();
      appendAnswer(msg.text, msg.sources);
      // Track conversation history for this site
      if (currentOrigin) {
        const site = getSite(currentOrigin);
        const triedUrls = (msg.sources || []).map(s => s.url).filter(Boolean);
        site.history.push({ question: msg.question, answer: msg.text, tried_urls: triedUrls });
        if (site.history.length > 5) site.history.shift();
      }
      isBusy = false;
      sendBtn.disabled = false;
    } else if (msg.type === 'error') {
      clearProgress();
      appendError(msg.message);
      isBusy = false;
      sendBtn.disabled = false;
    }
  });

  /* ── UI helpers ── */

  let progressEl = null;

  function showProgress(phase, detail) {
    if (!progressEl) {
      progressEl = document.createElement('div');
      progressEl.className = 'waa-progress';
      messages.appendChild(progressEl);
    }
    progressEl.innerHTML = `
      <span class="waa-spinner"></span> ${escHtml(phase || 'Working...')}<br>
      <span class="waa-progress-page">${escHtml(detail || '')}</span>
    `;
    messages.scrollTop = messages.scrollHeight;
  }

  function clearProgress() {
    if (progressEl) {
      progressEl.remove();
      progressEl = null;
    }
  }

  function appendAnswer(text, sources) {
    const div = document.createElement('div');
    div.className = 'waa-msg waa-msg-assistant';

    let html = `<div class="waa-msg-content">${formatAnswer(text)}`;

    if (sources && sources.length) {
      html += `<div class="waa-sources">
        <div class="waa-sources-title">Sources:</div>
        ${sources.map(s => {
          const label = escHtml(s.title || shortenUrl(s.url));
          const excerpt = s.relevant_excerpt
            ? `<span class="waa-source-excerpt">${escHtml(s.relevant_excerpt)}</span>`
            : '';
          return `<a class="waa-source-link" href="${escAttr(s.url)}" target="_blank" rel="noopener">
            ${label}
          </a>${excerpt}`;
        }).join('')}
      </div>`;
    }

    html += `</div>`;
    html += `<button class="waa-retry">Not right? Try again</button>`;
    div.innerHTML = html;

    div.querySelector('.waa-retry').addEventListener('click', () => {
      if (lastQuestion && !isBusy) {
        storeAndAppendMsg('user', '(trying again...)');
        submitWithMode(null, lastQuestion);
      }
    });

    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    if (currentOrigin) storeMsg(currentOrigin, div);
  }

  function appendError(text) {
    const div = document.createElement('div');
    div.className = 'waa-error';
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    if (currentOrigin) storeMsg(currentOrigin, div);
  }

  function formatAnswer(text) {
    return escHtml(text)
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.+?)`/g, '<code>$1</code>');
  }

  /* ── Util ── */

  function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function escAttr(s) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function shortenUrl(url) {
    try {
      const u = new URL(url);
      return u.pathname + u.search;
    } catch { return url; }
  }

})();
