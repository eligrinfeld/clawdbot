/** Core types for the website modernizer pipeline. */

export type LeadStatus =
  | "discovered"
  | "analyzing"
  | "analysis_failed"
  | "building"
  | "build_failed"
  | "ready"
  | "pitched"
  | "interested"
  | "sold"
  | "dead";

export type ConversionLikelihood = "low" | "medium" | "high";
export type EffortEstimate = "simple" | "medium" | "complex";
export type AnalysisDecision = "go" | "skip";
export type ReplySentiment = "interested" | "objection" | "question" | "negative" | "auto_reply";

export interface Lead {
  id: number;
  domain: string;
  status: LeadStatus;
  industry: string | null;
  location: string | null;
  businessName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  priorityScore: number;
  discoveredAt: string;
  updatedAt: string;
  costIncurred: number;
  source: string | null;
}

export interface LighthouseScores {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
}

export interface Analysis {
  id: number;
  leadId: number;
  lighthouseScores: LighthouseScores;
  mobileResponsive: boolean;
  designEra: string | null;
  contentSummary: string | null;
  businessInfo: BusinessInfo | null;
  improvementPotential: number;
  conversionLikelihood: ConversionLikelihood;
  effortRequired: EffortEstimate;
  decision: AnalysisDecision;
  decisionReason: string | null;
  keyImprovements: string[];
  riskFactors: string[];
  screenshotPath: string | null;
  analyzedAt: string;
}

export interface BusinessInfo {
  name: string;
  industry: string;
  services: string[];
  valuePropositions: string[];
  targetAudience: string;
  brandTone: string;
  location: string | null;
  phone: string | null;
  email: string | null;
}

export interface DesignSystem {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  neutralLight: string;
  neutralDark: string;
  headingFont: string;
  bodyFont: string;
  style: string;
}

export interface GeneratedSite {
  id: number;
  leadId: number;
  html: string;
  previewUrl: string | null;
  designSystem: DesignSystem | null;
  lighthouseScores: LighthouseScores | null;
  regenerationCount: number;
  qaPassed: boolean;
  generatedAt: string;
}

export interface OutreachRecord {
  id: number;
  leadId: number;
  emailTo: string;
  subject: string;
  body: string;
  sentAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  repliedAt: string | null;
  replyText: string | null;
  sentiment: ReplySentiment | null;
  status: "draft" | "sent" | "opened" | "clicked" | "replied" | "converted" | "dead";
}

export interface Sale {
  id: number;
  leadId: number;
  amount: number;
  stripePaymentId: string | null;
  paidAt: string | null;
  deliveredAt: string | null;
  supportUntil: string | null;
}

/** Config shape for the plugin. */
export interface ModernizerConfig {
  dataDir: string;
  anthropicApiKey?: string;
  stripeSecretKey?: string;
  sendgridApiKey?: string;
  fromEmail?: string;
  fromName?: string;
  hostingProvider?: "vercel" | "netlify";
  hostingToken?: string;
  maxConcurrentBuilds: number;
  maxRegenAttempts: number;
  minLighthouseScore: number;
  dailyEmailLimit: number;
  priceUsd: number;
  /** Max total LLM/API spend per calendar month (USD). Pipeline halts if exceeded. */
  maxMonthlyCostUsd: number;
  /** Max LLM/API spend per individual lead (USD). Lead is skipped if exceeded. */
  maxPerLeadCostUsd: number;
}

export const DEFAULT_CONFIG: Omit<ModernizerConfig, "dataDir"> = {
  maxConcurrentBuilds: 3,
  maxRegenAttempts: 3,
  minLighthouseScore: 85,
  dailyEmailLimit: 100,
  priceUsd: 200,
  maxMonthlyCostUsd: 500,
  maxPerLeadCostUsd: 10,
};

/** Pipeline stage result with cost tracking. */
export interface StageResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  costUsd: number;
  durationMs: number;
}
