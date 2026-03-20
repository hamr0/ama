# AMA

**Ask Me Anything — talk to any website using your existing AI subscription.**

AMA is a browser extension that lets you ask questions about any website and get researched, synthesized answers. It reads multiple pages, translates foreign content, and answers in English — all using your existing ChatGPT, Claude, or Gemini login. No API keys needed.

## How it works

1. Click the AMA icon in your toolbar to open the sidebar
2. Type a question about the site you're browsing
3. AMA finds relevant pages, fetches and reads them, then gives you a synthesized answer with sources

The extension builds an ARIA accessibility tree of the current page, extracts all links, fetches the sitemap, and uses your AI provider to pick the most relevant pages. In Research mode (default), it actually reads those pages and synthesizes a comprehensive answer.

## Features

### Research mode (default)
Type any question — AMA finds relevant pages on the site, fetches up to 5 of them, extracts their content, and sends everything to your AI provider for a synthesized answer. Works across languages: ask in English about a Dutch website and get an English answer.

### Search mode
Click the **Search** pill to switch to link-finding mode. AMA picks the 5 most relevant pages and shows them as clickable links — useful when you want to browse the pages yourself.

### Summarize
Click **Summarize** to get a concise summary of the current page. Auto-submits immediately.

### Contact
Click **Contact** to find contact information, customer service, FAQ, or help pages on the site. Auto-submits immediately.

### Site Search
When AMA detects a search input on the site, the **Site Search** pill activates. Type a query and AMA uses the site's own search, fetches the results page, and picks the top 5 most relevant links.

### Per-site conversations
Each website gets its own conversation thread. Switch tabs and the sidebar shows that site's conversation. Switch back and your previous Q&A is restored.

## AI Providers

AMA uses your existing browser sessions — no API keys required.

| Provider | Method | Status |
|----------|--------|--------|
| **Claude** | Direct HTTP via session cookies | Working |
| **Gemini** | Direct HTTP via Google session | Working |
| **ChatGPT** | Pinned background tab | Working |

Switch between providers using the dropdown in the sidebar.

## Setup

1. Clone this repo
2. Open `chrome://extensions` (Chrome) or `about:debugging` (Firefox)
3. Enable Developer Mode
4. Load unpacked → select the `chrome/` folder
5. Click the AMA icon in the toolbar
6. Open Settings to verify your AI provider login status
7. Navigate to any website and start asking

## Architecture

```
sidebar (sidepanel.js)
  ↕ chrome.runtime messages
background.js (service worker)
  ↕ chrome.tabs messages        ↕ HTTP fetch
content.js (page context)     AI providers / site pages
```

- **`content.js`** — Injected into every page. Builds an ARIA accessibility tree from the DOM, extracts links, detects site search capability. No UI — just data extraction.
- **`sidepanel.js`** — The sidebar UI. Manages conversations per-site, pill modes, provider selection. Communicates with background and content scripts.
- **`background.js`** — Service worker. Handles the research pipeline (sitemap fetch, link scoring, page fetching, LLM calls), session-based AI provider routing, and message passing.
- **`options.html/js`** — Settings page with provider cards showing login status.

## Tech

- Manifest V3 Chrome extension
- Vanilla JavaScript, no build step, no dependencies
- ARIA tree builder adapted from [barebrowse](https://github.com/nickvdyck/barebrowse)
- Session-based AI: uses browser cookies for Claude/Gemini, pinned tab for ChatGPT
- Chrome Side Panel API for persistent sidebar

## License

MIT
