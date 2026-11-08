export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Liveness: the web process is serving. Dependencies are checked by /api/ready. */
export function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
