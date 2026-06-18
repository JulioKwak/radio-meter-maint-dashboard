DROP TABLE IF EXISTS maintenance_types;
DROP TABLE IF EXISTS income_fee_rates;
DROP TABLE IF EXISTS expert_fee_rates;
DROP TABLE IF EXISTS expenses;
DROP TABLE IF EXISTS maintenance_jobs;
DROP TABLE IF EXISTS fee_rates;
DROP TABLE IF EXISTS monthly_expenses;
DROP TABLE IF EXISTS worker_wages;

CREATE TABLE maintenance_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  maintenance_no TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  request_date TEXT,
  urgent_due_date TEXT,
  complete_date TEXT,
  region TEXT,
  manager TEXT,
  result_type TEXT,
  applied_income_fee INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE fee_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  result_type TEXT NOT NULL,
  income_fee INTEGER NOT NULL DEFAULT 0,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_fee_rates_result_type ON fee_rates(result_type);
CREATE INDEX idx_fee_rates_period ON fee_rates(valid_from, valid_to);

CREATE TABLE monthly_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_year INTEGER NOT NULL,
  expense_month INTEGER NOT NULL,
  category TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(expense_year, expense_month, category)
);

CREATE INDEX idx_jobs_maintenance_no ON maintenance_jobs(maintenance_no);
CREATE INDEX idx_jobs_status ON maintenance_jobs(status);
CREATE INDEX idx_jobs_request_date ON maintenance_jobs(request_date);
CREATE INDEX idx_jobs_complete_date ON maintenance_jobs(complete_date);
CREATE INDEX idx_jobs_urgent_due_date ON maintenance_jobs(urgent_due_date);
CREATE INDEX idx_jobs_region ON maintenance_jobs(region);
CREATE INDEX idx_jobs_manager ON maintenance_jobs(manager);
CREATE INDEX idx_jobs_result_type ON maintenance_jobs(result_type);

INSERT INTO fee_rates (result_type, income_fee, valid_from, valid_to)
VALUES
  ('A(기타)', 0, '2026-04-01', NULL),
  ('A(시설점검)', 0, '2026-04-01', NULL),
  ('B(모뎀설치)', 0, '2026-04-01', NULL),
  ('C(전원선설치)', 0, '2026-04-01', NULL),
  ('C*(체결변경)', 0, '2026-04-01', NULL),
  ('D(계기함교체)', 0, '2026-04-01', NULL),
  ('E(계기1대교체)', 0, '2026-04-01', NULL),
  ('F(계기2대교체)', 0, '2026-04-01', NULL),
  ('J(계기함교체+a)', 0, '2026-04-01', NULL),
  ('K(계기1대교체+a)', 0, '2026-04-01', NULL),
  ('L(계기2대교체+a)', 0, '2026-04-01', NULL),
  ('M(차단기교체)', 0, '2026-04-01', NULL);
