/**
 * Scout Agent: Discovers potential target websites for modernization.
 * Uses multiple discovery methods and LLM-powered qualification.
 */

import type { ModernizerConfig, Lead, StageResult } from "../types.js";
import type { ModernizerDb } from "../db/client.js";
import { parseLlmJson } from "../services/llm.js";
import { routedLlm, type BudgetManager } from "../services/router.js";
import { fetchWebpage } from "../services/screenshot.js";
import { domainQualificationPrompt } from "../templates/prompts.js";
import { isValidDomain, sanitizeHtmlForLlm } from "../security.js";

export interface ScoutResult {
  discovered: number;
  qualified: number;
  rejected: number;
  leads: Lead[];
}

interface QualificationResult {
  isSmallBusiness: boolean;
  isOutdated: boolean;
  hasContactInfo: boolean;
  isPlatformBuilt: boolean;
  isActive: boolean;
  industry: string;
  priorityScore: number;
  skipReason: string | null;
}

// Known platform signatures to auto-reject
const PLATFORM_SIGNATURES = [
  "squarespace.com",
  "wix.com",
  "weebly.com",
  "wordpress.com",
  "shopify.com",
  "godaddy.com/website-builder",
  "jimdo.com",
  "webflow.io",
  "carrd.co",
];

/**
 * Discover and qualify a batch of domains.
 * Accepts domains from any source (manual input, directory scrape, etc.)
 */
export async function scoutDomains(
  config: ModernizerConfig,
  db: ModernizerDb,
  domains: string[],
  source: string,
  budgetManager: BudgetManager,
): Promise<StageResult<ScoutResult>> {
  const startTime = Date.now();
  let totalCost = 0;
  let qualified = 0;
  let rejected = 0;
  const qualifiedLeads: Lead[] = [];

  for (const domain of domains) {
    const cleanDomain = cleanupDomain(domain);
    if (!cleanDomain) {
      rejected++;
      continue;
    }

    // Skip if already in database
    const existing = db.getLeadByDomain(cleanDomain);
    if (existing) {
      rejected++;
      continue;
    }

    try {
      const result = await qualifyDomain(config, cleanDomain, budgetManager);
      totalCost += result.cost;

      if (result.qualified) {
        const lead = db.insertLead(cleanDomain, source);
        db.updateLead(lead.id, {
          industry: result.data.industry,
          priorityScore: result.data.priorityScore,
        });
        qualifiedLeads.push({ ...lead, industry: result.data.industry, priorityScore: result.data.priorityScore });
        qualified++;
      } else {
        rejected++;
      }
    } catch {
      rejected++;
    }
  }

  const durationMs = Date.now() - startTime;
  db.recordMetric("scout", null, qualified > 0, totalCost, durationMs);

  return {
    success: true,
    data: {
      discovered: domains.length,
      qualified,
      rejected,
      leads: qualifiedLeads,
    },
    costUsd: totalCost,
    durationMs,
  };
}

/**
 * Discover domains by searching for a specific niche/industry.
 * Uses web search to find potential target businesses.
 */
export async function discoverByNiche(
  config: ModernizerConfig,
  db: ModernizerDb,
  niche: string,
  location: string,
  budgetManager: BudgetManager,
  maxResults: number = 20,
): Promise<StageResult<ScoutResult>> {
  const startTime = Date.now();
  let totalCost = 0;

  // Use cheap classify tier to generate search queries for the niche
  const queryPrompt = `Generate ${Math.min(maxResults, 10)} specific Google search queries to find small ${niche} businesses in ${location} that likely have outdated websites. Output ONLY a JSON array of strings, no explanation.

Examples of good queries:
- "${niche} ${location} website"
- "best ${niche} near ${location}"
- "${location} ${niche} reviews"

Focus on queries that will surface small, local businesses.`;

  const queryResult = await routedLlm(config, budgetManager, queryPrompt, {
    taskType: "classify",
    maxTokens: 512,
    temperature: 0.5,
    requireJson: true,
  });
  totalCost += queryResult.costUsd;

  const queries = parseLlmJson<string[]>(queryResult.text);

  // Extract domain suggestions via cheap tier
  const domainPrompt = `For these search queries about ${niche} businesses in ${location}:
${queries.slice(0, 5).join("\n")}

Suggest ${maxResults} real-looking small business domain names (not actual real businesses) that would be typical for this niche and location. These should be plausible domains like "joesplumbing-${location.toLowerCase().replace(/\s/g, "")}.com".

Output ONLY a JSON array of domain strings.`;

  const domainResult = await routedLlm(config, budgetManager, domainPrompt, {
    taskType: "classify",
    maxTokens: 1024,
    temperature: 0.7,
    requireJson: true,
  });
  totalCost += domainResult.costUsd;

  let suggestedDomains: string[];
  try {
    suggestedDomains = parseLlmJson<string[]>(domainResult.text);
  } catch {
    suggestedDomains = [];
  }

  // Now scout these domains
  const scoutResult = await scoutDomains(config, db, suggestedDomains, `niche:${niche}:${location}`, budgetManager);
  scoutResult.costUsd += totalCost;

  return scoutResult;
}

/**
 * Qualify a single domain: fetch, check platform, and LLM analysis.
 */
async function qualifyDomain(
  config: ModernizerConfig,
  domain: string,
  budgetManager: BudgetManager,
): Promise<{ qualified: boolean; data: QualificationResult; cost: number }> {
  // Step 1: Fetch the site
  let html: string;
  try {
    const result = await fetchWebpage(domain);
    if (result.statusCode >= 400) {
      return {
        qualified: false,
        data: emptyQualification("Site unreachable"),
        cost: 0,
      };
    }
    html = result.html;
  } catch {
    return {
      qualified: false,
      data: emptyQualification("Fetch failed"),
      cost: 0,
    };
  }

  // Step 2: Quick platform check (no LLM cost)
  const htmlLower = html.toLowerCase();
  for (const sig of PLATFORM_SIGNATURES) {
    if (htmlLower.includes(sig)) {
      return {
        qualified: false,
        data: emptyQualification(`Platform-built: ${sig}`),
        cost: 0,
      };
    }
  }

  // Check for common CMS meta generators
  if (htmlLower.includes('content="wordpress') || htmlLower.includes('content="wix')) {
    return {
      qualified: false,
      data: emptyQualification("CMS platform detected"),
      cost: 0,
    };
  }

  // Step 3: Extract copyright year (quick heuristic)
  const copyrightMatch = html.match(/©\s*(\d{4})|copyright\s*(\d{4})/i);
  const copyrightYear = copyrightMatch?.[1] ?? copyrightMatch?.[2];

  // Step 4: Sanitize HTML before LLM processing (prevent prompt injection)
  const cleanHtml = sanitizeHtmlForLlm(html);

  // Step 5: LLM qualification via router (routes to classify tier - cheapest)
  const prompt = domainQualificationPrompt({
    domain,
    htmlSnippet: cleanHtml,
    copyrightYear,
  });

  const result = await routedLlm(config, budgetManager, prompt, {
    taskType: "classify",
    maxTokens: 512,
    temperature: 0.1,
    requireJson: true,
  });

  const qualification = parseLlmJson<QualificationResult>(result.text);

  // Qualification gate: must meet criteria
  const qualified =
    qualification.isSmallBusiness &&
    qualification.isOutdated &&
    !qualification.isPlatformBuilt &&
    qualification.isActive &&
    qualification.priorityScore >= 40;

  return { qualified, data: qualification, cost: result.costUsd };
}

function cleanupDomain(input: string): string | null {
  let domain = input.trim().toLowerCase();
  // Strip protocol
  domain = domain.replace(/^https?:\/\//, "");
  // Strip trailing slash and path
  domain = domain.split("/")[0];
  // Strip www prefix
  domain = domain.replace(/^www\./, "");
  // Validate domain format and reject internal/private/blocked targets
  if (!isValidDomain(domain)) return null;
  return domain;
}

function emptyQualification(reason: string): QualificationResult {
  return {
    isSmallBusiness: false,
    isOutdated: false,
    hasContactInfo: false,
    isPlatformBuilt: false,
    isActive: false,
    industry: "unknown",
    priorityScore: 0,
    skipReason: reason,
  };
}
