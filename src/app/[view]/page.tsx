import { redirect, notFound } from "next/navigation";
export default async function ViewAlias({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  if (
    ![
      "agent",
      "profile",
      "resumes",
      "applications",
      "discover",
      "integrations",
      "settings",
    ].includes(view)
  )
    notFound();
  redirect(`/#${view}`);
}
