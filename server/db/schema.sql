CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  city TEXT DEFAULT 'Irving',
  state TEXT DEFAULT 'TX',
  zip TEXT,
  source_channel TEXT NOT NULL DEFAULT 'manual',
  source_details TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  priority TEXT DEFAULT 'warm',
  storm_event_id TEXT,
  assigned_to TEXT DEFAULT 'Dennis',
  estimated_value REAL,
  actual_value REAL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  deleted_at TEXT,
  FOREIGN KEY (storm_event_id) REFERENCES storm_events(id)
);

CREATE TABLE IF NOT EXISTS interactions (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'note',
  direction TEXT DEFAULT 'internal',
  summary TEXT NOT NULL,
  raw_message TEXT,
  logged_by TEXT DEFAULT 'dennis',
  created_at TEXT DEFAULT (datetime('now')),
  attachments TEXT DEFAULT '[]',
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'inspection',
  scheduled_date TEXT NOT NULL,
  scheduled_time TEXT,
  duration_minutes INTEGER DEFAULT 60,
  status TEXT DEFAULT 'scheduled',
  address TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  job_type TEXT DEFAULT 'repair',
  description TEXT,
  status TEXT DEFAULT 'pending',
  start_date TEXT,
  end_date TEXT,
  quote_amount REAL,
  final_amount REAL,
  payment_status TEXT DEFAULT 'unpaid',
  payment_method TEXT,
  crew_assigned TEXT,
  before_photos TEXT DEFAULT '[]',
  after_photos TEXT DEFAULT '[]',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE TABLE IF NOT EXISTS storm_events (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  severity TEXT DEFAULT 'moderate',
  affected_areas TEXT DEFAULT '[]',
  leads_generated INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages_log (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  direction TEXT NOT NULL,
  from_id TEXT,
  to_id TEXT,
  content TEXT,
  lead_id TEXT,
  processed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  raw_payload TEXT,
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source_channel);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_interactions_lead ON interactions(lead_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_jobs_lead ON jobs(lead_id);
CREATE INDEX IF NOT EXISTS idx_messages_lead ON messages_log(lead_id);

-- Bot users table for Telegram integration
CREATE TABLE IF NOT EXISTS bot_users (
  id TEXT PRIMARY KEY,
  telegram_id TEXT UNIQUE,
  telegram_username TEXT,
  display_name TEXT,
  role TEXT DEFAULT 'contractor',
  approved INTEGER DEFAULT 0,
  linked_user_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Reminders table for scheduled notifications
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  user_telegram_id TEXT,
  lead_id TEXT,
  remind_at DATETIME,
  message TEXT,
  sent INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bot_users_telegram ON bot_users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(remind_at, sent);

-- Referral campaigns
CREATE TABLE IF NOT EXISTS referral_campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  sent_at TEXT,
  status TEXT DEFAULT 'draft',
  message_template TEXT,
  incentive_type TEXT,
  incentive_value REAL,
  criteria TEXT
);

-- Referral campaign recipients
CREATE TABLE IF NOT EXISTS referral_campaign_recipients (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  customer_lead_id TEXT NOT NULL,
  sent_at TEXT,
  responded INTEGER DEFAULT 0,
  referral_lead_id TEXT,
  FOREIGN KEY (campaign_id) REFERENCES referral_campaigns(id),
  FOREIGN KEY (customer_lead_id) REFERENCES leads(id),
  FOREIGN KEY (referral_lead_id) REFERENCES leads(id)
);

-- Referral incentives
CREATE TABLE IF NOT EXISTS referral_incentives (
  id TEXT PRIMARY KEY,
  referrer_lead_id TEXT NOT NULL,
  referred_lead_id TEXT NOT NULL,
  campaign_id TEXT,
  incentive_type TEXT,
  incentive_value REAL,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  paid_at TEXT,
  FOREIGN KEY (referrer_lead_id) REFERENCES leads(id),
  FOREIGN KEY (referred_lead_id) REFERENCES leads(id),
  FOREIGN KEY (campaign_id) REFERENCES referral_campaigns(id)
);

CREATE INDEX IF NOT EXISTS idx_referral_campaigns_status ON referral_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_referral_recipients_campaign ON referral_campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_referral_incentives_referrer ON referral_incentives(referrer_lead_id);
CREATE INDEX IF NOT EXISTS idx_referral_incentives_referred ON referral_incentives(referred_lead_id);
CREATE INDEX IF NOT EXISTS idx_leads_referred_by ON leads(referred_by);
CREATE INDEX IF NOT EXISTS idx_leads_referral_source ON leads(referral_source);
