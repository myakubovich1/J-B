import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { AdminAccessError, getAdminSnapshot } from "@/lib/admin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json(await getAdminSnapshot(await currentUser()), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof AdminAccessError ? error.message : "Unable to load operator metrics",
      },
      {
        status: error instanceof AdminAccessError ? error.status : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
