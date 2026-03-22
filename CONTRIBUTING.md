# Contributing to AMA

Thanks for your interest in contributing to AMA! This document provides guidelines for contributing code, fixing bugs, and proposing new features.

## Development Setup

### Chrome
1. Clone the repository
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** → select the `chrome/` folder
5. Make changes to files in `chrome/`
6. Click the reload icon in `chrome://extensions` to test changes

### Firefox
1. Clone the repository
2. Open `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on** → select any file in the `firefox/` folder
4. Make changes to files in `firefox/`
5. Click **Reload** in `about:debugging` to test changes

## Pull Request Checklist

Before submitting a pull request, ensure:

### General Requirements
- [ ] Code follows existing style and patterns
- [ ] No console errors or warnings introduced
- [ ] Extension loads and works in both Chrome and Firefox (if changes affect both)
- [ ] Commit messages are clear and descriptive

### Analytics & Instrumentation Requirements

**CRITICAL:** Every PR that modifies `sidepanel.js`, `content.js`, `background.js`, or manifest files **MUST** address analytics instrumentation:

- [ ] **New user interaction or behavior change identified**: List any new UI elements, user flows, or behavioral changes introduced
- [ ] **Analytics decision made**: Either:
  - **Adding events**: New analytics events are needed and have been added
  - **No events needed**: Explicitly explain in the PR description why no new instrumentation is required
- [ ] **Schema updated** (if adding events): `ANALYTICS.md` has been updated with:
  - Event name(s)
  - All properties with data types
  - Privacy notes (no query text, no page content, no URLs)
- [ ] **Privacy compliance verified**: Confirmed that:
  - No raw user input (query text, page content, URLs) is logged
  - Error messages use `categorizeError()` instead of raw error text
  - Domain hashing uses `hashDomain()` when recording site context

**Why this matters**: AMA operates on arbitrary websites and ships to the Firefox store. Privacy violations or undocumented tracking will block the PR.

### Example: When Analytics Are Needed

**Scenario**: Adding a "Copy Answer" button next to each assistant message.

**Required analytics thinking**:
- ✅ New user interaction: "Copy Answer" button click
- ✅ Event needed: `answer_copied` with properties: `{ query_id, mode, timestamp }`
- ✅ Schema updated in ANALYTICS.md
- ✅ No privacy concerns (no clipboard content captured, only the fact that copy occurred)

**Scenario**: Fixing a CSS layout bug in the pill buttons.

**Required analytics thinking**:
- ✅ No new user interaction (visual-only fix)
- ✅ No events needed (explicitly noted in PR description: "CSS-only change, no behavioral impact")

### Firefox Store Compliance

If your PR affects Firefox-specific code or manifest:
- [ ] Respects `data_collection_permissions` in `firefox/manifest.json`
- [ ] No new permissions added without justification
- [ ] Privacy policy implications considered (see ANALYTICS.md)

## Code Style

- Use clear, descriptive variable names
- Add comments for non-obvious logic
- Keep functions focused and small
- Follow existing formatting (2-space indents, single quotes)

## Testing Your Changes

### Manual Testing Checklist
- [ ] Test on a simple static site (e.g., personal blog)
- [ ] Test on a complex dynamic site (e.g., e-commerce, SPA)
- [ ] Test all six modes (Research, Search, Summarize, Contact, Site Search, Compare)
- [ ] Test provider switching (ChatGPT, Claude, Gemini)
- [ ] Test per-site conversation switching (open multiple tabs, switch between them)
- [ ] Check browser console for errors or unexpected analytics logs

### Analytics Testing
If you added analytics events:
- [ ] Open browser console
- [ ] Trigger the new user interaction
- [ ] Verify `[Analytics]` log appears with correct event name and properties
- [ ] Confirm no sensitive data (query text, URLs, page content) is logged

## Reporting Issues

When reporting bugs, please include:
- Browser (Chrome/Firefox) and version
- Steps to reproduce
- Expected vs. actual behavior
- Console errors (if any)
- Which AI provider you were using
- Example website URL (if relevant)

## Feature Requests

Before proposing a new feature:
1. Check existing issues and PRs
2. Consider whether it aligns with AMA's core mission (multi-page site research)
3. Think through the analytics instrumentation needed (see ANALYTICS.md)
4. Open an issue for discussion before implementing

## Questions?

Open an issue or start a discussion in the repository. We're here to help!
