import {
  Activity,
  Clock3,
  Radio,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  TrendingUp,
} from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { SignetShell } from "../components/signet-shell";
import { createClient } from "../lib/supabase/server";

export const dynamic = "force-dynamic";

type EngagementRow = {
  stream_id: string;
  name: string | null;
  client: string | null;
  fee_model: "fixed" | "tm" | "retainer" | null;
  fee_amount: number | string | null;
  planned_hours: number | string | null;
  hours_logged: number | string;
  cost_accrued: number | string;
  unbilled_amount: number | string;
  approved_co_hours: number | string;
  status: string;
  last_event_seq: number | string;
};

type SignalRow = {
  signal_id: string;
  stream_type: string;
  stream_id: string;
  code: "OVER_BUDGET" | "SCOPE_DRIFT" | "STALE" | "UNBILLED" | "UNRECONCILED";
  severity: "amber" | "red";
  detail: Record<string, unknown>;
  evidence_seqs: Array<number | string>;
  computed_at: string;
};

type BudgetLineRow = {
  stream_id: string;
  engagement_id: string;
};

type InvoiceRow = {
  stream_id: string;
  engagement_id: string;
};

type LedgerRow = {
  seq: number | string;
  hash: string | null;
};

function n(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number) {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    notation: Math.abs(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) >= 1000 ? 1 : 0,
  }).format(value);
}

function pct(value: number | null) {
  return value === null || !Number.isFinite(value) ? "—" : `${value.toFixed(1)}%`;
}

function metricForEngagement(row: EngagementRow) {
  const fee = n(row.fee_amount);
  const cost = n(row.cost_accrued);
  const planned = n(row.planned_hours);
  const approved = n(row.approved_co_hours);
  const logged = n(row.hours_logged);
  const capacity = planned + approved;

  return {
    margin: fee > 0 ? ((fee - cost) / fee) * 100 : null,
    burn: capacity > 0 ? (logged / capacity) * 100 : null,
  };
}

function signalLabel(code: SignalRow["code"]) {
  switch (code) {
    case "SCOPE_DRIFT":
      return "Scope drift";
    case "OVER_BUDGET":
      return "Over budget";
    case "STALE":
      return "Stale";
    case "UNBILLED":
      return "Unbilled";
    case "UNRECONCILED":
      return "Unreconciled";
  }
}

function signalDescription(
  signal: SignalRow,
  engagementName: string | undefined
) {
  const d = signal.detail ?? {};
  const target = engagementName ?? "Operational stream";

  switch (signal.code) {
    case "SCOPE_DRIFT":
      return `${target}: ${n(d.hours_logged).toFixed(1)}h logged against ${n(
        d.planned_hours
      ).toFixed(1)}h planned plus ${n(d.approved_co_hours).toFixed(
        1
      )}h approved scope.`;

    case "OVER_BUDGET":
      return `${target}: budget utilization is ${n(d.burn_pct).toFixed(1)}%.`;

    case "STALE":
      return `${target}: no qualifying activity for ${n(
        d.days_since_activity
      ).toFixed(1)} days.`;

    case "UNBILLED":
      return `${target}: ${money(n(d.unbilled_amount))} remains unbilled after ${n(
        d.days_since_reference
      ).toFixed(1)} days.`;

    case "UNRECONCILED":
      return `${target}: invoice total ${money(
        n(d.invoice_amount)
      )} does not match line total ${money(n(d.lines_sum))}.`;
  }
}

function MetricCard({
  label,
  value,
  meta,
  tone = "default",
  icon,
}: {
  label: string;
  value: string;
  meta: string;
  tone?: "default" | "red" | "amber" | "green";
  icon: ReactNode;
}) {
  return (
    <article className="metric-card">
      <div className="metric-content">
        <div className="metric-label">{label}</div>
        <div className={`metric-value ${tone}`}>{value}</div>
        <div className="metric-meta">{meta}</div>
      </div>
      <div className={`metric-icon ${tone}`}>{icon}</div>
    </article>
  );
}

export default async function Home() {
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims) {
    redirect("/login?next=/");
  }

  const [
    engagementResult,
    signalResult,
    budgetLineResult,
    invoiceResult,
    ledgerResult,
  ] = await Promise.all([
    supabase
      .from("proj_engagements")
      .select(
        "stream_id,name,client,fee_model,fee_amount,planned_hours,hours_logged,cost_accrued,unbilled_amount,approved_co_hours,status,last_event_seq"
      )
      .eq("status", "active")
      .order("last_event_seq", { ascending: false }),
    supabase
      .from("signals")
      .select(
        "signal_id,stream_type,stream_id,code,severity,detail,evidence_seqs,computed_at"
      )
      .is("cleared_at", null)
      .order("computed_at", { ascending: false }),
    supabase
      .from("proj_budget_lines")
      .select("stream_id,engagement_id"),
    supabase
      .from("proj_invoices")
      .select("stream_id,engagement_id"),
    supabase.rpc("get_trust_ledger_head"),
  ]);

  const engagements = (engagementResult.data ?? []) as EngagementRow[];
  const signals = (signalResult.data ?? []) as SignalRow[];
  const budgetLines = (budgetLineResult.data ?? []) as BudgetLineRow[];
  const invoices = (invoiceResult.data ?? []) as InvoiceRow[];
  const ledger = (ledgerResult.data ?? []) as LedgerRow[];

  const engagementById = new Map(
    engagements.map((row) => [row.stream_id, row])
  );
  const budgetToEngagement = new Map(
    budgetLines.map((row) => [row.stream_id, row.engagement_id])
  );
  const invoiceToEngagement = new Map(
    invoices.map((row) => [row.stream_id, row.engagement_id])
  );

  function engagementIdForSignal(signal: SignalRow) {
    if (signal.stream_type === "engagement") return signal.stream_id;
    if (signal.stream_type === "budget_line")
      return budgetToEngagement.get(signal.stream_id);
    if (signal.stream_type === "invoice")
      return invoiceToEngagement.get(signal.stream_id);
    return undefined;
  }

  const signalsByEngagement = new Map<string, SignalRow[]>();
  for (const signal of signals) {
    const engagementId = engagementIdForSignal(signal);
    if (!engagementId) continue;

    const existing = signalsByEngagement.get(engagementId) ?? [];
    existing.push(signal);
    signalsByEngagement.set(engagementId, existing);
  }

  const totalFee = engagements.reduce(
    (sum, row) => sum + n(row.fee_amount),
    0
  );
  const totalCost = engagements.reduce(
    (sum, row) => sum + n(row.cost_accrued),
    0
  );
  const portfolioMargin =
    totalFee > 0 ? ((totalFee - totalCost) / totalFee) * 100 : null;

  const redEngagementIds = new Set<string>();
  for (const signal of signals) {
    if (signal.severity !== "red") continue;
    const id = engagementIdForSignal(signal);
    if (id) redEngagementIds.add(id);
  }

  const revenueAtRisk = [...redEngagementIds].reduce((sum, id) => {
    return sum + n(engagementById.get(id)?.fee_amount);
  }, 0);

  const totalUnbilled = engagements.reduce(
    (sum, row) => sum + n(row.unbilled_amount),
    0
  );

  const unbilledSignals = signals.filter(
    (signal) => signal.code === "UNBILLED"
  );
  const oldestExposureDays =
    unbilledSignals.length > 0
      ? Math.max(
          ...unbilledSignals.map((signal) =>
            n(signal.detail?.days_since_reference)
          )
        )
      : null;

  const healthRows = engagements.slice(0, 6).map((row) => {
    const metrics = metricForEngagement(row);
    const related = signalsByEngagement.get(row.stream_id) ?? [];
    const primary =
      related.find((signal) => signal.severity === "red") ?? related[0];

    return {
      ...row,
      ...metrics,
      tone: primary?.severity ?? "clear",
      risk: primary ? signalLabel(primary.code) : "Clear",
    };
  });

  const visibleSignals = signals.slice(0, 4).map((signal) => {
    const engagementId = engagementIdForSignal(signal);
    const engagementName = engagementId
      ? engagementById.get(engagementId)?.name ?? undefined
      : undefined;
    const evidence = signal.evidence_seqs ?? [];
    const latestEvidence =
      evidence.length > 0 ? evidence[evidence.length - 1] : null;

    return {
      ...signal,
      description: signalDescription(signal, engagementName),
      latestEvidence,
    };
  });

  const leadSignal =
    signals.find((signal) => signal.severity === "red") ?? signals[0] ?? null;

  let narrationTitle = "No active operational exceptions.";
  let narrationBody =
    "The deterministic signal layer currently has no active amber or red exceptions for this organization.";

  if (leadSignal) {
    const engagementId = engagementIdForSignal(leadSignal);
    const engagementName = engagementId
      ? engagementById.get(engagementId)?.name ?? undefined
      : undefined;

    narrationTitle = `${engagementName ?? "Operational stream"} requires attention.`;
    narrationBody = signalDescription(leadSignal, engagementName);
  }

  const latestSeq = ledger[0]?.seq;
  const ledgerMeta = ledgerResult.error
    ? "Ledger read unavailable"
    : latestSeq
      ? `Latest evidence event #${latestSeq}`
      : "No events recorded yet";

  const hasDataError =
    Boolean(engagementResult.error) ||
    Boolean(signalResult.error) ||
    Boolean(budgetLineResult.error) ||
    Boolean(invoiceResult.error);

  return (
    <SignetShell active="command" crumb="Command Center">
      <div className="content">
        <section className="hero">
          <div className="eyebrow">VERIFIED OPERATIONS KERNEL · LIVE RLS DATA</div>
          <h1>Command Center</h1>
          <p>
            Margin and delivery risk derived from authenticated deterministic
            projections and operational signals. The narration layer remains
            downstream of the evidence.
          </p>
        </section>

        <section className="metrics">
          <MetricCard
            label="Portfolio margin"
            value={pct(portfolioMargin)}
            meta={`Across ${engagements.length} active ${
              engagements.length === 1 ? "engagement" : "engagements"
            }`}
            icon={<TrendingUp size={24} />}
          />
          <MetricCard
            label="Revenue at risk"
            value={money(revenueAtRisk)}
            meta={`${redEngagementIds.size} ${
              redEngagementIds.size === 1 ? "engagement" : "engagements"
            } with red signals`}
            tone={redEngagementIds.size > 0 ? "red" : "default"}
            icon={<TriangleAlert size={24} />}
          />
          <MetricCard
            label="Unbilled work"
            value={money(totalUnbilled)}
            meta={
              oldestExposureDays === null
                ? "No aged unbilled signal"
                : `Oldest aged exposure: ${oldestExposureDays.toFixed(1)} days`
            }
            tone={totalUnbilled > 0 ? "amber" : "default"}
            icon={<Clock3 size={24} />}
          />
          <MetricCard
            label="Ledger status"
            value={ledgerResult.error ? "Unavailable" : "Chain active"}
            meta={ledgerMeta}
            tone={ledgerResult.error ? "red" : "green"}
            icon={<ShieldCheck size={24} />}
          />
        </section>

        {hasDataError ? (
          <section className="panel full-panel" style={{ marginBottom: 20 }}>
            <div style={{ padding: 24 }}>
              <div className="danger-text">One or more live data reads failed.</div>
              <p className="panel-note" style={{ marginTop: 8 }}>
                Signet is refusing to substitute hard-coded demo values.
              </p>
            </div>
          </section>
        ) : null}

        <section className="dashboard-grid">
          <div className="panel">
            <div className="panel-header">
              <div className="panel-heading">
                <Activity size={17} />
                <span>Engagement health</span>
              </div>
              <span className="panel-note">Live projection</span>
            </div>

            {healthRows.length === 0 ? (
              <div style={{ padding: 28 }}>
                <div className="engagement-name">No active engagements</div>
                <p className="panel-note" style={{ marginTop: 8 }}>
                  Append operational events and this view will update from the
                  projection layer.
                </p>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Engagement</th>
                      <th>Client</th>
                      <th>Margin</th>
                      <th>Burn</th>
                      <th>Signal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {healthRows.map((item) => (
                      <tr key={item.stream_id}>
                        <td className="engagement-name">
                          {item.name ?? "Untitled engagement"}
                        </td>
                        <td>{item.client ?? "—"}</td>
                        <td
                          className={
                            item.tone === "red" ? "danger-text" : ""
                          }
                        >
                          {pct(item.margin)}
                        </td>
                        <td
                          className={
                            item.tone === "red"
                              ? "danger-text"
                              : item.tone === "amber"
                                ? "amber-text"
                                : ""
                          }
                        >
                          {pct(item.burn)}
                        </td>
                        <td>
                          <span className={`risk-pill ${item.tone}`}>
                            {item.risk}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-header">
              <div className="panel-heading">
                <Radio size={17} />
                <span>Active signals</span>
              </div>
              <span className="panel-note">{signals.length} active</span>
            </div>

            <div className="signal-list">
              {visibleSignals.length === 0 ? (
                <article className="signal-row">
                  <span className="signal-dot" />
                  <div className="signal-copy">
                    <strong>CLEAR</strong>
                    <p>No active deterministic exceptions.</p>
                    <small>Signal engine returned zero active rows.</small>
                  </div>
                </article>
              ) : (
                visibleSignals.map((signal) => (
                  <article className="signal-row" key={signal.signal_id}>
                    <span className={`signal-dot ${signal.severity}`} />
                    <div className="signal-copy">
                      <strong>{signal.code}</strong>
                      <p>{signal.description}</p>
                      <small>
                        {signal.latestEvidence
                          ? `Evidence event #${signal.latestEvidence}`
                          : "No evidence event attached"}
                      </small>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="ai-panel">
          <div className="ai-copy">
            <div className="ai-label">
              <Sparkles size={16} />
              NARRATION LAYER — READ ONLY
            </div>
            <h2>{narrationTitle}</h2>
            <p>{narrationBody}</p>
            <small>
              Current local narration is generated from deterministic signal
              fields only. A future LLM adapter may explain this evidence, but
              it will not receive authority to mutate operational state.
            </small>
          </div>
          <div className="signal-art" aria-hidden="true">
            {Array.from({ length: 11 }).map((_, row) => (
              <div className="wave-row" key={row}>
                {Array.from({ length: 28 }).map((_, col) => (
                  <i
                    key={col}
                    style={{
                      opacity: Math.max(
                        0.08,
                        0.7 -
                          Math.abs(col - 20) * 0.025 -
                          Math.abs(row - 5) * 0.05
                      ),
                      transform: `translateY(${
                        Math.sin((col + row) / 2.35) * (4 + row * 0.55)
                      }px)`,
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </section>
      </div>
    </SignetShell>
  );
}
