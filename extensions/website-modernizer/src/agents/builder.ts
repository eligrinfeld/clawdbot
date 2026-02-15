/**
 * Builder Agent: Generates modern, production-quality websites autonomously.
 * This is the core of the business - generates sites that score 90+ on Lighthouse.
 *
 * Pipeline: Design System → Content → Code → QA → Deploy
 * Includes iterative regeneration loop for failed QA.
 */

import type { ModernizerConfig, Analysis, DesignSystem, GeneratedSite, LighthouseScores, StageResult } from "../types.js";
import type { ModernizerDb } from "../db/client.js";
import { callLlm, parseLlmJson } from "../services/llm.js";
import { runLighthouseAudit } from "../services/lighthouse.js";
import { deploySite } from "../services/hosting.js";
import {
  designSystemPrompt,
  contentGenerationPrompt,
  siteGenerationPrompt,
  siteRegenerationPrompt,
} from "../templates/prompts.js";
import { sanitizeGeneratedHtml } from "../security.js";

export interface BuildResult {
  site: GeneratedSite;
  previewUrl: string | null;
  lighthouseScores: LighthouseScores;
  totalCost: number;
}

interface GeneratedContent {
  heroHeadline: string;
  heroSubheadline: string;
  ctaText: string;
  aboutHeading: string;
  aboutText: string;
  services: { name: string; description: string }[];
  contactHeading: string;
  contactSubtext: string;
  footerTagline: string;
}

/**
 * Run the full Builder Agent pipeline for a lead.
 * 1. Generate design system from analysis
 * 2. Generate content
 * 3. Generate site code
 * 4. QA check (Lighthouse audit)
 * 5. Regenerate if needed (up to maxRegenAttempts)
 * 6. Deploy to hosting
 */
export async function buildSite(
  config: ModernizerConfig,
  db: ModernizerDb,
  analysis: Analysis,
  leadId: number,
): Promise<StageResult<BuildResult>> {
  const startTime = Date.now();
  let totalCost = 0;

  const lead = db.getLead(leadId);
  if (!lead) return { success: false, error: "Lead not found", costUsd: 0, durationMs: 0 };

  const businessInfo = analysis.businessInfo;
  if (!businessInfo) return { success: false, error: "No business info in analysis", costUsd: 0, durationMs: 0 };

  try {
    db.updateLeadStatus(leadId, "building");

    // Step 1: Generate design system
    const designSystem = await generateDesignSystem(config, businessInfo);
    totalCost += designSystem.cost;

    // Step 2: Generate content
    const content = await generateContent(config, businessInfo);
    totalCost += content.cost;

    // Step 3 + 4: Generate and QA (with regeneration loop)
    let html = "";
    let lighthouseScores: LighthouseScores = { performance: 0, accessibility: 0, bestPractices: 0, seo: 0 };
    let qaPassed = false;
    let regenCount = 0;

    for (let attempt = 0; attempt <= config.maxRegenAttempts; attempt++) {
      if (attempt === 0) {
        // Initial generation
        const result = await generateSiteHtml(config, businessInfo, content.data, designSystem.data, lead);
        html = sanitizeGeneratedHtml(result.html);
        totalCost += result.cost;
      } else {
        // Regeneration with feedback
        regenCount++;
        const result = await regenerateSiteHtml(config, html, lighthouseResult.issues, []);
        html = sanitizeGeneratedHtml(result.html);
        totalCost += result.cost;
      }

      // QA: Run Lighthouse audit
      var lighthouseResult = await runLighthouseAudit(html);
      lighthouseScores = lighthouseResult.scores;

      // Check if all scores meet threshold
      const minScore = config.minLighthouseScore;
      qaPassed =
        lighthouseScores.performance >= minScore &&
        lighthouseScores.accessibility >= minScore &&
        lighthouseScores.bestPractices >= minScore &&
        lighthouseScores.seo >= minScore;

      if (qaPassed) break;

      // Log regeneration attempt
      db.recordMetric("builder_regen", leadId, false, 0, 0,
        `Attempt ${attempt + 1}: P=${lighthouseScores.performance} A=${lighthouseScores.accessibility} BP=${lighthouseScores.bestPractices} SEO=${lighthouseScores.seo}`);
    }

    // Save generated site to DB
    const site = db.insertSite(leadId, html, designSystem.data);
    db.updateSite(site.id, {
      lighthouseScores,
      regenerationCount: regenCount,
      qaPassed,
    });

    // Step 5: Deploy if QA passed
    let previewUrl: string | null = null;
    if (qaPassed) {
      const deployResult = await deploySite(config, html, businessInfo.name);
      if (deployResult.success && deployResult.url) {
        previewUrl = deployResult.url;
        db.updateSite(site.id, { previewUrl });
      }
    }

    // Update lead status
    db.updateLeadStatus(leadId, qaPassed ? "ready" : "build_failed");
    db.addCost(leadId, totalCost);

    const durationMs = Date.now() - startTime;
    db.recordMetric("builder", leadId, qaPassed, totalCost, durationMs,
      qaPassed ? undefined : `QA failed after ${regenCount + 1} attempts`);

    return {
      success: qaPassed,
      data: {
        site: { ...site, lighthouseScores, regenerationCount: regenCount, qaPassed, previewUrl },
        previewUrl,
        lighthouseScores,
        totalCost,
      },
      costUsd: totalCost,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    db.updateLeadStatus(leadId, "build_failed");
    db.addCost(leadId, totalCost);
    db.recordMetric("builder", leadId, false, totalCost, durationMs, (err as Error).message);
    return { success: false, error: (err as Error).message, costUsd: totalCost, durationMs };
  }
}

async function generateDesignSystem(
  config: ModernizerConfig,
  info: NonNullable<Analysis["businessInfo"]>,
): Promise<{ data: DesignSystem; cost: number }> {
  const prompt = designSystemPrompt({
    businessName: info.name,
    industry: info.industry,
    brandTone: info.brandTone,
  });

  const result = await callLlm(config, prompt, { temperature: 0.5, maxTokens: 1024 });
  const data = parseLlmJson<DesignSystem>(result.text);

  return { data, cost: result.costUsd };
}

async function generateContent(
  config: ModernizerConfig,
  info: NonNullable<Analysis["businessInfo"]>,
): Promise<{ data: GeneratedContent; cost: number }> {
  const prompt = contentGenerationPrompt({
    businessName: info.name,
    industry: info.industry,
    services: info.services,
    valuePropositions: info.valuePropositions,
    targetAudience: info.targetAudience,
    location: info.location,
    phone: info.phone,
    email: info.email,
  });

  const result = await callLlm(config, prompt, { temperature: 0.4, maxTokens: 2048 });
  const data = parseLlmJson<GeneratedContent>(result.text);

  return { data, cost: result.costUsd };
}

async function generateSiteHtml(
  config: ModernizerConfig,
  businessInfo: NonNullable<Analysis["businessInfo"]>,
  content: GeneratedContent,
  designSystem: DesignSystem,
  lead: { contactPhone: string | null; contactEmail: string | null; location: string | null },
): Promise<{ html: string; cost: number }> {
  const prompt = siteGenerationPrompt({
    businessName: businessInfo.name,
    industry: businessInfo.industry,
    content: JSON.stringify(content, null, 2),
    designSystem,
    contactPhone: lead.contactPhone ?? businessInfo.phone,
    contactEmail: lead.contactEmail ?? businessInfo.email,
    location: lead.location ?? businessInfo.location,
  });

  // Use a higher-capability model for code generation
  const result = await callLlm(config, prompt, {
    model: "claude-sonnet-4-5-20250929",
    temperature: 0.2,
    maxTokens: 16384,
  });

  // Strip any markdown fences the LLM might have added
  let html = result.text.trim();
  if (html.startsWith("```")) {
    html = html.replace(/^```(?:html)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  return { html, cost: result.costUsd };
}

async function regenerateSiteHtml(
  config: ModernizerConfig,
  previousHtml: string,
  lighthouseIssues: string[],
  validationErrors: string[],
): Promise<{ html: string; cost: number }> {
  const prompt = siteRegenerationPrompt({
    previousHtml,
    lighthouseIssues,
    validationErrors,
  });

  const result = await callLlm(config, prompt, {
    model: "claude-sonnet-4-5-20250929",
    temperature: 0.1,
    maxTokens: 16384,
  });

  let html = result.text.trim();
  if (html.startsWith("```")) {
    html = html.replace(/^```(?:html)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  return { html, cost: result.costUsd };
}
