# AMA

<p align="center">
  <img src="https://img.shields.io/github/package-json/v/hamr0/ama?label=version&color=2a4f8c" alt="version (auto from package.json)">
  <img src="https://img.shields.io/badge/license-Apache%202.0-2a4f8c" alt="license: Apache 2.0">
</p>

**Ask Me Anything. Talk to any website. Not just the page — the whole site with your existing AI subscription.**

## The problem

Most websites are terrible at helping you find what you need.

- **Government sites** bury forms under layers of bureaucratic navigation. Customer service tells you to "google it" — on their own website.
- **Foreign language sites** have exactly what you need, but you'll never know. A Dutch school's teaching philosophy, a German warranty policy, a French allergen menu — all inaccessible.
- **Old business sites** built 15 years ago have no search, no sitemap, and pages nested five levels deep.
- **Static sites** with no search force you to click through every page just to find a phone number.

Every AI browser extension reads the current page. Firefox's AI sidebar, ChatGPT, Claude, Gemini — they all stop at the page you're on. None of them crawl. None of them research across the site.

## What AMA does

Open the sidebar, type your question, and AMA finds relevant pages across the entire site, reads them, and gives you a synthesized answer in English — regardless of what language the site is in.

### Six modes

| Mode | What it does |
|------|-------------|
| **Research** (default) | Reads multiple pages across the site, synthesizes an answer with citations |
| **Search** | Finds the 5 most relevant pages, even when site navigation is broken |
| **Site Search** | Uses the site's own search, filters results through AI |
| **Compare** | Side-by-side comparison of the current page against other open tabs |
| **Summarize** | One-click page summary, translated to English if needed |
| **Contact** | Surfaces contact info, FAQ, and support pages buried in the site |

Per-site conversations — each site gets its own chat thread, preserved when you switch tabs.

## No API keys

Uses your existing ChatGPT, Claude, or Gemini subscription. No API keys. No accounts. Runs entirely in your browser. Nothing leaves your machine except the prompt to your chosen AI provider.

## Install

### Chrome
1. Download this repo (Code → Download ZIP) and unzip
2. Go to `chrome://extensions`, enable **Developer mode**
3. Click **Load unpacked** → select the `chrome/` folder
4. Click the AMA icon to open the sidebar

### Firefox
1. Download this repo (Code → Download ZIP) and unzip
2. Go to `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on** → pick any file in the `firefox/` folder
4. Click the AMA icon to toggle the sidebar

### Stores
- [Chrome Web Store](https://chromewebstore.google.com/) — search "AMA"
- [Firefox Add-ons](https://addons.mozilla.org/) — search "AMA"

## License

MIT
