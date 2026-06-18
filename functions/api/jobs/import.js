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

async function getIncomeFee(env, resultType) {
  if (!resultType) return 0;

  const row = await env.DB.prepare(`
    SELECT income_fee
    FROM fee_rates
    WHERE result_type = ?
  `).bind(resultType).first();

  return Number(row?.income_fee || 0);
}

async function upsertOne(env, input) {
  const maintenanceNo = normalizeNo(input.maintenanceNo || input.maintenance_no);
  if (!/^\d{12}$/.test(maintenanceNo)) {
    return { ok: false, reason: "유지보수 No 12자리 오류", maintenanceNo };
  }

  const status = normalizeStatus(input.status);
  if (!["신청", "보완 요청", "완료"].includes(status)) {
    return { ok: false, reason: "상태값 오류", maintenanceNo };
  }

  const requestDate = normalizeDate(input.requestDate || input.request_date);
  const urgentDueDate = normalizeDate(input.urgentDueDate || input.urgent_due_date);
  const completeDate = normalizeDate(input.completeDate || input.complete_date);
  const region = String(input.region || "").trim();
  const manager = String(input.manager || "").trim();
  const resultType = String(input.resultType || input.result_type || "").trim();

  const existed = await env.DB.prepare(`
    SELECT maintenance_no
    FROM maintenance_jobs
    WHERE maintenance_no = ?
  `).bind(maintenanceNo).first();

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

  return { ok: true, action: existed ? "updated" : "inserted", maintenanceNo };
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const rows = Array.isArray(body.rows) ? body.rows : [];

    if (!rows.length) {
      return json({ error: "업로드할 rows 데이터가 없습니다." }, 400);
    }

    if (rows.length > 20000) {
      return json({ error: "한 번에 20,000건까지만 업로드할 수 있습니다." }, 400);
    }

    let inserted = 0;
    let updated = 0;
    const invalid = [];

    for (let i = 0; i < rows.length; i++) {
      const result = await upsertOne(context.env, rows[i]);
      if (!result.ok) {
        invalid.push({ index: i, ...result });
        continue;
      }
      if (result.action === "inserted") inserted += 1;
      if (result.action === "updated") updated += 1;
    }

    return json({ ok: true, inserted, updated, invalid, total: rows.length });
  } catch (err) {
    return json({ error: err.message || "엑셀 업로드 처리 실패" }, 500);
  }
}
