/* AMA Analytics — Privacy-preserving instrumentation layer
 * See ANALYTICS.md for event schema and privacy principles
 */

(function () {
  'use strict';

  // Generate session ID once per browser session
  const SESSION_ID = 'sess_' + Math.random().toString(36).substring(2, 15);

  // Domain hashing utility
  async function hashDomain(domain) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(domain);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return 'hash_error';
    }
  }

  // Extract domain from URL
  function getDomain(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  // Core logging function (console-only for now)
  function logEvent(eventName, properties) {
    const event = {
      timestamp: new Date().toISOString(),
      event: eventName,
      properties: properties || {},
      session_id: SESSION_ID
    };
    console.log('[AMA Analytics]', JSON.stringify(event));
  }

  // Public API
  window.AMAAnalytics = {
    /**
     * Log query submission event
     * @param {string} mode - Query mode (research, search, etc.)
     * @param {string} provider - AI provider (chatgpt, claude, gemini)
     * @param {number} queryLength - Character count of query (never the text!)
     * @param {string} url - Current page URL (for domain hashing)
     */
    async logQuerySubmitted(mode, provider, queryLength, url) {
      const domain = getDomain(url);
      const siteHash = domain ? await hashDomain(domain) : 'no_domain';

      logEvent('query_submitted', {
        mode: mode || 'research',  // null mode defaults to research
        provider: provider || 'unknown',
        query_length: queryLength,
        site_hash: siteHash
      });
    },

    /**
     * Log research pipeline stage event
     * @param {string} stage - Pipeline stage name
     * @param {number} latencyMs - Milliseconds since previous stage
     * @param {string} url - Current page URL (for domain hashing)
     * @param {number} pageCount - Optional page count for pages_selected/pages_read
     */
    async logResearchStage(stage, latencyMs, url, pageCount) {
      const domain = getDomain(url);
      const siteHash = domain ? await hashDomain(domain) : 'no_domain';

      const properties = {
        stage: stage,
        latency_ms: latencyMs,
        site_hash: siteHash
      };

      if (pageCount !== undefined) {
        properties.page_count = pageCount;
      }

      logEvent('research_stage', properties);
    },

    /**
     * Get current session ID
     */
    getSessionId() {
      return SESSION_ID;
    }
  };
})();
