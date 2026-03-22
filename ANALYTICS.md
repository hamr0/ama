# Analytics Schema

This document enumerates **every** user interaction event tracked in the AMA browser extension. All instrumentation must respect privacy constraints and Firefox data collection permissions.

## Privacy Rules (Non-Negotiable)

1. **NEVER** capture query text or page content
2. **NEVER** capture identifiable user data (names, emails, credentials)
3. **NEVER** transmit data outside the browser (all analytics are local-only for now)
4. **Domain hashing**: When recording site domains, use one-way hash to prevent domain reconstruction
5. **Firefox compliance**: All tracking respects `browser_specific_settings.gecko.data_collection_permissions`

## Event Schema

### Query Lifecycle Events

#### `query_submitted`
Fired when user submits a query in any mode.

**Properties:**
- `mode` (string, required): One of `research`, `search`, `summarize`, `contact`, `asksite`, `compare`
- `provider` (string, required): AI provider selected (`chatgpt`, `claude`, `gemini`)
- `query_length` (number, required): Character count of the query (0 for auto-trigger modes)
- `site_domain_hash` (string, required): SHA-256 hash of the site origin
- `timestamp` (number, required): Unix timestamp in milliseconds

**Privacy notes:**
- Query text is NEVER captured, only character count
- Domain hash prevents domain reconstruction while enabling per-site aggregation

#### `funnel_stage`
Fired at each major stage of query processing to track funnel drop-off and latency.

**Properties:**
- `query_id` (string, required): Unique ID for this query session (generated on `query_submitted`)
- `stage` (string, required): One of:
  - `initiated`: Query submitted, background processing started
  - `sitemap_analyzed`: Sitemap/link extraction complete (Research mode only)
  - `pages_selected`: Relevant pages identified
  - `pages_read`: Pages fetched and processed
  - `answer_rendered`: Answer displayed to user
- `latency_ms` (number, optional): Milliseconds since `initiated` stage
- `page_count` (number, optional): Number of pages involved (context-dependent)
- `timestamp` (number, required): Unix timestamp in milliseconds

**Privacy notes:**
- No page URLs or content captured
- `query_id` is ephemeral (regenerated per query, not persisted across sessions)

#### `query_error`
Fired when a query fails at any stage.

**Properties:**
- `query_id` (string, required): Matches the failed query's ID
- `stage` (string, required): Stage where failure occurred (values from `funnel_stage.stage`)
- `error_category` (string, required): High-level error type (never raw error messages):
  - `network_error`: Fetch/timeout failures
  - `provider_error`: AI provider API errors
  - `permission_error`: Content script injection blocked
  - `page_read_error`: Cannot extract page data
  - `unknown_error`: Unclassified failures
- `provider` (string, required): AI provider in use when error occurred
- `mode` (string, required): Mode in use when error occurred
- `timestamp` (number, required): Unix timestamp in milliseconds

**Privacy notes:**
- Error messages are NEVER captured raw (only categorized)
- No stack traces or detailed error info logged

## Storage

All events are currently **logged to browser console only** for development/debugging. No persistent storage or transmission implemented.

Future storage options (not yet implemented):
- Local IndexedDB with 30-day TTL
- Privacy-preserving aggregation only (no raw event export)
- User-controlled opt-in/opt-out

## Implementation Notes

### Event Emission API

All events use a centralized `emitAnalyticsEvent(eventName, properties)` function in `analytics.js`:

```javascript
// Example usage in sidepanel.js:
emitAnalyticsEvent('query_submitted', {
  mode: activeMode || 'research',
  provider: providerSelect.value,
  query_length: question.length,
  site_domain_hash: hashDomain(currentOrigin),
  timestamp: Date.now()
});
```

### Query ID Generation

Each query generates a unique ephemeral ID:
```javascript
const queryId = `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
```

### Domain Hashing

```javascript
async function hashDomain(origin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(origin);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
```

## Governance

### PR Checklist

Every PR that modifies `sidepanel.js`, `content.js`, `background.js`, or manifest files **must**:

1. ✅ Identify any new user-facing interaction or behavioral change
2. ✅ Determine if new analytics events are needed (consult this schema)
3. ✅ If adding events: update ANALYTICS.md schema with event name, properties, and privacy notes
4. ✅ If NOT adding events: explicitly state in PR description why no instrumentation is needed
5. ✅ Verify no raw user input (query text, page content, URLs) is logged

### Review Guidance

Reviewers should:
- Reject PRs that log query text, page content, or identifiable user data
- Require schema updates for any new event
- Verify `error_category` enums instead of raw error messages
- Ensure Firefox `data_collection_permissions` compliance

## Future Extensions

Planned instrumentation (not yet implemented):
- Session boundaries (`sidebar_opened`, `sidebar_closed`)
- Mode switching (`mode_switched`)
- Citation clicks (`citation_clicked`)
- Provider latency/error breakdown
- Site search widget funnel

All future events must follow the privacy rules above and be added to this schema before shipping.
