/**
 * Pipeline tool: allows the clawdbot agent to run the full modernizer pipeline.
 * Registered as an agent tool so the bot can autonomously process leads.
 */

import { Type } from "@sinclair/typebox";
import type { ClawdbotPluginApi } from "../../../../src/plugins/types.js";
import { Orchestrator } from "../agents/orchestrator.js";
import { resolveConfig } from "../config.js";

export function createPipelineTool(api: ClawdbotPluginApi) {
  return {
    name: "website_modernizer_pipeline",
    label: "Website Modernizer",
    description: `Run the website modernizer pipeline to discover outdated business websites, generate modern replacements, and send outreach.

Stages:
- scout: Discover potential target websites (requires domains or niche+location)
- analyze: Deep analysis of discovered leads
- build: Generate modern website for analyzed leads
- sell: Send outreach email with demo to ready leads
- full: Run all stages in sequence

You can process specific domains, discover by niche, or advance existing leads through the pipeline.`,
    parameters: Type.Object({
      action: Type.String({
        description: "Pipeline action: 'run' (execute stages), 'status' (show stats), 'process' (single domain end-to-end)",
      }),
      stage: Type.Optional(Type.String({
        description: "Pipeline stage to run: scout, analyze, build, sell, full. Default: full",
      })),
      domains: Type.Optional(Type.String({
        description: "Comma-separated list of domains to scout (for scout stage)",
      })),
      niche: Type.Optional(Type.String({
        description: "Industry niche to discover (e.g., 'plumber', 'dentist')",
      })),
      location: Type.Optional(Type.String({
        description: "Location for niche discovery (e.g., 'Austin, TX')",
      })),
      domain: Type.Optional(Type.String({
        description: "Single domain to process end-to-end (for 'process' action)",
      })),
      lead_id: Type.Optional(Type.Number({
        description: "Specific lead ID to process",
      })),
      batch_size: Type.Optional(Type.Number({
        description: "Max leads per stage (default: 10)",
      })),
    }),
    async execute(_toolCallId: string, args: Record<string, unknown>) {
      const config = resolveConfig(api);
      const action = String(args.action ?? "run");

      const orchestrator = new Orchestrator(config);
      try {
        switch (action) {
          case "status": {
            const stats = orchestrator.getStats();
            return {
              content: [{ type: "text" as const, text: formatStats(stats) }],
              details: stats,
            };
          }

          case "process": {
            const domain = String(args.domain ?? "");
            if (!domain) {
              return { content: [{ type: "text" as const, text: "Error: 'domain' is required for the 'process' action." }] };
            }
            const result = await orchestrator.processSingleDomain(domain);
            return {
              content: [{ type: "text" as const, text: formatRunResults(result.results) }],
              details: result,
            };
          }

          case "run": {
            const stage = (args.stage as string) ?? "full";
            const domains = args.domains ? String(args.domains).split(",").map((d) => d.trim()) : undefined;
            const results = await orchestrator.run({
              stage: stage as "scout" | "analyze" | "build" | "sell" | "full",
              domains,
              niche: args.niche ? String(args.niche) : undefined,
              location: args.location ? String(args.location) : undefined,
              leadId: args.lead_id ? Number(args.lead_id) : undefined,
              batchSize: args.batch_size ? Number(args.batch_size) : 10,
            });
            return {
              content: [{ type: "text" as const, text: formatRunResults(results) }],
              details: results,
            };
          }

          default:
            return { content: [{ type: "text" as const, text: `Unknown action: ${action}. Use 'run', 'status', or 'process'.` }] };
        }
      } finally {
        orchestrator.close();
      }
    },
  };
}

function formatStats(stats: ReturnType<Orchestrator["getStats"]>): string {
  const lines = ["## Website Modernizer Pipeline Status\n"];

  lines.push("### Lead Pipeline");
  for (const [status, count] of Object.entries(stats.leadsByStatus)) {
    lines.push(`- ${status}: ${count}`);
  }

  lines.push("\n### Stage Metrics");
  for (const m of stats.metrics) {
    const successRate = m.total > 0 ? Math.round((m.successes / m.total) * 100) : 0;
    lines.push(`- ${m.stage}: ${m.total} runs, ${successRate}% success, $${m.totalCost.toFixed(2)} spent, avg ${Math.round(m.avgDurationMs)}ms`);
  }

  lines.push(`\n### Financials`);
  lines.push(`- Total Revenue: $${stats.totalRevenue.toFixed(2)}`);
  lines.push(`- Total Cost: $${stats.totalCost.toFixed(2)}`);
  lines.push(`- Profit Margin: ${(stats.profitMargin * 100).toFixed(1)}%`);

  return lines.join("\n");
}

function formatRunResults(results: { stage: string; processed: number; succeeded: number; failed: number; totalCost: number; totalDurationMs: number; details: string[] }[]): string {
  const lines = ["## Pipeline Run Results\n"];

  for (const r of results) {
    lines.push(`### ${r.stage.toUpperCase()}`);
    lines.push(`- Processed: ${r.processed} | Succeeded: ${r.succeeded} | Failed: ${r.failed}`);
    lines.push(`- Cost: $${r.totalCost.toFixed(4)} | Duration: ${(r.totalDurationMs / 1000).toFixed(1)}s`);
    if (r.details.length > 0) {
      lines.push("- Details:");
      for (const d of r.details) {
        lines.push(`  - ${d}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
