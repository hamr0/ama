/* WeAreAsking — Side Panel UI
 * Communicates with background.js via chrome.runtime messages
 * Requests page data from content.js via background.js relay
 */

(function () {
  'use strict';

  const api = typeof browser !== 'undefined' ? browser : chrome;

  /* ── DOM refs ── */
  const settingsBtn = document.querySelector('.waa-settings');
  const providerSelect = document.getElementById('provider-select');
  const messages = document.getElementById('messages');
  const emptyState = document.getElementById('empty-state');
  const input = document.getElementById('input');
  const sendBtn = document.getElementById('send-btn');
  const pillContainer = document.getElementById('pills');
  const askSitePill = document.getElementById('pill-asksite');

  /* ── State ── */
  let isBusy = false;
  let askSiteMode = false;
  let lastQuestion = '';
  let conversationHistory = [];

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
  sendBtn.addEventListener('click', () => submit());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });

  /* ── Pill handlers ── */
  pillContainer.addEventListener('click', (e) => {
    const pill = e.target.closest('.waa-pill');
    if (!pill || pill.classList.contains('disabled') || isBusy) return;

    const action = pill.dataset.action;
    if (action === 'summarize') {
      submitPill('Summarize this page concisely');
    } else if (action === 'contact') {
      submitPill('Find contact information, customer service, FAQ, or help pages on this site');
    } else if (action === 'asksite') {
      askSiteMode = true;
      input.placeholder = 'Type your search and press Enter...';
      input.focus();
      pill.classList.add('active');
    }
  });

  /* ── Get active tab and request page data from content script ── */

  async function getActiveTab() {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  async function getPageData() {
    const tab = await getActiveTab();
    if (!tab) throw new Error('No active tab found.');

    return new Promise((resolve, reject) => {
      api.tabs.sendMessage(tab.id, { type: 'getPageData' }, (response) => {
        if (api.runtime.lastError) {
          reject(new Error('Cannot communicate with page. Try refreshing the tab.'));
          return;
        }
        if (response && response.pageData) {
          // Attach conversation history from side panel
          response.pageData.history = conversationHistory.slice(-5);
          resolve(response.pageData);
        } else {
          reject(new Error('No page data returned. Make sure you are on a web page.'));
        }
      });
    });
  }

  /* ── Submit logic ── */

  function submitPill(question) {
    hideEmptyState();
    appendMsg('user', question);
    submit(question, true);
  }

  async function submit(overrideQuestion, skipUserMsg) {
    const question = overrideQuestion || input.value.trim();
    if (!question || isBusy) return;

    // Ask Site mode
    if (askSiteMode && !overrideQuestion) {
      askSiteMode = false;
      input.placeholder = 'Ask this site...';
      if (askSitePill) askSitePill.classList.remove('active');
      performSiteSearch(question);
      input.value = '';
      return;
    }

    isBusy = true;
    sendBtn.disabled = true;
    input.value = '';
    lastQuestion = question;

    hideEmptyState();
    if (!skipUserMsg) appendMsg('user', question);
    showProgress('Analyzing page...', '');

    try {
      const pageData = await getPageData();
      api.runtime.sendMessage({
        type: 'ask',
        question,
        pageData
      });
    } catch (err) {
      clearProgress();
      appendError(err.message);
      isBusy = false;
      sendBtn.disabled = false;
    }
  }

  async function performSiteSearch(query) {
    hideEmptyState();
    appendMsg('user', 'Site search: ' + query);
    isBusy = true;
    sendBtn.disabled = true;
    showProgress('Searching site...', query);

    try {
      const pageData = await getPageData();
      api.runtime.sendMessage({
        type: 'asksite',
        query,
        searchUrl: pageData._searchUrl || '',
        pageUrl: pageData.url
      });
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
      const triedUrls = (msg.sources || []).map(s => s.url).filter(Boolean);
      conversationHistory.push({ question: msg.question, answer: msg.text, tried_urls: triedUrls });
      if (conversationHistory.length > 5) conversationHistory.shift();
      isBusy = false;
      sendBtn.disabled = false;
    } else if (msg.type === 'nokey') {
      clearProgress();
      appendNoKey();
      isBusy = false;
      sendBtn.disabled = false;
    } else if (msg.type === 'error') {
      clearProgress();
      appendError(msg.message);
      isBusy = false;
      sendBtn.disabled = false;
    } else if (msg.type === 'pageInfo') {
      // Update Ask Site pill based on page capabilities
      if (msg.hasSearch) {
        askSitePill.classList.remove('disabled');
        askSitePill.title = 'Search this site';
        askSitePill.style.pointerEvents = '';
      } else {
        askSitePill.classList.add('disabled');
        askSitePill.title = 'No site search detected';
        askSitePill.style.pointerEvents = 'none';
      }
    }
  });

  /* ── On panel open, request page info from current tab ── */

  async function refreshPageInfo() {
    try {
      const tab = await getActiveTab();
      if (!tab) return;
      api.tabs.sendMessage(tab.id, { type: 'getPageInfo' }, (response) => {
        if (api.runtime.lastError) return;
        if (response) {
          if (response.hasSearch) {
            askSitePill.classList.remove('disabled');
            askSitePill.title = 'Search this site';
            askSitePill.style.pointerEvents = '';
          }
        }
      });
    } catch { /* ignore */ }
  }

  refreshPageInfo();

  // Re-check when tab changes
  api.tabs.onActivated.addListener(() => refreshPageInfo());
  api.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'complete') refreshPageInfo();
  });

  /* ── UI helpers ── */

  let progressEl = null;

  function hideEmptyState() {
    if (emptyState && emptyState.parentNode) emptyState.remove();
  }

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

  function appendMsg(role, text) {
    const div = document.createElement('div');
    div.className = `waa-msg waa-msg-${role}`;
    div.innerHTML = `<div class="waa-msg-content">${escHtml(text)}</div>`;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
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
    html += `<button class="waa-retry">Not right? Search again</button>`;
    div.innerHTML = html;

    div.querySelector('.waa-retry').addEventListener('click', () => {
      if (lastQuestion && !isBusy) {
        appendMsg('user', '(searching again...)');
        submit(lastQuestion, true);
      }
    });

    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  function appendNoKey() {
    const div = document.createElement('div');
    div.className = 'waa-error';
    div.innerHTML = 'No provider configured. <a class="waa-error-link" href="#">Open settings</a> to log in or add an API key.';
    div.querySelector('.waa-error-link').addEventListener('click', (e) => {
      e.preventDefault();
      api.runtime.sendMessage({ type: 'openSettings' });
    });
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  function appendError(text) {
    const div = document.createElement('div');
    div.className = 'waa-error';
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
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
