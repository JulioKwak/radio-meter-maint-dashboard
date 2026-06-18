-- 기존 데이터 보존용 수정 쿼리입니다.
-- 아래 순서대로 D1 Console에서 실행하세요.

ALTER TABLE fee_rates DROP COLUMN expert_fee;
ALTER TABLE maintenance_jobs DROP COLUMN applied_expert_fee;
DROP TABLE IF EXISTS worker_wages;
