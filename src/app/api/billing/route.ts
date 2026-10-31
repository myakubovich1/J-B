import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, currentUser, enforceRateLimit } from "@/lib/auth";
import { createCheckout, createPortal, getPlanState, stripeReady } from "@/lib/billing";
export const runtime = "nodejs";
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  return NextResponse.json({
    ...(await getPlanState(user.id)),
    configured: stripeReady(),
  });
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    await enforceRateLimit(`billing:${user.id}`, 10, 60);
    const body = z
      .object({
        action: z.enum(["checkout", "portal"]),
        plan: z.enum(["pro", "autonomous"]).optional(),
      })
      .parse(await request.json());
    const url =
      body.action === "portal"
        ? await createPortal(user.id)
        : await createCheckout(user.id, user.email, body.plan || "pro");
    return NextResponse.json({ url });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Billing request failed",
      },
      { status: 400 },
    );
  }
}
