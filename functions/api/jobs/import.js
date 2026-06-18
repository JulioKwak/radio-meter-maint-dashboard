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
  if (/^\d{4}[./]\d{1,2}[./]\d{1,2}$/.test(s)) {
    const [y, m, d] = s.split(/[./]/);
    return `${y.padStart(4, "0")}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return s;
}

function normalizeIncoming(input, index) {
  const maintenanceNo = normalizeNo(input.maintenanceNo || input.maintenance_no);
  const status = normalizeStatus(input.status);

  if (!/^\d{12}$/.test(maintenanceNo)) {
    return { ok: false, index, reason: "유지보수 No 12자리 오류", maintenanceNo };
  }

  if (!["신청", "보완 요청", "완료"].includes(status)) {
    return { ok: false, index, reason: "상태값 오류", maintenanceNo };
  }

  return {
    ok: true,
    row: {
      maintenanceNo,
      status,
      requestDate: normalizeDate(input.requestDate || input.request_date),
      urgentDueDate: normalizeDate(input.urgentDueDate || input.urgent_due_date),
      completeDate: normalizeDate(input.completeDate || input.complete_date),
      region: String(input.region || "").trim(),
      manager: String(input.manager || "").trim(),
      resultType: String(input.resultType || input.result_type || "").trim()
    }
  };
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
  return chunks;
}

async function loadFeeRows(env) {
  const result = await env.DB.prepare(`
    SELECT result_type, income_fee, valid_from, valid_to
    FROM fee_rates
    WHERE is_active = 1
    ORDER BY result_type, valid_from DESC
  `).all();

  return result.results || [];
}

function getEffectiveIncomeFee(feeRows, resultType, completeDate) {
  if (!resultType || !completeDate) return 0;

  const row = feeRows.find(f =>
    String(f.result_type || "") === String(resultType || "") &&
    String(f.valid_from || "") <= String(completeDate || "") &&
    (!f.valid_to || String(f.valid_to || "") >= String(completeDate || ""))
  );

  return Number(row?.income_fee || 0);
}

async function loadExistingNos(env, maintenanceNos) {
  const set = new Set();
  const uniqueNos = [...new Set(maintenanceNos)];

  for (const nos of chunk(uniqueNos, 100)) {
    const placeholders = nos.map(() => "?").join(",");
    const result = await env.DB.prepare(`
      SELECT maintenance_no
      FROM maintenance_jobs
      WHERE maintenance_no IN (${placeholders})
    `).bind(...nos).all();

    for (const row of result.results || []) set.add(row.maintenance_no);
  }

  return set;
}

async function upsertRows(env, rows, feeRows) {
  const CHUNK_SIZE = 50;

  for (const group of chunk(rows, CHUNK_SIZE)) {
    const valuesSql = group.map(() => `(
      ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )`).join(",");

    const params = [];
    for (const row of group) {
      const incomeFee = row.status === "완료" ? getEffectiveIncomeFee(feeRows, row.resultType, row.completeDate) : 0;
      params.push(
        row.maintenanceNo,
        row.status,
        row.requestDate || null,
        row.urgentDueDate || null,
        row.completeDate || null,
        row.region,
        row.manager,
        row.resultType,
        incomeFee
      );
    }

    await env.DB.prepare(`
      INSERT INTO maintenance_jobs (
        maintenance_no, status, request_date, urgent_due_date, complete_date,
        region, manager, result_type, applied_income_fee, created_at, updated_at
      )
      VALUES ${valuesSql}
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
    `).bind(...params).run();
  }
}

export async function onRequestPost(context) {
  try {
    if (!context.env.DB) {
      return json({ error: "D1 바인딩 DB가 없습니다." }, 500);
    }

    const body = await context.request.json();
    const rows = Array.isArray(body.rows) ? body.rows : [];

    if (!rows.length) {
      return json({ error: "업로드할 rows 데이터가 없습니다." }, 400);
    }

    if (rows.length > 10000) {
      return json({ error: "한 번에 저장 가능한 건수는 10,000건입니다." }, 400);
    }

    const validRows = [];
    const invalid = [];
    const seen = new Set();

    rows.forEach((input, index) => {
      const normalized = normalizeIncoming(input, index);
      if (!normalized.ok) {
        invalid.push(normalized);
        return;
      }

      const no = normalized.row.maintenanceNo;
      if (seen.has(no)) {
        invalid.push({ index, maintenanceNo: no, reason: "요청 내 유지보수 No 중복" });
        return;
      }

      seen.add(no);
      validRows.push(normalized.row);
    });

    if (!validRows.length) {
      return json({ ok: false, error: "저장 가능한 정상 데이터가 없습니다.", invalid }, 400);
    }

    const existingNos = await loadExistingNos(context.env, validRows.map(r => r.maintenanceNo));
    const feeRows = await loadFeeRows(context.env);

    await upsertRows(context.env, validRows, feeRows);

    let inserted = 0;
    let updated = 0;

    for (const row of validRows) {
      if (existingNos.has(row.maintenanceNo)) updated += 1;
      else inserted += 1;
    }

    return json({
      ok: true,
      inserted,
      updated,
      invalid,
      total: rows.length,
      saved: validRows.length
    });
  } catch (err) {
    return json({ error: err.message || "엑셀 업로드 처리 실패" }, 500);
  }
}
