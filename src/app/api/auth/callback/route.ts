import { NextResponse } from "next/server";
import { supabaseAuth } from "@/lib/auth";
import type { EmailOtpType } from "@supabase/supabase-js";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const client = await supabaseAuth();
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  let error: unknown = null;
  if (code) {
    const result = await client.auth.exchangeCodeForSession(code);
    error = result.error;
  } else if (
    tokenHash &&
    type &&
    ["signup", "email", "recovery", "invite", "magiclink"].includes(type)
  ) {
    const result = await client.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    });
    error = result.error;
  } else error = new Error("Missing confirmation code");
  return NextResponse.redirect(
    new URL(error ? "/signin?error=confirmation_failed" : "/", process.env.APP_URL || url.origin),
  );
}
