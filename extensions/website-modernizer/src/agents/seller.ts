/**
 * Seller Agent: Handles outreach, reply classification, and payment flow.
 * Sends personalized emails with live demo links and handles responses.
 */

import type { ModernizerConfig, StageResult, OutreachRecord, ReplySentiment } from "../types.js";
import type { ModernizerDb } from "../db/client.js";
import { callLlm, parseLlmJson } from "../services/llm.js";
import { sendEmail, isValidEmail } from "../services/email.js";
import { createPaymentLink } from "../services/payment.js";
import {
  outreachEmailPrompt,
  replyClassificationPrompt,
  followUpResponsePrompt,
} from "../templates/prompts.js";

export interface SellResult {
  outreach: OutreachRecord;
  paymentUrl?: string;
}

export interface ReplyClassification {
  sentiment: ReplySentiment;
  summary: string;
  suggestedAction: string;
  shouldRespond: boolean;
  responseUrgency: "immediate" | "within_24h" | "low";
}

/**
 * Run the Seller Agent pipeline for a ready lead.
 * 1. Validate contact info and suppression
 * 2. Generate personalized email via LLM
 * 3. Create Stripe payment link
 * 4. Send email
 * 5. Track outreach
 */
export async function pitchLead(
  config: ModernizerConfig,
  db: ModernizerDb,
  leadId: number,
): Promise<StageResult<SellResult>> {
  const startTime = Date.now();
  let totalCost = 0;

  const lead = db.getLead(leadId);
  if (!lead) return { success: false, error: "Lead not found", costUsd: 0, durationMs: 0 };

  const analysis = db.getAnalysis(leadId);
  if (!analysis) return { success: false, error: "No analysis found", costUsd: 0, durationMs: 0 };

  const site = db.getLatestSite(leadId);
  if (!site?.qaPassed) return { success: false, error: "No QA-passed site", costUsd: 0, durationMs: 0 };

  try {
    // Step 1: Validate contact
    const email = lead.contactEmail;
    if (!email || !isValidEmail(email)) {
      return { success: false, error: "No valid contact email", costUsd: 0, durationMs: Date.now() - startTime };
    }

    if (db.isEmailSuppressed(email)) {
      return { success: false, error: "Email is suppressed", costUsd: 0, durationMs: Date.now() - startTime };
    }

    // Check daily limit
    if (db.getTodayEmailCount() >= config.dailyEmailLimit) {
      return { success: false, error: "Daily email limit reached", costUsd: 0, durationMs: Date.now() - startTime };
    }

    // Check per-domain rate limit (max 1 email per domain per 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    if (db.countEmailsToDomainSince(lead.domain, thirtyDaysAgo) > 0) {
      return { success: false, error: `Already contacted ${lead.domain} within last 30 days`, costUsd: 0, durationMs: Date.now() - startTime };
    }

    // Check monthly cost budget
    if (db.getMonthlyTotalCost() >= config.maxMonthlyCostUsd) {
      return { success: false, error: "Monthly cost budget exceeded", costUsd: 0, durationMs: Date.now() - startTime };
    }

    // Step 2: Generate outreach email
    const previewUrl = site.previewUrl ?? `https://example.com/demo/${leadId}`;
    const emailContent = await generateOutreachEmail(config, {
      businessName: lead.businessName ?? lead.domain,
      industry: lead.industry ?? "business",
      oldScores: analysis.lighthouseScores,
      newScores: site.lighthouseScores ?? { performance: 95, accessibility: 95, bestPractices: 95, seo: 95 },
      improvements: analysis.keyImprovements,
      previewUrl,
      priceUsd: config.priceUsd,
    });
    totalCost += emailContent.cost;

    // Step 3: Create payment link (best-effort)
    let paymentUrl: string | undefined;
    const paymentResult = await createPaymentLink(config, {
      businessName: lead.businessName ?? lead.domain,
      domain: lead.domain,
      previewUrl,
      leadId,
    });
    if (paymentResult.success) {
      paymentUrl = paymentResult.url;
    }

    // Step 4: Save outreach record
    const outreach = db.insertOutreach(leadId, email, emailContent.subject, emailContent.body);

    // Step 5: Send the email
    const sendResult = await sendEmail(config, {
      to: email,
      subject: emailContent.subject,
      body: emailContent.body,
      trackOpens: true,
      trackClicks: true,
    });

    if (sendResult.success) {
      db.markOutreachSent(outreach.id);
      db.updateLeadStatus(leadId, "pitched");
    } else {
      db.updateOutreachStatus(outreach.id, "dead");
    }

    db.addCost(leadId, totalCost);
    const durationMs = Date.now() - startTime;
    db.recordMetric("seller", leadId, sendResult.success, totalCost, durationMs, sendResult.error);

    return {
      success: sendResult.success,
      data: { outreach, paymentUrl },
      error: sendResult.error,
      costUsd: totalCost,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    db.addCost(leadId, totalCost);
    db.recordMetric("seller", leadId, false, totalCost, durationMs, (err as Error).message);
    return { success: false, error: (err as Error).message, costUsd: totalCost, durationMs };
  }
}

/**
 * Classify a reply from a business owner.
 */
export async function classifyReply(
  config: ModernizerConfig,
  replyText: string,
): Promise<{ classification: ReplyClassification; cost: number }> {
  const prompt = replyClassificationPrompt(replyText);
  const result = await callLlm(config, prompt, {
    model: "claude-haiku-4-5-20251001",
    maxTokens: 512,
    temperature: 0.1,
  });

  const classification = parseLlmJson<ReplyClassification>(result.text);
  return { classification, cost: result.costUsd };
}

/**
 * Generate a follow-up response to a classified reply.
 */
export async function generateFollowUp(
  config: ModernizerConfig,
  db: ModernizerDb,
  leadId: number,
  replyText: string,
  sentiment: ReplySentiment,
): Promise<{ subject: string; body: string; cost: number }> {
  const lead = db.getLead(leadId);
  const outreach = db.getOutreach(leadId);
  const site = db.getLatestSite(leadId);

  const prompt = followUpResponsePrompt({
    businessName: lead?.businessName ?? "your business",
    originalEmail: outreach?.body ?? "",
    replyText,
    sentiment,
    previewUrl: site?.previewUrl ?? "",
    priceUsd: config.priceUsd,
  });

  const result = await callLlm(config, prompt, {
    model: "claude-sonnet-4-5-20250929",
    maxTokens: 1024,
    temperature: 0.3,
  });

  const data = parseLlmJson<{ subject: string; body: string }>(result.text);
  return { ...data, cost: result.costUsd };
}

/**
 * Handle an unsubscribe request.
 */
export function handleUnsubscribe(db: ModernizerDb, email: string): void {
  db.suppressEmail(email, "unsubscribe_request");
}

async function generateOutreachEmail(
  config: ModernizerConfig,
  info: Parameters<typeof outreachEmailPrompt>[0],
): Promise<{ subject: string; body: string; cost: number }> {
  const prompt = outreachEmailPrompt(info);
  const result = await callLlm(config, prompt, {
    model: "claude-sonnet-4-5-20250929",
    maxTokens: 1024,
    temperature: 0.4,
  });

  const data = parseLlmJson<{ subject: string; body: string }>(result.text);
  return { ...data, cost: result.costUsd };
}
