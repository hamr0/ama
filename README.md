# AMA

**Ask Me Anything. Talk to any website. Not just the page — the whole site with your existing AI subscription.**

## The problem

Most websites are terrible at helping you find what you need.

**Government websites** bury critical information under layers of bureaucratic navigation. Finding the right form, the right office, or the right phone number takes 20 clicks and three dead ends.

**Small business websites** built 15 years ago have no search, no sitemap, and pages nested five levels deep. The return policy exists somewhere — good luck finding it.

**Foreign language sites** might have exactly what you need, but if you don't speak the language, you'll never know. A Dutch school's teaching philosophy, a German manufacturer's warranty terms, a French restaurant's allergen menu — all inaccessible.

**Static websites** with no search functionality force you to manually click through every page. There's no way to ask "do you offer free shipping?" without reading the entire site.

**Poorly indexed sites** where the information exists but the navigation is broken, the search returns garbage, or the important pages aren't linked from anywhere obvious.

## The solution

AMA reads the website for you.

Open the sidebar, type your question in plain English, and AMA:

1. Analyzes the page structure and sitemap
2. Finds the most relevant pages across the entire site
3. Actually reads those pages
4. Gives you a synthesized answer in English — regardless of what language the site is in

No more clicking through 30 pages to find a phone number. No more Google Translating page by page. No more giving up because the site is too old, too broken, or too foreign.

## Features

### Research (default)
Type any question — AMA finds relevant pages on the site, fetches up to 5 of them, reads the content, and gives you a synthesized answer in English. Works across languages: ask in English about a Dutch website and get an English answer with page citations.

### Search
Switch to Search mode to get the 5 most relevant links on the site without reading them — useful when you want to browse the actual pages yourself.

### Summarize
One click. Gets a concise summary of the current page, translated to English if needed.

### Contact
One click. Finds contact information, customer service, FAQ, and help pages across the site.

### Site Search
When a site has its own search, AMA uses it — fetches the results page, extracts links, and lets the AI pick the top 5 most relevant results.

### Compare
Compare the current page against other open tabs. Select 1-4 tabs and get a structured comparison: differences, similarities, pros and cons. Works cross-site (Brand A vs Brand B) and same-site (Model A vs Model B).

### Per-site conversations
Each website gets its own conversation thread. Switch tabs and the sidebar shows that site's chat. Switch back and your previous Q&A is still there.

## No API keys

AMA uses your existing ChatGPT, Claude, or Gemini login. If you're already paying for a subscription, AMA uses it — no separate API key, no extra cost.

## Install

### Chrome
1. Clone this repo
2. Open `chrome://extensions`, enable Developer Mode
3. Load unpacked → select the `chrome/` folder
4. Click the AMA icon to open the sidebar

### Firefox
1. Clone this repo
2. Open `about:debugging#/runtime/this-firefox`
3. Load Temporary Add-on → select `firefox/manifest.json`
4. Open the sidebar from the Firefox sidebar menu

### From stores
- [Chrome Web Store](https://chromewebstore.google.com/) — search "AMA"
- [Firefox Add-ons](https://addons.mozilla.org/) — search "AMA"

## How it works

```
User asks question in sidebar
  ↓
Content script extracts ARIA tree + links from active tab
  ↓
Background fetches sitemap, scores links
  ↓
AI picks most relevant pages
  ↓
Background fetches those pages, extracts text
  ↓
AI synthesizes answer in English with citations
  ↓
Sidebar displays answer with source links
```

No data leaves your browser except to your chosen AI provider. No tracking. No accounts. No cloud.

## License

MIT
