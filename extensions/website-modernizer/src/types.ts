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

// ── Model Router Types ──

/** Task types tag every LLM call for routing. */
export type TaskType =
  | "classify"
  | "extract_structured"
  | "plan"
  | "reason"
  | "tool_decision"
  | "long_context"
  | "code_write"
  | "code_review"
  | "copy_outreach"
  | "safety_compliance";

/** Model tier identifiers. */
export type ModelTierId =
  | "tier0_fast"
  | "reasoning_default"
  | "agent_orchestrator"
  | "long_context"
  | "coder";

/** LLM provider type. */
export type ProviderType = "anthropic" | "openrouter" | "openai_compatible";

/** Configuration for a single model tier. */
export interface ModelTierConfig {
  provider: ProviderType;
  model: string;
  maxContext: number;
  baseUrl?: string;
  apiKeyEnv?: string;
}

/** A routing rule maps a task type to a model tier with parameters. */
export interface RoutingRule {
  taskType: TaskType;
  modelTier: ModelTierId;
  maxTokens: number;
  temperature?: number;
  escalateIf?: {
    retriesGte?: number;
    toolFailuresGte?: number;
    complexityGte?: number;
  };
}

/** Budget configuration with rate limiting and throttle thresholds. */
export interface BudgetConfig {
  monthlyCapUsd: number;
  softThrottlePct: number;
  hardThrottlePct: number;
  tokenRateLimit: {
    tokensPerMinute: number;
    burstTokens: number;
  };
}

/** Escalation policy when calls fail or get stuck. */
export interface EscalationPolicy {
  onSchemaFailure: ModelTierId[];
  onToolLoopStuck: { afterAttempts: number; escalateTo: ModelTierId };
  onLongContextOverflow: {
    summarizeWith: ModelTierId;
    reasonWith: ModelTierId;
    fallback: ModelTierId;
  };
}

/** Quality gate configuration. */
export interface QualityGateConfig {
  requireJsonSchemaFor: TaskType[];
  requireEvidenceFor: TaskType[];
  confidenceThreshold: number;
}

/** Complete router configuration. */
export interface RouterConfig {
  budget: BudgetConfig;
  models: Record<ModelTierId, ModelTierConfig>;
  routingRules: RoutingRule[];
  escalationPolicy: EscalationPolicy;
  qualityGates: QualityGateConfig;
}

/** Snapshot of the budget manager's state. */
export interface BudgetState {
  monthSpendUsd: number;
  monthlyCapUsd: number;
  utilization: number;
  throttleLevel: "normal" | "soft" | "hard" | "stopped";
  withinRateLimit: boolean;
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
  /** Model router configuration. */
  router: RouterConfig;
}

export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  budget: {
    monthlyCapUsd: 200,
    softThrottlePct: 0.70,
    hardThrottlePct: 0.90,
    tokenRateLimit: {
      tokensPerMinute: 120_000,
      burstTokens: 300_000,
    },
  },
  models: {
    tier0_fast: {
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      maxContext: 32_000,
    },
    reasoning_default: {
      provider: "openrouter",
      model: "deepseek/deepseek-chat",
      maxContext: 128_000,
      apiKeyEnv: "OPENROUTER_API_KEY",
    },
    agent_orchestrator: {
      provider: "openrouter",
      model: "moonshotai/kimi-k2",
      maxContext: 262_000,
      apiKeyEnv: "OPENROUTER_API_KEY",
    },
    long_context: {
      provider: "openrouter",
      model: "minimax/minimax-01",
      maxContext: 1_000_000,
      apiKeyEnv: "OPENROUTER_API_KEY",
    },
    coder: {
      provider: "openrouter",
      model: "mistralai/devstral-small-2505",
      maxContext: 200_000,
      apiKeyEnv: "OPENROUTER_API_KEY",
    },
  },
  routingRules: [
    { taskType: "classify", modelTier: "tier0_fast", maxTokens: 256 },
    { taskType: "extract_structured", modelTier: "tier0_fast", maxTokens: 800 },
    { taskType: "tool_decision", modelTier: "tier0_fast", maxTokens: 400 },
    { taskType: "reason", modelTier: "reasoning_default", maxTokens: 1400 },
    {
      taskType: "plan",
      modelTier: "reasoning_default",
      maxTokens: 1800,
      escalateIf: { retriesGte: 2, toolFailuresGte: 2, complexityGte: 0.7 },
    },
    { taskType: "long_context", modelTier: "long_context", maxTokens: 2400 },
    { taskType: "code_write", modelTier: "coder", maxTokens: 2400 },
    { taskType: "code_review", modelTier: "coder", maxTokens: 1800 },
    { taskType: "copy_outreach", modelTier: "tier0_fast", maxTokens: 900, temperature: 0.4 },
    { taskType: "safety_compliance", modelTier: "reasoning_default", maxTokens: 512 },
  ],
  escalationPolicy: {
    onSchemaFailure: ["tier0_fast", "reasoning_default", "agent_orchestrator"],
    onToolLoopStuck: { afterAttempts: 2, escalateTo: "agent_orchestrator" },
    onLongContextOverflow: {
      summarizeWith: "tier0_fast",
      reasonWith: "reasoning_default",
      fallback: "long_context",
    },
  },
  qualityGates: {
    requireJsonSchemaFor: ["extract_structured", "plan", "code_write"],
    requireEvidenceFor: ["copy_outreach"],
    confidenceThreshold: 0.72,
  },
};

export const DEFAULT_CONFIG: Omit<ModernizerConfig, "dataDir"> = {
  maxConcurrentBuilds: 3,
  maxRegenAttempts: 3,
  minLighthouseScore: 85,
  dailyEmailLimit: 100,
  priceUsd: 200,
  maxMonthlyCostUsd: 500,
  maxPerLeadCostUsd: 10,
  router: DEFAULT_ROUTER_CONFIG,
};

/** Pipeline stage result with cost tracking. */
export interface StageResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  costUsd: number;
  durationMs: number;
}
