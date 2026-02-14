/**
 * Lighthouse audit service using Chrome/Chromium headless.
 * Runs performance, accessibility, best-practices, and SEO audits.
 */

import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { LighthouseScores } from "../types.js";

const execFileAsync = promisify(execFile);

export interface LighthouseResult {
  scores: LighthouseScores;
  issues: string[];
  rawJson?: Record<string, unknown>;
}

/**
 * Run a Lighthouse audit on a URL or local HTML file.
 * Tries npx lighthouse first, falls back to a simplified fetch-based check.
 */
export async function runLighthouseAudit(target: string): Promise<LighthouseResult> {
  // If target is an HTML string (starts with <!DOCTYPE or <html), write to temp file
  let url = target;
  let tempFile: string | undefined;
  if (target.trimStart().startsWith("<")) {
    const tmpDir = join(tmpdir(), "modernizer-lighthouse");
    mkdirSync(tmpDir, { recursive: true });
    tempFile = join(tmpDir, `audit-${Date.now()}.html`);
    writeFileSync(tempFile, target, "utf-8");
    url = `file://${tempFile}`;
  }

  try {
    return await runLighthouseCli(url);
  } catch {
    // Fallback: basic HTML analysis if Lighthouse CLI unavailable
    return analyzeHtmlQuality(target.trimStart().startsWith("<") ? target : "");
  } finally {
    if (tempFile) {
      try { unlinkSync(tempFile); } catch { /* ignore */ }
    }
  }
}

async function runLighthouseCli(url: string): Promise<LighthouseResult> {
  const outputPath = join(tmpdir(), `lh-report-${Date.now()}.json`);

  try {
    await execFileAsync("npx", [
      "lighthouse",
      url,
      "--output=json",
      `--output-path=${outputPath}`,
      "--chrome-flags=--headless --no-sandbox --disable-gpu",
      "--only-categories=performance,accessibility,best-practices,seo",
      "--quiet",
    ], { timeout: 60_000 });

    const raw = JSON.parse(readFileSync(outputPath, "utf-8")) as Record<string, unknown>;
    const categories = raw.categories as Record<string, { score: number }>;

    const scores: LighthouseScores = {
      performance: Math.round((categories.performance?.score ?? 0) * 100),
      accessibility: Math.round((categories.accessibility?.score ?? 0) * 100),
      bestPractices: Math.round((categories["best-practices"]?.score ?? 0) * 100),
      seo: Math.round((categories.seo?.score ?? 0) * 100),
    };

    // Extract top issues from audits
    const audits = raw.audits as Record<string, { score: number | null; title: string }> | undefined;
    const issues: string[] = [];
    if (audits) {
      for (const [, audit] of Object.entries(audits)) {
        if (audit.score !== null && audit.score < 0.5) {
          issues.push(audit.title);
        }
      }
    }

    return { scores, issues: issues.slice(0, 20), rawJson: raw };
  } finally {
    try { unlinkSync(outputPath); } catch { /* ignore */ }
  }
}

/**
 * Fallback HTML quality analysis when Lighthouse CLI is unavailable.
 * Checks for common quality indicators in the HTML source.
 */
function analyzeHtmlQuality(html: string): LighthouseResult {
  if (!html) {
    return {
      scores: { performance: 50, accessibility: 50, bestPractices: 50, seo: 50 },
      issues: ["Could not analyze: no HTML content available"],
    };
  }

  const issues: string[] = [];
  let perfScore = 80;
  let a11yScore = 80;
  let bpScore = 80;
  let seoScore = 80;

  // Performance checks
  if (!html.includes("tailwindcss") && !html.includes("cdn.tailwindcss.com")) {
    // Not a concern per se, but our generated sites should use it
  }
  if ((html.match(/<script/g) || []).length > 5) {
    perfScore -= 10;
    issues.push("Many script tags may slow loading");
  }
  if (html.includes("<img") && !html.includes("loading=")) {
    perfScore -= 5;
    issues.push("Images missing lazy loading attribute");
  }

  // Accessibility checks
  if (!html.includes("lang=")) {
    a11yScore -= 10;
    issues.push("Missing lang attribute on html element");
  }
  if (!html.includes("<meta name=\"viewport\"")) {
    a11yScore -= 10;
    seoScore -= 10;
    issues.push("Missing viewport meta tag");
  }
  if (!html.includes("alt=")) {
    a11yScore -= 15;
    issues.push("Images missing alt text");
  }
  if (!html.includes("aria-")) {
    a11yScore -= 5;
    issues.push("No ARIA attributes found");
  }
  if (!html.includes("skip") && !html.includes("Skip")) {
    a11yScore -= 5;
    issues.push("Missing skip-to-content link");
  }

  // Best practices
  if (!html.includes("<!DOCTYPE html>") && !html.includes("<!doctype html>")) {
    bpScore -= 10;
    issues.push("Missing DOCTYPE declaration");
  }
  if (!html.includes("<meta charset")) {
    bpScore -= 5;
    issues.push("Missing charset meta tag");
  }
  if (html.includes("http://") && !html.includes("http://localhost")) {
    bpScore -= 5;
    issues.push("Contains non-HTTPS URLs");
  }

  // SEO checks
  if (!html.includes("<title>") && !html.includes("<title ")) {
    seoScore -= 15;
    issues.push("Missing title tag");
  }
  if (!html.includes("<meta name=\"description\"")) {
    seoScore -= 10;
    issues.push("Missing meta description");
  }
  if (!html.includes("<h1")) {
    seoScore -= 10;
    issues.push("Missing h1 heading");
  }

  // Semantic HTML bonus
  const semanticTags = ["<header", "<nav", "<main", "<footer", "<section", "<article"];
  const semanticCount = semanticTags.filter((t) => html.includes(t)).length;
  if (semanticCount >= 4) {
    a11yScore = Math.min(100, a11yScore + 5);
    seoScore = Math.min(100, seoScore + 5);
  } else if (semanticCount === 0) {
    a11yScore -= 10;
    issues.push("No semantic HTML elements found");
  }

  return {
    scores: {
      performance: Math.max(0, Math.min(100, perfScore)),
      accessibility: Math.max(0, Math.min(100, a11yScore)),
      bestPractices: Math.max(0, Math.min(100, bpScore)),
      seo: Math.max(0, Math.min(100, seoScore)),
    },
    issues,
  };
}
