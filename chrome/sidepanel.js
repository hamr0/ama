/* AMA — Side Panel UI
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
  let requestOrigin = '';   // origin that owns the in-flight request

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
    compare:   { placeholder: null, auto: false, picker: true },
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
    } else if (config.picker) {
      // Compare mode: show tab picker instead of text input
      activeMode = null;
      pillContainer.querySelectorAll('.waa-pill').forEach(p => p.classList.remove('active'));
      showTabPicker();
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

    clearProgress();

    currentOrigin = origin;
    siteName.textContent = getHostname(tab.url);

    // Rebuild messages area from stored conversation
    renderConversation(origin);

    if (requestOrigin && requestOrigin === origin) {
      isBusy = true;
      sendBtn.disabled = true;
      showProgress('Working...', '');
    } else if (requestOrigin) {
      isBusy = false;
      sendBtn.disabled = false;
    }

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

  /* ── Compare: tab picker ── */

  function removeTabPicker() {
    const picker = messages.querySelector('.waa-tab-picker');
    if (picker) picker.remove();
  }

  async function showTabPicker() {
    removeTabPicker();

    const empty = messages.querySelector('.waa-empty');
    if (empty) empty.remove();

    // Get current tab (always included in comparison)
    const activeTab = await getActiveTab();
    const currentTabId = activeTab?.id;
    const currentTitle = activeTab?.title || 'Current page';

    const allTabs = await api.tabs.query({});
    // Filter out chrome://, extension pages, and the current tab
    const otherTabs = allTabs.filter(t => {
      if (!t.url || t.id === currentTabId) return false;
      if (t.url.startsWith('chrome://') || t.url.startsWith('chrome-extension://')) return false;
      if (t.url.startsWith('about:') || t.url.startsWith('edge://')) return false;
      return true;
    });

    const container = document.createElement('div');
    container.className = 'waa-tab-picker';

    const header = document.createElement('div');
    header.className = 'waa-tab-picker-header';
    header.innerHTML = `<span class="waa-tab-picker-title">Compare <strong>${escHtml(currentTitle)}</strong> against:</span>`;
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'waa-tab-picker-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      removeTabPicker();
      renderConversation(currentOrigin);
    });
    header.appendChild(cancelBtn);
    container.appendChild(header);

    const list = document.createElement('ul');
    list.className = 'waa-tab-list';

    for (const tab of otherTabs) {
      const li = document.createElement('li');
      li.className = 'waa-tab-item';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.tabId = tab.id;

      const favicon = document.createElement('img');
      favicon.className = 'waa-tab-item-favicon';
      favicon.src = tab.favIconUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
      favicon.onerror = () => { favicon.style.display = 'none'; };

      const info = document.createElement('div');
      info.className = 'waa-tab-item-info';
      const title = document.createElement('div');
      title.className = 'waa-tab-item-title';
      title.textContent = tab.title || 'Untitled';
      const url = document.createElement('div');
      url.className = 'waa-tab-item-url';
      try { url.textContent = new URL(tab.url).hostname + new URL(tab.url).pathname; } catch { url.textContent = tab.url; }
      info.appendChild(title);
      info.appendChild(url);

      li.appendChild(cb);
      li.appendChild(favicon);
      li.appendChild(info);

      li.addEventListener('click', (e) => {
        if (e.target !== cb) cb.checked = !cb.checked;
        updateCompareBtn();
      });

      list.appendChild(li);
    }

    container.appendChild(list);

    const compareBtn = document.createElement('button');
    compareBtn.className = 'waa-compare-btn';
    compareBtn.textContent = 'Select at least 1 tab';
    compareBtn.disabled = true;
    compareBtn.addEventListener('click', () => submitCompare(otherTabs, currentTabId));
    container.appendChild(compareBtn);

    messages.appendChild(container);
    messages.scrollTop = messages.scrollHeight;

    function updateCompareBtn() {
      const checked = container.querySelectorAll('input[type="checkbox"]:checked').length;
      compareBtn.disabled = checked < 1;
      compareBtn.textContent = checked > 4
        ? 'Too many (max 4 + current)'
        : checked < 1
          ? 'Select at least 1 tab'
          : `Compare against ${checked} tab${checked > 1 ? 's' : ''}`;
      if (checked > 4) compareBtn.disabled = true;
    }
  }

  async function getPageDataFromTab(tabId) {
    return new Promise((resolve, reject) => {
      api.tabs.sendMessage(tabId, { type: 'getPageData' }, async (response) => {
        if (api.runtime.lastError) {
          await ensureContentScript(tabId);
          api.tabs.sendMessage(tabId, { type: 'getPageData' }, (response2) => {
            if (api.runtime.lastError || !response2?.pageData) {
              reject(new Error('Cannot read tab ' + tabId));
              return;
            }
            resolve(response2.pageData);
          });
          return;
        }
        if (response && response.pageData) {
          resolve(response.pageData);
        } else {
          reject(new Error('No page data from tab ' + tabId));
        }
      });
    });
  }

  async function submitCompare(otherTabs, currentTabId) {
    const picker = messages.querySelector('.waa-tab-picker');
    if (!picker) return;

    const checked = picker.querySelectorAll('input[type="checkbox"]:checked');
    const selectedTabIds = Array.from(checked).map(cb => Number(cb.dataset.tabId));
    if (selectedTabIds.length < 1 || selectedTabIds.length > 4) return;

    // Current tab is always first
    const allTabIds = [currentTabId, ...selectedTabIds];
    const allTabsInfo = [
      await getActiveTab(),
      ...otherTabs.filter(t => selectedTabIds.includes(t.id))
    ];

    removeTabPicker();
    isBusy = true;
    sendBtn.disabled = true;
    requestOrigin = currentOrigin;

    const tabNames = allTabsInfo.map(t => t?.title || 'Untitled').join(' vs ');
    storeAndAppendMsg('user', 'Compare: ' + tabNames);
    showProgress('Comparing...', `Reading ${allTabsInfo.length} pages`);

    try {
      const pages = [];
      for (let i = 0; i < allTabsInfo.length; i++) {
        const tab = allTabsInfo[i];
        if (!tab) continue;
        showProgress('Comparing...', `Reading ${i + 1}/${allTabsInfo.length}: ${tab.title || 'Untitled'}`);
        try {
          const data = await getPageDataFromTab(tab.id);
          pages.push({
            url: data.url || tab.url,
            title: data.title || tab.title || 'Untitled',
            ariaTree: (data.ariaTree || '').slice(0, 3000),
            isPrimary: i === 0
          });
        } catch {
          pages.push({
            url: tab.url,
            title: tab.title || 'Untitled',
            ariaTree: '(could not read page content)',
            isPrimary: i === 0
          });
        }
      }

      showProgress('Comparing...', 'Analyzing differences');
      api.runtime.sendMessage({ type: 'compare', pages });
    } catch (err) {
      clearProgress();
      appendError(err.message);
      isBusy = false;
      sendBtn.disabled = false;
    }
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
    requestOrigin = currentOrigin;

    storeAndAppendMsg('user', question);
    showProgress('Working...', '');

    try {
      const pageData = await getPageData();

      if (mode === 'summarize' || mode === 'contact') {
        // Direct LLM call with current page content — no link picking
        showProgress(mode === 'summarize' ? 'Summarizing...' : 'Finding contacts...', '');
        api.runtime.sendMessage({ type: 'direct', question, pageData });
      } else if (mode === 'search') {
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
    const targetOrigin = requestOrigin || currentOrigin;
    const onScreen = targetOrigin === currentOrigin;

    if (msg.type === 'progress') {
      if (onScreen) showProgress(msg.phase, msg.detail);
    } else if (msg.type === 'answer') {
      if (onScreen) clearProgress();
      if (targetOrigin) {
        const site = getSite(targetOrigin);
        const triedUrls = (msg.sources || []).map(s => s.url).filter(Boolean);
        site.history.push({ question: msg.question, answer: msg.text, tried_urls: triedUrls });
        if (site.history.length > 5) site.history.shift();
      }
      if (onScreen) {
        appendAnswer(msg.text, msg.sources);
      } else {
        storeAnswerForOrigin(targetOrigin, msg.text, msg.sources);
      }
      requestOrigin = '';
      isBusy = false;
      sendBtn.disabled = false;
    } else if (msg.type === 'error') {
      if (onScreen) {
        clearProgress();
        appendError(msg.message);
      } else {
        storeErrorForOrigin(targetOrigin, msg.message);
      }
      requestOrigin = '';
      isBusy = false;
      sendBtn.disabled = false;
    }
  });

  /* ── Off-screen storage helpers ── */

  function storeAnswerForOrigin(origin, text, sources) {
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
          return `<a class="waa-source-link" href="${escAttr(s.url)}" target="_blank" rel="noopener">${label}</a>${excerpt}`;
        }).join('')}
      </div>`;
    }
    html += `</div><button class="waa-retry">Not right? Try again</button>`;
    div.innerHTML = html;
    storeMsg(origin, div);
  }

  function storeErrorForOrigin(origin, text) {
    const div = document.createElement('div');
    div.className = 'waa-error';
    div.textContent = text;
    storeMsg(origin, div);
  }

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
