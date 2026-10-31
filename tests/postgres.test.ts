import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { emptyProfile, entity, type Application, type AgentRun } from "../src/lib/contracts";

// Executes the actual relational migration core in PostgreSQL/WASM. The Supabase
// auth/storage schema shells below do not emulate hosted Auth, Storage, or Vault.
describe("PostgreSQL migration, RLS, queue and quota contracts", () => {
  const db = new PGlite();
  const user = crypto.randomUUID(),
    other = crypto.randomUUID();
  const application: Application = {
    ...entity(user),
    jobUrl: "https://jobs.lever.co/fixture/one",
    job: null,
    status: "discovered",
    runId: crypto.randomUUID(),
    resumeId: null,
    matchScore: null,
    matchReasons: [],
    answers: {},
    receipt: null,
    error: null,
    submittedAt: null,
    submissionStartedAt: null,
    approvalId: null,
  };
  beforeAll(async () => {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key);create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid()to authenticated,service_role;
      create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(name text)returns text[] language sql immutable as $$select string_to_array(name,'/')$$;`);
    const filename = (await readdir("supabase/migrations")).find((f) => f.endsWith(".sql"))!;
    const migration = await readFile(`supabase/migrations/${filename}`, "utf8");
    // PGlite lacks the hosted Supabase Vault extension and pgcrypto. UUIDs use
    // PostgreSQL's built-in gen_random_uuid; the tested SQL core is unchanged.
    const core = migration
      .split("create extension if not exists supabase_vault")[0]
      .replace("create extension if not exists pgcrypto;", "");
    await db.exec(core);
    await db.query("insert into auth.users(id)values($1),($2)", [user, other]);
    await db.query("select public.save_owned_record($1,$2,$3,$4::jsonb)", [
      "applications",
      application.id,
      user,
      JSON.stringify(application),
    ]);
  }, 30000);
  afterAll(async () => {
    await db.close();
  });
  it("keeps inventory projections and owner constraints in the profile transaction", async () => {
    const profile = emptyProfile("postgres@example.test", "SQL Fixture");
    profile.skills = ["TypeScript"];
    profile.education = [
      {
        id: crypto.randomUUID(),
        school: "Fixture University",
        degree: "BS",
        major: "CS",
        startDate: "2023",
        endDate: "2027",
      },
    ];
    const record = { ...entity(user), profile, version: 1 };
    await db.query("select public.save_owned_record($1,$2,$3,$4::jsonb)", [
      "candidate_profiles",
      record.id,
      user,
      JSON.stringify(record),
    ]);
    expect(
      (await db.query("select id from public.skills where user_id=$1", [user])).rows,
    ).toHaveLength(1);
    expect(
      (await db.query("select id from public.education where user_id=$1", [user])).rows,
    ).toHaveLength(1);
    await expect(
      db.query("select public.save_owned_record($1,$2,$3,$4::jsonb)", [
        "candidate_profiles",
        record.id,
        other,
        JSON.stringify({ ...record, userId: other }),
      ]),
    ).rejects.toThrow("belongs to another user");
  });
  it("allows own reads and blocks cross-tenant reads and privileged calls", async () => {
    await db.exec("set role authenticated");
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
      expect((await db.query("select id from public.applications")).rows).toHaveLength(1);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
      expect((await db.query("select id from public.applications")).rows).toHaveLength(0);
      await expect(db.query("select public.claim_agent_run('forbidden',300,2)")).rejects.toThrow(
        "permission denied",
      );
      await expect(
        db.query("insert into public.subscriptions(id,user_id,data)values($1,$2,$3)", [
          crypto.randomUUID(),
          other,
          JSON.stringify({ plan: "autonomous" }),
        ]),
      ).rejects.toThrow("permission denied");
    } finally {
      await db.exec("reset role");
    }
  });
  it("atomically claims a run once and serializes jobs within a tenant", async () => {
    const run: AgentRun = {
      ...entity(user, application.runId),
      kind: "application",
      applicationId: application.id,
      status: "queued",
      stage: "reading_job",
      attempts: 0,
      maxAttempts: 3,
      leaseUntil: null,
      nextAttemptAt: new Date().toISOString(),
      error: null,
      approved: false,
      submitted: false,
    };
    for (const item of [run, { ...run, id: crypto.randomUUID() }])
      await db.query("select public.save_owned_record($1,$2,$3,$4::jsonb)", [
        "agent_runs",
        item.id,
        user,
        JSON.stringify(item),
      ]);
    const claimed = await db.query<{ value: AgentRun }>(
      "select public.claim_agent_run('worker',300,2)as value",
    );
    expect(claimed.rows[0].value.status).toBe("running");
    expect(claimed.rows[0].value.attempts).toBe(1);
    expect(
      (
        await db.query<{ value: AgentRun | null }>(
          "select public.claim_agent_run('worker',300,2)as value",
        )
      ).rows[0].value,
    ).toBeNull();
  });
  it("reserves a quota once and requires receipt evidence before consumption", async () => {
    expect(
      (
        await db.query<{ value: boolean }>("select public.reserve_submission($1,$2,1)as value", [
          user,
          application.id,
        ])
      ).rows[0].value,
    ).toBe(true);
    expect(
      (
        await db.query<{ value: boolean }>("select public.reserve_submission($1,$2,1)as value", [
          user,
          application.id,
        ])
      ).rows[0].value,
    ).toBe(true);
    await expect(
      db.query("select public.record_verified_submission($1,$2)", [user, application.id]),
    ).rejects.toThrow("Verifiable receipt required");
    const second = {
      ...application,
      id: crypto.randomUUID(),
      jobUrl: "https://jobs.lever.co/fixture/two",
    };
    await db.query("select public.save_owned_record($1,$2,$3,$4::jsonb)", [
      "applications",
      second.id,
      user,
      JSON.stringify(second),
    ]);
    expect(
      (
        await db.query<{ value: boolean }>("select public.reserve_submission($1,$2,1)as value", [
          user,
          second.id,
        ])
      ).rows[0].value,
    ).toBe(false);
    const confirmed = {
      ...application,
      status: "submitted",
      receipt: {
        confirmation: "Test receipt",
        url: "https://example.test/receipt",
        verifiedAt: new Date().toISOString(),
      },
    };
    await db.query("select public.save_owned_record($1,$2,$3,$4::jsonb)", [
      "applications",
      application.id,
      user,
      JSON.stringify(confirmed),
    ]);
    await db.query("select public.record_verified_submission($1,$2)", [user, application.id]);
    await db.query("select public.record_verified_submission($1,$2)", [user, application.id]);
    expect(
      (
        await db.query(
          "select id from public.usage_events where data->>'kind'='verified_submission'",
        )
      ).rows,
    ).toHaveLength(1);
  });
});
