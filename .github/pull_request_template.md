## Description

<!-- Briefly describe what this PR changes and why -->

## Type of Change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update
- [ ] Refactoring (no functional changes)

## Analytics & Instrumentation

<!-- REQUIRED for PRs touching sidepanel.js, content.js, background.js, or manifests -->

### New User Interactions or Behavioral Changes

<!-- List any new UI elements, user flows, or behavioral changes introduced. Write "None" if this is purely internal/refactoring. -->

-

### Analytics Decision

<!-- Choose ONE and explain: -->

- [ ] **Adding events**: I have added new analytics events and updated ANALYTICS.md
  - Event(s) added:
  - Schema documented: Yes / No
- [ ] **No events needed**: No new instrumentation is required because:
  <!-- Explain why (e.g., "CSS-only change", "internal refactor with no user-facing impact") -->

### Privacy Compliance

<!-- Check all that apply -->

- [ ] No raw user input (query text, page content, URLs) is logged
- [ ] Error categorization uses `categorizeError()` instead of raw error messages
- [ ] Domain recording uses `hashDomain()` where applicable
- [ ] I have reviewed ANALYTICS.md privacy rules

---

## Testing

<!-- Describe how you tested this change -->

### Manual Testing

- [ ] Tested in Chrome
- [ ] Tested in Firefox
- [ ] Tested on multiple site types (static, SPA, e-commerce, etc.)
- [ ] No console errors introduced

### Analytics Testing (if applicable)

- [ ] Verified `[Analytics]` logs appear in console
- [ ] Confirmed no sensitive data in logged events
- [ ] Event properties match ANALYTICS.md schema

---

## Screenshots / Logs

<!-- Add screenshots for UI changes, or paste relevant console logs for analytics changes -->

---

## Notes for Reviewers

<!-- Anything you want reviewers to pay special attention to? -->

<!--
Feedback welcomed:
- "Too broad" → I can split this into smaller PRs
- "Not now" → I can close this and revisit later
- "Wrong approach" → I'm open to alternative solutions
-->
