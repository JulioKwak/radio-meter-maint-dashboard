function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
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

function addDays(dateString, days) {
  const [y, m, d] = dateString.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function toApiFee(row) {
  return {
    id: row.id,
    resultType: row.result_type,
    incomeFee: Number(row.income_fee || 0),
    validFrom: row.valid_from || "",
    validTo: row.valid_to || "",
    isActive: row.is_active ?? 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isCurrent: !row.valid_to
  };
}

async function loadFees(env) {
  const result = await env.DB.prepare(`
    SELECT id, result_type, income_fee, valid_from, valid_to, is_active, created_at, updated_at
    FROM fee_rates
    WHERE is_active = 1
    ORDER BY result_type, valid_from
  `).all();

  const allFees = (result.results || []).map(toApiFee);
  const currentMap = new Map();

  for (const fee of allFees) {
    if (fee.validTo) continue;
    const prev = currentMap.get(fee.resultType);
    if (!prev || String(fee.validFrom || "") > String(prev.validFrom || "")) {
      currentMap.set(fee.resultType, fee);
    }
  }

  return {
    fees: [...currentMap.values()].sort((a, b) => a.resultType.localeCompare(b.resultType, "ko")),
    allFees
  };
}

async function saveCurrentFees(env, fees) {
  for (const f of fees) {
    const id = f.id ? Number(f.id) : null;
    const resultType = String(f.resultType || f.result_type || "").trim();
    const incomeFee = Number(f.incomeFee || f.income_fee || 0);
    const validFrom = normalizeDate(f.validFrom || f.valid_from) || new Date().toISOString().slice(0, 10);

    if (!resultType) continue;

    if (id) {
      await env.DB.prepare(`
        UPDATE fee_rates
        SET result_type = ?, income_fee = ?, valid_from = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(resultType, incomeFee, validFrom, id).run();
    } else {
      await env.DB.prepare(`
        INSERT INTO fee_rates (result_type, income_fee, valid_from, valid_to, is_active, created_at, updated_at)
        VALUES (?, ?, ?, NULL, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(resultType, incomeFee, validFrom).run();
    }
  }
}

async function applyNewRates(env, validFrom, fees) {
  const startDate = normalizeDate(validFrom);
  if (!startDate) throw new Error("신규 단가 적용시작일이 필요합니다.");

  const closeDate = addDays(startDate, -1);

  for (const f of fees) {
    const resultType = String(f.resultType || f.result_type || "").trim();
    const incomeFee = Number(f.incomeFee || f.income_fee || 0);
    if (!resultType) continue;

    // 기존 현재 단가 또는 신규 적용일 이후까지 열려 있는 단가를 닫습니다.
    await env.DB.prepare(`
      UPDATE fee_rates
      SET valid_to = ?, updated_at = CURRENT_TIMESTAMP
      WHERE result_type = ?
        AND is_active = 1
        AND valid_from < ?
        AND (valid_to IS NULL OR valid_to >= ?)
    `).bind(closeDate, resultType, startDate, startDate).run();

    // 같은 시작일의 단가가 이미 있으면 수정, 없으면 추가합니다.
    const existing = await env.DB.prepare(`
      SELECT id
      FROM fee_rates
      WHERE result_type = ?
        AND valid_from = ?
        AND is_active = 1
      LIMIT 1
    `).bind(resultType, startDate).first();

    if (existing?.id) {
      await env.DB.prepare(`
        UPDATE fee_rates
        SET income_fee = ?, valid_to = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(incomeFee, existing.id).run();
    } else {
      await env.DB.prepare(`
        INSERT INTO fee_rates (result_type, income_fee, valid_from, valid_to, is_active, created_at, updated_at)
        VALUES (?, ?, ?, NULL, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(resultType, incomeFee, startDate).run();
    }
  }
}

export async function onRequestGet(context) {
  try {
    if (!context.env.DB) return json({ error: "D1 바인딩 DB가 없습니다." }, 500);
    return json(await loadFees(context.env));
  } catch (err) {
    return json({ error: "단가표 조회 실패", message: err.message || String(err) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    if (!context.env.DB) return json({ error: "D1 바인딩 DB가 없습니다." }, 500);

    const body = await context.request.json();
    const action = body.action || "saveCurrent";
    const fees = Array.isArray(body.fees) ? body.fees : [];

    if (action === "applyNewRates") {
      await applyNewRates(context.env, body.validFrom, fees);
    } else {
      await saveCurrentFees(context.env, fees);
    }

    return json({ ok: true, ...(await loadFees(context.env)) });
  } catch (err) {
    return json({ error: err.message || "단가표 저장 실패" }, 400);
  }
}
