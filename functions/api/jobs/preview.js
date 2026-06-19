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
  if (!value) return "";
  const s = String(value).trim();
  if (!s) return "";
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
    return { ok: false, index, reason: "유지보수 No 12자리 오류", value: input.maintenanceNo || input.maintenance_no || "" };
  }

  if (!["신청", "보완 요청", "완료"].includes(status)) {
    return { ok: false, index, maintenanceNo, reason: "상태값 오류", value: input.status || "" };
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

function sameJob(a, b) {
  return String(a.status || "") === String(b.status || "") &&
    String(a.requestDate || "") === String(b.requestDate || "") &&
    String(a.urgentDueDate || "") === String(b.urgentDueDate || "") &&
    String(a.completeDate || "") === String(b.completeDate || "") &&
    String(a.region || "") === String(b.region || "") &&
    String(a.manager || "") === String(b.manager || "") &&
    String(a.resultType || "") === String(b.resultType || "");
}

function toCompareJob(row) {
  return {
    maintenanceNo: row.maintenance_no,
    status: row.status || "",
    requestDate: row.request_date || "",
    urgentDueDate: row.urgent_due_date || "",
    completeDate: row.complete_date || "",
    region: row.region || "",
    manager: row.manager || "",
    resultType: row.result_type || ""
  };
}

async function loadAllExistingMap(env) {
  const map = new Map();
  const result = await env.DB.prepare(`
    SELECT maintenance_no, status, request_date, urgent_due_date, complete_date,
           region, manager, result_type
    FROM maintenance_jobs
  `).all();

  for (const row of result.results || []) {
    map.set(row.maintenance_no, toCompareJob(row));
  }

  return map;
}

export async function onRequestPost(context) {
  try {
    if (!context.env.DB) {
      return json({ error: "D1 바인딩 DB가 없습니다." }, 500);
    }

    const body = await context.request.json();
    const rows = Array.isArray(body.rows) ? body.rows : [];

    if (!rows.length) {
      return json({ error: "검토할 rows 데이터가 없습니다." }, 400);
    }

    if (rows.length > 30000) {
      return json({ error: "한 번에 30,000건까지만 검토할 수 있습니다." }, 400);
    }

    const validRows = [];
    const invalid = [];
    const seen = new Set();
    const excelNoSet = new Set();

    rows.forEach((input, index) => {
      const rawNo = normalizeNo(input.maintenanceNo || input.maintenance_no);
      if (/^\d{12}$/.test(rawNo)) excelNoSet.add(rawNo);

      const normalized = normalizeIncoming(input, index);
      if (!normalized.ok) {
        invalid.push(normalized);
        return;
      }

      const no = normalized.row.maintenanceNo;
      if (seen.has(no)) {
        invalid.push({ index, maintenanceNo: no, reason: "엑셀 내 유지보수 No 중복" });
        return;
      }

      seen.add(no);
      validRows.push(normalized.row);
    });

    const existingMap = await loadAllExistingMap(context.env);

    const insertNos = [];
    const updateNos = [];
    const sameNos = [];
    const deleteNos = [];
    const updateSamples = [];
    const deleteSamples = [];

    for (const row of validRows) {
      const existing = existingMap.get(row.maintenanceNo);

      if (!existing) {
        insertNos.push(row.maintenanceNo);
        continue;
      }

      if (sameJob(row, existing)) {
        sameNos.push(row.maintenanceNo);
      } else {
        updateNos.push(row.maintenanceNo);
        if (updateSamples.length < 20) {
          updateSamples.push({ maintenanceNo: row.maintenanceNo, before: existing, after: row });
        }
      }
    }

    for (const [maintenanceNo, existing] of existingMap.entries()) {
      if (!excelNoSet.has(maintenanceNo)) {
        deleteNos.push(maintenanceNo);
        if (deleteSamples.length < 20) deleteSamples.push(existing);
      }
    }

    return json({
      ok: true,
      total: rows.length,
      dbCount: existingMap.size,
      validCount: validRows.length,
      insertCount: insertNos.length,
      updateCount: updateNos.length,
      deleteCount: deleteNos.length,
      sameCount: sameNos.length,
      invalidCount: invalid.length,
      toSaveCount: insertNos.length + updateNos.length + deleteNos.length,
      insertNos,
      updateNos,
      deleteNos,
      invalid: invalid.slice(0, 200),
      updateSamples,
      deleteSamples
    });
  } catch (err) {
    return json({ error: "엑셀 데이터 검토 실패", message: err.message || String(err) }, 500);
  }
}
