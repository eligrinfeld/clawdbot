/**
 * Model Router: intelligent multi-model routing with budget management,
 * escalation policies, and quality gates.
 *
 * Routes LLM calls to the cheapest-adequate model tier based on task type,
 * context size, risk level, and budget state. Escalates to more capable
 * models only when signals indicate it's needed.
 */

import type { ModernizerConfig, RouterConfig, TaskType, ModelTierId, ModelTierConfig, RoutingRule, BudgetState } from "../types.js";
import type { LlmResult, LlmCallOptions } from "./llm.js";
import { callProvider } from "./providers.js";
import { parseLlmJson } from "./llm.js";

// ── Budget Manager ──

export class BudgetManager {
  private monthSpend = 0;
  private minuteTokens: { timestamp: number; count: number }[] = [];

  constructor(
    private budget: RouterConfig["budget"],
    initialMonthSpend = 0,
  ) {
    this.monthSpend = initialMonthSpend;
  }

  /** Record a completed LLM call's cost and tokens. */
  record(costUsd: number, totalTokens: number): void {
    this.monthSpend += costUsd;
    this.minuteTokens.push({ timestamp: Date.now(), count: totalTokens });
    // Prune entries older than 1 minute
    const cutoff = Date.now() - 60_000;
    this.minuteTokens = this.minuteTokens.filter((e) => e.timestamp > cutoff);
  }

  /** Current month-to-date spend. */
  getMonthSpend(): number {
    return this.monthSpend;
  }

  /** Get budget utilization as a fraction (0-1+). */
  getUtilization(): number {
    return this.monthSpend / this.budget.monthlyCapUsd;
  }

  /** Get the current throttle level based on spend. */
  getThrottleLevel(): "normal" | "soft" | "hard" | "stopped" {
    const util = this.getUtilization();
    if (util >= 1.0) return "stopped";
    if (util >= this.budget.hardThrottlePct) return "hard";
    if (util >= this.budget.softThrottlePct) return "soft";
    return "normal";
  }

  /** Check if we're within the per-minute token rate limit. */
  isWithinRateLimit(): boolean {
    const cutoff = Date.now() - 60_000;
    const recentTokens = this.minuteTokens
      .filter((e) => e.timestamp > cutoff)
      .reduce((sum, e) => sum + e.count, 0);
    return recentTokens < this.budget.tokenRateLimit.tokensPerMinute;
  }

  /** Get current budget state for logging/decisions. */
  getState(): BudgetState {
    return {
      monthSpendUsd: this.monthSpend,
      monthlyCapUsd: this.budget.monthlyCapUsd,
      utilization: this.getUtilization(),
      throttleLevel: this.getThrottleLevel(),
      withinRateLimit: this.isWithinRateLimit(),
    };
  }

  /** Check if a specific model tier is allowed under current budget constraints. */
  isTierAllowed(tier: ModelTierId): boolean {
    const level = this.getThrottleLevel();
    if (level === "stopped") return false;
    if (level === "hard") {
      // Under hard throttle: only tier0 and reasoning_default
      return tier === "tier0_fast" || tier === "reasoning_default";
    }
    if (level === "soft") {
      // Under soft throttle: disable long_context except emergencies
      return tier !== "long_context";
    }
    return true;
  }
}

// ── Model Router ──

export interface RoutedCallOptions {
  taskType: TaskType;
  /** Override max tokens for this call. */
  maxTokens?: number;
  /** Override temperature for this call. */
  temperature?: number;
  /** System prompt. */
  systemPrompt?: string;
  /** Base64-encoded image for vision tasks. */
  imageBase64?: string;
  /** MIME type for the image. */
  imageMimeType?: string;
  /** Risk level affects model selection (high-risk → more capable model). */
  riskLevel?: "low" | "medium" | "high";
  /** Context token count estimate for routing decisions. */
  contextTokens?: number;
  /** Signal that previous attempts failed (triggers escalation). */
  previousFailures?: number;
  /** Force a specific model tier (bypasses routing). */
  forceTier?: ModelTierId;
  /** Whether to require JSON output validation. */
  requireJson?: boolean;
}

export interface RoutedResult extends LlmResult {
  /** Which model tier was selected by the router. */
  tier: ModelTierId;
  /** The task type that was routed. */
  taskType: TaskType;
  /** Whether the call was escalated from the default tier. */
  wasEscalated: boolean;
  /** Budget state after this call. */
  budgetState: BudgetState;
}

/**
 * Find the matching routing rule for a task type.
 */
function findRoutingRule(rules: RoutingRule[], taskType: TaskType): RoutingRule | undefined {
  return rules.find((r) => r.taskType === taskType);
}

/**
 * Determine which model tier to use based on routing rules, budget state,
 * risk level, context size, and failure history.
 */
export function selectModelTier(
  routerConfig: RouterConfig,
  budgetManager: BudgetManager,
  opts: RoutedCallOptions,
): { tier: ModelTierId; maxTokens: number; temperature: number; wasEscalated: boolean } {
  // Force tier if specified
  if (opts.forceTier) {
    const rule = findRoutingRule(routerConfig.routingRules, opts.taskType);
    return {
      tier: opts.forceTier,
      maxTokens: opts.maxTokens ?? rule?.maxTokens ?? 1024,
      temperature: opts.temperature ?? rule?.temperature ?? 0.3,
      wasEscalated: false,
    };
  }

  const rule = findRoutingRule(routerConfig.routingRules, opts.taskType);
  if (!rule) {
    // Default to reasoning tier if no rule found
    return {
      tier: "reasoning_default",
      maxTokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.3,
      wasEscalated: false,
    };
  }

  let tier = rule.modelTier;
  let wasEscalated = false;

  // Escalation: check failure-based triggers
  if (rule.escalateIf && opts.previousFailures) {
    if (rule.escalateIf.retriesGte && opts.previousFailures >= rule.escalateIf.retriesGte) {
      tier = escalateTier(tier);
      wasEscalated = true;
    }
  }

  // Escalation: high-risk tasks get bumped up
  if (opts.riskLevel === "high" && (tier === "tier0_fast")) {
    tier = "reasoning_default";
    wasEscalated = true;
  }

  // Escalation: large context → long_context tier
  if (opts.contextTokens && opts.contextTokens > 120_000) {
    // Apply "context tax" - prefer summarize+reason unless long_context is needed
    if (tier !== "long_context" && opts.contextTokens > 200_000) {
      tier = "long_context";
      wasEscalated = true;
    }
  }

  // Budget throttle: downgrade if budget is tight
  if (!budgetManager.isTierAllowed(tier)) {
    tier = downgradeTier(tier);
    wasEscalated = false; // downgrade, not escalation
  }

  return {
    tier,
    maxTokens: opts.maxTokens ?? rule.maxTokens,
    temperature: opts.temperature ?? rule.temperature ?? 0.3,
    wasEscalated,
  };
}

/** Escalate to the next more capable tier. */
function escalateTier(current: ModelTierId): ModelTierId {
  const chain: ModelTierId[] = ["tier0_fast", "reasoning_default", "coder", "agent_orchestrator", "long_context"];
  const idx = chain.indexOf(current);
  if (idx >= 0 && idx < chain.length - 1) return chain[idx + 1];
  return current;
}

/** Downgrade to the next cheaper tier. */
function downgradeTier(current: ModelTierId): ModelTierId {
  const chain: ModelTierId[] = ["long_context", "agent_orchestrator", "coder", "reasoning_default", "tier0_fast"];
  const idx = chain.indexOf(current);
  if (idx >= 0 && idx < chain.length - 1) return chain[idx + 1];
  return "tier0_fast";
}

/**
 * Main entry point: route an LLM call through the model router.
 *
 * Selects the appropriate model tier, calls the provider, tracks budget,
 * and handles JSON validation with escalation retries.
 */
export async function routedLlm(
  config: ModernizerConfig,
  budgetManager: BudgetManager,
  prompt: string,
  opts: RoutedCallOptions,
): Promise<RoutedResult> {
  const routerConfig = config.router;
  const selection = selectModelTier(routerConfig, budgetManager, opts);

  // Check budget: refuse if stopped
  const budgetState = budgetManager.getState();
  if (budgetState.throttleLevel === "stopped") {
    throw new Error(`Monthly budget exhausted ($${budgetState.monthSpendUsd.toFixed(2)} / $${budgetState.monthlyCapUsd}). Refusing LLM call.`);
  }

  // Rate limit check: wait if over per-minute limit
  if (!budgetManager.isWithinRateLimit()) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  // Resolve model config for the selected tier
  const modelConfig = routerConfig.models[selection.tier];
  if (!modelConfig) {
    throw new Error(`No model configured for tier '${selection.tier}'`);
  }

  // Build call options for the provider
  const callOpts: LlmCallOptions = {
    model: modelConfig.model,
    maxTokens: selection.maxTokens,
    temperature: selection.temperature,
    systemPrompt: opts.systemPrompt,
    imageBase64: opts.imageBase64,
    imageMimeType: opts.imageMimeType,
  };

  // Make the call
  let result: LlmResult;
  let currentTier = selection.tier;
  let wasEscalated = selection.wasEscalated;

  try {
    result = await callProvider(config, modelConfig, prompt, callOpts);
  } catch (err) {
    // On failure, try escalation chain from the escalation policy
    const escalationChain = routerConfig.escalationPolicy.onSchemaFailure;
    let lastError = err as Error;

    for (const nextTier of escalationChain) {
      if (nextTier === currentTier) continue;
      if (!budgetManager.isTierAllowed(nextTier)) continue;

      const nextModel = routerConfig.models[nextTier];
      if (!nextModel) continue;

      try {
        result = await callProvider(config, nextModel, prompt, { ...callOpts, model: nextModel.model });
        currentTier = nextTier;
        wasEscalated = true;
        break;
      } catch (e) {
        lastError = e as Error;
      }
    }

    if (!result!) {
      throw lastError;
    }
  }

  // Track budget
  const totalTokens = result.inputTokens + result.outputTokens;
  budgetManager.record(result.costUsd, totalTokens);

  // JSON quality gate: if JSON required, validate and retry with escalation
  if (opts.requireJson) {
    try {
      parseLlmJson(result.text);
    } catch {
      // JSON parse failed → escalate and retry once
      const nextTier = escalateTier(currentTier);
      if (nextTier !== currentTier && budgetManager.isTierAllowed(nextTier)) {
        const nextModel = routerConfig.models[nextTier];
        if (nextModel) {
          const retryResult = await callProvider(config, nextModel, prompt, { ...callOpts, model: nextModel.model });
          budgetManager.record(retryResult.costUsd, retryResult.inputTokens + retryResult.outputTokens);
          currentTier = nextTier;
          wasEscalated = true;
          result = retryResult;
        }
      }
    }
  }

  return {
    ...result,
    tier: currentTier,
    taskType: opts.taskType,
    wasEscalated,
    budgetState: budgetManager.getState(),
  };
}

/**
 * Create a BudgetManager initialized with current month's spend from DB.
 */
export function createBudgetManager(config: RouterConfig, currentMonthSpend = 0): BudgetManager {
  return new BudgetManager(config.budget, currentMonthSpend);
}
