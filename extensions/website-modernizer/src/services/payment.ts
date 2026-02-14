/**
 * Stripe payment integration for website sales.
 * Creates payment links and tracks conversions.
 */

import type { ModernizerConfig } from "../types.js";

export interface PaymentLinkResult {
  success: boolean;
  url?: string;
  paymentLinkId?: string;
  error?: string;
}

/**
 * Create a Stripe payment link for a website purchase.
 */
export async function createPaymentLink(
  config: ModernizerConfig,
  opts: {
    businessName: string;
    domain: string;
    previewUrl: string;
    leadId: number;
  },
): Promise<PaymentLinkResult> {
  const secretKey = config.stripeSecretKey ?? process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return { success: false, error: "No Stripe secret key configured" };
  }

  try {
    // Step 1: Create a price for this specific site
    const priceRes = await stripeRequest(secretKey, "POST", "/v1/prices", {
      unit_amount: config.priceUsd * 100, // cents
      currency: "usd",
      product_data: {
        name: `Modern Website for ${opts.businessName}`,
        description: `Professional website redesign for ${opts.domain}. Includes source code, deployment assistance, and 30-day support.`,
        metadata: { lead_id: String(opts.leadId), domain: opts.domain },
      },
    });

    if (!priceRes.ok) {
      return { success: false, error: `Stripe price creation failed: ${await priceRes.text()}` };
    }

    const price = (await priceRes.json()) as { id: string };

    // Step 2: Create payment link
    const linkRes = await stripeRequest(secretKey, "POST", "/v1/payment_links", {
      "line_items[0][price]": price.id,
      "line_items[0][quantity]": "1",
      "metadata[lead_id]": String(opts.leadId),
      "metadata[domain]": opts.domain,
      "metadata[preview_url]": opts.previewUrl,
      "after_completion[type]": "redirect",
      "after_completion[redirect][url]": opts.previewUrl + "?purchased=true",
    });

    if (!linkRes.ok) {
      return { success: false, error: `Stripe link creation failed: ${await linkRes.text()}` };
    }

    const link = (await linkRes.json()) as { id: string; url: string };

    return {
      success: true,
      url: link.url,
      paymentLinkId: link.id,
    };
  } catch (err) {
    return { success: false, error: `Stripe error: ${(err as Error).message}` };
  }
}

async function stripeRequest(
  secretKey: string,
  method: string,
  path: string,
  params: Record<string, string | Record<string, string>>,
): Promise<Response> {
  const formData = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "object") {
      for (const [subKey, subValue] of Object.entries(value)) {
        formData.append(`${key}[${subKey}]`, subValue);
      }
    } else {
      formData.append(key, value);
    }
  }

  return fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData.toString(),
  });
}
