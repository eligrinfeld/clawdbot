/**
 * Standalone build tool: generates a modern website for a given business description.
 * Can be used independently of the full pipeline (e.g., for testing or one-off builds).
 */

import { Type } from "@sinclair/typebox";
import type { ClawdbotPluginApi } from "../../../../src/plugins/types.js";
import { parseLlmJson } from "../services/llm.js";
import { routedLlm, createBudgetManager } from "../services/router.js";
import { runLighthouseAudit } from "../services/lighthouse.js";
import { siteGenerationPrompt, designSystemPrompt, contentGenerationPrompt } from "../templates/prompts.js";
import { resolveConfig } from "../config.js";
import type { DesignSystem } from "../types.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export function createBuildTool(api: ClawdbotPluginApi) {
  return {
    name: "website_modernizer_build",
    label: "Build Modern Website",
    description: `Generate a modern, production-ready website for a business. Creates a single HTML file with Tailwind CSS, mobile-responsive design, and high Lighthouse scores.

Provide business details and get back a complete website. The generated site includes:
- Hero section with compelling headline
- Services/products section
- About section
- Contact form
- Modern responsive design
- Accessibility compliance`,
    parameters: Type.Object({
      business_name: Type.String({ description: "Name of the business" }),
      industry: Type.String({ description: "Industry/type of business (e.g., plumber, dentist, restaurant)" }),
      services: Type.Optional(Type.String({ description: "Comma-separated list of services offered" })),
      location: Type.Optional(Type.String({ description: "Business location" })),
      phone: Type.Optional(Type.String({ description: "Business phone number" })),
      email: Type.Optional(Type.String({ description: "Business email" })),
      tone: Type.Optional(Type.String({ description: "Brand tone: professional, friendly, formal, casual (default: professional)" })),
      save_path: Type.Optional(Type.String({ description: "File path to save the generated HTML (default: data dir)" })),
    }),
    async execute(_toolCallId: string, args: Record<string, unknown>) {
      const config = resolveConfig(api);
      const budgetManager = createBudgetManager(config.router);
      const businessName = String(args.business_name);
      const industry = String(args.industry);
      const services = args.services ? String(args.services).split(",").map((s) => s.trim()) : [];
      const location = args.location ? String(args.location) : null;
      const phone = args.phone ? String(args.phone) : null;
      const email = args.email ? String(args.email) : null;
      const tone = String(args.tone ?? "professional");
      let totalCost = 0;

      try {
        // Step 1: Design system via extract_structured tier
        const dsPrompt = designSystemPrompt({ businessName, industry, brandTone: tone });
        const dsResult = await routedLlm(config, budgetManager, dsPrompt, {
          taskType: "extract_structured",
          temperature: 0.5,
          maxTokens: 1024,
          requireJson: true,
        });
        totalCost += dsResult.costUsd;
        const designSystem = parseLlmJson<DesignSystem>(dsResult.text);

        // Step 2: Content via copy_outreach tier
        const contentPrompt = contentGenerationPrompt({
          businessName,
          industry,
          services,
          valuePropositions: [],
          targetAudience: "local customers",
          location,
          phone,
          email,
        });
        const contentResult = await routedLlm(config, budgetManager, contentPrompt, {
          taskType: "copy_outreach",
          temperature: 0.4,
          maxTokens: 2048,
          requireJson: true,
        });
        totalCost += contentResult.costUsd;
        const content = parseLlmJson<Record<string, unknown>>(contentResult.text);

        // Step 3: Generate site via coder tier
        const sitePrompt = siteGenerationPrompt({
          businessName,
          industry,
          content: JSON.stringify(content, null, 2),
          designSystem,
          contactPhone: phone,
          contactEmail: email,
          location,
        });
        const siteResult = await routedLlm(config, budgetManager, sitePrompt, {
          taskType: "code_write",
          temperature: 0.2,
          maxTokens: 16384,
        });
        totalCost += siteResult.costUsd;

        let html = siteResult.text.trim();
        if (html.startsWith("```")) {
          html = html.replace(/^```(?:html)?\s*\n?/, "").replace(/\n?```\s*$/, "");
        }

        // Step 4: QA
        const qaResult = await runLighthouseAudit(html);

        // Save to file
        const outputDir = args.save_path ? String(args.save_path) : join(config.dataDir, "builds");
        mkdirSync(outputDir, { recursive: true });
        const filename = `${businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}.html`;
        const filePath = join(outputDir, filename);
        writeFileSync(filePath, html, "utf-8");

        const budgetState = budgetManager.getState();
        const summary = [
          `## Generated Website for ${businessName}\n`,
          `**Industry:** ${industry}`,
          `**Design Style:** ${designSystem.style}`,
          `**File:** ${filePath}`,
          `**Size:** ${(html.length / 1024).toFixed(1)} KB`,
          `**Router:** ${siteResult.tier} (${siteResult.model})`,
          `\n### Lighthouse Scores`,
          `- Performance: ${qaResult.scores.performance}/100`,
          `- Accessibility: ${qaResult.scores.accessibility}/100`,
          `- Best Practices: ${qaResult.scores.bestPractices}/100`,
          `- SEO: ${qaResult.scores.seo}/100`,
          `\n### Cost: $${totalCost.toFixed(4)} (budget: $${budgetState.monthSpendUsd.toFixed(2)}/$${budgetState.monthlyCapUsd})`,
        ];

        if (qaResult.issues.length > 0) {
          summary.push(`\n### QA Issues`);
          for (const issue of qaResult.issues.slice(0, 10)) {
            summary.push(`- ${issue}`);
          }
        }

        return {
          content: [{ type: "text" as const, text: summary.join("\n") }],
          details: { filePath, scores: qaResult.scores, designSystem, cost: totalCost, budgetState },
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error building site: ${(err as Error).message}` }],
        };
      }
    },
  };
}
