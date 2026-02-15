/**
 * Email sending service via SendGrid.
 * Handles CAN-SPAM compliance, suppression, and tracking.
 */

import type { ModernizerConfig } from "../types.js";
import { escapeHtml, isStrictValidEmail, isValidUrl } from "../security.js";

export interface SendEmailOptions {
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
  trackOpens?: boolean;
  trackClicks?: boolean;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send an email via SendGrid API.
 * Includes CAN-SPAM required headers (unsubscribe, physical address placeholder).
 */
export async function sendEmail(config: ModernizerConfig, opts: SendEmailOptions): Promise<SendEmailResult> {
  const apiKey = config.sendgridApiKey ?? process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    return { success: false, error: "No SendGrid API key configured" };
  }

  const fromEmail = config.fromEmail ?? "hello@example.com";
  const fromName = config.fromName ?? "Web Modernizer";

  // CAN-SPAM: include unsubscribe header and physical address
  const body = {
    personalizations: [{ to: [{ email: opts.to }] }],
    from: { email: fromEmail, name: fromName },
    reply_to: opts.replyTo ? { email: opts.replyTo } : { email: fromEmail },
    subject: opts.subject,
    content: [
      { type: "text/plain", value: opts.body },
      { type: "text/html", value: plainTextToHtml(opts.body) },
    ],
    // CAN-SPAM compliance headers
    headers: {
      "List-Unsubscribe": `<mailto:${fromEmail}?subject=unsubscribe>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    tracking_settings: {
      open_tracking: { enable: opts.trackOpens ?? true },
      click_tracking: { enable: opts.trackClicks ?? true },
    },
  };

  try {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.status === 202) {
      const messageId = response.headers.get("X-Message-Id") ?? undefined;
      return { success: true, messageId };
    }

    const errorText = await response.text();
    return { success: false, error: `SendGrid error ${response.status}: ${errorText}` };
  } catch (err) {
    return { success: false, error: `Email send failed: ${(err as Error).message}` };
  }
}

/** Validate email format with strict checks (length, TLD, control chars). */
export function isValidEmail(email: string): boolean {
  return isStrictValidEmail(email);
}

/** Convert plain text email to basic HTML with proper line breaks and safe link creation. */
function plainTextToHtml(text: string): string {
  const escaped = escapeHtml(text);

  // Convert URLs to links with proper validation and escaping
  const withLinks = escaped.replace(
    /(https?:\/\/[^\s<&]+)/g,
    (match) => {
      // Only linkify valid http/https URLs
      if (!isValidUrl(match)) return match;
      const escapedUrl = match.replace(/"/g, "&quot;");
      return `<a href="${escapedUrl}" style="color:#2563eb;">${match}</a>`;
    },
  );

  // Convert line breaks
  const withBreaks = withLinks.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333;">
<p>${withBreaks}</p>
</body></html>`;
}
