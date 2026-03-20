/* AMA — Background service worker
 * 2-phase pipeline: ARIA tree analysis -> optional page fetch
 * 1-2 LLM calls max per question.
 * Opens side panel on extension icon click.
 */

const api = typeof browser !== 'undefined' ? browser : chrome;

/* ── Side Panel: open on extension icon click ── */

api.action.onClicked.addListener(async (tab) => {
  await api.sidePanel.open({ windowId: tab.windowId });
});

// Enable side panel to open on action click
api.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

/* ── Settings ── */

const DEFAULTS = {
  provider: 'claude-web',
  fetchTimeout: 8000
};

async function getSettings() {
  const s = await api.storage.local.get(['provider']);
  return { provider: s.provider || DEFAULTS.provider };
}

/* ── HTML extraction (for fetched pages) ── */

function extractTextFromHtml(html) {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '');
  const mainMatch = html.match(/<main[\s\S]*?>([\s\S]*?)<\/main>/i);
  const articleMatch = html.match(/<article[\s\S]*?>([\s\S]*?)<\/article>/i);
  if (mainMatch) text = mainMatch[1];
  else if (articleMatch) text = articleMatch[1];
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

function extractTitleFromHtml(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
}

/* ── Sitemap + Robots ── */

async function fetchSitemap(origin, currentPath) {
  const sitemapUrls = [origin + '/sitemap.xml'];

  const localeMatch = (currentPath || '').match(/^\/([a-z]{2}-[a-z]{2})\b/i);
  const locale = localeMatch ? localeMatch[1].toLowerCase() : '';

  try {
    const robotsTxt = await fetchText(origin + '/robots.txt');
    if (robotsTxt) {
      const matches = robotsTxt.matchAll(/^Sitemap:\s*(.+)$/gim);
      for (const m of matches) {
        const url = m[1].trim();
        if (!sitemapUrls.includes(url)) {
          if (locale && url.toLowerCase().includes(locale)) {
            sitemapUrls.unshift(url);
          } else {
            sitemapUrls.push(url);
          }
        }
      }
    }
  } catch { /* robots.txt may not exist */ }

  for (const smUrl of sitemapUrls) {
    try {
      const xml = await fetchText(smUrl);
      if (!xml) continue;

      if (xml.includes('<sitemapindex')) {
        const indexUrls = [...xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi)]
          .map(m => m[1].trim())
          .slice(0, 5);
        const allUrls = [];
        for (const iUrl of indexUrls) {
          const subXml = await fetchText(iUrl);
          if (subXml) {
            const urls = parseSitemapUrls(subXml, origin);
            allUrls.push(...urls);
          }
        }
        if (allUrls.length > 0) return allUrls;
      }

      const urls = parseSitemapUrls(xml, origin);
      if (urls.length > 0) return urls;
    } catch { continue; }
  }
  return [];
}

function parseSitemapUrls(xml, origin) {
  const urls = [];
  const re = /<loc>\s*(.*?)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const url = m[1].trim();
    try {
      if (new URL(url).origin === new URL(origin).origin) urls.push(url);
    } catch { /* skip */ }
  }
  return urls;
}

/* ── Fetch ── */

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULTS.fetchTimeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
  finally { clearTimeout(timer); }
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULTS.fetchTimeout);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'text/html' } });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return null;
    return await res.text();
  } catch { return null; }
  finally { clearTimeout(timer); }
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/* ── LLM API ── */

async function callLLMJson(settings, systemPrompt, userMessage) {
  const raw = await callLLMRaw(settings, systemPrompt, userMessage);
  // Strip markdown fences
  let cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  // If response has prose around the JSON, extract the JSON object
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) cleaned = jsonMatch[0];
  return JSON.parse(cleaned);
}

async function callLLMRaw(settings, systemPrompt, userMessage) {
  if (settings.provider === 'chatgpt-web') return callChatGPTWeb(systemPrompt, userMessage);
  if (settings.provider === 'claude-web') return callClaudeWeb(systemPrompt, userMessage);
  if (settings.provider === 'gemini-web') return callGeminiWeb(systemPrompt, userMessage);
  throw new Error('Unknown provider: ' + settings.provider);
}

/* ── Pinned-tab approach for ChatGPT + Gemini ──
 * Opens provider in a pinned background tab, injects prompt via DOM,
 * polls for response, sends result back via message passing.
 * Claude uses direct HTTP (works without tabs).
 */

const _webProviderCallbacks = new Map();

async function findOrCreatePinnedTab(matchPattern, createUrl) {
  const tabs = await api.tabs.query({ url: matchPattern });
  if (tabs.length > 0) return tabs[0];
  return api.tabs.create({ url: createUrl, active: false, pinned: true });
}

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      api.tabs.onUpdated.removeListener(check);
      resolve(); // don't reject, just proceed
    }, 20000);
    function check(tid, info) {
      if (tid === tabId && info.status === 'complete') {
        api.tabs.onUpdated.removeListener(check);
        clearTimeout(timeout);
        resolve();
      }
    }
    api.tabs.onUpdated.addListener(check);
    api.tabs.get(tabId).then(tab => {
      if (tab.status === 'complete') {
        api.tabs.onUpdated.removeListener(check);
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

async function callViaPinnedTab(provider, prompt, matchPattern, freshUrl) {
  const tab = await findOrCreatePinnedTab(matchPattern, freshUrl);
  // Navigate to fresh conversation URL
  await api.tabs.update(tab.id, { url: freshUrl });
  await waitForTabLoad(tab.id);
  await delay(2500); // SPA hydration

  const callId = crypto.randomUUID();

  await api.scripting.executeScript({
    target: { tabId: tab.id },
    func: tabProviderDriver,
    args: [provider, prompt, callId]
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      _webProviderCallbacks.delete(callId);
      reject(new Error(`${provider} response timed out after 90s`));
    }, 90000);
    _webProviderCallbacks.set(callId, (result) => {
      clearTimeout(timeout);
      _webProviderCallbacks.delete(callId);
      if (result.error) reject(new Error(result.error));
      else resolve(result.text);
    });
  });
}

/* Driver function injected into provider tabs */
function tabProviderDriver(provider, prompt, callId) {
  const api = typeof browser !== 'undefined' ? browser : chrome;
  function done(result) {
    api.runtime.sendMessage({ type: 'webProviderResult', callId, ...result });
  }
  try {
    let editor, sendSelector, responseSelector;

    if (provider === 'chatgpt') {
      editor = document.querySelector('#prompt-textarea, div[contenteditable="true"][id="prompt-textarea"]');
      sendSelector = '[data-testid="send-button"], button[aria-label*="Send"], form button[type="submit"]';
      responseSelector = '[data-message-author-role="assistant"]';
    } else if (provider === 'gemini') {
      editor = document.querySelector('.ql-editor, div[contenteditable="true"][aria-label*="prompt"], rich-textarea .ql-editor, div[contenteditable="true"]');
      sendSelector = 'button[aria-label="Send message"], button.send-button, button[data-test-id="send-button"], .send-button-container button';
      responseSelector = '.model-response-text, .response-container, message-content';
    }

    if (!editor) return done({ error: `${provider} input not found. Is the site loaded and logged in?` });

    // Count existing responses before we submit
    const prevCount = document.querySelectorAll(responseSelector).length;

    // Insert text — use execCommand for ProseMirror/Quill compatibility
    editor.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    document.execCommand('insertText', false, prompt);

    // Also try direct value setting as fallback
    if (!editor.textContent.trim()) {
      editor.innerHTML = '<p>' + prompt.replace(/</g, '&lt;') + '</p>';
      editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }

    setTimeout(() => {
      const sendBtn = document.querySelector(sendSelector);
      if (!sendBtn) return done({ error: `${provider} send button not found.` });
      sendBtn.click();

      let attempts = 0, lastText = '', stableCount = 0;
      const poll = setInterval(() => {
        attempts++;
        const responses = document.querySelectorAll(responseSelector);
        if (responses.length > prevCount) {
          const text = responses[responses.length - 1].innerText.trim();
          if (text && text === lastText) {
            stableCount++;
            if (stableCount >= 4) { clearInterval(poll); done({ text }); }
          } else { lastText = text; stableCount = 0; }
        }
        if (attempts >= 180) {
          clearInterval(poll);
          done(lastText ? { text: lastText } : { error: `${provider} timed out.` });
        }
      }, 500);
    }, 800);
  } catch (e) { done({ error: e.message }); }
}

async function callChatGPTWeb(systemPrompt, userMessage) {
  return callViaPinnedTab('chatgpt', systemPrompt + '\n\n' + userMessage,
    '*://*.chatgpt.com/*', 'https://chatgpt.com/');
}

/* ── Gemini Web Session (HTTP, no tab) ── */

async function callGeminiWeb(systemPrompt, userMessage) {
  // Step 1: Fetch the Gemini app page to extract SNlM0e token
  const pageRes = await fetch('https://gemini.google.com/app', {
    credentials: 'include',
    headers: { 'Accept': 'text/html' }
  });
  if (!pageRes.ok) throw new Error('Not logged in to Gemini. Open settings and log in to Google.');
  const pageHtml = await pageRes.text();

  const tokenMatch = pageHtml.match(/"SNlM0e":"(.*?)"/);
  if (!tokenMatch) throw new Error('Gemini session expired or not logged in. Please log in to Google.');
  const snlm0e = tokenMatch[1];

  // Extract build label (bl param)
  const blMatch = pageHtml.match(/"cfb2h":"(.*?)"/);
  const bl = blMatch ? blMatch[1] : '';

  // Step 2: Build the request payload
  const prompt = systemPrompt + '\n\n' + userMessage;
  const innerPayload = JSON.stringify([
    [prompt, 0, null, [], null, null, 0],
    null,             // language
    [null, null, null], // conversation metadata (null = new chat)
    null, null, null,
    [1]               // web access
  ]);
  const fReq = JSON.stringify([null, innerPayload]);

  // Step 3: POST to StreamGenerate
  const params = new URLSearchParams({
    _reqid: String(Math.floor(Math.random() * 900000) + 100000),
    rt: 'c',
    bl: bl
  });

  const res = await fetch(
    `https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?${params}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      'Origin': 'https://gemini.google.com',
      'Referer': 'https://gemini.google.com/',
      'X-Same-Domain': '1'
    },
    body: `at=${encodeURIComponent(snlm0e)}&f.req=${encodeURIComponent(fReq)}`
  });

  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);

  // Step 4: Parse response — line-delimited, main data on line 3
  const rawText = await res.text();
  const lines = rawText.split('\n').filter(l => l.trim());

  // Find the line containing the response JSON (usually the longest one)
  let responseText = '';
  for (const line of lines) {
    try {
      const outer = JSON.parse(line);
      if (!Array.isArray(outer)) continue;
      for (const item of outer) {
        if (!Array.isArray(item) || item.length < 3) continue;
        try {
          const inner = JSON.parse(item[2]);
          // Navigate nested structure to find the text response
          if (inner && inner[4] && Array.isArray(inner[4])) {
            for (const candidate of inner[4]) {
              if (candidate && candidate[1] && Array.isArray(candidate[1]) && candidate[1][0]) {
                responseText = candidate[1][0];
                break;
              }
            }
          }
          // Alternative path: inner[0][0] for simpler responses
          if (!responseText && inner && inner[0] && typeof inner[0] === 'string') {
            responseText = inner[0];
          }
        } catch { /* not the right item */ }
      }
      if (responseText) break;
    } catch { /* not JSON */ }
  }

  if (!responseText) throw new Error('No response from Gemini.');
  return responseText;
}

/* ── Claude Web Session ── */

async function callClaudeWeb(systemPrompt, userMessage) {
  // Step 1: Get organization ID
  const orgRes = await fetch('https://claude.ai/api/organizations', {
    credentials: 'include'
  });
  if (!orgRes.ok) throw new Error('Not logged in to Claude. Open settings and log in.');
  const orgs = await orgRes.json();
  if (!orgs.length) throw new Error('No Claude organization found. Please log in again.');
  const orgId = orgs[0].uuid;

  // Step 2: Create a new conversation
  const convUuid = crypto.randomUUID();
  const convRes = await fetch(`https://claude.ai/api/organizations/${orgId}/chat_conversations`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '', uuid: convUuid })
  });
  if (!convRes.ok) throw new Error(`Claude conversation create failed: ${convRes.status}`);

  // Step 3: Send message
  const msgRes = await fetch(`https://claude.ai/api/organizations/${orgId}/chat_conversations/${convUuid}/completion`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: systemPrompt + '\n\n' + userMessage,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    })
  });
  if (!msgRes.ok) throw new Error(`Claude ${msgRes.status}: ${await msgRes.text()}`);

  // Step 4: Parse SSE stream
  const text = await msgRes.text();
  const lines = text.split('\n').filter(l => l.startsWith('data: '));
  let result = '';
  for (const line of lines) {
    try {
      const data = JSON.parse(line.slice(6));
      if (data.completion) result += data.completion;
    } catch { /* skip */ }
  }
  if (!result) throw new Error('No response from Claude.');
  return result;
}

/* ── Login status check (called from options page) ── */

async function checkLoginStatus(provider) {
  try {
    if (provider === 'chatgpt-web') {
      const res = await fetch('https://chatgpt.com/api/auth/session', { credentials: 'include' });
      if (!res.ok) return { loggedIn: false };
      const data = await res.json();
      return { loggedIn: !!data.accessToken, user: data.user?.email || '' };
    }
    if (provider === 'claude-web') {
      const res = await fetch('https://claude.ai/api/organizations', { credentials: 'include' });
      if (!res.ok) return { loggedIn: false };
      const orgs = await res.json();
      return { loggedIn: Array.isArray(orgs) && orgs.length > 0, user: orgs[0]?.name || '' };
    }
    if (provider === 'gemini-web') {
      const res = await fetch('https://gemini.google.com/app', { credentials: 'include', headers: { 'Accept': 'text/html' } });
      if (!res.ok) return { loggedIn: false };
      const html = await res.text();
      const hasToken = /"SNlM0e":"/.test(html);
      return { loggedIn: hasToken, user: hasToken ? 'Google account' : '' };
    }
  } catch { /* network error */ }
  return { loggedIn: false };
}

/* ═══════════════════════════════════════════
   2-PHASE PIPELINE
   Phase 1: ARIA tree + sitemap + question -> LLM (can_answer or needs_pages)
   Phase 2: Fetch needed pages -> LLM with full content -> answer
   ═══════════════════════════════════════════ */

// Score and rank links by keyword relevance to the question
function scoreLinks(links, sitemapUrls, question, excludeUrls) {
  const words = question.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const boostTerms = ['support', 'help', 'service', 'contact', 'faq', 'return',
    'repair', 'warranty', 'form', 'klantenservice', 'reparatie', 'retour',
    'garantie', 'hilfe', 'aide', 'formulaire', 'onderdelen', 'label',
    'download', 'order', 'account', 'shipping', 'delivery'];
  const allTerms = [...new Set([...words, ...boostTerms])];
  const excluded = new Set((excludeUrls || []).map(u => u.split('#')[0]));

  // Combine page links + sitemap into one list, deduped
  const seen = new Set();
  const candidates = [];

  for (const link of links) {
    const url = link.url;
    const normalized = url.split('#')[0];
    if (seen.has(normalized) || excluded.has(normalized)) continue;
    seen.add(normalized);
    candidates.push({ text: link.text, url });
  }

  for (const u of (sitemapUrls || [])) {
    const normalized = u.split('#')[0];
    if (seen.has(normalized) || excluded.has(normalized)) continue;
    seen.add(normalized);
    candidates.push({ text: shortenUrl(u), url: u });
  }

  // Score each candidate
  const scored = candidates.map(link => {
    const textLower = (link.text || '').toLowerCase();
    const pathLower = shortenUrl(link.url).toLowerCase();
    const combined = textLower + ' ' + pathLower;
    let score = 0;

    // Question words matching
    for (const w of words) {
      if (textLower.includes(w)) score += 3;
      if (pathLower.includes(w)) score += 2;
    }

    // Boost terms matching (URL path only — these are common service paths)
    for (const t of boostTerms) {
      if (pathLower.includes(t)) score += 1;
    }

    // Prefer deeper paths (more specific pages)
    const depth = (pathLower.match(/\//g) || []).length;
    if (depth >= 3) score += 1;

    // Penalize generic top-level pages
    if (pathLower === '/' || pathLower.match(/^\/[a-z]{2}(-[a-z]{2})?\/?$/)) score -= 5;

    // Penalize media files
    if (/\.(pdf|jpg|png|gif|svg|zip|mp4|css|js)$/i.test(pathLower)) score -= 2;

    return { ...link, score };
  });

  // Sort by score descending, return top results
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

async function handleQuestion(question, pageData, senderTabId) {
  const settings = await getSettings();

  const origin = new URL(pageData.url).origin;
  const history = pageData.history || [];

  try {
    // ── Fetch sitemap ──
    sendToSidePanel({ type: 'progress', phase: 'Analyzing page...', detail: 'Fetching sitemap...' });

    const sitemapUrls = await fetchSitemap(origin, new URL(pageData.url).pathname);
    const sitemapPaths = (sitemapUrls || [])
      .filter(u => u !== pageData.url)
      .map(u => ({ text: shortenUrl(u), url: u }));

    // ── Build clean link list from ARIA tree + sitemap ──
    const pageLinks = (pageData.links || []).map(l => ({
      text: l.text,
      url: l.url.startsWith('/') ? origin + l.url : l.url
    }));

    const seen = new Set([pageData.url.split('#')[0]]);
    const triedUrls = history.flatMap(h => h.tried_urls || []);
    for (const u of triedUrls) seen.add(u.split('#')[0]);

    const allLinks = [];
    for (const link of [...pageLinks, ...sitemapPaths]) {
      const normalized = link.url.split('#')[0];
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      allLinks.push(link);
    }

    if (allLinks.length === 0) {
      sendToSidePanel({
        type: 'answer',
        text: 'No links found on this page or sitemap to explore.',
        question,
        sources: []
      });
      return;
    }

    // ── Single LLM call: pick line numbers from link list ──
    sendToSidePanel({ type: 'progress', phase: 'Finding relevant pages...', detail: `${allLinks.length} links found` });

    const numberedLinks = allLinks.slice(0, 150);
    const linkList = numberedLinks.map((l, i) => `${i + 1}. [${l.text}] -> ${shortenUrl(l.url)}`).join('\n');

    let historySection = '';
    if (history.length > 0) {
      historySection = `\nPrevious answers were WRONG. Pick DIFFERENT links.\n` +
        (triedUrls.length > 0 ? `Already tried: ${triedUrls.map(u => shortenUrl(u)).join(', ')}\n` : '');
    }

    const systemPrompt = `Pick the 5 best links to answer a question. Return ONLY line numbers as JSON. Labels MUST be in English.`;

    const userPrompt = `${linkList}
${historySection}
Question: ${question}

Return exactly 5 picks. For each, give the line number and a short English label.
Think about what each page CONTAINS, not just the link text.
Example: {"picks":[{"n":3,"label":"Deliveries & returns"},{"n":17,"label":"FAQ"}],"reason":"brief explanation"}`;

    const result = await callLLMJson(settings, systemPrompt, userPrompt);

    // Map line numbers back to actual links
    const picks = (result.picks || []).slice(0, 5);
    const sources = picks
      .filter(p => p.n >= 1 && p.n <= numberedLinks.length)
      .map(p => {
        const link = numberedLinks[p.n - 1];
        return { url: link.url, title: p.label || link.text };
      });

    if (sources.length === 0) {
      sendToSidePanel({
        type: 'answer',
        text: 'Could not identify relevant pages. Try asking differently.',
        question,
        sources: []
      });
      return;
    }

    sendToSidePanel({
      type: 'answer',
      text: result.reason || 'Here are the most relevant pages:',
      question,
      sources
    });

  } catch (err) {
    sendToSidePanel({ type: 'error', message: err.message || 'Pipeline failed.' });
  }
}

/* ── Helpers ── */

function truncateText(text, maxChars) {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '...';
}

function shortenUrl(url) {
  try { return new URL(url).pathname + new URL(url).search; }
  catch { return url; }
}

/** Send a message to the side panel (which is an extension page, not a tab) */
function sendToSidePanel(message) {
  api.runtime.sendMessage(message).catch(() => {});
}

/** Legacy: send to a specific tab (still used for content script communication) */
function sendToTab(tabId, message) {
  api.tabs.sendMessage(tabId, message).catch(() => {});
}

/* ── Site Search: fetch results page, extract links, LLM picks top 5 ── */

function extractLinksFromHtml(html, origin) {
  const links = [];
  const re = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    if (!text || text.length < 3) continue;
    try {
      const url = new URL(href, origin);
      if (url.origin === origin && !url.pathname.match(/\.(css|js|png|jpg|svg|gif|ico)$/i)) {
        links.push({ text: text.slice(0, 150), url: url.pathname + url.search });
      }
    } catch { /* skip bad urls */ }
  }
  // Dedupe by URL
  const seen = new Set();
  return links.filter(l => {
    if (seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  });
}

async function handleSiteSearch(query, searchUrl, pageUrl) {
  const settings = await getSettings();
  const origin = new URL(pageUrl).origin;

  try {
    sendToSidePanel({ type: 'progress', phase: 'Searching site...', detail: shortenUrl(searchUrl) });

    const html = await fetchPage(searchUrl);
    if (!html) {
      sendToSidePanel({ type: 'error', message: 'Could not fetch search results from this site.' });
      return;
    }

    // Extract links from search results page
    const links = extractLinksFromHtml(html, origin);
    if (links.length === 0) {
      sendToSidePanel({ type: 'error', message: 'No results found on the search page.' });
      return;
    }

    sendToSidePanel({ type: 'progress', phase: 'Picking best results...', detail: `${links.length} links found` });

    // Same format as main search: numbered link list -> LLM picks top 5
    const numberedLinks = links.slice(0, 100);
    const linkList = numberedLinks.map((l, i) => `${i + 1}. [${l.text}] -> ${l.url}`).join('\n');

    const systemPrompt = `Pick the 5 best links to answer a question. Return ONLY line numbers as JSON. Labels MUST be in English.`;
    const userPrompt = `Site search results for "${query}":\n${linkList}\n\nQuestion: ${query}\n\nReturn exactly 5 picks. For each, give the line number and a short English label.\nExample: {"picks":[{"n":3,"label":"Form 1065 instructions"},{"n":7,"label":"Filing guide"}],"reason":"brief explanation"}`;

    const result = await callLLMJson(settings, systemPrompt, userPrompt);

    const picks = (result.picks || []).slice(0, 5);
    const sources = picks
      .filter(p => p.n >= 1 && p.n <= numberedLinks.length)
      .map(p => {
        const link = numberedLinks[p.n - 1];
        return { url: origin + link.url, title: p.label || link.text };
      });

    sendToSidePanel({
      type: 'answer',
      text: result.reason || 'Here are the most relevant results from site search:',
      question: 'Site search: ' + query,
      sources: sources.length > 0 ? sources : [{ url: searchUrl, title: 'Search results' }]
    });

  } catch (err) {
    sendToSidePanel({ type: 'error', message: err.message || 'Site search failed.' });
  }
}

/* ── Research: pick pages, fetch them, synthesize answer ── */

async function handleResearch(question, pageData) {
  const settings = await getSettings();
  const origin = new URL(pageData.url).origin;

  try {
    // Phase 1: Find relevant pages (same as handleQuestion)
    sendToSidePanel({ type: 'progress', phase: 'Researching...', detail: 'Fetching sitemap' });

    const sitemapUrls = await fetchSitemap(origin, new URL(pageData.url).pathname);
    const sitemapPaths = (sitemapUrls || [])
      .filter(u => u !== pageData.url)
      .map(u => ({ text: shortenUrl(u), url: u }));

    const pageLinks = (pageData.links || []).map(l => ({
      text: l.text,
      url: l.url.startsWith('/') ? origin + l.url : l.url
    }));

    const seen = new Set([pageData.url.split('#')[0]]);
    const triedUrls = (pageData.history || []).flatMap(h => h.tried_urls || []);
    for (const u of triedUrls) seen.add(u.split('#')[0]);

    const allLinks = [];
    for (const link of [...pageLinks, ...sitemapPaths]) {
      const normalized = link.url.split('#')[0];
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      allLinks.push(link);
    }

    if (allLinks.length === 0) {
      // No links to explore — just answer from current page ARIA tree
      sendToSidePanel({ type: 'progress', phase: 'Answering from current page...', detail: '' });
      const answer = await callLLMRaw(settings,
        'Answer the user\'s question based on the page content below. Answer in English even if the content is in another language. Be concise and helpful.',
        `Page: ${pageData.title}\nURL: ${pageData.url}\n\n${pageData.ariaTree}\n\nQuestion: ${question}`
      );
      sendToSidePanel({ type: 'answer', text: answer, question, sources: [{ url: pageData.url, title: pageData.title }] });
      return;
    }

    // LLM picks top 5 pages
    sendToSidePanel({ type: 'progress', phase: 'Researching...', detail: `Picking from ${allLinks.length} pages` });

    const numberedLinks = allLinks.slice(0, 150);
    const linkList = numberedLinks.map((l, i) => `${i + 1}. [${l.text}] -> ${shortenUrl(l.url)}`).join('\n');

    const pickResult = await callLLMJson(settings,
      'Pick the 5 best links to answer a question. Return ONLY line numbers as JSON. Labels MUST be in English.',
      `${linkList}\n\nQuestion: ${question}\n\nReturn exactly 5 picks.\nExample: {"picks":[{"n":3,"label":"About us"},{"n":7,"label":"Philosophy"}],"reason":"brief"}`
    );

    const picks = (pickResult.picks || []).slice(0, 5);
    const selectedUrls = picks
      .filter(p => p.n >= 1 && p.n <= numberedLinks.length)
      .map(p => ({ url: numberedLinks[p.n - 1].url, label: p.label || numberedLinks[p.n - 1].text }));

    if (selectedUrls.length === 0) {
      sendToSidePanel({ type: 'answer', text: 'Could not identify relevant pages. Try asking differently.', question, sources: [] });
      return;
    }

    // Phase 2: Fetch selected pages
    sendToSidePanel({ type: 'progress', phase: 'Reading pages...', detail: `0/${selectedUrls.length}` });

    const pageContents = [];
    for (let i = 0; i < selectedUrls.length; i++) {
      const { url, label } = selectedUrls[i];
      sendToSidePanel({ type: 'progress', phase: 'Reading pages...', detail: `${i + 1}/${selectedUrls.length}: ${label}` });

      const html = await fetchPage(url);
      if (html) {
        const text = extractTextFromHtml(html);
        pageContents.push({
          url,
          title: label, // English label from LLM pick
          text: truncateText(text, 3000)
        });
      }
      // Small delay between fetches to be polite
      if (i < selectedUrls.length - 1) await delay(300);
    }

    if (pageContents.length === 0) {
      sendToSidePanel({ type: 'answer', text: 'Could not load any of the selected pages.', question, sources: [] });
      return;
    }

    // Phase 3: Synthesize answer from all page contents
    sendToSidePanel({ type: 'progress', phase: 'Synthesizing answer...', detail: `From ${pageContents.length} pages` });

    const contentBlock = pageContents.map((p, i) =>
      `--- Page ${i + 1}: ${p.title} (${shortenUrl(p.url)}) ---\n${p.text}`
    ).join('\n\n');

    const systemPrompt = `You are a research assistant. The user asked a question about a website. Below is content from ${pageContents.length} pages on that site. Synthesize a clear, comprehensive answer in English, even if the source content is in another language. Cite which pages you drew from. Be concise but thorough.`;

    const userPrompt = `${contentBlock}\n\n---\nQuestion: ${question}`;

    const answer = await callLLMRaw(settings, systemPrompt, userPrompt);

    const sources = pageContents.map(p => ({
      url: p.url,
      title: p.title
    }));

    sendToSidePanel({ type: 'answer', text: answer, question, sources });

  } catch (err) {
    console.error('Research error:', err);
    sendToSidePanel({ type: 'error', message: err.message || 'Research failed.' });
  }
}

/* ── Message listener ── */

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ask') {
    handleQuestion(msg.question, msg.pageData, sender.tab?.id);
  } else if (msg.type === 'research') {
    handleResearch(msg.question, msg.pageData);
  } else if (msg.type === 'asksite') {
    // Resolve search URL template
    let searchUrl = msg.searchUrl;
    if (searchUrl && searchUrl.includes('__QUERY__')) {
      searchUrl = searchUrl.replace('__QUERY__', encodeURIComponent(msg.query));
    }
    handleSiteSearch(msg.query, searchUrl, msg.pageUrl);
  } else if (msg.type === 'openSettings') {
    api.runtime.openOptionsPage();
  } else if (msg.type === 'checkLogin') {
    checkLoginStatus(msg.provider).then(sendResponse);
    return true; // async response
  } else if (msg.type === 'webProviderResult') {
    const cb = _webProviderCallbacks.get(msg.callId);
    if (cb) cb({ text: msg.text, error: msg.error });
  }
  return false;
});
