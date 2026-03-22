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
  let currentQueryId = null; // Analytics: tracks current query session

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
    while (messages.firstChild) messages.firstChild.remove();
    const site = getSite(origin);

    if (site.messages.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'waa-empty';
      empty.textContent = 'Ask anything about this site. I\'ll read multiple pages and answer in your language.';
      messages.appendChild(empty);
    } else {
      for (const msg of site.messages) {
        messages.appendChild(msg.node.cloneNode(true));
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
    site.messages.push({ node: el.cloneNode(true) });
  }

  function storeAndAppendMsg(role, text) {
    const div = document.createElement('div');
    div.className = `waa-msg waa-msg-${role}`;
    const content = document.createElement('div');
    content.className = 'waa-msg-content';
    content.textContent = text;
    div.appendChild(content);
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
      await api.tabs.executeScript(tabId, { file: 'content.js' });
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
    const titleSpan = document.createElement('span');
    titleSpan.className = 'waa-tab-picker-title';
    titleSpan.textContent = 'Compare ';
    const strong = document.createElement('strong');
    strong.textContent = currentTitle;
    titleSpan.appendChild(strong);
    titleSpan.appendChild(document.createTextNode(' against:'));
    header.appendChild(titleSpan);
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

    storeAndAppendMsg('user', question);
    showProgress('Working...', '');

    // Analytics: Generate query ID and emit query_submitted event
    if (window.AMAAnalytics) {
      currentQueryId = window.AMAAnalytics.generateQueryId();
      const effectiveMode = mode || 'research';
      window.AMAAnalytics.hashDomain(currentOrigin).then(domainHash => {
        window.AMAAnalytics.emitAnalyticsEvent('query_submitted', {
          mode: effectiveMode,
          provider: providerSelect.value || 'chatgpt',
          query_length: question.length,
          site_domain_hash: domainHash,
          timestamp: Date.now()
        });
      });
    }

    try {
      const pageData = await getPageData();

      // Analytics: Emit initiated funnel stage
      if (window.AMAAnalytics && currentQueryId) {
        window.AMAAnalytics.emitAnalyticsEvent('funnel_stage', {
          query_id: currentQueryId,
          stage: 'initiated',
          latency_ms: 0,
          timestamp: Date.now()
        });
      }

      if (mode === 'summarize' || mode === 'contact') {
        // Direct LLM call with current page content — no link picking
        showProgress(mode === 'summarize' ? 'Summarizing...' : 'Finding contacts...', '');
        api.runtime.sendMessage({ type: 'direct', question, pageData, queryId: currentQueryId });
      } else if (mode === 'search') {
        showProgress('Finding relevant pages...', '');
        api.runtime.sendMessage({ type: 'ask', question, pageData, queryId: currentQueryId });
      } else if (mode === 'asksite') {
        showProgress('Searching site...', question);
        api.runtime.sendMessage({
          type: 'asksite',
          query: question,
          searchUrl: pageData._searchUrl || '',
          pageUrl: pageData.url,
          queryId: currentQueryId
        });
      } else {
        showProgress('Researching...', 'Finding relevant pages');
        api.runtime.sendMessage({ type: 'research', question, pageData, queryId: currentQueryId });
      }
    } catch (err) {
      clearProgress();
      appendError(err.message);

      // Analytics: Emit query_error event
      if (window.AMAAnalytics && currentQueryId) {
        window.AMAAnalytics.emitAnalyticsEvent('query_error', {
          query_id: currentQueryId,
          stage: 'initiated',
          error_category: window.AMAAnalytics.categorizeError(err),
          provider: providerSelect.value || 'chatgpt',
          mode: mode || 'research',
          timestamp: Date.now()
        });
      }

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

      // Analytics: Emit answer_rendered funnel stage
      if (window.AMAAnalytics && currentQueryId) {
        window.AMAAnalytics.emitAnalyticsEvent('funnel_stage', {
          query_id: currentQueryId,
          stage: 'answer_rendered',
          timestamp: Date.now()
        });
      }

      // Track conversation history for this site
      if (currentOrigin) {
        const site = getSite(currentOrigin);
        const triedUrls = (msg.sources || []).map(s => s.url).filter(Boolean);
        site.history.push({ question: msg.question, answer: msg.text, tried_urls: triedUrls });
        if (site.history.length > 5) site.history.shift();
      }
      isBusy = false;
      sendBtn.disabled = false;
      currentQueryId = null; // Reset query ID
    } else if (msg.type === 'error') {
      clearProgress();
      appendError(msg.message);

      // Analytics: Emit query_error event
      if (window.AMAAnalytics && currentQueryId) {
        window.AMAAnalytics.emitAnalyticsEvent('query_error', {
          query_id: currentQueryId,
          stage: msg.stage || 'unknown',
          error_category: window.AMAAnalytics.categorizeError(msg.message),
          provider: providerSelect.value || 'chatgpt',
          mode: msg.mode || 'unknown',
          timestamp: Date.now()
        });
      }

      isBusy = false;
      sendBtn.disabled = false;
      currentQueryId = null; // Reset query ID
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
    progressEl.textContent = '';
    const spinner = document.createElement('span');
    spinner.className = 'waa-spinner';
    progressEl.appendChild(spinner);
    progressEl.appendChild(document.createTextNode(' ' + (phase || 'Working...')));
    progressEl.appendChild(document.createElement('br'));
    const detailSpan = document.createElement('span');
    detailSpan.className = 'waa-progress-page';
    detailSpan.textContent = detail || '';
    progressEl.appendChild(detailSpan);
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

    const msgContent = document.createElement('div');
    msgContent.className = 'waa-msg-content';
    // Format answer: convert markdown-like syntax safely
    const lines = text.split('\n');
    for (const line of lines) {
      if (msgContent.childNodes.length > 0) msgContent.appendChild(document.createElement('br'));
      // Bold: **text**
      const parts = line.split(/(\*\*.*?\*\*|`.+?`)/g);
      for (const part of parts) {
        if (part.startsWith('**') && part.endsWith('**')) {
          const strong = document.createElement('strong');
          strong.textContent = part.slice(2, -2);
          msgContent.appendChild(strong);
        } else if (part.startsWith('`') && part.endsWith('`')) {
          const code = document.createElement('code');
          code.textContent = part.slice(1, -1);
          msgContent.appendChild(code);
        } else {
          msgContent.appendChild(document.createTextNode(part));
        }
      }
    }

    if (sources && sources.length) {
      const sourcesDiv = document.createElement('div');
      sourcesDiv.className = 'waa-sources';
      const sourcesTitle = document.createElement('div');
      sourcesTitle.className = 'waa-sources-title';
      sourcesTitle.textContent = 'Sources:';
      sourcesDiv.appendChild(sourcesTitle);
      for (const s of sources) {
        const a = document.createElement('a');
        a.className = 'waa-source-link';
        a.href = s.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = s.title || shortenUrl(s.url);
        sourcesDiv.appendChild(a);
        if (s.relevant_excerpt) {
          const excerpt = document.createElement('span');
          excerpt.className = 'waa-source-excerpt';
          excerpt.textContent = s.relevant_excerpt;
          sourcesDiv.appendChild(excerpt);
        }
      }
      msgContent.appendChild(sourcesDiv);
    }

    div.appendChild(msgContent);

    const retryBtn = document.createElement('button');
    retryBtn.className = 'waa-retry';
    retryBtn.textContent = 'Not right? Try again';
    div.appendChild(retryBtn);

    retryBtn.addEventListener('click', () => {
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
