/* AMA Analytics — Privacy-first user interaction tracking
 * Records structured events for product analytics without capturing sensitive data.
 *
 * Privacy constraints:
 * - NEVER log query text or page content
 * - Only log enumerable UI states (mode, provider) and aggregate metrics (character count)
 * - No PII, no URLs, no page titles in events
 */

(function () {
  'use strict';

  const api = typeof browser !== 'undefined' ? browser : chrome;

  /**
   * Core event logging function.
   * Events are stored locally for now; future iterations can add remote telemetry.
   *
   * @param {string} eventName - Event type identifier
   * @param {Object} properties - Event properties (must not contain PII or query text)
   */
  function logEvent(eventName, properties = {}) {
    const event = {
      event: eventName,
      timestamp: new Date().toISOString(),
      ...properties
    };

    // Store events locally in extension storage
    api.storage.local.get('analytics_events').then(data => {
      const events = data.analytics_events || [];
      events.push(event);

      // Keep last 1000 events to avoid unbounded growth
      const trimmed = events.slice(-1000);

      api.storage.local.set({ analytics_events: trimmed });
    }).catch(err => {
      // Silent failure — analytics should never break the extension
      console.debug('Analytics logging failed:', err);
    });

    // Also log to console in debug mode for development visibility
    if (console.debug) {
      console.debug('[AMA Analytics]', eventName, properties);
    }
  }

  /**
   * Log query submission event.
   * Captures core engagement metrics: mode, provider, query length.
   *
   * @param {Object} params
   * @param {string|null} params.mode - Active mode (research, search, summarize, contact, asksite, compare, or null for default)
   * @param {string} params.provider - Selected AI provider
   * @param {number} params.queryLength - Character count of the query (never the text itself)
   */
  function logQuerySubmitted({ mode, provider, queryLength }) {
    logEvent('query_submitted', {
      mode: mode || 'default',
      provider: provider,
      query_length: queryLength
    });
  }

  // Export to global scope
  window.AMAAnalytics = {
    logQuerySubmitted
  };

})();
