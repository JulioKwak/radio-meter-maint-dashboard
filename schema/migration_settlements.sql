-- 정산현황(분기별 정산) 테이블 추가 마이그레이션입니다.
-- D1 콘솔 또는 `wrangler d1 execute <db> --remote --file schema/migration_settlements.sql` 로 실행하세요.

CREATE TABLE IF NOT EXISTS settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  settlement_year INTEGER NOT NULL,
  settlement_quarter INTEGER NOT NULL,
  result_type TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  unit_fee INTEGER NOT NULL DEFAULT 0,
  actual_cost INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  line_total INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(settlement_year, settlement_quarter, result_type)
);

CREATE INDEX IF NOT EXISTS idx_settlements_period ON settlements(settlement_year, settlement_quarter);
