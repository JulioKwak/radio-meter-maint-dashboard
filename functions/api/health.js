export async function onRequestGet() {
  return Response.json({
    ok: true,
    message: "dashboard api is running"
  });
}
