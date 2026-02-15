/**
 * Plugin configuration resolver.
 * Merges defaults with plugin config and environment variables.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import type { ClawdbotPluginApi } from "../../../src/plugins/types.js";
import type { ModernizerConfig, RouterConfig, ModelTierId, ModelTierConfig } from "./types.js";
import { DEFAULT_CONFIG, DEFAULT_ROUTER_CONFIG } from "./types.js";

function parseFloatEnv(name: string): number | undefined {
  const val = process.env[name];
  if (!val) return undefined;
  const num = parseFloat(val);
  return Number.isFinite(num) ? num : undefined;
}

export function resolveConfig(api: ClawdbotPluginApi): ModernizerConfig {
  const pluginCfg = (api.pluginConfig ?? {}) as Partial<ModernizerConfig>;

  return {
    dataDir: pluginCfg.dataDir ?? join(homedir(), ".clawdbot", "website-modernizer"),
    anthropicApiKey: pluginCfg.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY,
    stripeSecretKey: pluginCfg.stripeSecretKey ?? process.env.STRIPE_SECRET_KEY,
    sendgridApiKey: pluginCfg.sendgridApiKey ?? process.env.SENDGRID_API_KEY,
    fromEmail: pluginCfg.fromEmail ?? process.env.MODERNIZER_FROM_EMAIL,
    fromName: pluginCfg.fromName ?? process.env.MODERNIZER_FROM_NAME,
    hostingProvider: pluginCfg.hostingProvider ?? (process.env.HOSTING_PROVIDER as "vercel" | "netlify" | undefined),
    hostingToken: pluginCfg.hostingToken ?? process.env.HOSTING_TOKEN,
    maxConcurrentBuilds: pluginCfg.maxConcurrentBuilds ?? DEFAULT_CONFIG.maxConcurrentBuilds,
    maxRegenAttempts: pluginCfg.maxRegenAttempts ?? DEFAULT_CONFIG.maxRegenAttempts,
    minLighthouseScore: pluginCfg.minLighthouseScore ?? DEFAULT_CONFIG.minLighthouseScore,
    dailyEmailLimit: pluginCfg.dailyEmailLimit ?? DEFAULT_CONFIG.dailyEmailLimit,
    priceUsd: pluginCfg.priceUsd ?? DEFAULT_CONFIG.priceUsd,
    maxMonthlyCostUsd: pluginCfg.maxMonthlyCostUsd ?? parseFloatEnv("MODERNIZER_MAX_MONTHLY_COST") ?? DEFAULT_CONFIG.maxMonthlyCostUsd,
    maxPerLeadCostUsd: pluginCfg.maxPerLeadCostUsd ?? parseFloatEnv("MODERNIZER_MAX_PER_LEAD_COST") ?? DEFAULT_CONFIG.maxPerLeadCostUsd,
    router: resolveRouterConfig(pluginCfg),
  };
}

/**
 * Resolve router config from plugin config and environment variables.
 * Model tiers can be overridden via env vars like MODERNIZER_MODEL_TIER0=provider:model
 * Budget cap can be overridden via MODERNIZER_ROUTER_BUDGET_CAP.
 */
function resolveRouterConfig(pluginCfg: Partial<ModernizerConfig>): RouterConfig {
  const base = pluginCfg.router ?? DEFAULT_ROUTER_CONFIG;
  const result: RouterConfig = {
    ...base,
    budget: { ...base.budget },
    models: { ...base.models },
    routingRules: [...base.routingRules],
    escalationPolicy: { ...base.escalationPolicy },
    qualityGates: { ...base.qualityGates },
  };

  // Override budget cap from env
  const budgetCap = parseFloatEnv("MODERNIZER_ROUTER_BUDGET_CAP");
  if (budgetCap) result.budget.monthlyCapUsd = budgetCap;

  // Override individual model tiers from env (format: "provider:model" or "provider:model:baseUrl")
  const tierEnvMap: Record<ModelTierId, string> = {
    tier0_fast: "MODERNIZER_MODEL_TIER0",
    reasoning_default: "MODERNIZER_MODEL_REASONING",
    agent_orchestrator: "MODERNIZER_MODEL_ORCHESTRATOR",
    long_context: "MODERNIZER_MODEL_LONG_CONTEXT",
    coder: "MODERNIZER_MODEL_CODER",
  };

  for (const [tier, envKey] of Object.entries(tierEnvMap)) {
    const val = process.env[envKey];
    if (val) {
      const parsed = parseModelEnv(val);
      if (parsed) {
        result.models[tier as ModelTierId] = { ...result.models[tier as ModelTierId], ...parsed };
      }
    }
  }

  return result;
}

/** Parse a model env var in format "provider:model" or "provider:model:baseUrl". */
function parseModelEnv(val: string): Partial<ModelTierConfig> | null {
  const parts = val.split(":");
  if (parts.length < 2) return null;
  const provider = parts[0] as ModelTierConfig["provider"];
  if (!["anthropic", "openrouter", "openai_compatible"].includes(provider)) return null;
  const model = parts.slice(1, parts.length > 2 ? -1 : undefined).join(":");
  const baseUrl = parts.length > 2 ? parts[parts.length - 1] : undefined;
  return { provider, model, ...(baseUrl ? { baseUrl } : {}) };
}
