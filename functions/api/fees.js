function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

function toApiFee(row) {
  return {
    resultType: row.result_type,
    incomeFee: row.income_fee || 0,
    updatedAt: row.updated_at
  };
}

export async function onRequestGet(context) {
  try {
    const result = await context.env.DB.prepare(`
      SELECT result_type, income_fee, updated_at
      FROM fee_rates
      ORDER BY result_type
    `).all();

    return json({ fees: (result.results || []).map(toApiFee) });
  } catch (err) {
    return json({ error: "단가표 조회 실패", message: err.message || String(err) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const fees = Array.isArray(body.fees) ? body.fees : [];

    await context.env.DB.prepare("DELETE FROM fee_rates").run();

    for (const f of fees) {
      const resultType = String(f.resultType || f.result_type || "").trim();
      if (!resultType) continue;

      await context.env.DB.prepare(`
        INSERT INTO fee_rates (result_type, income_fee, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `).bind(
        resultType,
        Number(f.incomeFee || f.income_fee || 0)
      ).run();
    }

    const result = await context.env.DB.prepare(`
      SELECT result_type, income_fee, updated_at
      FROM fee_rates
      ORDER BY result_type
    `).all();

    return json({ ok: true, fees: (result.results || []).map(toApiFee) });
  } catch (err) {
    return json({ error: err.message || "단가표 저장 실패" }, 400);
  }
}
