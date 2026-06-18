function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

function normalizeStatus(value) {
  const raw = String(value ?? "").trim();
  const compact = raw.replace(/\s+/g, "");

  if (!compact || compact === "신청") return "신청";
  if (compact === "보완" || compact === "보완요청") return "보완 요청";
  if (compact === "완료") return "완료";

  return "";
}

function normalizeNo(value) {
  return String(value ?? "").replace(/[^0-9]/g, "").trim();
}

function normalizeDate(value) {
  if (value === null || value === undefined) return null;

  const s = String(value).trim();
  if (!s) return null;

  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
    const [y, m, d] = s.split("-");
    return `${y.padStart(4, "0")}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  return s;
}

function normalizeJob(input) {
  const maintenanceNo = normalizeNo(input.maintenanceNo || input.maintenance_no);
  const status = normalizeStatus(input.status);

  if (!/^\d{12}$/.test(maintenanceNo)) {
    throw new Error("유지보수 No는 12자리 숫자여야 합니다.");
  }

  if (!["신청", "보완 요청", "완료"].includes(status)) {
    throw new Error("상태값은 신청, 보완 요청, 완료 중 하나여야 합니다.");
  }

  return {
    maintenanceNo,
    status,
    requestDate: normalizeDate(input.requestDate || input.request_date),
    urgentDueDate: normalizeDate(input.urgentDueDate || input.urgent_due_date),
    completeDate: normalizeDate(input.completeDate || input.complete_date),
    region: String(input.region || "").trim(),
    manager: String(input.manager || "").trim(),
    resultType: String(input.resultType || input.result_type || "").trim()
  };
}

async function getIncomeFee(env, resultType, completeDate) {
  if (!resultType || !completeDate) return 0;

  const row = await env.DB.prepare(`
    SELECT income_fee
    FROM fee_rates
    WHERE result_type = ?
      AND valid_from <= ?
      AND (valid_to IS NULL OR valid_to >= ?)
      AND is_active = 1
    ORDER BY valid_from DESC
    LIMIT 1
  `).bind(resultType, completeDate, completeDate).first();

  return Number(row?.income_fee || 0);
}

async function saveOneJob(env, input) {
  const job = normalizeJob(input);

  const exists = await env.DB.prepare(`
    SELECT id
    FROM maintenance_jobs
    WHERE maintenance_no = ?
  `).bind(job.maintenanceNo).first();

  const incomeFee = job.status === "완료"
    ? await getIncomeFee(env, job.resultType, job.completeDate)
    : 0;

  await env.DB.prepare(`
    INSERT INTO maintenance_jobs (
      maintenance_no,
      status,
      request_date,
      urgent_due_date,
      complete_date,
      region,
      manager,
      result_type,
      applied_income_fee,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(maintenance_no) DO UPDATE SET
      status = excluded.status,
      request_date = excluded.request_date,
      urgent_due_date = excluded.urgent_due_date,
      complete_date = excluded.complete_date,
      region = excluded.region,
      manager = excluded.manager,
      result_type = excluded.result_type,
      applied_income_fee = excluded.applied_income_fee,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    job.maintenanceNo,
    job.status,
    job.requestDate,
    job.urgentDueDate,
    job.completeDate,
    job.region,
    job.manager,
    job.resultType,
    incomeFee
  ).run();

  return exists ? "updated" : "inserted";
}

export async function onRequestPost(context) {
  try {
    if (!context.env.DB) {
      return json({
        error: "D1 바인딩 DB가 없습니다."
      }, 500);
    }

    const body = await context.request.json();
    const rows = body.rows || body.jobs || [];

    if (!Array.isArray(rows)) {
      return json({
        error: "rows 배열이 필요합니다."
      }, 400);
    }

    let inserted = 0;
    let updated = 0;
    const invalid = [];

    for (let i = 0; i < rows.length; i++) {
      try {
        const result = await saveOneJob(context.env, rows[i]);

        if (result === "inserted") inserted++;
        if (result === "updated") updated++;
      } catch (err) {
        invalid.push({
          index: i + 1,
          maintenanceNo: rows[i]?.maintenanceNo || rows[i]?.maintenance_no || "",
          message: err.message || String(err)
        });
      }
    }

    return json({
      ok: true,
      inserted,
      updated,
      invalid
    });
  } catch (err) {
    return json({
      error: "작업 데이터 저장 실패",
      message: err.message || String(err)
    }, 500);
  }
}
