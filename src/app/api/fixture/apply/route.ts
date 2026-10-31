import { NextResponse } from "next/server";
import { acceptFixtureApplication, fixtureEnabled, readFixtureForm } from "@/lib/fixture";
import { checkOrigin, errorResponse } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!fixtureEnabled()) return new Response("Not found", { status: 404 });
  try {
    checkOrigin(request);
    const result = await acceptFixtureApplication(await readFixtureForm(request));
    const base = process.env.APP_URL || request.url;
    return NextResponse.redirect(new URL(`/fixture/confirmation/${result.id}`, base), {
      status: 303,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
