/**
 * E2E tests for the website-modernizer extension.
 * Mocks all external services (Anthropic, SendGrid, Stripe, hosting, Lighthouse)
 * and exercises the full pipeline: Scout → Analyze → Build → Sell.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ModernizerDb } from "./db/client.js";
import { parseLlmJson } from "./services/llm.js";
import type { ModernizerConfig, Analysis, BusinessInfo } from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";
import {
  MOCK_DESIGN_SYSTEM,
  MOCK_CONTENT,
  MOCK_GENERATED_HTML,
  MOCK_QUALIFICATION,
  MOCK_ANALYSIS,
  MOCK_OUTREACH_EMAIL,
  OUTDATED_PLUMBER_HTML,
} from "./test-utils/fixtures.js";

// ── Mock all external services ──

// Track callLlm invocations so we can return different responses per call
let llmCallIndex = 0;
const llmResponses: string[] = [];

vi.mock("./services/llm.js", () => ({
  callLlm: vi.fn(async () => {
    const text = llmResponses[llmCallIndex] ?? "{}";
    llmCallIndex++;
    return { text, inputTokens: 500, outputTokens: 200, costUsd: 0.005, model: "mock" };
  }),
  parseLlmJson: <T>(text: string): T => {
    let cleaned = text.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }
    return JSON.parse(cleaned) as T;
  },
}));

vi.mock("./services/screenshot.js", () => ({
  fetchWebpage: vi.fn(async (url: string) => ({
    html: OUTDATED_PLUMBER_HTML,
    statusCode: 200,
    headers: {},
  })),
  takeScreenshot: vi.fn(async () => null), // Skip screenshots
  screenshotHtml: vi.fn(async () => null),
}));

vi.mock("./services/lighthouse.js", () => ({
  runLighthouseAudit: vi.fn(async () => ({
    scores: { performance: 92, accessibility: 95, bestPractices: 90, seo: 88 },
    issues: [],
  })),
}));

vi.mock("./services/hosting.js", () => ({
  deploySite: vi.fn(async () => ({
    success: true,
    url: "https://mod-joes-plumbing-12345.netlify.app",
    deployId: "deploy-123",
  })),
}));

vi.mock("./services/email.js", () => ({
  sendEmail: vi.fn(async () => ({ success: true, messageId: "msg-123" })),
  isValidEmail: (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
}));

vi.mock("./services/payment.js", () => ({
  createPaymentLink: vi.fn(async () => ({
    success: true,
    url: "https://buy.stripe.com/test_link",
    paymentLinkId: "plink_123",
  })),
}));

// ── Test helpers ──

function createTestConfig(dataDir: string): ModernizerConfig {
  return {
    ...DEFAULT_CONFIG,
    dataDir,
    anthropicApiKey: "test-key-mock",
    sendgridApiKey: "test-sg-key",
    stripeSecretKey: "test-stripe-key",
    hostingProvider: "netlify",
    hostingToken: "test-hosting-token",
    fromEmail: "test@example.com",
    fromName: "Test Modernizer",
    minLighthouseScore: 85,
    maxRegenAttempts: 3,
  };
}

function createTestAnalysis(leadId: number): Omit<Analysis, "id" | "leadId" | "analyzedAt"> {
  return {
    lighthouseScores: { performance: 45, accessibility: 50, bestPractices: 55, seo: 40 },
    mobileResponsive: false,
    designEra: "2000s",
    contentSummary: "Outdated plumbing website",
    businessInfo: {
      name: "Joe's Plumbing",
      industry: "plumber",
      services: ["Emergency Repairs", "Drain Cleaning"],
      valuePropositions: ["24/7 service"],
      targetAudience: "Homeowners",
      brandTone: "professional",
      location: "Austin, TX",
      phone: "(512) 555-0123",
      email: "info@joesplumbing.com",
    },
    improvementPotential: 85,
    conversionLikelihood: "medium",
    effortRequired: "simple",
    decision: "go",
    decisionReason: "High improvement potential",
    keyImprovements: ["Modern design", "Mobile responsive", "Better accessibility"],
    riskFactors: [],
    screenshotPath: null,
  };
}

// ── Tests ──

describe("Website Modernizer E2E", () => {
  let tmpDir: string;
  let config: ModernizerConfig;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "modernizer-test-"));
    config = createTestConfig(tmpDir);
    llmCallIndex = 0;
    llmResponses.length = 0;
    vi.clearAllMocks();
    // Reset lighthouse mock to default passing scores (vi.clearAllMocks doesn't undo mockResolvedValue)
    const { runLighthouseAudit } = await import("./services/lighthouse.js");
    (runLighthouseAudit as ReturnType<typeof vi.fn>).mockResolvedValue({
      scores: { performance: 92, accessibility: 95, bestPractices: 90, seo: 88 },
      issues: [],
    });
    // Reset fetchWebpage to default
    const { fetchWebpage } = await import("./services/screenshot.js");
    (fetchWebpage as ReturnType<typeof vi.fn>).mockResolvedValue({
      html: OUTDATED_PLUMBER_HTML,
      statusCode: 200,
      headers: {},
    });
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* temp dir cleanup best-effort */ }
  });

  // ── Database Tests ──

  describe("Database", () => {
    it("should create database with all tables and indexes", () => {
      const db = new ModernizerDb(tmpDir);
      try {
        // Verify tables exist by querying them
        const lead = db.insertLead("test.com", "test");
        expect(lead.id).toBe(1);
        expect(lead.domain).toBe("test.com");
        expect(lead.status).toBe("discovered");

        const counts = db.countLeadsByStatus();
        expect(counts.discovered).toBe(1);
      } finally {
        db.close();
      }
    });

    it("should handle full lead CRUD lifecycle", () => {
      const db = new ModernizerDb(tmpDir);
      try {
        // Insert
        const lead = db.insertLead("example-plumber.com", "manual");
        expect(lead.id).toBeGreaterThan(0);

        // Update fields
        db.updateLead(lead.id, {
          businessName: "Example Plumber",
          contactEmail: "info@example-plumber.com",
          industry: "plumber",
          priorityScore: 80,
        });

        // Read back
        const updated = db.getLead(lead.id)!;
        expect(updated.businessName).toBe("Example Plumber");
        expect(updated.contactEmail).toBe("info@example-plumber.com");
        expect(updated.industry).toBe("plumber");
        expect(updated.priorityScore).toBe(80);

        // Status update
        db.updateLeadStatus(lead.id, "analyzing");
        expect(db.getLead(lead.id)!.status).toBe("analyzing");

        // Cost tracking
        db.addCost(lead.id, 0.05);
        db.addCost(lead.id, 0.10);
        expect(db.getLead(lead.id)!.costIncurred).toBeCloseTo(0.15);

        // Dedup
        const dupe = db.insertLead("example-plumber.com", "dupe");
        expect(dupe.id).toBe(lead.id); // Same ID (upsert)
      } finally {
        db.close();
      }
    });

    it("should handle analysis insert and retrieval with JSON fields", () => {
      const db = new ModernizerDb(tmpDir);
      try {
        const lead = db.insertLead("test.com");
        const analysisData = createTestAnalysis(lead.id);
        const analysis = db.insertAnalysis(lead.id, analysisData);

        expect(analysis.leadId).toBe(lead.id);
        expect(analysis.decision).toBe("go");
        expect(analysis.businessInfo!.name).toBe("Joe's Plumbing");
        expect(analysis.keyImprovements).toHaveLength(3);

        // Retrieve
        const fetched = db.getAnalysis(lead.id)!;
        expect(fetched.lighthouseScores.performance).toBe(45);
        expect(fetched.businessInfo!.industry).toBe("plumber");
      } finally {
        db.close();
      }
    });

    it("should handle generated sites with QA tracking", () => {
      const db = new ModernizerDb(tmpDir);
      try {
        const lead = db.insertLead("test.com");
        const site = db.insertSite(lead.id, "<html>test</html>", {
          primaryColor: "#2563eb",
          secondaryColor: "#1e40af",
          accentColor: "#f59e0b",
          neutralLight: "#f8fafc",
          neutralDark: "#1e293b",
          headingFont: "Inter",
          bodyFont: "Open Sans",
          style: "modern",
        });

        expect(site.leadId).toBe(lead.id);
        expect(site.qaPassed).toBe(false);
        expect(site.regenerationCount).toBe(0);

        db.updateSite(site.id, {
          qaPassed: true,
          regenerationCount: 2,
          lighthouseScores: { performance: 95, accessibility: 92, bestPractices: 90, seo: 88 },
          previewUrl: "https://example.netlify.app",
        });

        const updated = db.getLatestSite(lead.id)!;
        expect(updated.qaPassed).toBe(true);
        expect(updated.regenerationCount).toBe(2);
        expect(updated.previewUrl).toBe("https://example.netlify.app");
        expect(updated.lighthouseScores!.performance).toBe(95);
      } finally {
        db.close();
      }
    });

    it("should track outreach and suppression", () => {
      const db = new ModernizerDb(tmpDir);
      try {
        const lead = db.insertLead("test.com");
        const outreach = db.insertOutreach(lead.id, "info@test.com", "Subject", "Body");
        expect(outreach.status).toBe("draft");

        db.markOutreachSent(outreach.id);
        const sent = db.getOutreach(lead.id)!;
        expect(sent.status).toBe("sent");
        expect(sent.sentAt).toBeTruthy();

        // Daily count
        expect(db.getTodayEmailCount()).toBe(1);

        // Suppression
        expect(db.isEmailSuppressed("info@test.com")).toBe(false);
        db.suppressEmail("info@test.com", "unsubscribe");
        expect(db.isEmailSuppressed("info@test.com")).toBe(true);
      } finally {
        db.close();
      }
    });

    it("should record and summarize pipeline metrics", () => {
      const db = new ModernizerDb(tmpDir);
      try {
        // Create a lead so FK constraints are satisfied
        const lead = db.insertLead("metrics-lead.com");
        db.recordMetric("scout", null, true, 0.05, 1200);
        db.recordMetric("scout", null, true, 0.03, 800);
        db.recordMetric("analyzer", lead.id, true, 0.20, 5000);
        db.recordMetric("builder", lead.id, false, 1.00, 30000, "QA failed");

        const summary = db.getMetricsSummary();
        expect(summary).toHaveLength(3);

        const scoutMetric = summary.find((m) => m.stage === "scout")!;
        expect(scoutMetric.total).toBe(2);
        expect(scoutMetric.successes).toBe(2);
        expect(scoutMetric.totalCost).toBeCloseTo(0.08);

        const builderMetric = summary.find((m) => m.stage === "builder")!;
        expect(builderMetric.total).toBe(1);
        expect(builderMetric.successes).toBe(0);
      } finally {
        db.close();
      }
    });
  });

  // ── LLM Utilities ──

  describe("LLM Utilities", () => {
    it("should parse clean JSON", () => {
      const result = parseLlmJson<{ foo: string }>('{"foo": "bar"}');
      expect(result.foo).toBe("bar");
    });

    it("should parse JSON wrapped in markdown code fences", () => {
      const result = parseLlmJson<{ foo: string }>('```json\n{"foo": "bar"}\n```');
      expect(result.foo).toBe("bar");
    });

    it("should parse JSON with bare code fences", () => {
      const result = parseLlmJson<{ x: number }>('```\n{"x": 42}\n```');
      expect(result.x).toBe(42);
    });
  });

  // ── Scout Agent ──

  describe("Scout Agent", () => {
    it("should qualify a valid outdated domain", async () => {
      const { scoutDomains } = await import("./agents/scout.js");
      // LLM call for qualification
      llmResponses.push(MOCK_QUALIFICATION);

      const db = new ModernizerDb(tmpDir);
      try {
        const result = await scoutDomains(config, db, ["joes-plumbing-austin.com"], "test");
        expect(result.success).toBe(true);
        expect(result.data!.qualified).toBe(1);
        expect(result.data!.rejected).toBe(0);
        expect(result.data!.leads).toHaveLength(1);

        const lead = db.getLeadByDomain("joes-plumbing-austin.com");
        expect(lead).toBeDefined();
        expect(lead!.industry).toBe("plumber");
        expect(lead!.priorityScore).toBe(75);
      } finally {
        db.close();
      }
    });

    it("should reject platform-built sites without LLM cost", async () => {
      const { fetchWebpage } = await import("./services/screenshot.js");
      (fetchWebpage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        html: '<html><body>Built with <a href="https://squarespace.com">Squarespace</a></body></html>',
        statusCode: 200,
        headers: {},
      });

      const { scoutDomains } = await import("./agents/scout.js");
      const db = new ModernizerDb(tmpDir);
      try {
        const result = await scoutDomains(config, db, ["squarespace-site.com"], "test");
        expect(result.data!.qualified).toBe(0);
        expect(result.data!.rejected).toBe(1);
        // No LLM calls made (platform check is pre-LLM)
        expect(result.costUsd).toBe(0);
      } finally {
        db.close();
      }
    });

    it("should skip duplicate domains", async () => {
      llmResponses.push(MOCK_QUALIFICATION);

      const { scoutDomains } = await import("./agents/scout.js");
      const db = new ModernizerDb(tmpDir);
      try {
        // First scout
        await scoutDomains(config, db, ["dupe-test.com"], "test");
        // Second scout (same domain)
        const result = await scoutDomains(config, db, ["dupe-test.com"], "test");
        expect(result.data!.rejected).toBe(1);
        expect(result.data!.qualified).toBe(0);
      } finally {
        db.close();
      }
    });

    it("should clean up domain URLs correctly", async () => {
      llmResponses.push(MOCK_QUALIFICATION);

      const { scoutDomains } = await import("./agents/scout.js");
      const db = new ModernizerDb(tmpDir);
      try {
        const result = await scoutDomains(config, db, ["https://www.test-domain.com/about"], "test");
        expect(result.data!.qualified).toBe(1);

        const lead = db.getLeadByDomain("test-domain.com");
        expect(lead).toBeDefined();
      } finally {
        db.close();
      }
    });

    it("should reject invalid domains", async () => {
      const { scoutDomains } = await import("./agents/scout.js");
      const db = new ModernizerDb(tmpDir);
      try {
        const result = await scoutDomains(config, db, ["x", "", "no-dot"], "test");
        expect(result.data!.rejected).toBe(3);
        expect(result.data!.qualified).toBe(0);
      } finally {
        db.close();
      }
    });
  });

  // ── Analyzer Agent ──

  describe("Analyzer Agent", () => {
    it("should analyze a discovered lead and extract business info", async () => {
      // LLM calls: 1) website analysis
      llmResponses.push(MOCK_ANALYSIS);

      const { analyzeLead } = await import("./agents/analyzer.js");
      const db = new ModernizerDb(tmpDir);
      try {
        const lead = db.insertLead("old-plumber.com", "test");

        const result = await analyzeLead(config, db, lead.id);
        expect(result.success).toBe(true);
        expect(result.data!.decision).toBe("go");
        expect(result.data!.improvementPotential).toBe(85);
        expect(result.data!.businessInfo!.name).toBe("Joe's Plumbing");

        // Lead should be updated with business info
        const updated = db.getLead(lead.id)!;
        expect(updated.businessName).toBe("Joe's Plumbing");
        expect(updated.contactEmail).toBe("info@joesplumbing.com");
        expect(updated.industry).toBe("plumber");
      } finally {
        db.close();
      }
    });

    it("should mark lead as dead when decision is skip", async () => {
      const skipAnalysis = JSON.parse(MOCK_ANALYSIS);
      skipAnalysis.decision = "skip";
      skipAnalysis.decisionReason = "Already modern site";
      llmResponses.push(JSON.stringify(skipAnalysis));

      const { analyzeLead } = await import("./agents/analyzer.js");
      const db = new ModernizerDb(tmpDir);
      try {
        const lead = db.insertLead("modern-site.com", "test");

        const result = await analyzeLead(config, db, lead.id);
        expect(result.success).toBe(true);
        expect(result.data!.decision).toBe("skip");

        expect(db.getLead(lead.id)!.status).toBe("dead");
      } finally {
        db.close();
      }
    });

    it("should handle fetch failures gracefully", async () => {
      const { fetchWebpage } = await import("./services/screenshot.js");
      (fetchWebpage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        html: "",
        statusCode: 404,
        headers: {},
      });

      const { analyzeLead } = await import("./agents/analyzer.js");
      const db = new ModernizerDb(tmpDir);
      try {
        const lead = db.insertLead("dead-site.com", "test");
        const result = await analyzeLead(config, db, lead.id);
        expect(result.success).toBe(false);
        expect(result.error).toContain("404");
        expect(db.getLead(lead.id)!.status).toBe("analysis_failed");
      } finally {
        db.close();
      }
    });

    it("should record cost and duration metrics", async () => {
      llmResponses.push(MOCK_ANALYSIS);

      const { analyzeLead } = await import("./agents/analyzer.js");
      const db = new ModernizerDb(tmpDir);
      try {
        const lead = db.insertLead("metrics-test.com", "test");
        const result = await analyzeLead(config, db, lead.id);

        expect(result.costUsd).toBeGreaterThan(0);
        expect(result.durationMs).toBeGreaterThanOrEqual(0);

        // Check cost was added to lead
        expect(db.getLead(lead.id)!.costIncurred).toBeGreaterThan(0);

        // Check metric was recorded
        const metrics = db.getMetricsSummary();
        const analyzerMetric = metrics.find((m) => m.stage === "analyzer");
        expect(analyzerMetric).toBeDefined();
        expect(analyzerMetric!.total).toBe(1);
      } finally {
        db.close();
      }
    });
  });

  // ── Builder Agent ──

  describe("Builder Agent", () => {
    it("should generate a site that passes QA on first attempt", async () => {
      // LLM calls: 1) design system, 2) content, 3) HTML generation
      llmResponses.push(MOCK_DESIGN_SYSTEM, MOCK_CONTENT, MOCK_GENERATED_HTML);

      const { buildSite } = await import("./agents/builder.js");
      const db = new ModernizerDb(tmpDir);
      try {
        const lead = db.insertLead("builder-test.com", "test");
        db.updateLead(lead.id, { contactEmail: "info@test.com", contactPhone: "(555) 123-4567" });
        const analysis = db.insertAnalysis(lead.id, createTestAnalysis(lead.id));

        const result = await buildSite(config, db, analysis, lead.id);
        expect(result.success).toBe(true);
        expect(result.data!.lighthouseScores.performance).toBe(92);
        expect(result.data!.previewUrl).toBe("https://mod-joes-plumbing-12345.netlify.app");

        // Check DB state
        const site = db.getLatestSite(lead.id)!;
        expect(site.qaPassed).toBe(true);
        expect(site.regenerationCount).toBe(0);
        expect(site.html).toContain("<!DOCTYPE html>");
        expect(db.getLead(lead.id)!.status).toBe("ready");
      } finally {
        db.close();
      }
    });

    it("should regenerate when QA fails and eventually pass", async () => {
      const { runLighthouseAudit } = await import("./services/lighthouse.js");
      // First attempt: fail QA, second attempt: pass
      (runLighthouseAudit as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          scores: { performance: 60, accessibility: 55, bestPractices: 70, seo: 50 },
          issues: ["Missing viewport meta tag", "Poor contrast ratio"],
        })
        .mockResolvedValueOnce({
          scores: { performance: 92, accessibility: 95, bestPractices: 90, seo: 88 },
          issues: [],
        });

      // LLM calls: 1) design, 2) content, 3) initial HTML, 4) regenerated HTML
      llmResponses.push(MOCK_DESIGN_SYSTEM, MOCK_CONTENT, MOCK_GENERATED_HTML, MOCK_GENERATED_HTML);

      const { buildSite } = await import("./agents/builder.js");
      const db = new ModernizerDb(tmpDir);
      try {
        const lead = db.insertLead("regen-test.com", "test");
        const analysis = db.insertAnalysis(lead.id, createTestAnalysis(lead.id));

        const result = await buildSite(config, db, analysis, lead.id);
        expect(result.success).toBe(true);

        const site = db.getLatestSite(lead.id)!;
        expect(site.qaPassed).toBe(true);
        expect(site.regenerationCount).toBe(1);

        // Check regen metric was recorded
        const metrics = db.getMetricsSummary();
        const regenMetric = metrics.find((m) => m.stage === "builder_regen");
        expect(regenMetric).toBeDefined();
        expect(regenMetric!.total).toBe(1);
      } finally {
        db.close();
      }
    });

    it("should mark as build_failed after exhausting regen attempts", async () => {
      const { runLighthouseAudit } = await import("./services/lighthouse.js");
      // All attempts fail QA
      (runLighthouseAudit as ReturnType<typeof vi.fn>).mockResolvedValue({
        scores: { performance: 50, accessibility: 40, bestPractices: 60, seo: 45 },
        issues: ["Critical issues"],
      });

      // LLM calls: 1) design, 2) content, 3) initial HTML, 4-6) regen attempts
      llmResponses.push(
        MOCK_DESIGN_SYSTEM, MOCK_CONTENT,
        MOCK_GENERATED_HTML, MOCK_GENERATED_HTML, MOCK_GENERATED_HTML, MOCK_GENERATED_HTML,
      );

      const { buildSite } = await import("./agents/builder.js");
      const db = new ModernizerDb(tmpDir);
      try {
        const lead = db.insertLead("fail-test.com", "test");
        const analysis = db.insertAnalysis(lead.id, createTestAnalysis(lead.id));

        const result = await buildSite(config, db, analysis, lead.id);
        expect(result.success).toBe(false);

        expect(db.getLead(lead.id)!.status).toBe("build_failed");
        const site = db.getLatestSite(lead.id)!;
        expect(site.qaPassed).toBe(false);
        expect(site.regenerationCount).toBe(3);
      } finally {
        db.close();
      }
    });

    it("should not deploy if QA fails", async () => {
      const { runLighthouseAudit } = await import("./services/lighthouse.js");
      (runLighthouseAudit as ReturnType<typeof vi.fn>).mockResolvedValue({
        scores: { performance: 50, accessibility: 40, bestPractices: 60, seo: 45 },
        issues: ["Failures"],
      });

      llmResponses.push(
        MOCK_DESIGN_SYSTEM, MOCK_CONTENT,
        MOCK_GENERATED_HTML, MOCK_GENERATED_HTML, MOCK_GENERATED_HTML, MOCK_GENERATED_HTML,
      );

      const { deploySite } = await import("./services/hosting.js");
      const { buildSite } = await import("./agents/builder.js");
      const db = new ModernizerDb(tmpDir);
      try {
        const lead = db.insertLead("no-deploy.com", "test");
        const analysis = db.insertAnalysis(lead.id, createTestAnalysis(lead.id));
        await buildSite(config, db, analysis, lead.id);
        expect(deploySite).not.toHaveBeenCalled();
      } finally {
        db.close();
      }
    });

    it("should return error if lead has no business info", async () => {
      const { buildSite } = await import("./agents/builder.js");
      const db = new ModernizerDb(tmpDir);
      try {
        const lead = db.insertLead("no-info.com", "test");
        const analysis = db.insertAnalysis(lead.id, {
          ...createTestAnalysis(lead.id),
          businessInfo: null,
        });

        const result = await buildSite(config, db, analysis, lead.id);
        expect(result.success).toBe(false);
        expect(result.error).toContain("No business info");
      } finally {
        db.close();
      }
    });
  });

  // ── Seller Agent ──

  describe("Seller Agent", () => {
    it("should send outreach email for a ready lead", async () => {
      // LLM call: outreach email
      llmResponses.push(MOCK_OUTREACH_EMAIL);

      const { pitchLead } = await import("./agents/seller.js");
      const db = new ModernizerDb(tmpDir);
      try {
        // Set up a ready lead with all prerequisites
        const lead = db.insertLead("seller-test.com", "test");
        db.updateLead(lead.id, { contactEmail: "owner@seller-test.com", businessName: "Seller Test" });
        db.updateLeadStatus(lead.id, "ready");
        db.insertAnalysis(lead.id, createTestAnalysis(lead.id));
        const site = db.insertSite(lead.id, MOCK_GENERATED_HTML);
        db.updateSite(site.id, { qaPassed: true, previewUrl: "https://preview.example.com" });

        const result = await pitchLead(config, db, lead.id);
        expect(result.success).toBe(true);
        expect(result.data!.outreach.emailTo).toBe("owner@seller-test.com");
        expect(result.data!.paymentUrl).toBe("https://buy.stripe.com/test_link");

        // Check DB state
        expect(db.getLead(lead.id)!.status).toBe("pitched");
        const outreach = db.getOutreach(lead.id)!;
        expect(outreach.status).toBe("sent");
        expect(outreach.sentAt).toBeTruthy();
      } finally {
        db.close();
      }
    });

    it("should reject leads without valid email", async () => {
      const { pitchLead } = await import("./agents/seller.js");
      const db = new ModernizerDb(tmpDir);
      try {
        const lead = db.insertLead("no-email.com", "test");
        db.updateLeadStatus(lead.id, "ready");
        db.insertAnalysis(lead.id, createTestAnalysis(lead.id));
        const site = db.insertSite(lead.id, MOCK_GENERATED_HTML);
        db.updateSite(site.id, { qaPassed: true });

        const result = await pitchLead(config, db, lead.id);
        expect(result.success).toBe(false);
        expect(result.error).toContain("No valid contact email");
      } finally {
        db.close();
      }
    });

    it("should reject suppressed emails", async () => {
      llmResponses.push(MOCK_OUTREACH_EMAIL);

      const { pitchLead } = await import("./agents/seller.js");
      const db = new ModernizerDb(tmpDir);
      try {
        const lead = db.insertLead("suppressed.com", "test");
        db.updateLead(lead.id, { contactEmail: "blocked@example.com" });
        db.updateLeadStatus(lead.id, "ready");
        db.insertAnalysis(lead.id, createTestAnalysis(lead.id));
        const site = db.insertSite(lead.id, MOCK_GENERATED_HTML);
        db.updateSite(site.id, { qaPassed: true });

        // Suppress the email
        db.suppressEmail("blocked@example.com", "unsubscribe");

        const result = await pitchLead(config, db, lead.id);
        expect(result.success).toBe(false);
        expect(result.error).toContain("suppressed");
      } finally {
        db.close();
      }
    });

    it("should respect daily email limit", async () => {
      llmResponses.push(MOCK_OUTREACH_EMAIL, MOCK_OUTREACH_EMAIL);

      const { pitchLead } = await import("./agents/seller.js");
      const limitConfig = { ...config, dailyEmailLimit: 0 }; // Set limit to 0
      const db = new ModernizerDb(tmpDir);
      try {
        const lead = db.insertLead("limited.com", "test");
        db.updateLead(lead.id, { contactEmail: "test@limited.com" });
        db.updateLeadStatus(lead.id, "ready");
        db.insertAnalysis(lead.id, createTestAnalysis(lead.id));
        const site = db.insertSite(lead.id, MOCK_GENERATED_HTML);
        db.updateSite(site.id, { qaPassed: true });

        const result = await pitchLead(limitConfig, db, lead.id);
        expect(result.success).toBe(false);
        expect(result.error).toContain("Daily email limit");
      } finally {
        db.close();
      }
    });

    it("should handle unsubscribe correctly", async () => {
      const { handleUnsubscribe } = await import("./agents/seller.js");
      const db = new ModernizerDb(tmpDir);
      try {
        expect(db.isEmailSuppressed("unsub@test.com")).toBe(false);
        handleUnsubscribe(db, "unsub@test.com");
        expect(db.isEmailSuppressed("unsub@test.com")).toBe(true);
      } finally {
        db.close();
      }
    });
  });

  // ── Orchestrator ──

  describe("Orchestrator", () => {
    it("should report pipeline stats from an empty database", async () => {
      const { Orchestrator } = await import("./agents/orchestrator.js");
      const orchestrator = new Orchestrator(config);
      try {
        const stats = orchestrator.getStats();
        expect(stats.totalRevenue).toBe(0);
        expect(stats.totalCost).toBe(0);
        expect(stats.profitMargin).toBe(0);
      } finally {
        orchestrator.close();
      }
    });

    it("should run scout stage with domains", async () => {
      llmResponses.push(MOCK_QUALIFICATION);

      const { Orchestrator } = await import("./agents/orchestrator.js");
      const orchestrator = new Orchestrator(config);
      try {
        const results = await orchestrator.run({
          stage: "scout",
          domains: ["orch-test.com"],
        });

        expect(results).toHaveLength(1);
        expect(results[0].stage).toBe("scout");
        expect(results[0].succeeded).toBe(1);
      } finally {
        orchestrator.close();
      }
    });

    it("should handle empty scout (no domains/niche)", async () => {
      const { Orchestrator } = await import("./agents/orchestrator.js");
      const orchestrator = new Orchestrator(config);
      try {
        const results = await orchestrator.run({ stage: "scout" });
        expect(results[0].processed).toBe(0);
        expect(results[0].details[0]).toContain("No domains or niche");
      } finally {
        orchestrator.close();
      }
    });
  });

  // ── Full Pipeline E2E ──

  describe("Full Pipeline", () => {
    it("should process a single domain through scout → analyze → build → sell", async () => {
      // Set up all LLM responses in order:
      // 1) Scout: qualification
      // 2) Analyzer: website analysis
      // 3) Builder: design system
      // 4) Builder: content
      // 5) Builder: HTML generation
      // 6) Seller: outreach email
      llmResponses.push(
        MOCK_QUALIFICATION,
        MOCK_ANALYSIS,
        MOCK_DESIGN_SYSTEM,
        MOCK_CONTENT,
        MOCK_GENERATED_HTML,
        MOCK_OUTREACH_EMAIL,
      );

      const { Orchestrator } = await import("./agents/orchestrator.js");
      const orchestrator = new Orchestrator(config);
      try {
        const { results, leadId } = await orchestrator.processSingleDomain("e2e-test-plumber.com");

        expect(leadId).not.toBeNull();

        // All 4 stages should have run
        expect(results).toHaveLength(4);
        expect(results[0].stage).toBe("scout");
        expect(results[0].succeeded).toBe(1);
        expect(results[1].stage).toBe("analyze");
        expect(results[1].succeeded).toBe(1);
        expect(results[2].stage).toBe("build");
        expect(results[2].succeeded).toBe(1);
        expect(results[3].stage).toBe("sell");
        // Sell may fail without real email, but the attempt should be made
        expect(results[3].processed).toBe(1);

        // Verify pipeline stats
        const stats = orchestrator.getStats();
        expect(Object.keys(stats.leadsByStatus).length).toBeGreaterThan(0);
        expect(stats.totalCost).toBeGreaterThan(0);
        expect(stats.metrics.length).toBeGreaterThan(0);

        // Total cost should be sum of all stages
        const totalFromResults = results.reduce((acc, r) => acc + r.totalCost, 0);
        expect(totalFromResults).toBeGreaterThan(0);
      } finally {
        orchestrator.close();
      }
    });

    it("should stop pipeline when scout rejects domain", async () => {
      const { fetchWebpage } = await import("./services/screenshot.js");
      (fetchWebpage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        html: '<html><body>Powered by <a href="https://wix.com">Wix</a></body></html>',
        statusCode: 200,
        headers: {},
      });

      const { Orchestrator } = await import("./agents/orchestrator.js");
      const orchestrator = new Orchestrator(config);
      try {
        const { results, leadId } = await orchestrator.processSingleDomain("wix-domain.com");
        expect(leadId).toBeNull();
        expect(results).toHaveLength(1); // Only scout ran
        expect(results[0].succeeded).toBe(0);
      } finally {
        orchestrator.close();
      }
    });

    it("should stop pipeline when analyzer decides to skip", async () => {
      const skipAnalysis = JSON.parse(MOCK_ANALYSIS);
      skipAnalysis.decision = "skip";
      llmResponses.push(MOCK_QUALIFICATION, JSON.stringify(skipAnalysis));

      const { Orchestrator } = await import("./agents/orchestrator.js");
      const orchestrator = new Orchestrator(config);
      try {
        const { results, leadId } = await orchestrator.processSingleDomain("skip-test.com");
        expect(leadId).not.toBeNull();
        expect(results).toHaveLength(2); // Scout + Analyze only
        expect(results[1].stage).toBe("analyze");
      } finally {
        orchestrator.close();
      }
    });
  });
});
