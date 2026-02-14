/**
 * Plugin configuration resolver.
 * Merges defaults with plugin config and environment variables.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import type { ClawdbotPluginApi } from "../../../src/plugins/types.js";
import type { ModernizerConfig } from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";

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
  };
}
