import { timingSafeEqual } from "node:crypto";
import { readiness } from "@/lib/health";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function detailAllowed(request: Request): boolean {
  const token = process.env.HEALTH_CHECK_TOKEN;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  return Boolean(
    token &&
    supplied.length === token.length &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(token)),
  );
}
/** Readiness for load balancers and uptime monitors: 503 only when requests cannot succeed. */
export async function GET(request: Request) {
  const result = await readiness();
  const body = detailAllowed(request)
    ? result
    : {
        status: result.status,
        checks: result.checks.map(({ name, status }) => ({ name, status })),
      };
  return Response.json(body, {
    status: result.status === "failed" ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
