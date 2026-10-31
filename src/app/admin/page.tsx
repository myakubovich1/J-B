import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getAdminSnapshot, isAdmin } from "@/lib/admin";
import { AdminView } from "@/components/admin-view";
export const dynamic = "force-dynamic";
export default async function AdminPage() {
  const user = await currentUser();
  if (!isAdmin(user)) notFound();
  return <AdminView initial={await getAdminSnapshot(user)} />;
}
