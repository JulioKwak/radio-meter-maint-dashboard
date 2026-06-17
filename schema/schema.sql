-- Cloudflare D1 Console에서 radio_meter_maint_db 선택 후 실행하세요.
-- 기존 테이블이 없을 때 기준입니다.

CREATE TABLE IF NOT EXISTS maintenance_jobs (
  maintenance_no TEXT PRIMARY KEY NOT NULL, -- 엑셀 A열: 유지보수 No, 12자리 숫자
  status TEXT NOT NULL DEFAULT '신청',       -- 엑셀 B열: 신청 / 보완 요청 / 완료
  request_date TEXT,                        -- 엑셀 C열: 요청일, YYYY-MM-DD
  urgent_due_date TEXT,                     -- 엑셀 D열: 긴급처리 요구일자, YYYY-MM-DD
  complete_date TEXT,                       -- 엑셀 E열: 완료일, YYYY-MM-DD
  region TEXT,                              -- 엑셀 F열: 지역분류
  manager TEXT,                             -- 엑셀 G열: 담당자
  result_type TEXT,                         -- 엑셀 H열: 결과유형
  applied_income_fee INTEGER DEFAULT 0,     -- 완료 당시 적용 수입 수수료
  applied_expert_fee INTEGER DEFAULT 0,     -- 완료 당시 적용 전문가 지급 수수료
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_maintenance_jobs_status
ON maintenance_jobs(status);

CREATE INDEX IF NOT EXISTS idx_maintenance_jobs_request_date
ON maintenance_jobs(request_date);

CREATE INDEX IF NOT EXISTS idx_maintenance_jobs_complete_date
ON maintenance_jobs(complete_date);

CREATE INDEX IF NOT EXISTS idx_maintenance_jobs_due_date
ON maintenance_jobs(urgent_due_date);

CREATE INDEX IF NOT EXISTS idx_maintenance_jobs_manager
ON maintenance_jobs(manager);

CREATE INDEX IF NOT EXISTS idx_maintenance_jobs_region
ON maintenance_jobs(region);

CREATE INDEX IF NOT EXISTS idx_maintenance_jobs_result_type
ON maintenance_jobs(result_type);

CREATE TABLE IF NOT EXISTS fee_rates (
  result_type TEXT PRIMARY KEY NOT NULL, -- 결과유형
  income_fee INTEGER NOT NULL DEFAULT 0, -- 유지보수 유형별 수수료
  expert_fee INTEGER NOT NULL DEFAULT 0, -- 유지보수 유형별 전문가 지급 수수료
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS monthly_expenses (
  expense_month TEXT PRIMARY KEY NOT NULL, -- YYYY-MM
  labor_cost INTEGER NOT NULL DEFAULT 0, -- 인건비
  car_rental_cost INTEGER NOT NULL DEFAULT 0, -- 차량렌탈비
  car_maintenance_cost INTEGER NOT NULL DEFAULT 0, -- 차량유지비
  bonus_cost INTEGER NOT NULL DEFAULT 0, -- 성과급
  material_cost INTEGER NOT NULL DEFAULT 0, -- 자재비
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS worker_wages (
  wage_month TEXT NOT NULL, -- YYYY-MM
  worker_name TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (wage_month, worker_name)
);

-- 정상 생성 확인용
SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;
