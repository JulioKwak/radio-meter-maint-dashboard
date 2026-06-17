function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

const EXPENSE_ITEMS = ["인건비", "차량렌탈비", "차량유지비", "성과급", "자재비"];

export async function onRequestGet(context) {
  const monthlyRows = await context.env.DB.prepare(`
    SELECT expense_month, labor_cost, car_rental_cost, car_maintenance_cost, bonus_cost, material_cost
    FROM monthly_expenses
    ORDER BY expense_month
  `).all();

  const wageRows = await context.env.DB.prepare(`
    SELECT wage_month, worker_name, amount
    FROM worker_wages
    ORDER BY wage_month, worker_name
  `).all();

  const monthlyExpenses = {};
  for (const row of monthlyRows.results || []) {
    monthlyExpenses[row.expense_month] = {
      "인건비": row.labor_cost || 0,
      "차량렌탈비": row.car_rental_cost || 0,
      "차량유지비": row.car_maintenance_cost || 0,
      "성과급": row.bonus_cost || 0,
      "자재비": row.material_cost || 0
    };
  }

  const workerWages = {};
  for (const row of wageRows.results || []) {
    if (!workerWages[row.wage_month]) workerWages[row.wage_month] = {};
    workerWages[row.wage_month][row.worker_name] = row.amount || 0;
  }

  return json({ monthlyExpenses, workerWages });
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const monthlyExpenses = body.monthlyExpenses || {};
    const workerWages = body.workerWages || {};

    await context.env.DB.prepare("DELETE FROM monthly_expenses").run();
    await context.env.DB.prepare("DELETE FROM worker_wages").run();

    for (const [month, items] of Object.entries(monthlyExpenses)) {
      if (!/^\d{4}-\d{2}$/.test(month)) continue;

      await context.env.DB.prepare(`
        INSERT INTO monthly_expenses (
          expense_month, labor_cost, car_rental_cost, car_maintenance_cost,
          bonus_cost, material_cost, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).bind(
        month,
        Number(items["인건비"] || 0),
        Number(items["차량렌탈비"] || 0),
        Number(items["차량유지비"] || 0),
        Number(items["성과급"] || 0),
        Number(items["자재비"] || 0)
      ).run();
    }

    for (const [month, workers] of Object.entries(workerWages)) {
      if (!/^\d{4}-\d{2}$/.test(month)) continue;

      for (const [worker, amount] of Object.entries(workers || {})) {
        const workerName = String(worker || "").trim();
        if (!workerName) continue;

        await context.env.DB.prepare(`
          INSERT INTO worker_wages (wage_month, worker_name, amount, updated_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        `).bind(month, workerName, Number(amount || 0)).run();
      }
    }

    return json({ ok: true });
  } catch (err) {
    return json({ error: err.message || "지출 저장 실패" }, 400);
  }
}
