import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";
import { MarketingHome } from "@/components/marketing-home";
import { WorkspaceApp } from "@/components/workspace-app";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { absolute: "J*B — Your career. On autopilot." } };
export default async function Home() {
  const user = await currentUser();
  if (!user) return <MarketingHome />;
  return <WorkspaceApp initial={await getWorkspace(user)} />;
}
