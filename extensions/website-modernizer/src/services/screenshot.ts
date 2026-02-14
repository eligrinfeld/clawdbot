/**
 * Screenshot service: captures website screenshots via Playwright.
 * Falls back to a simulated screenshot if Playwright is unavailable.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

export interface ScreenshotResult {
  path: string;
  base64: string;
  width: number;
  height: number;
}

/**
 * Take a screenshot of a URL using Playwright.
 * Falls back to returning an empty result if Playwright is not installed.
 */
export async function takeScreenshot(url: string, outputDir: string): Promise<ScreenshotResult | null> {
  mkdirSync(outputDir, { recursive: true });
  const filename = `screenshot-${Date.now()}.png`;
  const outputPath = join(outputDir, filename);

  try {
    // Dynamic import: Playwright may not be installed
    const pw = await import("playwright-core");

    const browser = await pw.chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-gpu"],
    });

    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();

      await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
      // Wait for any lazy content
      await page.waitForTimeout(1000);

      const buffer = await page.screenshot({
        path: outputPath,
        fullPage: true,
        type: "png",
      });

      return {
        path: outputPath,
        base64: buffer.toString("base64"),
        width: 1280,
        height: 800,
      };
    } finally {
      await browser.close();
    }
  } catch {
    // Playwright not available or page failed to load
    return null;
  }
}

/**
 * Take a screenshot of a local HTML file.
 */
export async function screenshotHtml(html: string, outputDir: string): Promise<ScreenshotResult | null> {
  mkdirSync(outputDir, { recursive: true });
  const filename = `screenshot-${Date.now()}.png`;
  const outputPath = join(outputDir, filename);

  try {
    const pw = await import("playwright-core");
    const browser = await pw.chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-gpu"],
    });

    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: "networkidle", timeout: 30_000 });
      await page.waitForTimeout(500);

      const buffer = await page.screenshot({
        path: outputPath,
        fullPage: true,
        type: "png",
      });

      return {
        path: outputPath,
        base64: buffer.toString("base64"),
        width: 1280,
        height: 800,
      };
    } finally {
      await browser.close();
    }
  } catch {
    return null;
  }
}

/**
 * Fetch HTML content from a URL.
 */
export async function fetchWebpage(url: string): Promise<{ html: string; statusCode: number; headers: Record<string, string> }> {
  const fullUrl = url.startsWith("http") ? url : `https://${url}`;
  const response = await fetch(fullUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ModernizerBot/1.0)",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });

  const html = await response.text();
  const headers: Record<string, string> = {};
  response.headers.forEach((v, k) => { headers[k] = v; });

  return { html, statusCode: response.status, headers };
}
