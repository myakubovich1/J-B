import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { entity, emptyProfile } from "../src/lib/contracts";
import { SupabaseStore } from "../src/lib/store";

const enabled = process.env.RUN_SUPABASE_INTEGRATION === "true";
describe.skipIf(!enabled)("live Supabase tenant isolation", () => {
  const ids: string[] = [];
  let service: SupabaseClient;
  let first: SupabaseClient;
  let second: SupabaseClient;
  const store = new SupabaseStore();
  beforeAll(async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const password = `Test-${crypto.randomUUID()}`;
    const clients: SupabaseClient[] = [];
    for (let index = 0; index < 2; index++) {
      const email = `career-integration-${crypto.randomUUID()}@example.test`;
      const { data, error } = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error || !data.user) throw error || new Error("User creation failed");
      ids.push(data.user.id);
      const client = createClient(url, key, {
        auth: { persistSession: false },
      });
      const result = await client.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      clients.push(client);
    }
    first = clients[0];
    second = clients[1];
  });
  afterAll(async () => {
    for (const id of ids) await service.auth.admin.deleteUser(id);
  });
  it("persists records and enforces RLS independently of service filters", async () => {
    const record = {
      ...entity(ids[0]),
      profile: emptyProfile("candidate@example.test", "Integration Candidate"),
      version: 1,
    };
    await store.save("candidate_profiles", record);
    expect((await store.get("candidate_profiles", record.id, ids[0]))?.profile.legalName).toBe(
      "Integration Candidate",
    );
    expect(await store.get("candidate_profiles", record.id, ids[1])).toBeNull();
    const own = await first.from("candidate_profiles").select("data");
    expect(own.error).toBeNull();
    expect(own.data).toHaveLength(1);
    const other = await second.from("candidate_profiles").select("data");
    expect(other.error).toBeNull();
    expect(other.data).toEqual([]);
    const escalation = await first.from("subscriptions").insert({
      id: crypto.randomUUID(),
      user_id: ids[0],
      data: { plan: "autonomous" },
    });
    expect(escalation.error).not.toBeNull();
  });
});
