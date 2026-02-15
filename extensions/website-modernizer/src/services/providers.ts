/**
 * Multi-provider LLM abstraction layer.
 *
 * Supports:
 * - Anthropic (direct API, Claude models)
 * - OpenRouter (gateway to DeepSeek, Kimi, MiniMax, etc.)
 * - Any OpenAI-compatible endpoint
 *
 * Each provider normalizes its response into a common LlmResult format.
 */

import type { ModernizerConfig, ModelTierConfig } from "../types.js";
import type { LlmCallOptions, LlmResult } from "./llm.js";

// Pricing per 1M tokens for cost tracking (input/output)
const KNOWN_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  "claude-sonnet-4-5-20250929": { input: 3, output: 15 },
  "claude-opus-4-5-20250929": { input: 15, output: 75 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
  // DeepSeek
  "deepseek/deepseek-r1": { input: 0.55, output: 2.19 },
  "deepseek/deepseek-chat": { input: 0.14, output: 0.28 },
  // Kimi / Moonshot
  "moonshotai/kimi-k2": { input: 0.6, output: 2.4 },
  // MiniMax
  "minimax/minimax-01": { input: 0.4, output: 1.1 },
  // Coding models
  "mistralai/devstral-small-2505": { input: 0.1, output: 0.3 },
  // Generic fallbacks
  "meta-llama/llama-3.3-70b-instruct": { input: 0.3, output: 0.3 },
};

// Default cost estimate for unknown models
const DEFAULT_PRICING = { input: 1, output: 3 };

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = KNOWN_PRICING[model] ?? DEFAULT_PRICING;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

/**
 * Resolve the API key for a model tier's provider.
 */
function resolveApiKey(config: ModernizerConfig, tierConfig: ModelTierConfig): string {
  // Check tier-specific env var first
  if (tierConfig.apiKeyEnv) {
    const key = process.env[tierConfig.apiKeyEnv];
    if (key) return key;
  }
  // Fall back to provider-specific defaults
  switch (tierConfig.provider) {
    case "anthropic":
      return config.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
    case "openrouter":
      return process.env.OPENROUTER_API_KEY ?? "";
    case "openai_compatible":
      return process.env.OPENAI_API_KEY ?? "";
  }
}

/**
 * Call an LLM provider and return a normalized result.
 * Routes to Anthropic or OpenAI-compatible (OpenRouter) format based on provider type.
 */
export async function callProvider(
  config: ModernizerConfig,
  tierConfig: ModelTierConfig,
  prompt: string,
  opts: LlmCallOptions,
): Promise<LlmResult> {
  const apiKey = resolveApiKey(config, tierConfig);
  if (!apiKey) {
    throw new Error(`No API key found for provider '${tierConfig.provider}' (model: ${tierConfig.model}). Set ${tierConfig.apiKeyEnv ?? "the appropriate env var"}.`);
  }

  if (tierConfig.provider === "anthropic") {
    return callAnthropic(apiKey, opts.model ?? tierConfig.model, prompt, opts);
  }
  // OpenRouter and openai_compatible both use OpenAI chat completions format
  const baseUrl = tierConfig.baseUrl ?? "https://openrouter.ai/api/v1";
  return callOpenAiCompatible(apiKey, baseUrl, opts.model ?? tierConfig.model, prompt, opts, tierConfig.provider);
}

/**
 * Call the Anthropic Messages API directly.
 */
async function callAnthropic(
  apiKey: string,
  model: string,
  prompt: string,
  opts: LlmCallOptions,
): Promise<LlmResult> {
  const content: unknown[] = [];
  if (opts.imageBase64 && opts.imageMimeType) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: opts.imageMimeType, data: opts.imageBase64 },
    });
  }
  content.push({ type: "text", text: prompt });

  const body = {
    model,
    max_tokens: opts.maxTokens ?? 8192,
    temperature: opts.temperature ?? 0.3,
    ...(opts.systemPrompt ? { system: opts.systemPrompt } : {}),
    messages: [{ role: "user", content }],
  };

  const response = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    content: { type: string; text: string }[];
    usage: { input_tokens: number; output_tokens: number };
    model: string;
  };

  const text = data.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");

  return {
    text,
    inputTokens: data.usage.input_tokens,
    outputTokens: data.usage.output_tokens,
    costUsd: estimateCost(model, data.usage.input_tokens, data.usage.output_tokens),
    model: data.model,
  };
}

/**
 * Call an OpenAI-compatible API (OpenRouter, direct OpenAI, etc.).
 */
async function callOpenAiCompatible(
  apiKey: string,
  baseUrl: string,
  model: string,
  prompt: string,
  opts: LlmCallOptions,
  provider: string,
): Promise<LlmResult> {
  const messages: unknown[] = [];
  if (opts.systemPrompt) {
    messages.push({ role: "system", content: opts.systemPrompt });
  }

  // Build user message content
  if (opts.imageBase64 && opts.imageMimeType) {
    messages.push({
      role: "user",
      content: [
        {
          type: "image_url",
          image_url: { url: `data:${opts.imageMimeType};base64,${opts.imageBase64}` },
        },
        { type: "text", text: prompt },
      ],
    });
  } else {
    messages.push({ role: "user", content: prompt });
  }

  const body = {
    model,
    messages,
    max_tokens: opts.maxTokens ?? 8192,
    temperature: opts.temperature ?? 0.3,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  // OpenRouter-specific headers
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://clawd.bot";
    headers["X-Title"] = "Clawdbot Website Modernizer";
  }

  const response = await fetchWithRetry(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${provider} API error ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens?: number };
    model: string;
  };

  const text = data.choices[0]?.message?.content ?? "";
  const inputTokens = data.usage?.prompt_tokens ?? 0;
  const outputTokens = data.usage?.completion_tokens ?? 0;

  return {
    text,
    inputTokens,
    outputTokens,
    costUsd: estimateCost(model, inputTokens, outputTokens),
    model: data.model ?? model,
  };
}

/** Fetch with exponential backoff retry for transient errors. */
async function fetchWithRetry(url: string, init: RequestInit, maxRetries = 3): Promise<Response> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.status === 429 || response.status >= 500) {
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }
      return response;
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError ?? new Error("Fetch failed after retries");
}
