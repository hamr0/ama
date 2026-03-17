/* WeAreAsking — Background service worker
 * Handles: crawl orchestration, content extraction, LLM calls
 */

const api = typeof browser !== 'undefined' ? browser : chrome;

/* ── Settings ── */

const DEFAULTS = {
  provider: 'anthropic',
  model: { anthropic: 'claude-sonnet-4-20250514', openai: 'gpt-4o-mini' },
  maxPages: 3,
  fetchDelay: 1500,   // ms between page fetches (avoid rate limits)
  fetchTimeout: 8000  // ms per fetch
};

async function getSettings() {
  const s = await api.storage.local.get([
    'provider', 'apiKey', 'model', 'maxPages'
  ]);
  const provider = s.provider || DEFAULTS.provider;
  return {
    provider,
    apiKey: s.apiKey || '',
    model: s.model || DEFAULTS.model[provider],
    maxPages: s.maxPages || DEFAULTS.maxPages
  };
}

/* ── HTML text extraction (regex-based, no DOMParser in service worker) ── */

function extractTextFromHtml(html) {
  // Remove script, style, nav, footer, header, noscript
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '');

  // Try to extract <main> or <article> content first
  const mainMatch = html.match(/<main[\s\S]*?>([\s\S]*?)<\/main>/i);
  const articleMatch = html.match(/<article[\s\S]*?>([\s\S]*?)<\/article>/i);
  if (mainMatch) text = mainMatch[1];
  else if (articleMatch) text = articleMatch[1];

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, ' ');

  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

function extractLinksFromHtml(html, baseUrl) {
  const links = [];
  const seen = new Set();
  const origin = new URL(baseUrl).origin;
  const re = /<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let href = m[1];
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    if (!text || text.length > 200) continue;

    // Resolve relative URLs
    try {
      const url = new URL(href, baseUrl);
      if (url.origin !== origin) continue; // same-origin only
      href = url.href;
    } catch { continue; }

    if (seen.has(href)) continue;
    seen.add(href);

    // Skip non-page links
    if (/\.(pdf|jpg|png|gif|svg|zip|mp4|mp3|css|js)$/i.test(href)) continue;

    links.push({ url: href, text });
  }
  return links;
}

function extractTitleFromHtml(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
}

/* ── Link scoring ── */

function scoreLink(link, question) {
  const q = question.toLowerCase();
  const words = q.split(/\s+/).filter(w => w.length > 2);
  const linkText = link.text.toLowerCase();
  const linkPath = new URL(link.url).pathname.toLowerCase();
  let score = 0;

  for (const word of words) {
    if (linkText.includes(word)) score += 3;
    if (linkPath.includes(word)) score += 2;
  }

  // Boost links with informative text
  if (linkText.length > 5 && linkText.length < 80) score += 1;

  // Penalize generic links
  const generic = ['home', 'login', 'sign in', 'contact', 'privacy', 'terms',
    'cookie', 'sitemap', 'skip to content', 'menu', 'search'];
  if (generic.some(g => linkText.includes(g))) score -= 5;

  return score;
}

function rankLinks(links, question, limit) {
  return links
    .map(link => ({ ...link, score: scoreLink(link, question) }))
    .filter(link => link.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/* ── Fetch with timeout ── */

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULTS.fetchTimeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'text/html' }
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ── LLM API ── */

async function callLLM(settings, systemPrompt, userMessage) {
  if (settings.provider === 'anthropic') {
    return callAnthropic(settings, systemPrompt, userMessage);
  }
  return callOpenAI(settings, systemPrompt, userMessage);
}

async function callAnthropic(settings, systemPrompt, userMessage) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.content[0].text;
}

async function callOpenAI(settings, systemPrompt, userMessage) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ]
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

/* ── System prompt ── */

const SYSTEM_PROMPT = `You are a helpful assistant that answers questions about a website based on content extracted from its pages.

Rules:
- Answer ONLY based on the provided page contents. Do not use external knowledge.
- Cite which page each fact comes from using the page URL.
- If the provided content does not contain the answer, say: "I couldn't find this on the site."
- Be concise and direct.
- When referencing pages, use their URLs so the user can navigate there.`;

/* ── Crawl orchestration ── */

async function handleQuestion(question, pageData, tabId) {
  const settings = await getSettings();

  if (!settings.apiKey) {
    sendToTab(tabId, {
      type: 'error',
      message: 'No API key configured. Right-click the extension icon → Options to set one up.'
    });
    return;
  }

  const visited = [];
  const allLinks = [];

  // Step 1: process the current page
  visited.push({
    url: pageData.url,
    title: pageData.title,
    text: truncateText(pageData.text, 3000)
  });

  sendToTab(tabId, {
    type: 'progress',
    page: shortenUrl(pageData.url),
    current: 1,
    total: settings.maxPages
  });

  // Collect links from current page
  for (const link of (pageData.links || [])) {
    allLinks.push(link);
  }

  // Step 2: crawl additional pages
  const ranked = rankLinks(allLinks, question, settings.maxPages - 1);

  for (let i = 0; i < ranked.length; i++) {
    const link = ranked[i];

    // Delay between fetches
    if (i > 0) await delay(DEFAULTS.fetchDelay);

    sendToTab(tabId, {
      type: 'progress',
      page: shortenUrl(link.url),
      current: visited.length + 1,
      total: Math.min(visited.length + ranked.length - i, settings.maxPages)
    });

    const html = await fetchPage(link.url);
    if (!html) continue;

    const text = extractTextFromHtml(html);
    const title = extractTitleFromHtml(html) || link.text;

    visited.push({
      url: link.url,
      title,
      text: truncateText(text, 3000)
    });

    // Gather new links from this page too
    const newLinks = extractLinksFromHtml(html, link.url);
    for (const nl of newLinks) {
      if (!visited.some(v => v.url === nl.url) && !allLinks.some(l => l.url === nl.url)) {
        allLinks.push(nl);
      }
    }
  }

  // Step 3: assemble context and call LLM
  sendToTab(tabId, { type: 'progress', page: 'Thinking...', current: visited.length, total: visited.length });

  const context = visited.map((p, i) =>
    `--- Page ${i + 1}: ${p.url} ---\nTitle: ${p.title}\n\n${p.text}`
  ).join('\n\n');

  const userMessage = `The user is on: ${pageData.url}\n\nQuestion: ${question}\n\n` +
    `Here are the contents of ${visited.length} pages from this site:\n\n${context}`;

  try {
    const answer = await callLLM(settings, SYSTEM_PROMPT, userMessage);
    sendToTab(tabId, {
      type: 'answer',
      text: answer,
      sources: visited.map(p => ({ url: p.url, title: p.title })),
      pagesVisited: visited.length,
      trail: visited.map(p => `${shortenUrl(p.url)} — ${p.title}`)
    });
  } catch (err) {
    sendToTab(tabId, {
      type: 'error',
      message: err.message || 'LLM request failed.'
    });
  }
}

/* ── Helpers ── */

function truncateText(text, maxChars) {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '...';
}

function shortenUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function sendToTab(tabId, message) {
  api.tabs.sendMessage(tabId, message).catch(() => {});
}

/* ── Message listener ── */

api.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'ask' && sender.tab) {
    handleQuestion(msg.question, msg.pageData, sender.tab.id);
  }
  return false;
});
