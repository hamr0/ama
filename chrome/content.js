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
      <button class="waa-close" title="Close">&times;</button>
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
      showProgress(msg.page, msg.current, msg.total);
    } else if (msg.type === 'answer') {
      clearProgress();
      appendAnswer(msg.text, msg.sources, msg.trail);
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

  function showProgress(page, current, total) {
    if (!progressEl) {
      progressEl = el('div', { className: 'waa-progress' });
      messages.appendChild(progressEl);
    }
    const label = total > 0 ? `${current} of ${total} pages` : '';
    progressEl.innerHTML = `
      <span class="waa-spinner"></span> Exploring...<br>
      <span class="waa-progress-page">&rarr; ${escHtml(page)}</span><br>
      <span>${label}</span>
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
        ${sources.map(s =>
          `<a class="waa-source-link" href="${escAttr(s.url)}" target="_blank" rel="noopener">
            ${escHtml(shortenUrl(s.url))}
          </a>`
        ).join('')}
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
    return {
      url: location.href,
      title: document.title,
      text: text.slice(0, 5000),
      links
    };
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

        links.push({ url: href, text });
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
