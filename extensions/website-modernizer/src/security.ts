/**
 * Security utilities for the website-modernizer extension.
 * Centralizes input validation, sanitization, and safety checks.
 */

import { isBlockedHostname, isPrivateIpAddress } from "../../../src/infra/net/ssrf.js";

// ── HTML Sanitization ──

/** Event handler attribute names to strip from HTML. */
const EVENT_HANDLER_RE = /\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

/** Strip dangerous content from untrusted HTML before passing to LLM. */
export function sanitizeHtmlForLlm(html: string): string {
  let cleaned = html;

  // Remove <script> tags and their contents
  cleaned = cleaned.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");

  // Remove <style> tags and their contents
  cleaned = cleaned.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");

  // Remove HTML comments (can carry injection payloads)
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, "");

  // Remove event handler attributes (onclick, onerror, onload, etc.)
  cleaned = cleaned.replace(EVENT_HANDLER_RE, "");

  // Remove javascript: URLs in href/src/action attributes
  cleaned = cleaned.replace(/(href|src|action)\s*=\s*["']?\s*javascript:/gi, "$1=\"#blocked:");

  // Remove data: URLs in src attributes (can carry base64 payloads)
  cleaned = cleaned.replace(/src\s*=\s*["']?\s*data:/gi, "src=\"#blocked:");

  // Remove base64-encoded data attributes
  cleaned = cleaned.replace(/data-[a-z-]+\s*=\s*["'][^"']{500,}["']/gi, "");

  return cleaned;
}

/** Sanitize LLM-generated HTML to remove dangerous elements. */
export function sanitizeGeneratedHtml(html: string): string {
  let cleaned = html;

  // Allow only Tailwind CDN script tag; remove all others
  cleaned = cleaned.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (match) => {
    if (match.includes("cdn.tailwindcss.com")) return match;
    return "";
  });

  // Remove standalone script tags without closing (self-closing or unclosed)
  cleaned = cleaned.replace(/<script\b[^>]*\/?\s*>/gi, (match) => {
    if (match.includes("cdn.tailwindcss.com")) return match;
    return "";
  });

  // Remove event handler attributes
  cleaned = cleaned.replace(EVENT_HANDLER_RE, "");

  // Remove javascript: URLs
  cleaned = cleaned.replace(/(href|src|action)\s*=\s*["']?\s*javascript:/gi, "$1=\"#blocked:");

  // Remove data: URLs in src (except small SVGs for icons)
  cleaned = cleaned.replace(/src\s*=\s*["']\s*data:(?!image\/svg\+xml[^"']{0,500}["'])/gi, "src=\"#blocked:");

  return cleaned;
}

// ── Error Sanitization ──

const MAX_ERROR_LENGTH = 200;

/** Truncate and sanitize error messages from external APIs to prevent credential leakage. */
export function sanitizeErrorMessage(msg: string): string {
  if (!msg) return "Unknown error";

  let cleaned = msg;

  // Strip potential JSON blobs (may contain tokens/keys)
  cleaned = cleaned.replace(/\{[\s\S]*\}/g, "{...}");

  // Strip Bearer/Basic auth tokens
  cleaned = cleaned.replace(/(?:Bearer|Basic)\s+[A-Za-z0-9+/=._-]+/gi, "[REDACTED]");

  // Strip API key patterns (sk_test_xxx, pk_live_xxx, key_xxx, token_xxx, etc.)
  cleaned = cleaned.replace(/(?:sk|pk|key|token|secret)[_-][a-zA-Z0-9_-]{16,}/gi, "[REDACTED]");

  // Truncate
  if (cleaned.length > MAX_ERROR_LENGTH) {
    cleaned = cleaned.slice(0, MAX_ERROR_LENGTH) + "...(truncated)";
  }

  return cleaned;
}

// ── URL Validation ──

const BLOCKED_SCHEMES = ["javascript:", "data:", "vbscript:", "blob:"];
const DEFAULT_ALLOWED_SCHEMES = ["https:", "http:"];

/** Validate that a URL uses an allowed scheme and is not blocked. */
export function isValidUrl(url: string, allowedSchemes?: string[]): boolean {
  if (!url || typeof url !== "string") return false;

  const trimmed = url.trim();
  if (!trimmed) return false;

  // Check for blocked schemes first
  const lowerUrl = trimmed.toLowerCase();
  for (const scheme of BLOCKED_SCHEMES) {
    if (lowerUrl.startsWith(scheme)) return false;
  }

  // Validate against allowed schemes
  const schemes = allowedSchemes ?? DEFAULT_ALLOWED_SCHEMES;
  try {
    const parsed = new URL(trimmed);
    return schemes.includes(parsed.protocol);
  } catch {
    return false;
  }
}

// ── Domain Validation ──

/** Validate a domain is well-formed and not internal/private. */
export function isValidDomain(domain: string): boolean {
  if (!domain || typeof domain !== "string") return false;

  const trimmed = domain.trim().toLowerCase();
  if (!trimmed) return false;

  // Must have at least one dot and a TLD of 2+ chars
  if (!trimmed.includes(".")) return false;
  const parts = trimmed.split(".");
  const tld = parts[parts.length - 1];
  if (tld.length < 2) return false;

  // Max domain length per RFC
  if (trimmed.length > 253) return false;

  // Must only contain valid domain characters
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(trimmed)) return false;

  // Labels must be 1-63 chars
  for (const label of parts) {
    if (label.length === 0 || label.length > 63) return false;
  }

  // Reject blocked hostnames and private IPs
  if (isBlockedHostname(trimmed)) return false;
  if (isPrivateIpAddress(trimmed)) return false;

  return true;
}

// ── JSON Parsing ──

/** Safely parse JSON with a fallback value on error. */
export function safeJsonParse<T>(text: string | null | undefined, fallback: T): T {
  if (text == null || text === "") return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

// ── Email Validation ──

/**
 * Strict email validation.
 * - Max 254 characters (RFC 5321)
 * - TLD at least 2 chars
 * - No control characters
 * - Local part max 64 chars
 */
export function isStrictValidEmail(email: string): boolean {
  if (!email || typeof email !== "string") return false;

  const trimmed = email.trim();

  // Length limits
  if (trimmed.length < 3 || trimmed.length > 254) return false;

  // No control characters
  if (/[\x00-\x1f\x7f]/.test(trimmed)) return false;

  // Basic structure: local@domain
  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex < 1 || atIndex > 64) return false;

  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);

  // Local part validation
  if (local.length === 0 || local.length > 64) return false;
  if (/\s/.test(local)) return false;

  // Domain must have a TLD of 2+ chars
  if (!domain.includes(".")) return false;
  const tld = domain.split(".").pop() ?? "";
  if (tld.length < 2) return false;

  // Domain chars
  if (!/^[a-zA-Z0-9.-]+$/.test(domain)) return false;

  return true;
}

// ── HTML Escaping ──

/** Escape special HTML characters for safe rendering. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
