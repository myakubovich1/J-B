import Link from "next/link";
import { fixtureJob, fixturePosting } from "@/lib/fixture";
export default function FixturePostingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(fixturePosting()).replaceAll("<", "\\u003c"),
        }}
      />
      <h1>{fixtureJob.title}</h1>
      <p>
        {fixtureJob.company} · {fixtureJob.location}
      </p>
      <div className="card">
        <h2>Build useful things with a thoughtful team.</h2>
        <p>
          This is a local application fixture. It exercises job reading, resume uploads, conditional
          questions, approvals, and receipt verification.
        </p>
        <h2>What you’ll bring</h2>
        <ul>
          <li>Experience with TypeScript, Python, or React through coursework or projects.</li>
          <li>Interest in accessible web applications and reliable APIs.</li>
          <li>A relevant degree in progress or equivalent experience.</li>
        </ul>
        <h2>The role</h2>
        <p>
          Summer internship in New York, United States. Work authorization and sponsorship answers
          must be explicitly confirmed by the candidate.
        </p>
        <Link href="/fixture/employer/software-intern/apply" className="button button-primary">
          Apply
        </Link>
      </div>
    </>
  );
}
