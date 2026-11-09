import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { AuthScreen } from "@/components/auth-screen";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create your account" };
export default async function SignUp() {
  if (await currentUser()) redirect("/");
  return <AuthScreen local={process.env.APP_MODE !== "supabase"} initialMode="signup" />;
}
