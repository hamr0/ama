# Contributing to AMA

Thank you for contributing to AMA! This document outlines the development workflow and quality standards.

## Development Setup

### Chrome
1. Clone this repository
2. Go to `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** → select the `chrome/` folder
5. Make changes to files in `chrome/`
6. Click the reload icon in `chrome://extensions` to test changes

### Firefox
1. Clone this repository
2. Go to `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on** → pick any file in the `firefox/` folder
4. Make changes to files in `firefox/`
5. Click **Reload** in `about:debugging` to test changes

---

## Pull Request Checklist

Before submitting a PR, ensure you've addressed the following:

### Code Quality
- [ ] Manual testing in Chrome and/or Firefox (depending on files changed)
- [ ] No console errors or warnings introduced
- [ ] Existing functionality still works (no regressions)

### Privacy & Analytics
When modifying user interaction surfaces (`sidepanel.js`, `content.js`, pill buttons, mode logic, message-passing):

- [ ] **Does this PR add a new user interaction surface?** (button, mode, flow)
- [ ] **Does this PR modify the query submission path?**
- [ ] **Does this PR change how Research/Search/Compare modes work?**
- [ ] **Does this PR add new message-passing between content.js and sidepanel.js?**

**If YES to any above:**
- [ ] New events added to `ANALYTICS.md` schema (or existing events updated)
- [ ] Event properties follow privacy principles:
  - No query text logged
  - No page content logged
  - Domain hashing for site identification
- [ ] Console logging added at the appropriate interaction point

**If NO to all above:**
- [ ] Explicitly note **"No analytics changes required"** in PR description

### Firefox-Specific (if modifying Firefox build)
- [ ] Avoid `innerHTML` — use `textContent`, `appendChild`, or explicit DOM manipulation
- [ ] Respect `data_collection_permissions` in manifest (analytics must be opt-in)
- [ ] Test in Firefox Developer Edition or Nightly if using new APIs

---

## Analytics Philosophy

AMA's analytics are designed to be **privacy-preserving by default**:

1. **No query text** — Never log what users ask
2. **No page content** — Never log scraped page text or ARIA trees
3. **Domain hashing** — Site domains are hashed (SHA-256) before logging
4. **Console-only** — All events currently log to browser console (no external transmission)
5. **Firefox compliance** — Respects Firefox's `data_collection_permissions` (opt-in only)

See `ANALYTICS.md` for the full event schema and privacy principles.

---

## Code Style

- **Vanilla JavaScript** — No build tools, no transpilation
- **Strict mode** — Wrap code in `(function() { 'use strict'; })()` IIFEs
- **Comments** — Explain *why*, not *what*
- **Naming** — Descriptive function and variable names
- **Error handling** — Fail gracefully on `chrome://` pages, extension pages, and restricted contexts

---

## Licensing

By contributing, you agree that your contributions will be licensed under the MIT License.
