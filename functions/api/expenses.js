function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

const EXPENSE_ITEMS = ["인건비", "전문가 수수료", "차량렌탈비", "차량유지비", "성과급", "자재비"];

function parseMonthKey(monthKey) {
  const s = String(monthKey || "").trim();
  const match = s.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;

  return {
    year: Number(match[1]),
    month: Number(match[2])
  };
}

function makeMonthKey(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export async function onRequestGet(context) {
  try {
    const monthlyRows = await context.env.DB.prepare(`
      SELECT expense_year, expense_month, category, amount
      FROM monthly_expenses
      ORDER BY expense_year, expense_month, category
    `).all();

    const monthlyExpenses = {};

    for (const row of monthlyRows.results || []) {
      const monthKey = makeMonthKey(row.expense_year, row.expense_month);
      if (!monthlyExpenses[monthKey]) monthlyExpenses[monthKey] = {};
      monthlyExpenses[monthKey][row.category] = Number(row.amount || 0);
    }

    return json({ monthlyExpenses });
  } catch (err) {
    return json({ error: "지출 데이터 조회 실패", message: err.message || String(err) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const monthlyExpenses = body.monthlyExpenses || {};

    await context.env.DB.prepare(`DELETE FROM monthly_expenses`).run();

    for (const [monthKey, items] of Object.entries(monthlyExpenses)) {
      const parsed = parseMonthKey(monthKey);
      if (!parsed) continue;

      for (const item of EXPENSE_ITEMS) {
        const amount = Number(items?.[item] || 0);
        if (!amount) continue;

        await context.env.DB.prepare(`
          INSERT INTO monthly_expenses (
            expense_year, expense_month, category, amount, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(expense_year, expense_month, category) DO UPDATE SET
            amount = excluded.amount,
            updated_at = CURRENT_TIMESTAMP
        `).bind(parsed.year, parsed.month, item, amount).run();
      }
    }

    return json({ ok: true });
  } catch (err) {
    return json({ error: "지출 데이터 저장 실패", message: err.message || String(err) }, 500);
  }
}
