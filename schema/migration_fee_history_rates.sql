-- 단가표를 적용기간 이력 방식으로 변경하는 마이그레이션입니다.
-- 기존 fee_rates의 현재 단가는 2026-04-01부터 적용되는 단가로 이관합니다.

CREATE TABLE fee_rates_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  result_type TEXT NOT NULL,
  income_fee INTEGER NOT NULL DEFAULT 0,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO fee_rates_new (
  result_type,
  income_fee,
  valid_from,
  valid_to,
  is_active,
  created_at,
  updated_at
)
SELECT
  result_type,
  income_fee,
  '2026-04-01',
  NULL,
  COALESCE(is_active, 1),
  COALESCE(created_at, CURRENT_TIMESTAMP),
  COALESCE(updated_at, CURRENT_TIMESTAMP)
FROM fee_rates;

DROP TABLE fee_rates;
ALTER TABLE fee_rates_new RENAME TO fee_rates;

CREATE INDEX idx_fee_rates_result_type ON fee_rates(result_type);
CREATE INDEX idx_fee_rates_period ON fee_rates(valid_from, valid_to);

-- 인상 전 단가 행 추가. 금액은 화면에서 수정하세요.
INSERT INTO fee_rates (result_type, income_fee, valid_from, valid_to)
VALUES
  ('A(기타)', 0, '2025-11-01', '2026-03-31'),
  ('A(시설점검)', 0, '2025-11-01', '2026-03-31'),
  ('B(모뎀설치)', 0, '2025-11-01', '2026-03-31'),
  ('C(전원선설치)', 0, '2025-11-01', '2026-03-31'),
  ('C*(체결변경)', 0, '2025-11-01', '2026-03-31'),
  ('D(계기함교체)', 0, '2025-11-01', '2026-03-31'),
  ('E(계기1대교체)', 0, '2025-11-01', '2026-03-31'),
  ('F(계기2대교체)', 0, '2025-11-01', '2026-03-31'),
  ('J(계기함교체+a)', 0, '2025-11-01', '2026-03-31'),
  ('K(계기1대교체+a)', 0, '2025-11-01', '2026-03-31'),
  ('L(계기2대교체+a)', 0, '2025-11-01', '2026-03-31'),
  ('M(차단기교체)', 0, '2025-11-01', '2026-03-31');
