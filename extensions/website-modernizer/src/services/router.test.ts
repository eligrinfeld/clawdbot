/**
 * Tests for the model router: budget management, tier selection,
 * escalation policies, throttling, and quality gates.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { BudgetManager, selectModelTier, routedLlm, createBudgetManager } from "./router.js";
import { DEFAULT_ROUTER_CONFIG } from "../types.js";
import type { RouterConfig, ModernizerConfig, BudgetState, ModelTierId } from "../types.js";

// ── Test helpers ──

function makeConfig(overrides: Partial<RouterConfig> = {}): RouterConfig {
  return {
    ...DEFAULT_ROUTER_CONFIG,
    ...overrides,
    budget: { ...DEFAULT_ROUTER_CONFIG.budget, ...(overrides.budget ?? {}) },
    models: { ...DEFAULT_ROUTER_CONFIG.models, ...(overrides.models ?? {}) },
  };
}

function makeBudgetManager(
  opts: { monthlyCapUsd?: number; initialSpend?: number; softPct?: number; hardPct?: number } = {},
): BudgetManager {
  const config = makeConfig({
    budget: {
      monthlyCapUsd: opts.monthlyCapUsd ?? 200,
      softThrottlePct: opts.softPct ?? 0.70,
      hardThrottlePct: opts.hardPct ?? 0.90,
      tokenRateLimit: { tokensPerMinute: 120_000, burstTokens: 300_000 },
    },
  });
  return new BudgetManager(config.budget, opts.initialSpend ?? 0);
}

// ── BudgetManager Tests ──

describe("BudgetManager", () => {
  it("starts with zero spend", () => {
    const bm = makeBudgetManager();
    expect(bm.getMonthSpend()).toBe(0);
    expect(bm.getUtilization()).toBe(0);
    expect(bm.getThrottleLevel()).toBe("normal");
  });

  it("starts with initial spend", () => {
    const bm = makeBudgetManager({ initialSpend: 50 });
    expect(bm.getMonthSpend()).toBe(50);
    expect(bm.getUtilization()).toBe(0.25);
  });

  it("records cost and tokens", () => {
    const bm = makeBudgetManager();
    bm.record(10, 5000);
    expect(bm.getMonthSpend()).toBe(10);
    bm.record(5, 3000);
    expect(bm.getMonthSpend()).toBe(15);
  });

  describe("throttle levels", () => {
    it("returns normal below soft threshold", () => {
      const bm = makeBudgetManager({ monthlyCapUsd: 200, initialSpend: 100 });
      expect(bm.getThrottleLevel()).toBe("normal");
    });

    it("returns soft at 70% utilization", () => {
      const bm = makeBudgetManager({ monthlyCapUsd: 200, initialSpend: 140 });
      expect(bm.getThrottleLevel()).toBe("soft");
    });

    it("returns hard at 90% utilization", () => {
      const bm = makeBudgetManager({ monthlyCapUsd: 200, initialSpend: 180 });
      expect(bm.getThrottleLevel()).toBe("hard");
    });

    it("returns stopped at 100% utilization", () => {
      const bm = makeBudgetManager({ monthlyCapUsd: 200, initialSpend: 200 });
      expect(bm.getThrottleLevel()).toBe("stopped");
    });

    it("returns stopped above 100% utilization", () => {
      const bm = makeBudgetManager({ monthlyCapUsd: 200, initialSpend: 250 });
      expect(bm.getThrottleLevel()).toBe("stopped");
    });
  });

  describe("tier allowlisting", () => {
    it("allows all tiers under normal throttle", () => {
      const bm = makeBudgetManager({ initialSpend: 50 });
      expect(bm.isTierAllowed("tier0_fast")).toBe(true);
      expect(bm.isTierAllowed("reasoning_default")).toBe(true);
      expect(bm.isTierAllowed("agent_orchestrator")).toBe(true);
      expect(bm.isTierAllowed("long_context")).toBe(true);
      expect(bm.isTierAllowed("coder")).toBe(true);
    });

    it("disables long_context under soft throttle", () => {
      const bm = makeBudgetManager({ initialSpend: 150 });
      expect(bm.getThrottleLevel()).toBe("soft");
      expect(bm.isTierAllowed("tier0_fast")).toBe(true);
      expect(bm.isTierAllowed("reasoning_default")).toBe(true);
      expect(bm.isTierAllowed("long_context")).toBe(false);
      expect(bm.isTierAllowed("coder")).toBe(true);
    });

    it("only allows tier0 and reasoning under hard throttle", () => {
      const bm = makeBudgetManager({ initialSpend: 185 });
      expect(bm.getThrottleLevel()).toBe("hard");
      expect(bm.isTierAllowed("tier0_fast")).toBe(true);
      expect(bm.isTierAllowed("reasoning_default")).toBe(true);
      expect(bm.isTierAllowed("agent_orchestrator")).toBe(false);
      expect(bm.isTierAllowed("long_context")).toBe(false);
      expect(bm.isTierAllowed("coder")).toBe(false);
    });

    it("blocks all tiers when stopped", () => {
      const bm = makeBudgetManager({ initialSpend: 200 });
      expect(bm.getThrottleLevel()).toBe("stopped");
      expect(bm.isTierAllowed("tier0_fast")).toBe(false);
      expect(bm.isTierAllowed("reasoning_default")).toBe(false);
    });
  });

  describe("rate limiting", () => {
    it("allows calls within rate limit", () => {
      const bm = makeBudgetManager();
      bm.record(1, 1000);
      expect(bm.isWithinRateLimit()).toBe(true);
    });

    it("blocks calls exceeding per-minute token limit", () => {
      const bm = makeBudgetManager();
      // Exceed 120k tokens in one minute
      bm.record(1, 130_000);
      expect(bm.isWithinRateLimit()).toBe(false);
    });
  });

  describe("budget state snapshot", () => {
    it("returns complete state object", () => {
      const bm = makeBudgetManager({ monthlyCapUsd: 200, initialSpend: 100 });
      const state = bm.getState();
      expect(state).toEqual({
        monthSpendUsd: 100,
        monthlyCapUsd: 200,
        utilization: 0.5,
        throttleLevel: "normal",
        withinRateLimit: true,
      });
    });
  });
});

// ── selectModelTier Tests ──

describe("selectModelTier", () => {
  let routerConfig: RouterConfig;
  let budgetManager: BudgetManager;

  beforeEach(() => {
    routerConfig = makeConfig();
    budgetManager = makeBudgetManager();
  });

  it("routes classify tasks to tier0_fast", () => {
    const result = selectModelTier(routerConfig, budgetManager, { taskType: "classify" });
    expect(result.tier).toBe("tier0_fast");
    expect(result.maxTokens).toBe(256);
    expect(result.wasEscalated).toBe(false);
  });

  it("routes extract_structured to tier0_fast", () => {
    const result = selectModelTier(routerConfig, budgetManager, { taskType: "extract_structured" });
    expect(result.tier).toBe("tier0_fast");
    expect(result.maxTokens).toBe(800);
  });

  it("routes reason tasks to reasoning_default", () => {
    const result = selectModelTier(routerConfig, budgetManager, { taskType: "reason" });
    expect(result.tier).toBe("reasoning_default");
    expect(result.maxTokens).toBe(1400);
  });

  it("routes code_write to coder tier", () => {
    const result = selectModelTier(routerConfig, budgetManager, { taskType: "code_write" });
    expect(result.tier).toBe("coder");
    expect(result.maxTokens).toBe(2400);
  });

  it("routes copy_outreach to tier0_fast", () => {
    const result = selectModelTier(routerConfig, budgetManager, { taskType: "copy_outreach" });
    expect(result.tier).toBe("tier0_fast");
  });

  it("routes long_context to long_context tier", () => {
    const result = selectModelTier(routerConfig, budgetManager, { taskType: "long_context" });
    expect(result.tier).toBe("long_context");
  });

  it("routes safety_compliance to reasoning_default", () => {
    const result = selectModelTier(routerConfig, budgetManager, { taskType: "safety_compliance" });
    expect(result.tier).toBe("reasoning_default");
  });

  it("defaults to reasoning_default for unknown task types", () => {
    const result = selectModelTier(routerConfig, budgetManager, { taskType: "unknown_task" as any });
    expect(result.tier).toBe("reasoning_default");
  });

  describe("force tier override", () => {
    it("uses forced tier regardless of task type", () => {
      const result = selectModelTier(routerConfig, budgetManager, {
        taskType: "classify",
        forceTier: "coder",
      });
      expect(result.tier).toBe("coder");
      expect(result.wasEscalated).toBe(false);
    });
  });

  describe("maxTokens and temperature overrides", () => {
    it("respects maxTokens override", () => {
      const result = selectModelTier(routerConfig, budgetManager, {
        taskType: "classify",
        maxTokens: 1000,
      });
      expect(result.maxTokens).toBe(1000);
    });

    it("respects temperature override", () => {
      const result = selectModelTier(routerConfig, budgetManager, {
        taskType: "classify",
        temperature: 0.9,
      });
      expect(result.temperature).toBe(0.9);
    });
  });

  describe("escalation", () => {
    it("escalates plan tasks after retry threshold", () => {
      const result = selectModelTier(routerConfig, budgetManager, {
        taskType: "plan",
        previousFailures: 2,
      });
      expect(result.wasEscalated).toBe(true);
      // reasoning_default escalates to coder
      expect(result.tier).not.toBe("reasoning_default");
    });

    it("does not escalate plan tasks below retry threshold", () => {
      const result = selectModelTier(routerConfig, budgetManager, {
        taskType: "plan",
        previousFailures: 1,
      });
      expect(result.tier).toBe("reasoning_default");
      expect(result.wasEscalated).toBe(false);
    });

    it("escalates tier0 tasks to reasoning_default for high risk", () => {
      const result = selectModelTier(routerConfig, budgetManager, {
        taskType: "classify",
        riskLevel: "high",
      });
      expect(result.tier).toBe("reasoning_default");
      expect(result.wasEscalated).toBe(true);
    });

    it("does not escalate for medium risk", () => {
      const result = selectModelTier(routerConfig, budgetManager, {
        taskType: "classify",
        riskLevel: "medium",
      });
      expect(result.tier).toBe("tier0_fast");
      expect(result.wasEscalated).toBe(false);
    });

    it("escalates to long_context for very large context", () => {
      const result = selectModelTier(routerConfig, budgetManager, {
        taskType: "reason",
        contextTokens: 250_000,
      });
      expect(result.tier).toBe("long_context");
      expect(result.wasEscalated).toBe(true);
    });

    it("does not escalate for moderate context size", () => {
      const result = selectModelTier(routerConfig, budgetManager, {
        taskType: "reason",
        contextTokens: 50_000,
      });
      expect(result.tier).toBe("reasoning_default");
      expect(result.wasEscalated).toBe(false);
    });
  });

  describe("budget-constrained downgrade", () => {
    it("downgrades long_context when soft throttled", () => {
      const bm = makeBudgetManager({ initialSpend: 150 });
      expect(bm.getThrottleLevel()).toBe("soft");
      const result = selectModelTier(routerConfig, bm, {
        taskType: "long_context",
      });
      // long_context not allowed under soft → downgrade
      expect(result.tier).not.toBe("long_context");
    });

    it("downgrades coder when hard throttled", () => {
      const bm = makeBudgetManager({ initialSpend: 185 });
      expect(bm.getThrottleLevel()).toBe("hard");
      const result = selectModelTier(routerConfig, bm, {
        taskType: "code_write",
      });
      // coder not allowed under hard → downgrade to reasoning or tier0
      expect(["tier0_fast", "reasoning_default"]).toContain(result.tier);
    });

    it("uses tier0 when hard throttled for classify tasks", () => {
      const bm = makeBudgetManager({ initialSpend: 185 });
      const result = selectModelTier(routerConfig, bm, {
        taskType: "classify",
      });
      expect(result.tier).toBe("tier0_fast");
    });
  });
});

// ── createBudgetManager Tests ──

describe("createBudgetManager", () => {
  it("creates with default config", () => {
    const bm = createBudgetManager(DEFAULT_ROUTER_CONFIG);
    expect(bm.getMonthSpend()).toBe(0);
    expect(bm.getState().monthlyCapUsd).toBe(200);
  });

  it("creates with initial month spend", () => {
    const bm = createBudgetManager(DEFAULT_ROUTER_CONFIG, 75);
    expect(bm.getMonthSpend()).toBe(75);
  });
});

// ── DEFAULT_ROUTER_CONFIG Tests ──

describe("DEFAULT_ROUTER_CONFIG", () => {
  it("has $200 monthly budget cap", () => {
    expect(DEFAULT_ROUTER_CONFIG.budget.monthlyCapUsd).toBe(200);
  });

  it("has 5 model tiers configured", () => {
    const tiers = Object.keys(DEFAULT_ROUTER_CONFIG.models);
    expect(tiers).toContain("tier0_fast");
    expect(tiers).toContain("reasoning_default");
    expect(tiers).toContain("agent_orchestrator");
    expect(tiers).toContain("long_context");
    expect(tiers).toContain("coder");
    expect(tiers).toHaveLength(5);
  });

  it("has routing rules for all task types", () => {
    const taskTypes = DEFAULT_ROUTER_CONFIG.routingRules.map((r) => r.taskType);
    expect(taskTypes).toContain("classify");
    expect(taskTypes).toContain("extract_structured");
    expect(taskTypes).toContain("reason");
    expect(taskTypes).toContain("plan");
    expect(taskTypes).toContain("code_write");
    expect(taskTypes).toContain("copy_outreach");
    expect(taskTypes).toContain("long_context");
    expect(taskTypes).toContain("safety_compliance");
  });

  it("uses DeepSeek for reasoning_default", () => {
    expect(DEFAULT_ROUTER_CONFIG.models.reasoning_default.model).toContain("deepseek");
  });

  it("uses Kimi for agent_orchestrator", () => {
    expect(DEFAULT_ROUTER_CONFIG.models.agent_orchestrator.model).toContain("kimi");
  });

  it("uses MiniMax for long_context", () => {
    expect(DEFAULT_ROUTER_CONFIG.models.long_context.model).toContain("minimax");
  });

  it("uses Devstral for coder", () => {
    expect(DEFAULT_ROUTER_CONFIG.models.coder.model).toContain("devstral");
  });

  it("uses Anthropic Haiku for tier0_fast", () => {
    expect(DEFAULT_ROUTER_CONFIG.models.tier0_fast.model).toContain("haiku");
    expect(DEFAULT_ROUTER_CONFIG.models.tier0_fast.provider).toBe("anthropic");
  });

  it("sets escalation policy with 3-tier schema failure chain", () => {
    expect(DEFAULT_ROUTER_CONFIG.escalationPolicy.onSchemaFailure).toHaveLength(3);
  });

  it("sets 70% soft throttle and 90% hard throttle", () => {
    expect(DEFAULT_ROUTER_CONFIG.budget.softThrottlePct).toBe(0.70);
    expect(DEFAULT_ROUTER_CONFIG.budget.hardThrottlePct).toBe(0.90);
  });

  it("sets 120k tokens/minute rate limit", () => {
    expect(DEFAULT_ROUTER_CONFIG.budget.tokenRateLimit.tokensPerMinute).toBe(120_000);
  });

  it("plan task has escalation triggers", () => {
    const planRule = DEFAULT_ROUTER_CONFIG.routingRules.find((r) => r.taskType === "plan");
    expect(planRule?.escalateIf).toBeDefined();
    expect(planRule?.escalateIf?.retriesGte).toBe(2);
  });

  it("quality gates require JSON for structured output tasks", () => {
    expect(DEFAULT_ROUTER_CONFIG.qualityGates.requireJsonSchemaFor).toContain("extract_structured");
    expect(DEFAULT_ROUTER_CONFIG.qualityGates.requireJsonSchemaFor).toContain("plan");
  });

  it("quality gates require evidence for outreach", () => {
    expect(DEFAULT_ROUTER_CONFIG.qualityGates.requireEvidenceFor).toContain("copy_outreach");
  });
});

// ── Task Type → Pipeline Stage Mapping ──

describe("pipeline task type mapping", () => {
  let routerConfig: RouterConfig;
  let bm: BudgetManager;

  beforeEach(() => {
    routerConfig = makeConfig();
    bm = makeBudgetManager();
  });

  it("scout uses classify tier (cheapest)", () => {
    const result = selectModelTier(routerConfig, bm, { taskType: "classify" });
    expect(result.tier).toBe("tier0_fast");
  });

  it("analyzer uses reason tier for deep analysis", () => {
    const result = selectModelTier(routerConfig, bm, { taskType: "reason" });
    expect(result.tier).toBe("reasoning_default");
  });

  it("builder uses coder tier for HTML generation", () => {
    const result = selectModelTier(routerConfig, bm, { taskType: "code_write" });
    expect(result.tier).toBe("coder");
  });

  it("seller outreach uses tier0 by default, upgrades on high risk", () => {
    const normal = selectModelTier(routerConfig, bm, { taskType: "copy_outreach" });
    expect(normal.tier).toBe("tier0_fast");

    const highRisk = selectModelTier(routerConfig, bm, {
      taskType: "copy_outreach",
      riskLevel: "high",
    });
    expect(highRisk.tier).toBe("reasoning_default");
    expect(highRisk.wasEscalated).toBe(true);
  });
});

// ── Budget Governor Scenarios ──

describe("budget governor scenarios", () => {
  it("pipeline under $200 stays fully operational", () => {
    const bm = makeBudgetManager({ monthlyCapUsd: 200, initialSpend: 80 });
    expect(bm.getThrottleLevel()).toBe("normal");
    expect(bm.isTierAllowed("long_context")).toBe(true);
    expect(bm.isTierAllowed("agent_orchestrator")).toBe(true);
  });

  it("at 70% budget, disables MiniMax (long_context)", () => {
    const bm = makeBudgetManager({ monthlyCapUsd: 200, initialSpend: 141 });
    expect(bm.getThrottleLevel()).toBe("soft");
    expect(bm.isTierAllowed("long_context")).toBe(false);
    expect(bm.isTierAllowed("reasoning_default")).toBe(true);
    expect(bm.isTierAllowed("coder")).toBe(true);
  });

  it("at 90% budget, caps to tier0 and reasoning only", () => {
    const bm = makeBudgetManager({ monthlyCapUsd: 200, initialSpend: 181 });
    expect(bm.getThrottleLevel()).toBe("hard");
    expect(bm.isTierAllowed("long_context")).toBe(false);
    expect(bm.isTierAllowed("agent_orchestrator")).toBe(false);
    expect(bm.isTierAllowed("coder")).toBe(false);
    expect(bm.isTierAllowed("tier0_fast")).toBe(true);
    expect(bm.isTierAllowed("reasoning_default")).toBe(true);
  });

  it("at 100% budget, refuses all calls", () => {
    const bm = makeBudgetManager({ monthlyCapUsd: 200, initialSpend: 200 });
    expect(bm.getThrottleLevel()).toBe("stopped");
    expect(bm.isTierAllowed("tier0_fast")).toBe(false);
  });

  it("progressive spend tracking", () => {
    const bm = makeBudgetManager({ monthlyCapUsd: 200 });

    // Early: all good
    bm.record(50, 10000);
    expect(bm.getThrottleLevel()).toBe("normal");

    // Mid: still ok
    bm.record(50, 10000);
    expect(bm.getThrottleLevel()).toBe("normal");

    // Approaching soft limit
    bm.record(41, 10000);
    expect(bm.getThrottleLevel()).toBe("soft");
    expect(bm.isTierAllowed("long_context")).toBe(false);

    // Approaching hard limit
    bm.record(40, 10000);
    expect(bm.getThrottleLevel()).toBe("hard");
    expect(bm.isTierAllowed("coder")).toBe(false);

    // Over budget
    bm.record(20, 10000);
    expect(bm.getThrottleLevel()).toBe("stopped");
  });
});
