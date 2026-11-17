/**
 * Internal AI QA Testing Platform - Diagnostics & Sensitive Data Redactor
 * Ensures tokens, passwords, cookies, and PII are redacted before logging or persistence.
 * Defined in Section 9.4 of System Design v1.0.
 */

const PASSWORD_KEY_REGEX = /(password|pass|secret|token|api[_-]?key|auth|bearer|credentials)/i;
const BEARER_REGEX = /Bearer\s+([A-Za-z0-9\-._~+/]+=*)/gi;
const COOKIE_AUTH_REGEX = /(session|token|auth|sid)=([^;]+)/gi;
const QUERY_SECRET_REGEX = /([?&](?:password|token|api_key|secret)=)[^&]+/gi;

export class Redactor {
  /**
   * Redact plain text string
   */
  static redactText(text) {
    if (typeof text !== 'string') return text;

    let sanitized = text
      .replace(BEARER_REGEX, 'Bearer [REDACTED_TOKEN]')
      .replace(COOKIE_AUTH_REGEX, '$1=[REDACTED_COOKIE]')
      .replace(QUERY_SECRET_REGEX, '$1[REDACTED]');

    return sanitized;
  }

  /**
   * Redact a URL string, stripping sensitive query params
   */
  static redactUrl(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return urlStr;
    try {
      const parsed = new URL(urlStr);
      for (const [key] of parsed.searchParams) {
        if (PASSWORD_KEY_REGEX.test(key)) {
          parsed.searchParams.set(key, '[REDACTED]');
        }
      }
      return parsed.toString();
    } catch {
      return this.redactText(urlStr);
    }
  }

  /**
   * Recursively redact an object or array
   */
  static redactObject(obj, depth = 0) {
    if (depth > 8 || !obj || typeof obj !== 'object') {
      return typeof obj === 'string' ? this.redactText(obj) : obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.redactObject(item, depth + 1));
    }

    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      if (PASSWORD_KEY_REGEX.test(key)) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.redactObject(value, depth + 1);
      } else if (typeof value === 'string') {
        sanitized[key] = this.redactText(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
}
