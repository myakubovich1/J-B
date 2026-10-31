import Link from "next/link";
import { notFound } from "next/navigation";
import { getFixtureReceipt } from "@/lib/fixture";
export default async function FixtureConfirmationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = getFixtureReceipt(id);
  if (!result) notFound();
  return (
    <>
      <h1>Application received.</h1>
      <div className="card" data-testid="confirmation">
        <h2>Thank you. Your test application was submitted.</h2>
        <p>
          Northstar Labs (test employer) received your Software Engineering Intern application and
          validated your PDF upload.
        </p>
        <p>
          Confirmation receipt: <strong>{result.id}</strong>
        </p>
        <p>Received: {result.createdAt}</p>
        <p>
          Resume SHA-256: <code style={{ overflowWrap: "anywhere" }}>{result.pdfHash}</code>
        </p>
        <p>This receipt exists only after the employer form was submitted successfully.</p>
      </div>
      <Link href="/#applications" className="button button-secondary">
        Return to applications
      </Link>
    </>
  );
}
