/**
 * LLM service: wraps Anthropic API calls with cost tracking and retries.
 * Used by all agents for structured JSON generation.
 */

import type { ModernizerConfig } from "../types.js";

export interface LlmCallOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  imageBase64?: string;
  imageMimeType?: string;
}

export interface LlmResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model: string;
}

// Approximate pricing per 1M tokens (input/output) for cost tracking
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-5-20250929": { input: 3, output: 15 },
  "claude-opus-4-5-20250929": { input: 15, output: 75 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
};

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING[DEFAULT_MODEL];
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

export async function callLlm(
  config: ModernizerConfig,
  prompt: string,
  opts: LlmCallOptions = {},
): Promise<LlmResult> {
  const apiKey = config.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("No Anthropic API key configured. Set anthropicApiKey in plugin config or ANTHROPIC_API_KEY env var.");

  const model = opts.model ?? DEFAULT_MODEL;
  const maxTokens = opts.maxTokens ?? 8192;

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
    max_tokens: maxTokens,
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
    throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
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

/** Parse JSON from LLM output, stripping markdown fences if present. */
export function parseLlmJson<T>(text: string): T {
  let cleaned = text.trim();
  // Strip markdown code fences
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  return JSON.parse(cleaned) as T;
}

/** Fetch with exponential backoff retry for transient errors. */
async function fetchWithRetry(url: string, init: RequestInit, maxRetries = 3): Promise<Response> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, init);
      // Retry on 429 (rate limit) and 5xx (server errors)
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
