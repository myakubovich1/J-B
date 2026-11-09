import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { AuthScreen } from "@/components/auth-screen";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };
const errors: Record<string, string> = {
  confirmation_failed:
    "That confirmation link is invalid or expired. Sign in to request a new one.",
};
export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await currentUser()) redirect("/");
  const { error } = await searchParams;
  return (
    <AuthScreen
      local={process.env.APP_MODE !== "supabase"}
      initialMode="signin"
      initialError={error ? errors[error] : undefined}
    />
  );
}
