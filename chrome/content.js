/* WeAreAsking — Content script
 * Injects floating chat widget via shadow DOM, extracts current page content
 */

(function () {
  'use strict';
  if (document.getElementById('waa-root')) return; // already injected

  const api = typeof browser !== 'undefined' ? browser : chrome;

  /* ── Create shadow DOM host ── */
  const host = document.createElement('div');
  host.id = 'waa-root';
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'closed' });

  /* ── Load styles ── */
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = api.runtime.getURL('widget.css');
  shadow.appendChild(style);

  /* ── State ── */
  let isOpen = false;
  let isBusy = false;

  /* ── Build UI ── */

  // Bubble
  const bubble = el('button', { className: 'waa-bubble' });
  bubble.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/>
    <circle cx="8" cy="10" r="1.2"/>
    <circle cx="12" cy="10" r="1.2"/>
    <circle cx="16" cy="10" r="1.2"/>
  </svg>`;
  shadow.appendChild(bubble);

  // Panel
  const panel = el('div', { className: 'waa-panel hidden' });
  panel.innerHTML = `
    <div class="waa-header">
      <span>WeAreAsking</span>
      <div class="waa-header-actions">
        <button class="waa-settings" title="Settings">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 00-.48-.41h-3.84a.48.48 0 00-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87a.48.48 0 00.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.26.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1112 8.4a3.6 3.6 0 010 7.2z"/></svg>
        </button>
        <button class="waa-close" title="Close">&times;</button>
      </div>
    </div>
    <div class="waa-messages">
      <div class="waa-empty">Ask this site anything.<br>The agent will explore pages to find your answer.</div>
    </div>
    <div class="waa-input-area">
      <input class="waa-input" type="text" placeholder="Ask this site..." autocomplete="off">
      <button class="waa-send">Ask</button>
    </div>
  `;
  shadow.appendChild(panel);

  const settingsBtn = panel.querySelector('.waa-settings');
  const closeBtn = panel.querySelector('.waa-close');
  const messages = panel.querySelector('.waa-messages');
  const emptyState = panel.querySelector('.waa-empty');
  const input = panel.querySelector('.waa-input');
  const sendBtn = panel.querySelector('.waa-send');

  /* ── Event handlers ── */

  bubble.addEventListener('click', () => {
    isOpen = true;
    bubble.classList.add('hidden');
    panel.classList.remove('hidden');
    input.focus();
  });

  settingsBtn.addEventListener('click', () => {
    api.runtime.sendMessage({ type: 'openSettings' });
  });

  closeBtn.addEventListener('click', () => {
    isOpen = false;
    panel.classList.add('hidden');
    bubble.classList.remove('hidden');
  });

  sendBtn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });

  function submit() {
    const question = input.value.trim();
    if (!question || isBusy) return;

    isBusy = true;
    sendBtn.disabled = true;
    input.value = '';

    // Hide empty state
    if (emptyState) emptyState.remove();

    // Show user message
    appendMsg('user', question);

    // Show initial progress
    showProgress('Starting...', 0, 0);

    // Extract current page and send to background
    const pageData = extractCurrentPage();
    api.runtime.sendMessage({
      type: 'ask',
      question,
      pageData
    });
  }

  /* ── Incoming messages from background ── */

  api.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'progress') {
      showProgress(msg.phase, msg.detail, msg.round);
    } else if (msg.type === 'answer') {
      clearProgress();
      appendAnswer(msg.text, msg.sources, msg.trail);
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
    }
  });

  /* ── UI helpers ── */

  let progressEl = null;

  const PHASE_LABELS = {
    decompose: 'Breaking down question',
    scan: 'Scanning page',
    navigate: 'Picking pages',
    extract: 'Reading pages',
    answer: 'Thinking'
  };

  function showProgress(phase, detail, round) {
    if (!progressEl) {
      progressEl = el('div', { className: 'waa-progress' });
      messages.appendChild(progressEl);
    }
    const label = PHASE_LABELS[phase] || phase || 'Working';
    const roundLabel = round ? ` (round ${round})` : '';
    progressEl.innerHTML = `
      <span class="waa-spinner"></span> ${escHtml(label)}${roundLabel}<br>
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
    const div = el('div', { className: `waa-msg waa-msg-${role}` });
    div.innerHTML = `<div class="waa-msg-content">${escHtml(text)}</div>`;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  function appendAnswer(text, sources, trail) {
    const div = el('div', { className: 'waa-msg waa-msg-assistant' });

    let html = `<div class="waa-msg-content">${formatAnswer(text)}`;

    // Sources
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

    // Crawl trail
    if (trail && trail.length) {
      html += `<div class="waa-trail">
        <button class="waa-trail-toggle">&#9662; Crawl trail</button>
        <div class="waa-trail-list">
          ${trail.map(t => escHtml(t)).join('<br>')}
        </div>
      </div>`;
    }

    html += `</div>`;
    div.innerHTML = html;

    // Toggle crawl trail
    const toggle = div.querySelector('.waa-trail-toggle');
    const list = div.querySelector('.waa-trail-list');
    if (toggle && list) {
      toggle.addEventListener('click', () => {
        list.classList.toggle('open');
        toggle.innerHTML = list.classList.contains('open')
          ? '&#9652; Crawl trail'
          : '&#9662; Crawl trail';
      });
    }

    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  function appendNoKey() {
    const div = el('div', { className: 'waa-error' });
    div.innerHTML = 'No API key configured. <a class="waa-error-link" href="#">Open settings</a> to add one.';
    div.querySelector('.waa-error-link').addEventListener('click', (e) => {
      e.preventDefault();
      api.runtime.sendMessage({ type: 'openSettings' });
    });
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  function appendError(text) {
    const div = el('div', { className: 'waa-error' });
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  function formatAnswer(text) {
    // Basic markdown-lite: newlines → <br>, **bold**, `code`
    return escHtml(text)
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.+?)`/g, '<code>$1</code>');
  }

  /* ── Current page extraction ── */

  function extractCurrentPage() {
    const text = extractPageText();
    const links = extractPageLinks();
    const headings = extractPageHeadings();
    return {
      url: location.href,
      title: document.title,
      text: text.slice(0, 5000),
      links,
      headings
    };
  }

  function extractPageHeadings() {
    const headings = [];
    for (const el of document.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      const text = (el.textContent || '').trim();
      if (!text || text.length > 200) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const level = parseInt(el.tagName[1], 10);
      headings.push({ level, text });
    }
    return headings;
  }

  function extractPageText() {
    // Prefer <main> or <article>
    const main = document.querySelector('main') || document.querySelector('article');
    const root = main || document.body;

    // Walk the DOM, skip hidden elements and noise
    const skip = new Set(['SCRIPT', 'STYLE', 'NAV', 'FOOTER', 'HEADER',
      'NOSCRIPT', 'SVG', 'IMG', 'VIDEO', 'AUDIO', 'IFRAME', 'CANVAS']);
    const parts = [];

    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent.trim();
        if (t) parts.push(t);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (skip.has(node.tagName)) return;

      // Skip hidden elements
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return;

      // Use aria-label if present and element has no visible text children
      const ariaLabel = node.getAttribute('aria-label');
      if (ariaLabel) parts.push(ariaLabel);

      for (const child of node.childNodes) walk(child);
    }

    walk(root);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  function extractPageLinks() {
    const origin = location.origin;
    const links = [];
    const seen = new Set();

    for (const a of document.querySelectorAll('a[href]')) {
      try {
        const url = new URL(a.href, location.href);
        if (url.origin !== origin) continue;
        const href = url.href.split('#')[0];
        if (seen.has(href) || href === location.href.split('#')[0]) continue;
        seen.add(href);

        const text = (a.textContent || '').trim();
        if (!text || text.length > 200) continue;
        if (/\.(pdf|jpg|png|gif|svg|zip|mp4|css|js)$/i.test(href)) continue;

        // Tag whether this link is in a nav, header, or footer (site navigation)
        const navEl = a.closest('nav, [role="navigation"]');
        const footerEl = a.closest('footer, [role="contentinfo"]');
        const headerEl = a.closest('header');
        const inNav = !!(navEl || footerEl || headerEl);
        // Get the section label from aria-label if available
        const sectionEl = navEl || footerEl || headerEl;
        const navLabel = sectionEl ? (sectionEl.getAttribute('aria-label') || sectionEl.tagName.toLowerCase()) : '';
        links.push({ url: href, text, nav: inNav, navLabel });
      } catch { /* skip bad urls */ }
    }
    return links;
  }

  /* ── Util ── */

  function el(tag, attrs) {
    const e = document.createElement(tag);
    if (attrs) Object.assign(e, attrs);
    return e;
  }

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
