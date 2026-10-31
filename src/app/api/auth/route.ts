import { NextResponse } from "next/server";
import { z } from "zod";
import {
  assertSameOrigin,
  currentUser,
  enforceRateLimit,
  signIn,
  signOut,
  signUp,
} from "@/lib/auth";
export const runtime = "nodejs";
const schema = z.object({
  action: z.enum(["signup", "signin", "signout"]),
  email: z.string().email().max(254).optional(),
  password: z.string().min(10).max(200).optional(),
  name: z.string().max(200).default(""),
});
export async function GET() {
  return NextResponse.json(
    { user: await currentUser() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = schema.parse(await request.json());
    if (body.action === "signout") {
      await signOut();
      return NextResponse.json({ ok: true });
    }
    if (!body.email || !body.password)
      return NextResponse.json(
        {
          error: "Email and a password of at least 10 characters are required",
        },
        { status: 400 },
      );
    await enforceRateLimit(`auth:${body.email.toLowerCase()}`, 12, 300);
    const user =
      body.action === "signup"
        ? await signUp(body.email, body.password, body.name)
        : await signIn(body.email, body.password);
    return NextResponse.json({ user, confirmationRequired: !user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authentication failed";
    return NextResponse.json(
      { error: message },
      { status: message.includes("Too many") ? 429 : 400 },
    );
  }
}
