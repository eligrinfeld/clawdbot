/** SQLite schema for the website modernizer pipeline. */

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'discovered',
  industry TEXT,
  location TEXT,
  business_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  priority_score REAL NOT NULL DEFAULT 0,
  discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  cost_incurred REAL NOT NULL DEFAULT 0,
  source TEXT
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_domain ON leads(domain);
CREATE INDEX IF NOT EXISTS idx_leads_priority ON leads(priority_score DESC);

CREATE TABLE IF NOT EXISTS analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL UNIQUE REFERENCES leads(id),
  lighthouse_scores TEXT, -- JSON
  mobile_responsive INTEGER NOT NULL DEFAULT 0,
  design_era TEXT,
  content_summary TEXT,
  business_info TEXT, -- JSON
  improvement_potential REAL NOT NULL DEFAULT 0,
  conversion_likelihood TEXT NOT NULL DEFAULT 'low',
  effort_required TEXT NOT NULL DEFAULT 'medium',
  decision TEXT NOT NULL DEFAULT 'skip',
  decision_reason TEXT,
  key_improvements TEXT, -- JSON array
  risk_factors TEXT, -- JSON array
  screenshot_path TEXT,
  analyzed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_analyses_lead ON analyses(lead_id);
CREATE INDEX IF NOT EXISTS idx_analyses_decision ON analyses(decision);

CREATE TABLE IF NOT EXISTS generated_sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  html TEXT NOT NULL,
  preview_url TEXT,
  design_system TEXT, -- JSON
  lighthouse_scores TEXT, -- JSON
  regeneration_count INTEGER NOT NULL DEFAULT 0,
  qa_passed INTEGER NOT NULL DEFAULT 0,
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sites_lead ON generated_sites(lead_id);
CREATE INDEX IF NOT EXISTS idx_sites_qa ON generated_sites(qa_passed);

CREATE TABLE IF NOT EXISTS outreach (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  email_to TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at TEXT,
  opened_at TEXT,
  clicked_at TEXT,
  replied_at TEXT,
  reply_text TEXT,
  sentiment TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
);

CREATE INDEX IF NOT EXISTS idx_outreach_lead ON outreach(lead_id);
CREATE INDEX IF NOT EXISTS idx_outreach_status ON outreach(status);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL UNIQUE REFERENCES leads(id),
  amount REAL NOT NULL,
  stripe_payment_id TEXT,
  paid_at TEXT,
  delivered_at TEXT,
  support_until TEXT
);

CREATE INDEX IF NOT EXISTS idx_sales_lead ON sales(lead_id);

CREATE TABLE IF NOT EXISTS suppression_list (
  email TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pipeline_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stage TEXT NOT NULL,
  lead_id INTEGER REFERENCES leads(id),
  success INTEGER NOT NULL,
  cost_usd REAL NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_metrics_stage ON pipeline_metrics(stage);
CREATE INDEX IF NOT EXISTS idx_metrics_recorded ON pipeline_metrics(recorded_at);
`;
