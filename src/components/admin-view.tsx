"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  CreditCard,
  Database,
  RefreshCw,
  ShieldCheck,
  Users,
  Zap,
} from "lucide-react";
import type { AdminSnapshot } from "@/lib/admin";
import { Badge, Button, Card } from "./ui";

const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
const number = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
const percentage = (value: number | null) =>
  value === null ? "No observations" : `${number(value * 100)}%`;
export function AdminView({ initial }: { initial: AdminSnapshot }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin", { cache: "no-store" });
      if (!response.ok)
        throw new Error(
          response.status === 403 || response.status === 401
            ? "Operator access is no longer available."
            : "Metrics are temporarily unavailable.",
        );
      setData((await response.json()) as AdminSnapshot);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load metrics");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = setInterval(() => void refresh(), 30000);
    return () => clearInterval(timer);
  }, [refresh]);
  const outcomeMetrics = [
    {
      label: "Application completion",
      value: data.outcomes.applicationCompletion,
      note: "Verified receipts / applications first attempted this month.",
    },
    {
      label: "Submission verification",
      value: data.outcomes.submissionVerification,
      note: "Verified receipts / applications whose submission started this month.",
    },
    {
      label: "Clarification frequency",
      value: data.outcomes.clarificationFrequency,
      note: "Applications with a screening question / first-attempt cohort. Login and submission approvals are excluded.",
    },
    {
      label: "Resume generation success",
      value: data.outcomes.resumeGeneration,
      note: "Successful / finished measured generations, including compilation and PDF validation. Older uninstrumented attempts are excluded.",
    },
    {
      label: "Saved PDF validation",
      value: data.outcomes.savedResumeValidation,
      note: "Valid / saved resume artifacts generated this month. Compiler crashes that produced no artifact are excluded.",
    },
  ];
  const metrics = [
    {
      label: "Active users · 30 days",
      value: number(data.activeUsers30d),
      detail: `${number(data.users)} accounts total`,
      icon: Users,
    },
    {
      label: "Paid subscribers",
      value: number(data.paidSubscribers),
      detail: `${number(data.trialSubscribers)} trials`,
      icon: CreditCard,
    },
    {
      label: "Nominal monthly revenue",
      value: money(data.nominalMrrUsd),
      detail: "Configured monthly plan prices",
      icon: ArrowUpRight,
    },
    {
      label: "Verified submissions",
      value: number(data.verifiedSubmissions),
      detail: `${number(data.attempts)} application attempts`,
      icon: CheckCircle2,
    },
  ];
  const maximum = Math.max(1, ...data.daily.map((day) => Math.max(day.attempts, day.verified)));
  return (
    <main className="mx-auto max-w-7xl px-6 py-8 sm:px-10">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-5">
        <div>
          <a className="text-link mb-6" href="/">
            <ArrowLeft size={13} />
            Back to your agent
          </a>
          <div className="eyebrow">
            <ShieldCheck size={12} />
            OPERATOR WORKSPACE
          </div>
          <h1 className="mt-3 font-serif text-4xl tracking-tight">A clear view of the work.</h1>
          <p className="mt-3 text-xs text-[var(--muted)]">
            {data.periodLabel} · UTC calendar month · Refreshes every 30 seconds
          </p>
        </div>
        <Button variant="secondary" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={13} className={loading ? "spin" : ""} />
          Refresh metrics
        </Button>
      </header>
      {error && (
        <p
          role="alert"
          className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-800"
        >
          {error}
        </p>
      )}
      <Card className="mb-6 flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--sage)]">
            <Activity size={17} />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Execution controls</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {data.running} running · {data.queueDepth} queued · {data.waiting} waiting for input
            </p>
          </div>
        </div>
        <Badge tone={data.emergencyStop ? "red" : "green"}>
          {data.emergencyStop ? "Emergency stop active" : "Execution enabled"}
        </Badge>
        <p className="basis-full text-[11px] text-[var(--muted)]">
          The emergency stop is controlled by operator configuration on the web and worker hosts.
          Active portal submissions require receipt reconciliation.
        </p>
      </Card>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ label, value, detail, icon: Icon }) => (
          <Card key={label} className="p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <span className="text-[11px] text-[var(--muted)]">{label}</span>
              <Icon size={15} className="text-[var(--green)]" />
            </div>
            <p className="font-serif text-3xl">{value}</p>
            <p className="mt-2 text-[10px] text-[var(--muted)]">{detail}</p>
          </Card>
        ))}
      </div>
      <Card className="mb-6 p-6">
        <h2 className="text-sm font-semibold">Outcome rates</h2>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Application cohorts count distinct applications, including{" "}
          {data.outcomes.inProgressApplications} still in progress. Retries do not add applications
          to a cohort.
        </p>
        <dl className="mt-6 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {outcomeMetrics.map(({ label, value, note }) => (
            <div key={label} className="border-t border-[var(--line)] pt-4">
              <dt className="text-[11px] font-medium">{label}</dt>
              <dd className="mt-2 text-xl">{percentage(value.rate)}</dd>
              <dd className="mt-1 text-[11px] text-[var(--muted)]">
                {value.numerator} of {value.denominator}
              </dd>
              <dd className="mt-2 text-[10px] leading-relaxed text-[var(--muted)]">{note}</dd>
            </div>
          ))}
          <div className="border-t border-[var(--line)] pt-4">
            <dt className="text-[11px] font-medium">Mean application execution cost</dt>
            <dd className="mt-2 text-xl">
              {data.outcomes.meanApplicationCostUsd === null
                ? "No observations"
                : money(data.outcomes.meanApplicationCostUsd)}
            </dd>
            <dd className="mt-2 text-[10px] leading-relaxed text-[var(--muted)]">
              Recorded costs allocated to the first-attempt cohort, including retries and partial
              work, divided by its application count. Unallocated chat costs are excluded.
              {!data.outcomes.applicationCostEstimateComplete && " Unit pricing is incomplete."}
            </dd>
          </div>
        </dl>
      </Card>
      <div className="mb-6 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card className="min-w-0 p-6">
          <div className="flex-between mb-7">
            <h2 className="text-sm font-semibold">Application activity</h2>
            <span className="text-[10px] text-[var(--muted)]">This month</span>
          </div>
          <div
            className="flex h-36 items-end gap-1"
            role="img"
            aria-label={`This month: ${data.attempts} attempts and ${data.verifiedSubmissions} verified submissions. Daily values follow in the table.`}
          >
            {data.daily.map((day) => (
              <div
                key={day.day}
                className="flex h-full flex-1 items-end justify-center gap-px"
                title={`${day.day}: ${day.attempts} attempts, ${day.verified} verified`}
              >
                <span
                  className="min-w-px flex-1 rounded-t bg-[#e9dfd0]"
                  style={{ height: `${(day.attempts / maximum) * 100}%` }}
                />
                <span
                  className="min-w-px flex-1 rounded-t bg-[#8a9c77]"
                  style={{ height: `${(day.verified / maximum) * 100}%` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-between text-[10px] text-[var(--muted)]">
            <span>
              {data.daily[0]?.day.slice(-2)} {data.periodLabel.split(" ")[0]}
            </span>
            <span>Today</span>
          </div>
          <div className="mt-5 flex gap-5 text-[10px] text-[var(--muted)]">
            <span className="flex items-center gap-2">
              <i className="h-2 w-2 rounded-sm bg-[#e9dfd0]" />
              Attempts
            </span>
            <span className="flex items-center gap-2">
              <i className="h-2 w-2 rounded-sm bg-[#8a9c77]" />
              Verified
            </span>
          </div>
          <details className="mt-5 text-xs">
            <summary className="cursor-pointer text-[var(--green)]">View daily values</summary>
            <div className="mt-3 max-h-48 overflow-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Daily application activity in UTC</caption>
                <thead>
                  <tr>
                    <th scope="col" className="py-2">
                      Day
                    </th>
                    <th scope="col">Attempts</th>
                    <th scope="col">Verified</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((day) => (
                    <tr key={day.day} className="border-t border-[var(--line)]">
                      <th scope="row" className="py-2 font-normal">
                        {day.day}
                      </th>
                      <td>{day.attempts}</td>
                      <td>{day.verified}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </Card>
        <Card className="p-6">
          <h2 className="mb-6 text-sm font-semibold">Execution health</h2>
          <dl className="space-y-5">
            {[
              ["Failed applications", number(data.failedApplications)],
              ["Unverified submissions", number(data.unverifiedApplications)],
              [
                "Average runtime",
                data.averageRuntimeSeconds === null
                  ? "No finished runs"
                  : `${number(data.averageRuntimeSeconds)} sec`,
              ],
              ["Internal retries", number(data.retries)],
              ["Expired worker leases", number(data.expiredLeases)],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-4 border-b border-[var(--line)] pb-4 text-xs"
              >
                <dt className="text-[var(--muted)]">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-5 text-[10px] text-[var(--muted)]">
            Elapsed runtime uses {data.measuredRuns} finished application runs and may include
            approval pauses.
          </p>
        </Card>
      </div>
      <div className="mb-6 grid gap-5 lg:grid-cols-2">
        <Card className="p-6">
          <div className="flex-between mb-6">
            <h2 className="text-sm font-semibold">Resource usage</h2>
            <Database size={15} className="text-[var(--green)]" />
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-7">
            {[
              ["Browser minutes", number(data.browserMinutes)],
              ["Model input tokens", number(data.inputTokens)],
              ["Model output tokens", number(data.outputTokens)],
              ["Recorded cost estimate", money(data.recordedCostUsd)],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-[10px] text-[var(--muted)]">{label}</p>
                <p className="mt-2 text-xl">{value}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-[10px] text-[var(--muted)]">
            Cost per verified submission:{" "}
            {data.costPerVerifiedSubmissionUsd === null
              ? "Not yet available"
              : money(data.costPerVerifiedSubmissionUsd)}
            . Includes recorded retry costs.
          </p>
          {!data.costEstimateComplete && (
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-[11px] text-amber-900">
              Cost estimates are incomplete. Configure model and browser unit prices before using
              them for budget decisions.
            </p>
          )}
        </Card>
        <Card className="p-6">
          <div className="flex-between mb-6">
            <h2 className="text-sm font-semibold">Failure categories</h2>
            <Zap size={15} className="text-[var(--green)]" />
          </div>
          {data.failureCategories.length ? (
            <ul className="space-y-4">
              {data.failureCategories.map((item) => (
                <li
                  key={item.category}
                  className="flex-between border-b border-[var(--line)] pb-3 text-xs"
                >
                  <span className="text-[var(--muted)]">{item.category}</span>
                  <strong className="font-medium">{item.count}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-xs text-[var(--muted)]">No failed runs recorded this month.</p>
          )}
        </Card>
      </div>
      <Card className="mb-6 overflow-hidden">
        <div className="p-6">
          <h2 className="text-sm font-semibold">Execution cost alerts</h2>
          <p className="mt-2 text-[11px] text-[var(--muted)]">
            {data.costAlertCount} observations this month · Latest 50 · Saved in-app and shown to
            the affected user. External alert delivery is not configured by this feature.
          </p>
        </div>
        {data.costAlerts.length ? (
          <div className="overflow-auto">
            <table className="w-full min-w-[680px] text-left text-xs">
              <caption className="sr-only">
                Recorded execution cost threshold and pricing alerts
              </caption>
              <thead className="bg-[#f4f5ef] text-[10px] text-[var(--muted)]">
                <tr>
                  {["Observed (UTC)", "Customer", "Signal", "Recorded cost", "Threshold"].map(
                    (label) => (
                      <th key={label} scope="col" className="px-6 py-3 font-medium">
                        {label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {data.costAlerts.map((alert, index) => (
                  <tr
                    key={`${alert.customer}:${alert.kind}:${alert.observedAt}:${index}`}
                    className="border-t border-[var(--line)]"
                  >
                    <td className="px-6 py-4">
                      <time dateTime={alert.observedAt}>
                        {new Date(alert.observedAt).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "UTC",
                        })}
                      </time>
                    </td>
                    <th scope="row" className="px-6 py-4 font-mono text-[11px] font-normal">
                      {alert.customer}
                    </th>
                    <td className="px-6 py-4">
                      {
                        {
                          expensive_application: "Application cost",
                          monthly_budget: "Monthly budget",
                          pricing_incomplete: "Missing unit prices",
                        }[alert.kind]
                      }
                      {!alert.estimateComplete && (
                        <span className="mt-1 block text-[10px] text-[var(--muted)]">
                          Estimate incomplete
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">{money(alert.recordedCostUsd)}</td>
                    <td className="px-6 py-4">
                      {alert.thresholdUsd === null ? "Not applicable" : money(alert.thresholdUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-6 pb-6 text-xs text-[var(--muted)]">
            No cost threshold or pricing alerts were recorded this month.
          </p>
        )}
      </Card>
      <Card className="overflow-hidden">
        <div className="flex-between p-6">
          <div>
            <h2 className="text-sm font-semibold">Cost by customer</h2>
            <p className="mt-2 text-[10px] text-[var(--muted)]">
              Pseudonymous customer references · Top 50 by recorded cost
            </p>
          </div>
          <Users size={15} className="text-[var(--green)]" />
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-[500px] text-left text-xs">
            <caption className="sr-only">Monthly execution costs by pseudonymous customer</caption>
            <thead className="bg-[#f4f5ef] text-[10px] text-[var(--muted)]">
              <tr>
                {["Customer", "Attempts", "Verified", "Recorded cost"].map((label) => (
                  <th scope="col" key={label} className="px-6 py-3 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.customers.map((customer) => (
                <tr key={customer.customer} className="border-t border-[var(--line)]">
                  <th scope="row" className="px-6 py-4 font-mono text-[11px] font-normal">
                    {customer.customer}
                  </th>
                  <td className="px-6 py-4">{customer.attempts}</td>
                  <td className="px-6 py-4">{customer.verified}</td>
                  <td className="px-6 py-4">{money(customer.costUsd)}</td>
                </tr>
              ))}
              {!data.customers.length && (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-[var(--muted)]">
                    Customer usage will appear after the worker records an operation.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <footer className="mt-6 flex flex-wrap justify-between gap-3 text-[10px] text-[var(--muted)]">
        <span>
          Aggregate operational data. Contact details, answers, documents, and payment identifiers
          are excluded.
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock3 size={11} />
          Updated{" "}
          {new Date(data.generatedAt).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "UTC",
          })}{" "}
          UTC
        </span>
      </footer>
      <p className="mt-4 text-[10px] text-[var(--muted)]">
        Nominal recurring revenue excludes trials, discounts, proration, taxes, and failed payments.
        It is a plan-price estimate.
      </p>
    </main>
  );
}
