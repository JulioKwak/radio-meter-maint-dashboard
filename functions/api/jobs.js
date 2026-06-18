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
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
    const [y, m, d] = s.split("-");
    return `${y.padStart(4, "0")}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return s;
}

function toApiJob(row) {
  return {
    maintenanceNo: row.maintenance_no,
    status: row.status,
    requestDate: row.request_date || "",
    urgentDueDate: row.urgent_due_date || "",
    completeDate: row.complete_date || "",
    region: row.region || "",
    manager: row.manager || "",
    resultType: row.result_type || "",
    appliedIncomeFee: row.applied_income_fee || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getIncomeFee(env, resultType) {
  if (!resultType) return 0;

  const row = await env.DB.prepare(`
    SELECT income_fee
    FROM fee_rates
    WHERE result_type = ?
  `).bind(resultType).first();

  return Number(row?.income_fee || 0);
}

async function upsertJob(env, input) {
  const maintenanceNo = normalizeNo(input.maintenanceNo || input.maintenance_no);
  if (!/^\d{12}$/.test(maintenanceNo)) {
    throw new Error("유지보수 No는 12자리 숫자여야 합니다.");
  }

  const status = normalizeStatus(input.status);
  if (!["신청", "보완 요청", "완료"].includes(status)) {
    throw new Error("상태값은 신청, 보완 요청, 완료 중 하나여야 합니다.");
  }

  const requestDate = normalizeDate(input.requestDate || input.request_date);
  const urgentDueDate = normalizeDate(input.urgentDueDate || input.urgent_due_date);
  const completeDate = normalizeDate(input.completeDate || input.complete_date);
  const region = String(input.region || "").trim();
  const manager = String(input.manager || "").trim();
  const resultType = String(input.resultType || input.result_type || "").trim();
  const incomeFee = status === "완료" ? await getIncomeFee(env, resultType) : 0;

  await env.DB.prepare(`
    INSERT INTO maintenance_jobs (
      maintenance_no, status, request_date, urgent_due_date, complete_date,
      region, manager, result_type, applied_income_fee, created_at, updated_at
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
    maintenanceNo, status, requestDate, urgentDueDate, completeDate,
    region, manager, resultType, incomeFee
  ).run();

  return { maintenanceNo };
}

export async function onRequestGet(context) {
  try {
    const { searchParams } = new URL(context.request.url);
    let sql = `
      SELECT *
      FROM maintenance_jobs
      WHERE 1 = 1
    `;
    const params = [];

    const requestStart = searchParams.get("requestStart");
    const requestEnd = searchParams.get("requestEnd");
    const completeStart = searchParams.get("completeStart");
    const completeEnd = searchParams.get("completeEnd");
    const dueStart = searchParams.get("dueStart");
    const dueEnd = searchParams.get("dueEnd");
    const manager = searchParams.get("manager");
    const region = searchParams.get("region");
    const status = searchParams.get("status");

    if (requestStart) { sql += " AND request_date >= ?"; params.push(requestStart); }
    if (requestEnd) { sql += " AND request_date <= ?"; params.push(requestEnd); }
    if (completeStart) { sql += " AND complete_date >= ?"; params.push(completeStart); }
    if (completeEnd) { sql += " AND complete_date <= ?"; params.push(completeEnd); }
    if (dueStart) { sql += " AND urgent_due_date >= ?"; params.push(dueStart); }
    if (dueEnd) { sql += " AND urgent_due_date <= ?"; params.push(dueEnd); }
    if (manager) { sql += " AND manager = ?"; params.push(manager); }
    if (region) { sql += " AND region = ?"; params.push(region); }
    if (status) { sql += " AND status = ?"; params.push(status); }

    sql += " ORDER BY COALESCE(request_date, '') DESC, maintenance_no DESC LIMIT 20000";

    const result = await context.env.DB.prepare(sql).bind(...params).all();
    return json({ jobs: (result.results || []).map(toApiJob) });
  } catch (err) {
    return json({ error: "작업현황 조회 실패", message: err.message || String(err) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    if (!body.job) return json({ error: "job 데이터가 필요합니다." }, 400);
    const result = await upsertJob(context.env, body.job);
    return json({ ok: true, ...result });
  } catch (err) {
    return json({ error: err.message || "저장 실패" }, 400);
  }
}

export async function onRequestDelete(context) {
  try {
    const body = await context.request.json();
    const maintenanceNo = normalizeNo(body.maintenanceNo || body.maintenance_no);
    if (!/^\d{12}$/.test(maintenanceNo)) {
      return json({ error: "유효한 유지보수 No가 필요합니다." }, 400);
    }

    await context.env.DB.prepare(`
      DELETE FROM maintenance_jobs
      WHERE maintenance_no = ?
    `).bind(maintenanceNo).run();

    return json({ ok: true });
  } catch (err) {
    return json({ error: err.message || "삭제 실패" }, 400);
  }
}
