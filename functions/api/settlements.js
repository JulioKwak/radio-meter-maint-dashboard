function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

const QUARTER_END = { 1: "03-31", 2: "06-30", 3: "09-30", 4: "12-31" };

function quarterEndDate(year, quarter) {
  return `${year}-${QUARTER_END[quarter]}`;
}

function toApiRow(row) {
  return {
    resultType: row.result_type,
    count: Number(row.count || 0),
    unitFee: Number(row.unit_fee || 0),
    actualCost: Number(row.actual_cost || 0),
    note: row.note || "",
    lineTotal: Number(row.line_total || 0)
  };
}

async function getEffectiveFee(env, resultType, dateStr) {
  const row = await env.DB.prepare(`
    SELECT income_fee
    FROM fee_rates
    WHERE result_type = ?
      AND is_active = 1
      AND valid_from <= ?
      AND (valid_to IS NULL OR valid_to >= ?)
    ORDER BY valid_from DESC
    LIMIT 1
  `).bind(resultType, dateStr, dateStr).first();

  return Number(row?.income_fee || 0);
}

async function loadSettlement(env, year, quarter) {
  const typesResult = await env.DB.prepare(`
    SELECT DISTINCT result_type
    FROM fee_rates
    WHERE is_active = 1
    ORDER BY result_type
  `).all();

  const resultTypes = (typesResult.results || []).map(r => r.result_type);
  const endDate = quarterEndDate(year, quarter);

  const savedResult = await env.DB.prepare(`
    SELECT result_type, count, unit_fee, actual_cost, note, line_total
    FROM settlements
    WHERE settlement_year = ? AND settlement_quarter = ?
  `).bind(year, quarter).all();

  const savedMap = new Map((savedResult.results || []).map(r => [r.result_type, r]));

  const rows = [];
  for (const resultType of resultTypes) {
    const saved = savedMap.get(resultType);
    if (saved) {
      rows.push(toApiRow(saved));
    } else {
      const unitFee = await getEffectiveFee(env, resultType, endDate);
      rows.push({ resultType, count: 0, unitFee, actualCost: 0, note: "", lineTotal: 0 });
    }
  }

  // 단가표에서는 사라졌지만 과거에 저장된 정산 데이터가 있는 유형도 함께 보여줍니다.
  for (const [resultType, saved] of savedMap.entries()) {
    if (!resultTypes.includes(resultType)) rows.push(toApiRow(saved));
  }

  const totals = rows.reduce((acc, r) => {
    acc.count += r.count;
    acc.baseAmount += r.count * r.unitFee;
    acc.actualCost += r.actualCost;
    acc.amount += r.lineTotal;
    return acc;
  }, { count: 0, baseAmount: 0, actualCost: 0, amount: 0 });

  return { year, quarter, rows, totals };
}

export async function onRequestGet(context) {
  try {
    if (!context.env.DB) return json({ error: "D1 바인딩 DB가 없습니다." }, 500);

    const url = new URL(context.request.url);
    const year = Number(url.searchParams.get("year")) || new Date().getFullYear();
    const quarter = Number(url.searchParams.get("quarter")) || 1;

    if (quarter < 1 || quarter > 4) return json({ error: "분기는 1~4 사이여야 합니다." }, 400);

    return json(await loadSettlement(context.env, year, quarter));
  } catch (err) {
    return json({ error: "정산현황 조회 실패", message: err.message || String(err) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    if (!context.env.DB) return json({ error: "D1 바인딩 DB가 없습니다." }, 500);

    const body = await context.request.json();
    const year = Number(body.year);
    const quarter = Number(body.quarter);
    const rows = Array.isArray(body.rows) ? body.rows : [];

    if (!year || quarter < 1 || quarter > 4) {
      return json({ error: "연도/분기 값이 올바르지 않습니다." }, 400);
    }

    const endDate = quarterEndDate(year, quarter);

    for (const r of rows) {
      const resultType = String(r.resultType || "").trim();
      if (!resultType) continue;

      const count = Number(r.count) || 0;
      const actualCost = Number(r.actualCost) || 0;
      const note = String(r.note || "").trim();
      const unitFee = await getEffectiveFee(context.env, resultType, endDate);
      const lineTotal = count * unitFee + actualCost;

      await context.env.DB.prepare(`
        INSERT INTO settlements (
          settlement_year, settlement_quarter, result_type,
          count, unit_fee, actual_cost, note, line_total,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(settlement_year, settlement_quarter, result_type) DO UPDATE SET
          count = excluded.count,
          unit_fee = excluded.unit_fee,
          actual_cost = excluded.actual_cost,
          note = excluded.note,
          line_total = excluded.line_total,
          updated_at = CURRENT_TIMESTAMP
      `).bind(year, quarter, resultType, count, unitFee, actualCost, note, lineTotal).run();
    }

    return json({ ok: true, ...(await loadSettlement(context.env, year, quarter)) });
  } catch (err) {
    return json({ error: err.message || "정산현황 저장 실패" }, 400);
  }
}
