import { CircleDot, Filter, Radio, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { SignetShell } from "../../components/signet-shell";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

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

type EngagementRow = {
  stream_id: string;
  name: string | null;
};

type BudgetLineRow = {
  stream_id: string;
  engagement_id: string;
  label: string | null;
};

type InvoiceRow = {
  stream_id: string;
  engagement_id: string;
};

type LedgerRow = {
  seq: number | string;
  event_type: string;
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

function shortId(value: string) {
  return value.slice(0, 8);
}

function describeSignal(signal: SignalRow) {
  const d = signal.detail ?? {};

  switch (signal.code) {
    case "SCOPE_DRIFT":
      return `Net fixed-fee scope is beyond tolerance: ${n(d.hours_logged).toFixed(
        1
      )}h logged, ${n(d.planned_hours).toFixed(1)}h planned and ${n(
        d.approved_co_hours
      ).toFixed(1)}h explicitly approved.`;

    case "OVER_BUDGET":
      return `Budget-line utilization is ${n(d.burn_pct).toFixed(
        1
      )}% (${n(d.hours_logged).toFixed(1)}h of ${n(
        d.budget_hours
      ).toFixed(1)}h).`;

    case "STALE":
      return `No qualifying activity for ${n(
        d.days_since_activity
      ).toFixed(1)} days; deterministic threshold is ${n(
        d.threshold_days
      ).toFixed(0)} days.`;

    case "UNBILLED":
      return `${money(n(d.unbilled_amount))} remains unbilled after ${n(
        d.days_since_reference
      ).toFixed(1)} days.`;

    case "UNRECONCILED":
      return `Invoice total ${money(n(d.invoice_amount))} does not reconcile to line total ${money(
        n(d.lines_sum)
      )}.`;
  }
}

export default async function SignalsPage() {
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims) {
    redirect("/auth/demo?next=/signals");
  }

  const [
    signalResult,
    engagementResult,
    budgetLineResult,
    invoiceResult,
  ] = await Promise.all([
    supabase
      .from("signals")
      .select(
        "signal_id,stream_type,stream_id,code,severity,detail,evidence_seqs,computed_at"
      )
      .is("cleared_at", null)
      .order("computed_at", { ascending: false }),
    supabase.from("proj_engagements").select("stream_id,name"),
    supabase
      .from("proj_budget_lines")
      .select("stream_id,engagement_id,label"),
    supabase.from("proj_invoices").select("stream_id,engagement_id"),
  ]);

  const signals = (signalResult.data ?? []) as SignalRow[];
  const engagements = (engagementResult.data ?? []) as EngagementRow[];
  const budgetLines = (budgetLineResult.data ?? []) as BudgetLineRow[];
  const invoices = (invoiceResult.data ?? []) as InvoiceRow[];

  const engagementById = new Map(
    engagements.map((row) => [row.stream_id, row.name ?? "Untitled engagement"])
  );
  const budgetById = new Map(
    budgetLines.map((row) => [row.stream_id, row])
  );
  const invoiceById = new Map(
    invoices.map((row) => [row.stream_id, row])
  );

  const evidenceSeqs = [
    ...new Set(
      signals.flatMap((signal) =>
        (signal.evidence_seqs ?? []).map((seq) => String(seq))
      )
    ),
  ];

  let evidenceBySeq = new Map<string, string>();
  let ledgerError = false;

  if (evidenceSeqs.length > 0) {
    const { data: ledgerData, error: ledgerQueryError } = await supabase
      .from("trust_ledger")
      .select("seq,event_type")
      .in("seq", evidenceSeqs);

    ledgerError = Boolean(ledgerQueryError);

    evidenceBySeq = new Map(
      ((ledgerData ?? []) as LedgerRow[]).map((row) => [
        String(row.seq),
        row.event_type,
      ])
    );
  }

  function titleForSignal(signal: SignalRow) {
    if (signal.stream_type === "engagement") {
      return engagementById.get(signal.stream_id) ?? `Engagement ${shortId(signal.stream_id)}`;
    }

    if (signal.stream_type === "budget_line") {
      const budget = budgetById.get(signal.stream_id);
      if (!budget) return `Budget line ${shortId(signal.stream_id)}`;

      const engagement =
        engagementById.get(budget.engagement_id) ?? "Unknown engagement";
      return `${engagement} / ${budget.label ?? "Budget line"}`;
    }

    if (signal.stream_type === "invoice") {
      const invoice = invoiceById.get(signal.stream_id);
      const engagement = invoice
        ? engagementById.get(invoice.engagement_id)
        : undefined;

      return `${engagement ?? "Unknown engagement"} / Invoice ${shortId(
        signal.stream_id
      )}`;
    }

    return `${signal.stream_type} ${shortId(signal.stream_id)}`;
  }

  const redCount = signals.filter((signal) => signal.severity === "red").length;
  const amberCount = signals.filter(
    (signal) => signal.severity === "amber"
  ).length;

  const readError =
    Boolean(signalResult.error) ||
    Boolean(engagementResult.error) ||
    Boolean(budgetLineResult.error) ||
    Boolean(invoiceResult.error);

  return (
    <SignetShell active="signals" crumb="Signals">
      <div className="content">
        <section className="hero page-hero">
          <div className="eyebrow">DETERMINISTIC RISK ENGINE · LIVE RLS DATA</div>
          <h1>Signals</h1>
          <p>
            Every active alert is computed from operational state and carries
            exact event evidence. No LLM creates, clears or changes a signal.
          </p>
        </section>

        <div className="signal-toolbar">
          <div>
            <Radio size={16} />
            <strong>{signals.length} active</strong>
            <span>
              {redCount} red · {amberCount} amber
            </span>
          </div>
          <button title="Filter UI is presentation-only for now">
            <Filter size={14} /> Filter
          </button>
        </div>

        {readError ? (
          <section className="panel full-panel">
            <div style={{ padding: 28 }}>
              <div className="danger-text">Unable to read live signal data.</div>
              <p className="panel-note" style={{ marginTop: 8 }}>
                Signet will not substitute hard-coded demo signals.
              </p>
            </div>
          </section>
        ) : signals.length === 0 ? (
          <section className="panel full-panel">
            <div style={{ padding: 32 }}>
              <div className="engagement-name">No active signals</div>
              <p className="panel-note" style={{ marginTop: 8 }}>
                The deterministic signal engine currently has no amber or red
                exceptions for this organization.
              </p>
            </div>
          </section>
        ) : (
          <section className="signal-card-grid">
            {signals.map((signal) => (
              <article
                className={`evidence-card ${signal.severity}`}
                key={signal.signal_id}
              >
                <div className="evidence-head">
                  <div>
                    <span className={`signal-dot ${signal.severity}`} />
                    <strong>{signal.code}</strong>
                  </div>
                  <span className={`risk-pill ${signal.severity}`}>
                    {signal.severity.toUpperCase()}
                  </span>
                </div>

                <h2>{titleForSignal(signal)}</h2>
                <p>{describeSignal(signal)}</p>

                <div className="evidence-block">
                  <div className="evidence-label">
                    <ShieldCheck size={13} /> Evidence chain
                  </div>

                  {(signal.evidence_seqs ?? []).length === 0 ? (
                    <div className="evidence-event">
                      <CircleDot size={11} />
                      <span>No event sequence attached</span>
                    </div>
                  ) : (
                    signal.evidence_seqs.map((seq) => {
                      const key = String(seq);
                      const eventType = evidenceBySeq.get(key);

                      return (
                        <div className="evidence-event" key={key}>
                          <CircleDot size={11} />
                          <span>
                            #{key}
                            {eventType ? ` ${eventType}` : ""}
                          </span>
                        </div>
                      );
                    })
                  )}

                  {ledgerError ? (
                    <div className="evidence-event">
                      <CircleDot size={11} />
                      <span>Ledger event labels unavailable; sequence evidence preserved.</span>
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    </SignetShell>
  );
}
