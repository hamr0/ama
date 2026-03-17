/* WeAreAsking — Background service worker
 * Pipeline: DECOMPOSE → SCAN → NAVIGATE → EXTRACT → (repeat 3 rounds) → ANSWER
 * All LLM responses are forced JSON to limit hallucinations.
 */

const api = typeof browser !== 'undefined' ? browser : chrome;

/* ── Settings ── */

const DEFAULTS = {
  provider: 'openai',
  model: { anthropic: 'claude-sonnet-4-20250514', openai: 'gpt-4o-mini' },
  maxPages: 3,
  maxRounds: 3,
  fetchDelay: 1200,
  fetchTimeout: 8000
};

async function getSettings() {
  const s = await api.storage.local.get(['provider', 'apiKey', 'model', 'maxPages']);
  const provider = s.provider || DEFAULTS.provider;
  return {
    provider,
    apiKey: s.apiKey || '',
    model: s.model || DEFAULTS.model[provider],
    maxPages: s.maxPages || DEFAULTS.maxPages
  };
}

/* ── HTML extraction ── */

function extractHeadingsFromHtml(html) {
  const headings = [];
  const re = /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const level = parseInt(m[1][1], 10);
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    if (text && text.length < 200) {
      headings.push({ level, text });
    }
  }
  return headings;
}

function extractLinksFromHtml(html, baseUrl) {
  const links = [];
  const seen = new Set();
  const origin = new URL(baseUrl).origin;

  // Find nav/header regions to tag links
  const navRegions = [];
  const navRe = /<(nav|header)[^>]*>([\s\S]*?)<\/\1>/gi;
  let nm;
  while ((nm = navRe.exec(html)) !== null) {
    navRegions.push({ start: nm.index, end: nm.index + nm[0].length });
  }

  const re = /<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let href = m[1];
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    if (!text || text.length > 200) continue;
    try {
      const url = new URL(href, baseUrl);
      if (url.origin !== origin) continue;
      href = url.href;
    } catch { continue; }
    if (seen.has(href)) continue;
    seen.add(href);
    if (/\.(pdf|jpg|png|gif|svg|zip|mp4|mp3|css|js)$/i.test(href)) continue;
    const inNav = navRegions.some(r => m.index >= r.start && m.index <= r.end);
    links.push({ url: href, text, nav: inNav });
  }
  return links;
}

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
  // Step 1: check robots.txt for Sitemap directives
  const sitemapUrls = [origin + '/sitemap.xml'];

  // Detect locale from current path (e.g. /nl-nl/... → nl-nl)
  const localeMatch = (currentPath || '').match(/^\/([a-z]{2}-[a-z]{2})\b/i);
  const locale = localeMatch ? localeMatch[1].toLowerCase() : '';

  try {
    const robotsTxt = await fetchText(origin + '/robots.txt');
    if (robotsTxt) {
      const matches = robotsTxt.matchAll(/^Sitemap:\s*(.+)$/gim);
      for (const m of matches) {
        const url = m[1].trim();
        if (!sitemapUrls.includes(url)) {
          // Prioritize locale-matching sitemaps
          if (locale && url.toLowerCase().includes(locale)) {
            sitemapUrls.unshift(url);
          } else {
            sitemapUrls.push(url);
          }
        }
      }
    }
  } catch { /* robots.txt may not exist */ }

  // Step 2: try each sitemap URL
  for (const smUrl of sitemapUrls) {
    try {
      const xml = await fetchText(smUrl);
      if (!xml) continue;

      // Check for sitemap index (contains other sitemaps)
      if (xml.includes('<sitemapindex')) {
        const indexUrls = [...xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi)]
          .map(m => m[1].trim())
          .slice(0, 5); // check up to 5 sub-sitemaps
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

      // Regular sitemap
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
    // Same origin only
    try {
      if (new URL(url).origin === new URL(origin).origin) {
        urls.push(url);
      }
    } catch { /* skip */ }
  }
  return urls;
}

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

/* ── Fetch ── */

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

/* ── LLM API (JSON forced) ── */

async function callLLMJson(settings, systemPrompt, userMessage) {
  const raw = await callLLMRaw(settings, systemPrompt, userMessage, true);
  // Strip markdown fences if model wraps in ```json
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(cleaned);
}

async function callLLMRaw(settings, systemPrompt, userMessage, json = false) {
  if (settings.provider === 'anthropic') {
    return callAnthropic(settings, systemPrompt, userMessage);
  }
  return callOpenAI(settings, systemPrompt, userMessage, json);
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
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content[0].text;
}

async function callOpenAI(settings, systemPrompt, userMessage, json = false) {
  const body = {
    model: settings.model,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ]
  };
  if (json) body.response_format = { type: 'json_object' };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

/* ═══════════════════════════════════════════
   PIPELINE
   Phase 1: DECOMPOSE  — break question into sub-questions
   Phase 2: SCAN       — extract headings + links from current page
   Phase 3: NAVIGATE   — LLM picks pages (repeated per round)
   Phase 4: EXTRACT    — fetch + extract headings from picked pages
   Phase 5: ANSWER     — final answer from all gathered context
   ═══════════════════════════════════════════ */

/* ── Phase 1: DECOMPOSE ── */

async function phaseDecompose(settings, question, history) {
  const system = `You decompose user questions into sub-questions for searching a website.
Respond with ONLY valid JSON. No explanation.`;

  let historyCtx = '';
  if (history && history.length > 0) {
    historyCtx = `\nThis is a FOLLOW-UP question. Previous conversation:\n` +
      history.map(h => `Q: ${h.question}\nA: ${h.answer}`).join('\n\n') +
      `\n\nThe user was not satisfied with the previous answer. Decompose differently — look for NEW angles.\n`;
  }

  const prompt = `The user asked: "${question}"
${historyCtx}
Break this into 1-3 focused sub-questions that would help find the answer on a website.
Each sub-question should target a specific piece of information.
Mark dependencies — if sub-question 2 depends on finding something in sub-question 1.

Respond as JSON:
{
  "subquestions": [
    { "id": 1, "question": "...", "keywords": ["...", "..."], "depends_on": [] },
    { "id": 2, "question": "...", "keywords": ["...", "..."], "depends_on": [1] }
  ]
}`;

  return callLLMJson(settings, system, prompt);
}

/* ── Phase 2: SCAN ── */

function phaseScan(pageData, html) {
  // From content script we get pageData (DOM-extracted).
  // If we also have raw HTML, extract headings from it.
  const headings = html
    ? extractHeadingsFromHtml(html)
    : (pageData.headings || []);
  const links = pageData.links || [];

  return {
    url: pageData.url,
    title: pageData.title,
    headings,
    links,
    text: pageData.text || ''
  };
}

/* ── Phase 3: NAVIGATE ── */

async function phaseNavigate(settings, subquestions, pages, visitedUrls, sitemapUrls) {
  const system = `You pick the best pages to visit on a website to answer questions.
Respond with ONLY valid JSON. No explanation.`;

  // Build a site map from all pages we've seen so far
  const siteMap = pages.map(p => {
    const headingList = p.headings.length > 0
      ? p.headings.map(h => `${'#'.repeat(h.level)} ${h.text}`).join('\n')
      : '(no headings found)';

    // Split nav links (site structure) from content links
    const navLinks = p.links.filter(l => l.nav);
    const contentLinks = p.links.filter(l => !l.nav);
    const shownLinks = [...navLinks, ...contentLinks.slice(0, 40)];
    const linkSample = shownLinks.map(l => {
      let tag = '';
      if (l.nav) tag = l.navLabel ? ` [NAV: ${l.navLabel}]` : ' [NAV]';
      return `  - [${l.text}]${tag} → ${shortenUrl(l.url)}`;
    }).join('\n');

    return `PAGE: ${p.url}\nTitle: ${p.title}\nHeadings:\n${headingList}\nLinks:\n${linkSample}`;
  }).join('\n\n---\n\n');

  // Include sitemap URLs — pre-filter to keep prompt manageable
  // A sitemap can have thousands of URLs; we keyword-filter to ~100 max
  let sitemapSection = '';
  if (sitemapUrls && sitemapUrls.length > 0) {
    const keywords = subquestions.flatMap(sq => sq.keywords || []).map(k => k.toLowerCase());
    // Also add common service/support path segments
    const boostTerms = ['support', 'help', 'service', 'contact', 'faq', 'return',
      'repair', 'warranty', 'form', 'klantenservice', 'reparatie', 'retour',
      'garantie', 'hilfe', 'aide', 'formulaire', 'onderdelen'];
    const allTerms = [...new Set([...keywords, ...boostTerms])];

    const filtered = sitemapUrls
      .filter(u => !visitedUrls.has(u))
      .filter(u => {
        const path = shortenUrl(u).toLowerCase();
        return allTerms.some(t => path.includes(t));
      })
      .map(u => shortenUrl(u));

    // If keyword filter gives too few, include a broader sample
    let paths = filtered;
    if (filtered.length < 10) {
      const remaining = sitemapUrls
        .filter(u => !visitedUrls.has(u))
        .map(u => shortenUrl(u))
        .filter(p => !filtered.includes(p))
        .slice(0, 50);
      paths = [...filtered, ...remaining];
    }
    paths = paths.slice(0, 100);

    if (paths.length > 0) {
      sitemapSection = `\n\nSITEMAP (${sitemapUrls.length} total pages on site, showing ${paths.length} most relevant):\n${paths.join('\n')}`;
    }
  }

  const alreadyVisited = [...visitedUrls].map(u => shortenUrl(u)).join(', ');
  const questionsStr = subquestions.map(sq =>
    `${sq.id}. ${sq.question} [keywords: ${sq.keywords.join(', ')}]`
  ).join('\n');

  const prompt = `We are exploring a website to answer these sub-questions:
${questionsStr}

Here is what we've seen so far (page headings and available links):

${siteMap}${sitemapSection}

Already visited (do NOT pick these): ${alreadyVisited || 'none'}

Pick up to 3 pages to visit next. Choose based on:
- SITEMAP URLs that match the sub-questions (best source — these are real pages)
- [NAV] links (site navigation structure)
- Page headings that match the sub-questions
- Link text that suggests relevant content (in ANY language)
- Prefer deeper/specific pages (e.g. /service/repairs) over top-level pages (e.g. /products)
- If a heading on a visited page already answers a sub-question, note it

Respond as JSON:
{
  "picks": [
    { "url": "full URL", "reason": "why this page likely helps", "for_subquestion": 1 }
  ],
  "already_answered": [
    { "subquestion_id": 1, "answer_hint": "found on page X: ...", "source_url": "..." }
  ]
}

If no promising pages remain, return: { "picks": [], "already_answered": [] }`;

  return callLLMJson(settings, system, prompt);
}

/* ── Phase 4: EXTRACT ── */

async function phaseExtract(urls) {
  const results = [];
  for (let i = 0; i < urls.length; i++) {
    if (i > 0) await delay(DEFAULTS.fetchDelay);
    const html = await fetchPage(urls[i]);
    if (!html) {
      results.push({ url: urls[i], title: '', headings: [], links: [], text: '', ok: false });
      continue;
    }
    results.push({
      url: urls[i],
      title: extractTitleFromHtml(html),
      headings: extractHeadingsFromHtml(html),
      links: extractLinksFromHtml(html, urls[i]),
      text: truncateText(extractTextFromHtml(html), 3000),
      ok: true
    });
  }
  return results;
}

/* ── Phase 5: ANSWER ── */

async function phaseAnswer(settings, question, subquestions, pages, history) {
  const system = `You answer questions about a website using ONLY the provided page contents.
Respond with ONLY valid JSON. No explanation.`;

  const context = pages
    .filter(p => p.text)
    .map(p => `PAGE: ${p.url}\nTitle: ${p.title}\n\n${p.text}`)
    .join('\n\n---\n\n');

  const sqStr = subquestions.map(sq => `${sq.id}. ${sq.question}`).join('\n');

  // Include previous Q&A so follow-ups don't repeat
  let historySection = '';
  if (history && history.length > 0) {
    historySection = `\nPrevious questions and answers in this conversation (do NOT repeat these — build on them):\n` +
      history.map(h => `Q: ${h.question}\nA: ${h.answer}`).join('\n\n') + '\n';
  }

  const prompt = `Original question: "${question}"
${historySection}
Sub-questions:
${sqStr}

Content from ${pages.length} pages:

${context}

Answer the original question using ONLY the page contents above. If this is a follow-up, give a NEW answer that builds on previous answers — do not repeat what was already said.
For each claim, cite the source URL.
If the content doesn't contain the answer, say so and suggest what the user should look for.

Respond as JSON:
{
  "answer": "Your complete answer here, with URLs inline",
  "sources": [
    { "url": "...", "title": "...", "relevant_excerpt": "brief quote that was useful" }
  ],
  "found": true
}

Set "found" to false if the pages didn't contain the answer.`;

  return callLLMJson(settings, system, prompt);
}

/* ═══════════════════════════════════════════
   ORCHESTRATOR
   ═══════════════════════════════════════════ */

// Per-tab conversation history
const tabHistory = {};

async function handleQuestion(question, pageData, tabId) {
  const settings = await getSettings();

  if (!settings.apiKey) {
    sendToTab(tabId, { type: 'nokey' });
    return;
  }

  // Get or create history for this tab
  if (!tabHistory[tabId]) tabHistory[tabId] = [];
  const history = tabHistory[tabId];

  const visitedUrls = new Set([pageData.url]);
  const allPages = []; // pages with headings/links/text

  try {
    // ── Phase 1: DECOMPOSE ──
    sendToTab(tabId, { type: 'progress', phase: 'decompose', detail: 'Breaking down question...' });
    const decomp = await phaseDecompose(settings, question, history);
    const subquestions = decomp.subquestions || [{ id: 1, question, keywords: question.split(/\s+/), depends_on: [] }];

    sendToTab(tabId, {
      type: 'progress', phase: 'decompose',
      detail: subquestions.map(sq => sq.question).join(' → ')
    });

    // ── Phase 2: SCAN current page + fetch sitemap ──
    sendToTab(tabId, { type: 'progress', phase: 'scan', detail: 'Scanning page + fetching sitemap...' });

    const origin = new URL(pageData.url).origin;
    const [currentPage, sitemapUrls] = await Promise.all([
      Promise.resolve(phaseScan(pageData, null)),
      fetchSitemap(origin, new URL(pageData.url).pathname)
    ]);
    allPages.push(currentPage);

    const scanDetail = sitemapUrls.length > 0
      ? `Sitemap: ${sitemapUrls.length} pages | Current page: ${currentPage.headings.length} headings, ${currentPage.links.length} links`
      : `No sitemap found | Current page: ${currentPage.headings.length} headings, ${currentPage.links.length} links`;
    sendToTab(tabId, { type: 'progress', phase: 'scan', detail: scanDetail });

    // ── Rounds: NAVIGATE → EXTRACT → (repeat) ──
    for (let round = 1; round <= DEFAULTS.maxRounds; round++) {
      sendToTab(tabId, {
        type: 'progress', phase: 'navigate',
        detail: `Round ${round}/${DEFAULTS.maxRounds} — picking pages...`,
        round
      });

      // Phase 3: NAVIGATE (with sitemap)
      const nav = await phaseNavigate(settings, subquestions, allPages, visitedUrls, sitemapUrls);

      // Check if some answers were found in headings already
      if (nav.already_answered && nav.already_answered.length > 0) {
        sendToTab(tabId, {
          type: 'progress', phase: 'navigate',
          detail: `Found hints: ${nav.already_answered.map(a => a.answer_hint).join('; ')}`,
          round
        });
      }

      const picks = (nav.picks || []).filter(p => {
        try { return !visitedUrls.has(new URL(p.url, pageData.url).href); }
        catch { return false; }
      }).slice(0, settings.maxPages);

      if (picks.length === 0) {
        sendToTab(tabId, {
          type: 'progress', phase: 'navigate',
          detail: `Round ${round} — no more promising pages`,
          round
        });
        break;
      }

      // Phase 4: EXTRACT
      const urls = picks.map(p => {
        try { return new URL(p.url, pageData.url).href; }
        catch { return p.url; }
      });

      for (const u of urls) visitedUrls.add(u);

      sendToTab(tabId, {
        type: 'progress', phase: 'extract',
        detail: picks.map(p => `${shortenUrl(p.url)} (${p.reason})`).join(' | '),
        round
      });

      const extracted = await phaseExtract(urls);
      const extractReport = extracted.map(p => {
        if (!p.ok) return `${shortenUrl(p.url)}: FAILED`;
        return `${shortenUrl(p.url)}: ${p.text.length} chars, ${p.headings.length} headings, ${p.links.length} links`;
      }).join(' | ');
      sendToTab(tabId, {
        type: 'progress', phase: 'extract',
        detail: extractReport,
        round
      });

      for (const page of extracted) {
        if (page.ok) allPages.push(page);
      }
    }

    // ── Phase 5: ANSWER ──
    sendToTab(tabId, { type: 'progress', phase: 'answer', detail: 'Assembling answer...' });
    const result = await phaseAnswer(settings, question, subquestions, allPages, history);

    // Save to history for follow-up questions
    history.push({ question, answer: result.answer });
    // Keep last 5 exchanges to avoid token bloat
    if (history.length > 5) history.shift();

    sendToTab(tabId, {
      type: 'answer',
      text: result.answer,
      found: result.found,
      sources: result.sources || [],
      pagesVisited: allPages.length,
      trail: allPages.map(p => `${shortenUrl(p.url)} — ${p.title}`)
    });

  } catch (err) {
    sendToTab(tabId, { type: 'error', message: err.message || 'Pipeline failed.' });
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

function sendToTab(tabId, message) {
  api.tabs.sendMessage(tabId, message).catch(() => {});
}

/* ── Message listener ── */

api.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'ask' && sender.tab) {
    handleQuestion(msg.question, msg.pageData, sender.tab.id);
  } else if (msg.type === 'openSettings') {
    api.runtime.openOptionsPage();
  }
  return false;
});
