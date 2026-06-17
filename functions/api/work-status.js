export async function onRequestGet(context) {
  const result = await context.env.DB.prepare(`
    SELECT
      COUNT(*) AS total_count,
      SUM(CASE WHEN status = '보완' THEN 1 ELSE 0 END) AS supplement_count,
      SUM(CASE WHEN status = '완료' THEN 1 ELSE 0 END) AS complete_count
    FROM maintenance_jobs
  `).first();

  return Response.json({
    total_count: result.total_count ?? 0,
    supplement_count: result.supplement_count ?? 0,
    complete_count: result.complete_count ?? 0
  });
}
