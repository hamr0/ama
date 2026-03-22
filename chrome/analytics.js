/* AMA — Analytics Layer
 * Privacy-first user interaction instrumentation.
 * See ANALYTICS.md for full schema and privacy rules.
 */

(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════
     PRIVACY UTILITIES
     ══════════════════════════════════════════════════════════════ */

  /**
   * Hash a domain using SHA-256 to prevent reconstruction while enabling aggregation.
   * @param {string} origin - Full origin (e.g., "https://example.com")
   * @returns {Promise<string>} - Hex-encoded SHA-256 hash
   */
  async function hashDomain(origin) {
    if (!origin) return '';
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(origin);
      const hash = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    } catch (err) {
      console.warn('[Analytics] Domain hashing failed:', err);
      return 'hash_error';
    }
  }

  /**
   * Generate a unique ephemeral query ID (not persisted across sessions).
   * @returns {string} - Unique query ID
   */
  function generateQueryId() {
    return `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /* ══════════════════════════════════════════════════════════════
     EVENT EMISSION
     ══════════════════════════════════════════════════════════════ */

  /**
   * Central analytics event emitter.
   * Currently logs to console only. Future: IndexedDB with privacy-preserving aggregation.
   *
   * @param {string} eventName - Event name from ANALYTICS.md schema
   * @param {object} properties - Event properties (must match schema)
   */
  function emitAnalyticsEvent(eventName, properties) {
    const event = {
      event: eventName,
      ...properties,
      _emitted_at: Date.now()
    };

    // Development: log to console
    if (typeof console !== 'undefined' && console.log) {
      console.log('[Analytics]', eventName, event);
    }

    // Future: persist to IndexedDB with TTL, respect user opt-in/opt-out
    // Future: privacy-preserving aggregation only (no raw event export)
  }

  /* ══════════════════════════════════════════════════════════════
     ERROR CATEGORIZATION
     ══════════════════════════════════════════════════════════════ */

  /**
   * Categorize an error into a high-level privacy-safe category.
   * NEVER logs raw error messages or stack traces.
   *
   * @param {Error|string} error - The error object or message
   * @returns {string} - Error category from ANALYTICS.md schema
   */
  function categorizeError(error) {
    const msg = (error?.message || error || '').toLowerCase();

    if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout')) {
      return 'network_error';
    }
    if (msg.includes('api') || msg.includes('provider') || msg.includes('openai') || msg.includes('anthropic')) {
      return 'provider_error';
    }
    if (msg.includes('permission') || msg.includes('inject') || msg.includes('content script')) {
      return 'permission_error';
    }
    if (msg.includes('page data') || msg.includes('cannot read') || msg.includes('aria tree')) {
      return 'page_read_error';
    }

    return 'unknown_error';
  }

  /* ══════════════════════════════════════════════════════════════
     PUBLIC API
     ══════════════════════════════════════════════════════════════ */

  // Expose analytics functions to global scope for use in sidepanel.js and background.js
  window.AMAAnalytics = {
    emitAnalyticsEvent,
    hashDomain,
    generateQueryId,
    categorizeError
  };

})();
