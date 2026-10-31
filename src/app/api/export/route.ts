import { requireUser, errorResponse } from "@/lib/http";
import { getStore } from "@/lib/store";
export async function GET() {
  try {
    const user = await requireUser();
    const apps = await getStore().list("applications", user.id);
    const cell = (v: string) =>
      `"${(/^[=+@\-\t\r]/.test(v) ? "'" : "") + v.replaceAll('"', '""')}"`;
    const rows = [
      ["Company", "Title", "URL", "Status", "Submitted", "Confirmation"],
      ...apps.map((a) => [
        a.job?.company ?? "",
        a.job?.title ?? "",
        a.jobUrl,
        a.status,
        a.submittedAt ?? "",
        a.receipt?.confirmation ?? "",
      ]),
    ];
    return new Response(rows.map((r) => r.map(cell).join(",")).join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=applications.csv",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
