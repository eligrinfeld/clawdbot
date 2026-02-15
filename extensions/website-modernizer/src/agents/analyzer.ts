/**
 * Analyzer Agent: Deep analysis of target websites to determine rebuild approach.
 * Combines automated Lighthouse audits with LLM-powered content and design analysis.
 */

import type { ModernizerConfig, Analysis, StageResult } from "../types.js";
import type { ModernizerDb } from "../db/client.js";
import { parseLlmJson } from "../services/llm.js";
import { routedLlm, type BudgetManager } from "../services/router.js";
import { runLighthouseAudit } from "../services/lighthouse.js";
import { fetchWebpage, takeScreenshot } from "../services/screenshot.js";
import { websiteAnalysisPrompt, screenshotAnalysisPrompt } from "../templates/prompts.js";
import { join } from "node:path";
import { sanitizeHtmlForLlm } from "../security.js";

interface LlmAnalysisResult {
  businessInfo: {
    name: string;
    industry: string;
    services: string[];
    valuePropositions: string[];
    targetAudience: string;
    brandTone: string;
    location: string | null;
    phone: string | null;
    email: string | null;
  };
  designEra: string;
  contentSummary: string;
  improvementPotential: number;
  conversionLikelihood: "low" | "medium" | "high";
  effortRequired: "simple" | "medium" | "complex";
  decision: "go" | "skip";
  decisionReason: string;
  keyImprovements: string[];
  riskFactors: string[];
}

interface ScreenshotAnalysis {
  designEra: string;
  designIssues: string[];
  missingElements: string[];
  professionalScore: number;
  brandColors: string[];
}

/**
 * Run full analysis on a discovered lead.
 * 1. Fetch website HTML
 * 2. Run Lighthouse audit
 * 3. Take screenshot (if Playwright available)
 * 4. LLM analysis of content and design
 * 5. Score and make go/skip decision
 */
export async function analyzeLead(
  config: ModernizerConfig,
  db: ModernizerDb,
  leadId: number,
  budgetManager: BudgetManager,
): Promise<StageResult<Analysis>> {
  const startTime = Date.now();
  let totalCost = 0;

  const lead = db.getLead(leadId);
  if (!lead) return { success: false, error: "Lead not found", costUsd: 0, durationMs: 0 };

  try {
    db.updateLeadStatus(leadId, "analyzing");

    // Step 1: Fetch the website
    const { html, statusCode } = await fetchWebpage(lead.domain);
    if (statusCode >= 400) {
      db.updateLeadStatus(leadId, "analysis_failed");
      return { success: false, error: `Website returned ${statusCode}`, costUsd: 0, durationMs: Date.now() - startTime };
    }

    // Step 2: Run Lighthouse audit on the original site
    const lighthouse = await runLighthouseAudit(`https://${lead.domain}`);

    // Check for mobile responsiveness (basic heuristic)
    const hasMobileViewport = html.includes('name="viewport"');
    const hasMediaQueries = html.includes("@media");
    const isMobileResponsive = hasMobileViewport && hasMediaQueries;

    // Step 3: Take screenshot (best-effort)
    const screenshotDir = join(config.dataDir, "screenshots");
    const screenshot = await takeScreenshot(`https://${lead.domain}`, screenshotDir);
    let screenshotAnalysis: ScreenshotAnalysis | undefined;

    if (screenshot) {
      // Analyze screenshot with vision model via extract_structured task
      const screenshotResult = await routedLlm(config, budgetManager, screenshotAnalysisPrompt(), {
        taskType: "extract_structured",
        imageBase64: screenshot.base64,
        imageMimeType: "image/png",
        maxTokens: 1024,
        // Vision requires Anthropic - force tier0 which defaults to Anthropic
        forceTier: "tier0_fast",
        requireJson: true,
      });
      totalCost += screenshotResult.costUsd;
      screenshotAnalysis = parseLlmJson<ScreenshotAnalysis>(screenshotResult.text);
    }

    // Step 4: Sanitize HTML before LLM processing (prevent prompt injection)
    const cleanHtml = sanitizeHtmlForLlm(html);

    const analysisPrompt = websiteAnalysisPrompt({
      domain: lead.domain,
      htmlSnippet: cleanHtml,
      lighthouseScores: lighthouse.scores,
      isMobileResponsive,
    });

    // Use reasoning tier for deep analysis
    const analysisResult = await routedLlm(config, budgetManager, analysisPrompt, {
      taskType: "reason",
      maxTokens: 2048,
      temperature: 0.2,
      requireJson: true,
    });
    totalCost += analysisResult.costUsd;

    const llmAnalysis = parseLlmJson<LlmAnalysisResult>(analysisResult.text);

    // Step 5: Combine all signals into final analysis
    const analysis: Omit<Analysis, "id" | "leadId" | "analyzedAt"> = {
      lighthouseScores: lighthouse.scores,
      mobileResponsive: isMobileResponsive,
      designEra: screenshotAnalysis?.designEra ?? llmAnalysis.designEra,
      contentSummary: llmAnalysis.contentSummary,
      businessInfo: llmAnalysis.businessInfo,
      improvementPotential: llmAnalysis.improvementPotential,
      conversionLikelihood: llmAnalysis.conversionLikelihood,
      effortRequired: llmAnalysis.effortRequired,
      decision: llmAnalysis.decision,
      decisionReason: llmAnalysis.decisionReason,
      keyImprovements: llmAnalysis.keyImprovements,
      riskFactors: llmAnalysis.riskFactors,
      screenshotPath: screenshot?.path ?? null,
    };

    // Store analysis
    const stored = db.insertAnalysis(leadId, analysis);

    // Update lead with extracted business info
    db.updateLead(leadId, {
      businessName: llmAnalysis.businessInfo.name,
      contactEmail: llmAnalysis.businessInfo.email ?? undefined,
      contactPhone: llmAnalysis.businessInfo.phone ?? undefined,
      industry: llmAnalysis.businessInfo.industry,
      location: llmAnalysis.businessInfo.location ?? undefined,
    });

    // Update status based on decision
    if (llmAnalysis.decision === "skip") {
      db.updateLeadStatus(leadId, "dead");
    }

    db.addCost(leadId, totalCost);

    const durationMs = Date.now() - startTime;
    db.recordMetric("analyzer", leadId, true, totalCost, durationMs);

    return { success: true, data: stored, costUsd: totalCost, durationMs };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    db.updateLeadStatus(leadId, "analysis_failed");
    db.addCost(leadId, totalCost);
    db.recordMetric("analyzer", leadId, false, totalCost, durationMs, (err as Error).message);
    return { success: false, error: (err as Error).message, costUsd: totalCost, durationMs };
  }
}
