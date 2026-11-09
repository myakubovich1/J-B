import { redirect } from "next/navigation";
/** Common alias. Keeps older confirmation links and habits working. */
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const query = new URLSearchParams(await searchParams).toString();
  redirect(query ? `/signin?${query}` : "/signin");
}
