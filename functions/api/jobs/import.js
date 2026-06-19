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
  if (/^\d{4}[./]\s*\d{1,2}[./]\s*\d{1,2}\.?$/.test(s)) {
    const cleaned = s.replace(/\.$/, "");
    const [y, m, d] = cleaned.split(/[./]/).map(v => v.trim());
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
  const normalized = normalizeIncoming(input, 0);
  if (!normalized.ok) throw new Error(normalized.reason || "유효하지 않은 작업 데이터입니다.");

  const job = normalized.row;

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

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
  return chunks;
}

async function deleteJobs(env, deleteNos) {
  let deleted = 0;
  const invalid = [];
  const validNos = [];

  for (const noRaw of deleteNos || []) {
    const no = normalizeNo(noRaw);
    if (!/^\d{12}$/.test(no)) {
      invalid.push({ maintenanceNo: noRaw, reason: "삭제 대상 유지보수 No 12자리 오류" });
      continue;
    }
    validNos.push(no);
  }

  for (const nos of chunk([...new Set(validNos)], 100)) {
    const placeholders = nos.map(() => "?").join(",");

    const existing = await env.DB.prepare(`
      SELECT maintenance_no
      FROM maintenance_jobs
      WHERE maintenance_no IN (${placeholders})
    `).bind(...nos).all();

    const existingNos = (existing.results || []).map(r => r.maintenance_no);
    if (!existingNos.length) continue;

    const deletePlaceholders = existingNos.map(() => "?").join(",");
    await env.DB.prepare(`
      DELETE FROM maintenance_jobs
      WHERE maintenance_no IN (${deletePlaceholders})
    `).bind(...existingNos).run();

    deleted += existingNos.length;
  }

  return { deleted, invalid };
}

export async function onRequestPost(context) {
  try {
    if (!context.env.DB) {
      return json({ error: "D1 바인딩 DB가 없습니다." }, 500);
    }

    const body = await context.request.json();
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const deleteNos = Array.isArray(body.deleteNos) ? body.deleteNos : [];

    if (!rows.length && !deleteNos.length) {
      return json({ error: "업로드할 rows 또는 삭제할 deleteNos 데이터가 없습니다." }, 400);
    }

    if (rows.length > 1000) {
      return json({ error: "한 번에 저장 가능한 rows는 1,000건입니다. 브라우저에서 나누어 전송하세요." }, 400);
    }

    if (deleteNos.length > 1000) {
      return json({ error: "한 번에 삭제 가능한 deleteNos는 1,000건입니다. 브라우저에서 나누어 전송하세요." }, 400);
    }

    let inserted = 0;
    let updated = 0;
    let deleted = 0;
    let invalid = [];
    const seen = new Set();

    for (let i = 0; i < rows.length; i++) {
      try {
        const no = normalizeNo(rows[i]?.maintenanceNo || rows[i]?.maintenance_no);
        if (seen.has(no)) {
          invalid.push({ index: i + 1, maintenanceNo: no, reason: "요청 내 유지보수 No 중복" });
          continue;
        }
        seen.add(no);

        const result = await saveOneJob(context.env, rows[i]);
        if (result === "inserted") inserted += 1;
        if (result === "updated") updated += 1;
      } catch (err) {
        invalid.push({
          index: i + 1,
          maintenanceNo: rows[i]?.maintenanceNo || rows[i]?.maintenance_no || "",
          reason: err.message || String(err)
        });
      }
    }

    if (deleteNos.length) {
      const deleteResult = await deleteJobs(context.env, deleteNos);
      deleted = deleteResult.deleted;
      invalid = invalid.concat(deleteResult.invalid || []);
    }

    return json({
      ok: true,
      inserted,
      updated,
      deleted,
      invalid,
      total: rows.length,
      saved: inserted + updated
    });
  } catch (err) {
    return json({ error: "엑셀 업로드 처리 실패", message: err.message || String(err) }, 500);
  }
}
