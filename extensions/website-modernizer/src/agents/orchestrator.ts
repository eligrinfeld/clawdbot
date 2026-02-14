/**
 * Master Orchestrator: Coordinates the full Scout → Analyze → Build → Sell pipeline.
 * Manages lead lifecycle, resource allocation, and strategic decisions.
 */

import type { ModernizerConfig, Lead, LeadStatus, StageResult } from "../types.js";
import { ModernizerDb } from "../db/client.js";
import { scoutDomains, discoverByNiche } from "./scout.js";
import { analyzeLead } from "./analyzer.js";
import { buildSite } from "./builder.js";
import { pitchLead } from "./seller.js";

export interface PipelineStats {
  leadsByStatus: Record<string, number>;
  metrics: { stage: string; total: number; successes: number; totalCost: number; avgDurationMs: number }[];
  totalRevenue: number;
  totalCost: number;
  profitMargin: number;
}

export interface RunPipelineOptions {
  /** Run specific stage only, or "full" for all stages. */
  stage?: "scout" | "analyze" | "build" | "sell" | "full";
  /** Max leads to process per stage in this run. */
  batchSize?: number;
  /** For scout stage: domains to process. */
  domains?: string[];
  /** For scout stage: niche and location for discovery. */
  niche?: string;
  location?: string;
  /** Specific lead ID to process. */
  leadId?: number;
}

export interface RunResult {
  stage: string;
  processed: number;
  succeeded: number;
  failed: number;
  totalCost: number;
  totalDurationMs: number;
  details: string[];
}

/**
 * The Orchestrator manages the full pipeline lifecycle.
 * Each call to run() advances leads through the pipeline.
 */
export class Orchestrator {
  private db: ModernizerDb;
  private config: ModernizerConfig;

  constructor(config: ModernizerConfig) {
    this.config = config;
    this.db = new ModernizerDb(config.dataDir);
  }

  /**
   * Run the pipeline (or a specific stage).
   */
  async run(opts: RunPipelineOptions = {}): Promise<RunResult[]> {
    const stage = opts.stage ?? "full";
    const batchSize = opts.batchSize ?? 10;
    const results: RunResult[] = [];

    if (stage === "scout" || stage === "full") {
      results.push(await this.runScout(opts, batchSize));
    }

    if (stage === "analyze" || stage === "full") {
      results.push(await this.runAnalyze(opts, batchSize));
    }

    if (stage === "build" || stage === "full") {
      results.push(await this.runBuild(opts, batchSize));
    }

    if (stage === "sell" || stage === "full") {
      results.push(await this.runSell(opts, batchSize));
    }

    return results;
  }

  /**
   * Get pipeline statistics.
   */
  getStats(): PipelineStats {
    const leadsByStatus = this.db.countLeadsByStatus();
    const metrics = this.db.getMetricsSummary();

    let totalCost = 0;
    for (const m of metrics) totalCost += m.totalCost;

    // Rough revenue estimate from sold leads
    const soldCount = leadsByStatus.sold ?? 0;
    const totalRevenue = soldCount * this.config.priceUsd;

    return {
      leadsByStatus,
      metrics,
      totalRevenue,
      totalCost,
      profitMargin: totalRevenue > 0 ? (totalRevenue - totalCost) / totalRevenue : 0,
    };
  }

  /**
   * Process a single domain through the full pipeline.
   */
  async processSingleDomain(domain: string): Promise<{ results: RunResult[]; leadId: number | null }> {
    // Scout
    const scoutResult = await scoutDomains(this.config, this.db, [domain], "manual");
    if (!scoutResult.data?.leads.length) {
      return {
        results: [{ stage: "scout", processed: 1, succeeded: 0, failed: 1, totalCost: scoutResult.costUsd, totalDurationMs: scoutResult.durationMs, details: ["Domain did not qualify"] }],
        leadId: null,
      };
    }

    const leadId = scoutResult.data.leads[0].id;
    const results: RunResult[] = [];
    results.push({ stage: "scout", processed: 1, succeeded: 1, failed: 0, totalCost: scoutResult.costUsd, totalDurationMs: scoutResult.durationMs, details: [`Lead ${leadId} created`] });

    // Analyze
    const analyzeResult = await analyzeLead(this.config, this.db, leadId);
    results.push({ stage: "analyze", processed: 1, succeeded: analyzeResult.success ? 1 : 0, failed: analyzeResult.success ? 0 : 1, totalCost: analyzeResult.costUsd, totalDurationMs: analyzeResult.durationMs, details: [analyzeResult.error ?? "Analysis complete"] });

    if (!analyzeResult.success || analyzeResult.data?.decision === "skip") {
      return { results, leadId };
    }

    // Build
    const buildResult = await buildSite(this.config, this.db, analyzeResult.data!, leadId);
    results.push({ stage: "build", processed: 1, succeeded: buildResult.success ? 1 : 0, failed: buildResult.success ? 0 : 1, totalCost: buildResult.costUsd, totalDurationMs: buildResult.durationMs, details: [buildResult.error ?? `Site built, preview: ${buildResult.data?.previewUrl ?? "N/A"}`] });

    if (!buildResult.success) {
      return { results, leadId };
    }

    // Sell
    const sellResult = await pitchLead(this.config, this.db, leadId);
    results.push({ stage: "sell", processed: 1, succeeded: sellResult.success ? 1 : 0, failed: sellResult.success ? 0 : 1, totalCost: sellResult.costUsd, totalDurationMs: sellResult.durationMs, details: [sellResult.error ?? "Outreach sent"] });

    return { results, leadId };
  }

  close(): void {
    this.db.close();
  }

  // ── Private stage runners ──

  private async runScout(opts: RunPipelineOptions, batchSize: number): Promise<RunResult> {
    const startTime = Date.now();
    let totalCost = 0;
    const details: string[] = [];

    if (opts.domains?.length) {
      const result = await scoutDomains(this.config, this.db, opts.domains, "manual");
      totalCost += result.costUsd;
      details.push(`Scouted ${opts.domains.length} domains: ${result.data?.qualified ?? 0} qualified, ${result.data?.rejected ?? 0} rejected`);
      return {
        stage: "scout",
        processed: opts.domains.length,
        succeeded: result.data?.qualified ?? 0,
        failed: result.data?.rejected ?? 0,
        totalCost,
        totalDurationMs: Date.now() - startTime,
        details,
      };
    }

    if (opts.niche && opts.location) {
      const result = await discoverByNiche(this.config, this.db, opts.niche, opts.location, batchSize);
      totalCost += result.costUsd;
      details.push(`Niche discovery (${opts.niche} in ${opts.location}): ${result.data?.qualified ?? 0} qualified`);
      return {
        stage: "scout",
        processed: result.data?.discovered ?? 0,
        succeeded: result.data?.qualified ?? 0,
        failed: result.data?.rejected ?? 0,
        totalCost,
        totalDurationMs: Date.now() - startTime,
        details,
      };
    }

    details.push("No domains or niche specified for scouting");
    return { stage: "scout", processed: 0, succeeded: 0, failed: 0, totalCost: 0, totalDurationMs: 0, details };
  }

  private async runAnalyze(opts: RunPipelineOptions, batchSize: number): Promise<RunResult> {
    const startTime = Date.now();
    let totalCost = 0;
    let succeeded = 0;
    let failed = 0;
    const details: string[] = [];

    // Get leads ready for analysis
    let leads: Lead[];
    if (opts.leadId) {
      const lead = this.db.getLead(opts.leadId);
      leads = lead ? [lead] : [];
    } else {
      leads = this.db.getLeadsByStatus("discovered", batchSize);
    }

    for (const lead of leads) {
      const result = await analyzeLead(this.config, this.db, lead.id);
      totalCost += result.costUsd;
      if (result.success) {
        succeeded++;
        details.push(`${lead.domain}: ${result.data?.decision ?? "unknown"} (potential: ${result.data?.improvementPotential ?? 0})`);
      } else {
        failed++;
        details.push(`${lead.domain}: FAILED - ${result.error}`);
      }
    }

    return {
      stage: "analyze",
      processed: leads.length,
      succeeded,
      failed,
      totalCost,
      totalDurationMs: Date.now() - startTime,
      details,
    };
  }

  private async runBuild(opts: RunPipelineOptions, batchSize: number): Promise<RunResult> {
    const startTime = Date.now();
    let totalCost = 0;
    let succeeded = 0;
    let failed = 0;
    const details: string[] = [];

    // Get analyzed leads with "go" decision
    let leads: Lead[];
    if (opts.leadId) {
      const lead = this.db.getLead(opts.leadId);
      leads = lead ? [lead] : [];
    } else {
      // Leads that have been analyzed but not yet built
      leads = this.db.getLeadsByStatus("discovered", batchSize)
        .filter(() => false); // Won't match - we need analyzed leads
      // Actually get leads that passed analysis
      const analyzed = this.db.getLeadsByStatus("analyzing", batchSize);
      // Get leads with go decision from analyses
      leads = [];
      const discovered = this.db.getLeadsByStatus("discovered", batchSize * 2);
      for (const lead of [...discovered, ...analyzed]) {
        const analysis = this.db.getAnalysis(lead.id);
        if (analysis?.decision === "go" && lead.status !== "building" && lead.status !== "ready") {
          leads.push(lead);
          if (leads.length >= batchSize) break;
        }
      }
    }

    // Process builds (respecting concurrent limit)
    const concurrency = Math.min(this.config.maxConcurrentBuilds, leads.length);
    const batches: Lead[][] = [];
    for (let i = 0; i < leads.length; i += concurrency) {
      batches.push(leads.slice(i, i + concurrency));
    }

    for (const batch of batches) {
      const results = await Promise.all(
        batch.map(async (lead) => {
          const analysis = this.db.getAnalysis(lead.id);
          if (!analysis) return { lead, result: { success: false, error: "No analysis", costUsd: 0, durationMs: 0 } as StageResult<unknown> };
          return { lead, result: await buildSite(this.config, this.db, analysis, lead.id) };
        }),
      );

      for (const { lead, result } of results) {
        totalCost += result.costUsd;
        if (result.success) {
          succeeded++;
          details.push(`${lead.domain}: Built successfully`);
        } else {
          failed++;
          details.push(`${lead.domain}: FAILED - ${result.error}`);
        }
      }
    }

    return {
      stage: "build",
      processed: leads.length,
      succeeded,
      failed,
      totalCost,
      totalDurationMs: Date.now() - startTime,
      details,
    };
  }

  private async runSell(opts: RunPipelineOptions, batchSize: number): Promise<RunResult> {
    const startTime = Date.now();
    let totalCost = 0;
    let succeeded = 0;
    let failed = 0;
    const details: string[] = [];

    let leads: Lead[];
    if (opts.leadId) {
      const lead = this.db.getLead(opts.leadId);
      leads = lead ? [lead] : [];
    } else {
      leads = this.db.getLeadsByStatus("ready", batchSize);
    }

    for (const lead of leads) {
      const result = await pitchLead(this.config, this.db, lead.id);
      totalCost += result.costUsd;
      if (result.success) {
        succeeded++;
        details.push(`${lead.domain}: Pitched to ${lead.contactEmail}`);
      } else {
        failed++;
        details.push(`${lead.domain}: FAILED - ${result.error}`);
      }
    }

    return {
      stage: "sell",
      processed: leads.length,
      succeeded,
      failed,
      totalCost,
      totalDurationMs: Date.now() - startTime,
      details,
    };
  }
}
