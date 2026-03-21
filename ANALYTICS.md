# Analytics Schema

## Privacy Principles

AMA extension analytics are designed with strict privacy constraints:

1. **No query text** — Never log user questions or answers
2. **No page content** — Never log page text, ARIA trees, or scraped content
3. **Domain hashing** — Site domains are hashed before logging (SHA-256)
4. **Local-only** — All events are logged to browser console only (no external transmission)
5. **Firefox compliance** — Respects `data_collection_permissions` in manifest

## Event Schema

All events share a common structure:

```javascript
{
  timestamp: ISO 8601 string,
  event: string,        // Event name
  properties: object,   // Event-specific properties
  session_id: string    // Browser session identifier (generated at extension load)
}
```

### Event Catalog

#### `query_submitted`

Fired when a user submits a question in the sidebar.

**Properties:**
- `mode` (string): Query mode — one of `"research"`, `"search"`, `"summarize"`, `"contact"`, `"asksite"`, `"compare"`, or `null` (default research)
- `provider` (string): Selected AI provider — one of `"chatgpt"`, `"claude"`, `"gemini"`
- `query_length` (number): Character count of the user's question (never the text itself)
- `site_hash` (string): SHA-256 hash of the site domain (e.g., `sha256("example.com")`)

**Example:**
```javascript
{
  timestamp: "2024-03-21T10:30:00.000Z",
  event: "query_submitted",
  properties: {
    mode: "research",
    provider: "claude",
    query_length: 42,
    site_hash: "a3c5f7..."
  },
  session_id: "sess_abc123"
}
```

---

#### `research_stage`

Fired at each stage of the Research mode pipeline to track funnel progression and latency.

**Properties:**
- `stage` (string): Pipeline stage — one of:
  - `"initiated"` — Research request started
  - `"sitemap_analyzed"` — Sitemap fetched and parsed
  - `"pages_selected"` — Relevant pages identified
  - `"pages_read"` — Page content retrieved
  - `"answer_rendered"` — Final answer displayed to user
- `latency_ms` (number): Milliseconds since the previous stage (or since `query_submitted` for `initiated`)
- `site_hash` (string): SHA-256 hash of the site domain
- `page_count` (number, optional): Number of pages selected/read (for `pages_selected` and `pages_read` stages)

**Example:**
```javascript
{
  timestamp: "2024-03-21T10:30:02.500Z",
  event: "research_stage",
  properties: {
    stage: "pages_selected",
    latency_ms: 2500,
    site_hash: "a3c5f7...",
    page_count: 5
  },
  session_id: "sess_abc123"
}
```

---

## Implementation Notes

### Console-only logging

Events are currently logged to `console.log()` with the prefix `[AMA Analytics]`:

```javascript
console.log('[AMA Analytics]', JSON.stringify(event));
```

This allows observation during development without external transmission. Future iterations may add:
- LocalStorage buffering for session replay
- Optional telemetry endpoint (behind explicit user opt-in)

### Domain hashing

Use `crypto.subtle.digest('SHA-256', ...)` for consistent domain hashing:

```javascript
async function hashDomain(domain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(domain);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
```

### Session ID

Generate once at extension load and persist for the browser session:

```javascript
const SESSION_ID = 'sess_' + Math.random().toString(36).substring(2, 15);
```

---

## Firefox Data Collection Permissions

The Firefox manifest declares:

```json
"data_collection_permissions": {
  "required": ["none"],
  "optional": ["technicalAndInteraction"]
}
```

This signals to Firefox users that:
- No data collection is **required** for core functionality
- Technical and interaction analytics are **optional** (disabled by default)

Future work: Add UI in `options.html` to let users opt-in to analytics.

---

## PR Instrumentation Checklist

When modifying files that affect user interactions, consider whether new analytics events are needed:

- [ ] Does this PR add a new user interaction surface? (button, mode, flow)
- [ ] Does this PR modify the query submission path?
- [ ] Does this PR change how Research/Search/Compare modes work?
- [ ] Does this PR add new message-passing between content.js and sidepanel.js?

If **yes** to any:
- [ ] New events added to this ANALYTICS.md schema
- [ ] Event properties follow privacy principles (no query text, no page content, domain hashing)
- [ ] Console logging added at the appropriate point in the interaction flow

If **no** to all:
- [ ] Explicitly note "No analytics changes required" in PR description
