import { currentUser } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";
import { AuthScreen } from "@/components/auth-screen";
import { WorkspaceApp } from "@/components/workspace-app";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await currentUser();
  if (!user) return <AuthScreen local={process.env.APP_MODE !== "supabase"} />;
  return <WorkspaceApp initial={await getWorkspace(user)} />;
}
