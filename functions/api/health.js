export async function onRequestGet() {
  return Response.json({
    ok: true,
    service: "radio-meter-maint-dashboard",
    message: "API 정상 동작 중"
  });
}
