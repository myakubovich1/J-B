import { notFound } from "next/navigation";
import { fixtureEnabled } from "@/lib/fixture";
export const dynamic = "force-dynamic";
export default function FixtureLayout({ children }: { children: React.ReactNode }) {
  if (!fixtureEnabled()) notFound();
  return (
    <main className="fixture-site">
      <div className="eyebrow">LOCAL TEST EMPLOYER · NO REAL APPLICATIONS</div>
      {children}
      <p className="helper-text">
        This fixture only verifies your local application workflow. No personal information is sent
        to an employer.
      </p>
    </main>
  );
}
