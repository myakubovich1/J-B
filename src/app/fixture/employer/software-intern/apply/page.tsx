import { fixtureJob } from "@/lib/fixture";
import { FixtureApplyForm } from "./apply-form";
export default function FixtureApplicationPage() {
  return (
    <>
      <h1>Apply to {fixtureJob.company}</h1>
      <p>
        {fixtureJob.title} · {fixtureJob.location}
      </p>
      <FixtureApplyForm initialApplicationId={crypto.randomUUID()} />
    </>
  );
}
