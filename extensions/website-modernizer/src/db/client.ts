/**
 * SQLite database client for the website modernizer pipeline.
 * Wraps better-sqlite3 with typed CRUD operations for all entities.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { SCHEMA_SQL } from "./schema.js";
import type {
  Analysis,
  BusinessInfo,
  DesignSystem,
  GeneratedSite,
  Lead,
  LeadStatus,
  LighthouseScores,
  OutreachRecord,
  Sale,
} from "../types.js";

export class ModernizerDb {
  private db: Database.Database;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    const dbPath = join(dataDir, "modernizer.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA_SQL);
  }

  close(): void {
    this.db.close();
  }

  // ── Leads ──

  insertLead(domain: string, source?: string): Lead {
    const stmt = this.db.prepare(`
      INSERT INTO leads (domain, source) VALUES (?, ?)
      ON CONFLICT(domain) DO UPDATE SET updated_at = datetime('now')
      RETURNING *
    `);
    return this.rowToLead(stmt.get(domain, source ?? null) as Record<string, unknown>);
  }

  getLead(id: number): Lead | undefined {
    const row = this.db.prepare("SELECT * FROM leads WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToLead(row) : undefined;
  }

  getLeadByDomain(domain: string): Lead | undefined {
    const row = this.db.prepare("SELECT * FROM leads WHERE domain = ?").get(domain) as Record<string, unknown> | undefined;
    return row ? this.rowToLead(row) : undefined;
  }

  getLeadsByStatus(status: LeadStatus, limit = 50): Lead[] {
    const rows = this.db.prepare("SELECT * FROM leads WHERE status = ? ORDER BY priority_score DESC LIMIT ?").all(status, limit) as Record<string, unknown>[];
    return rows.map((r) => this.rowToLead(r));
  }

  updateLeadStatus(id: number, status: LeadStatus): void {
    this.db.prepare("UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
  }

  updateLead(id: number, fields: Partial<Pick<Lead, "businessName" | "contactEmail" | "contactPhone" | "industry" | "location" | "priorityScore" | "costIncurred">>): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (fields.businessName !== undefined) { sets.push("business_name = ?"); vals.push(fields.businessName); }
    if (fields.contactEmail !== undefined) { sets.push("contact_email = ?"); vals.push(fields.contactEmail); }
    if (fields.contactPhone !== undefined) { sets.push("contact_phone = ?"); vals.push(fields.contactPhone); }
    if (fields.industry !== undefined) { sets.push("industry = ?"); vals.push(fields.industry); }
    if (fields.location !== undefined) { sets.push("location = ?"); vals.push(fields.location); }
    if (fields.priorityScore !== undefined) { sets.push("priority_score = ?"); vals.push(fields.priorityScore); }
    if (fields.costIncurred !== undefined) { sets.push("cost_incurred = ?"); vals.push(fields.costIncurred); }
    if (sets.length === 0) return;
    sets.push("updated_at = datetime('now')");
    vals.push(id);
    this.db.prepare(`UPDATE leads SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }

  addCost(leadId: number, costUsd: number): void {
    this.db.prepare("UPDATE leads SET cost_incurred = cost_incurred + ?, updated_at = datetime('now') WHERE id = ?").run(costUsd, leadId);
  }

  countLeadsByStatus(): Record<LeadStatus, number> {
    const rows = this.db.prepare("SELECT status, COUNT(*) as cnt FROM leads GROUP BY status").all() as { status: LeadStatus; cnt: number }[];
    const result = {} as Record<LeadStatus, number>;
    for (const r of rows) result[r.status] = r.cnt;
    return result;
  }

  // ── Analyses ──

  insertAnalysis(leadId: number, data: Omit<Analysis, "id" | "leadId" | "analyzedAt">): Analysis {
    const stmt = this.db.prepare(`
      INSERT INTO analyses (lead_id, lighthouse_scores, mobile_responsive, design_era, content_summary, business_info, improvement_potential, conversion_likelihood, effort_required, decision, decision_reason, key_improvements, risk_factors, screenshot_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `);
    const row = stmt.get(
      leadId,
      JSON.stringify(data.lighthouseScores),
      data.mobileResponsive ? 1 : 0,
      data.designEra,
      data.contentSummary,
      data.businessInfo ? JSON.stringify(data.businessInfo) : null,
      data.improvementPotential,
      data.conversionLikelihood,
      data.effortRequired,
      data.decision,
      data.decisionReason,
      JSON.stringify(data.keyImprovements),
      JSON.stringify(data.riskFactors),
      data.screenshotPath,
    ) as Record<string, unknown>;
    return this.rowToAnalysis(row);
  }

  getAnalysis(leadId: number): Analysis | undefined {
    const row = this.db.prepare("SELECT * FROM analyses WHERE lead_id = ?").get(leadId) as Record<string, unknown> | undefined;
    return row ? this.rowToAnalysis(row) : undefined;
  }

  // ── Generated Sites ──

  insertSite(leadId: number, html: string, designSystem?: DesignSystem): GeneratedSite {
    const stmt = this.db.prepare(`
      INSERT INTO generated_sites (lead_id, html, design_system) VALUES (?, ?, ?) RETURNING *
    `);
    const row = stmt.get(leadId, html, designSystem ? JSON.stringify(designSystem) : null) as Record<string, unknown>;
    return this.rowToSite(row);
  }

  updateSite(id: number, fields: Partial<Pick<GeneratedSite, "html" | "previewUrl" | "lighthouseScores" | "regenerationCount" | "qaPassed">>): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (fields.html !== undefined) { sets.push("html = ?"); vals.push(fields.html); }
    if (fields.previewUrl !== undefined) { sets.push("preview_url = ?"); vals.push(fields.previewUrl); }
    if (fields.lighthouseScores !== undefined) { sets.push("lighthouse_scores = ?"); vals.push(JSON.stringify(fields.lighthouseScores)); }
    if (fields.regenerationCount !== undefined) { sets.push("regeneration_count = ?"); vals.push(fields.regenerationCount); }
    if (fields.qaPassed !== undefined) { sets.push("qa_passed = ?"); vals.push(fields.qaPassed ? 1 : 0); }
    if (sets.length === 0) return;
    vals.push(id);
    this.db.prepare(`UPDATE generated_sites SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }

  getLatestSite(leadId: number): GeneratedSite | undefined {
    const row = this.db.prepare("SELECT * FROM generated_sites WHERE lead_id = ? ORDER BY id DESC LIMIT 1").get(leadId) as Record<string, unknown> | undefined;
    return row ? this.rowToSite(row) : undefined;
  }

  // ── Outreach ──

  insertOutreach(leadId: number, emailTo: string, subject: string, body: string): OutreachRecord {
    const stmt = this.db.prepare(`
      INSERT INTO outreach (lead_id, email_to, subject, body) VALUES (?, ?, ?, ?) RETURNING *
    `);
    const row = stmt.get(leadId, emailTo, subject, body) as Record<string, unknown>;
    return this.rowToOutreach(row);
  }

  markOutreachSent(id: number): void {
    this.db.prepare("UPDATE outreach SET sent_at = datetime('now'), status = 'sent' WHERE id = ?").run(id);
  }

  updateOutreachStatus(id: number, status: OutreachRecord["status"]): void {
    this.db.prepare("UPDATE outreach SET status = ? WHERE id = ?").run(status, id);
  }

  getOutreach(leadId: number): OutreachRecord | undefined {
    const row = this.db.prepare("SELECT * FROM outreach WHERE lead_id = ? ORDER BY id DESC LIMIT 1").get(leadId) as Record<string, unknown> | undefined;
    return row ? this.rowToOutreach(row) : undefined;
  }

  getTodayEmailCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM outreach WHERE sent_at >= date('now')").get() as { cnt: number };
    return row.cnt;
  }

  isEmailSuppressed(email: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM suppression_list WHERE email = ?").get(email);
    return !!row;
  }

  suppressEmail(email: string, reason: string): void {
    this.db.prepare("INSERT OR IGNORE INTO suppression_list (email, reason) VALUES (?, ?)").run(email, reason);
  }

  // ── Sales ──

  insertSale(leadId: number, amount: number): Sale {
    const stmt = this.db.prepare("INSERT INTO sales (lead_id, amount) VALUES (?, ?) RETURNING *");
    return stmt.get(leadId, amount) as Sale;
  }

  // ── Metrics ──

  recordMetric(stage: string, leadId: number | null, success: boolean, costUsd: number, durationMs: number, errorMessage?: string): void {
    this.db.prepare(`
      INSERT INTO pipeline_metrics (stage, lead_id, success, cost_usd, duration_ms, error_message)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(stage, leadId, success ? 1 : 0, costUsd, durationMs, errorMessage ?? null);
  }

  getMetricsSummary(): { stage: string; total: number; successes: number; totalCost: number; avgDurationMs: number }[] {
    return this.db.prepare(`
      SELECT stage, COUNT(*) as total, SUM(success) as successes,
             SUM(cost_usd) as totalCost, AVG(duration_ms) as avgDurationMs
      FROM pipeline_metrics GROUP BY stage
    `).all() as { stage: string; total: number; successes: number; totalCost: number; avgDurationMs: number }[];
  }

  // ── Row mappers ──

  private rowToLead(r: Record<string, unknown>): Lead {
    return {
      id: r.id as number,
      domain: r.domain as string,
      status: r.status as LeadStatus,
      industry: r.industry as string | null,
      location: r.location as string | null,
      businessName: r.business_name as string | null,
      contactEmail: r.contact_email as string | null,
      contactPhone: r.contact_phone as string | null,
      priorityScore: r.priority_score as number,
      discoveredAt: r.discovered_at as string,
      updatedAt: r.updated_at as string,
      costIncurred: r.cost_incurred as number,
      source: r.source as string | null,
    };
  }

  private rowToAnalysis(r: Record<string, unknown>): Analysis {
    return {
      id: r.id as number,
      leadId: r.lead_id as number,
      lighthouseScores: r.lighthouse_scores ? JSON.parse(r.lighthouse_scores as string) : { performance: 0, accessibility: 0, bestPractices: 0, seo: 0 },
      mobileResponsive: !!(r.mobile_responsive as number),
      designEra: r.design_era as string | null,
      contentSummary: r.content_summary as string | null,
      businessInfo: r.business_info ? JSON.parse(r.business_info as string) : null,
      improvementPotential: r.improvement_potential as number,
      conversionLikelihood: r.conversion_likelihood as ConversionLikelihood,
      effortRequired: r.effort_required as EffortEstimate,
      decision: r.decision as AnalysisDecision,
      decisionReason: r.decision_reason as string | null,
      keyImprovements: r.key_improvements ? JSON.parse(r.key_improvements as string) : [],
      riskFactors: r.risk_factors ? JSON.parse(r.risk_factors as string) : [],
      screenshotPath: r.screenshot_path as string | null,
      analyzedAt: r.analyzed_at as string,
    };
  }

  private rowToSite(r: Record<string, unknown>): GeneratedSite {
    return {
      id: r.id as number,
      leadId: r.lead_id as number,
      html: r.html as string,
      previewUrl: r.preview_url as string | null,
      designSystem: r.design_system ? JSON.parse(r.design_system as string) : null,
      lighthouseScores: r.lighthouse_scores ? JSON.parse(r.lighthouse_scores as string) : null,
      regenerationCount: r.regeneration_count as number,
      qaPassed: !!(r.qa_passed as number),
      generatedAt: r.generated_at as string,
    };
  }

  private rowToOutreach(r: Record<string, unknown>): OutreachRecord {
    return {
      id: r.id as number,
      leadId: r.lead_id as number,
      emailTo: r.email_to as string,
      subject: r.subject as string,
      body: r.body as string,
      sentAt: r.sent_at as string | null,
      openedAt: r.opened_at as string | null,
      clickedAt: r.clicked_at as string | null,
      repliedAt: r.replied_at as string | null,
      replyText: r.reply_text as string | null,
      sentiment: r.sentiment as ReplySentiment | null,
      status: r.status as OutreachRecord["status"],
    };
  }
}

// Re-export types used by rowToAnalysis
import type { AnalysisDecision, ConversionLikelihood, EffortEstimate, ReplySentiment } from "../types.js";
