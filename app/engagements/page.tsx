import {
  ArrowUpRight,
  BriefcaseBusiness,
  Clock3,
  TrendingUp,
} from "lucide-react";
import { redirect } from "next/navigation";
import { SignetShell } from "../../components/signet-shell";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

type EngagementRow = {
  stream_id: string;
  name: string | null;
  client: string | null;
  fee_model: "fixed" | "tm" | "retainer" | null;
  fee_amount: number | string | null;
  planned_cost: number | string | null;
  planned_hours: number | string | null;
  status: string;
  hours_logged: number | string;
  cost_accrued: number | string;
  unbilled_amount: number | string;
  approved_co_hours: number | string;
  last_activity_at: string | null;
  last_event_seq: number | string;
};

function n(value: number | string | null | undefined) {
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

function modelLabel(model: EngagementRow["fee_model"]) {
  if (model === "fixed") return "Fixed fee";
  if (model === "tm") return "T&M";
  if (model === "retainer") return "Retainer";
  return "—";
}

function rowMetrics(row: EngagementRow) {
  const fee = n(row.fee_amount);
  const cost = n(row.cost_accrued);
  const plannedHours = n(row.planned_hours);
  const approvedHours = n(row.approved_co_hours);
  const logged = n(row.hours_logged);
  const capacity = plannedHours + approvedHours;

  const margin = fee > 0 ? ((fee - cost) / fee) * 100 : null;
  const burn = capacity > 0 ? (logged / capacity) * 100 : null;

  let risk = "Clear";
  let tone = "clear";

  if (burn !== null && burn > 100) {
    risk = "Over scope";
    tone = "red";
  } else if (burn !== null && burn >= 85) {
    risk = "Budget watch";
    tone = "amber";
  } else if (margin !== null && margin < 20) {
    risk = "Margin watch";
    tone = "amber";
  }

  return { margin, burn, risk, tone };
}

export default async function EngagementsPage() {
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims) {
    redirect("/auth/demo?next=/engagements");
  }

  const { data, error } = await supabase
    .from("proj_engagements")
    .select(
      "stream_id,name,client,fee_model,fee_amount,planned_cost,planned_hours,status,hours_logged,cost_accrued,unbilled_amount,approved_co_hours,last_activity_at,last_event_seq"
    )
    .eq("status", "active")
    .order("last_event_seq", { ascending: false });

  const rows = (data ?? []) as EngagementRow[];

  const activeClients = new Set(
    rows.map((row) => row.client).filter((client): client is string => Boolean(client))
  ).size;

  const totalFee = rows.reduce((sum, row) => sum + n(row.fee_amount), 0);
  const totalCost = rows.reduce((sum, row) => sum + n(row.cost_accrued), 0);
  const weightedMargin =
    totalFee > 0 ? ((totalFee - totalCost) / totalFee) * 100 : null;

  const totalUnbilled = rows.reduce(
    (sum, row) => sum + n(row.unbilled_amount),
    0
  );
  const exposedCount = rows.filter((row) => n(row.unbilled_amount) > 0).length;

  return (
    <SignetShell active="engagements" crumb="Engagements">
      <div className="content">
        <section className="hero page-hero">
          <div className="eyebrow">OPERATING PORTFOLIO · LIVE RLS DATA</div>
          <h1>Engagements</h1>
          <p>
            Commercial state rebuilt from the append-only event stream.
            Margin, burn and billing exposure are calculated from authenticated,
            org-scoped deterministic projections.
          </p>
        </section>

        <section className="metrics page-metrics">
          <article className="metric-card">
            <div>
              <div className="metric-label">Active engagements</div>
              <div className="metric-value">{rows.length}</div>
              <div className="metric-meta">
                Across {activeClients} {activeClients === 1 ? "client" : "clients"}
              </div>
            </div>
            <div className="metric-icon">
              <BriefcaseBusiness size={24} />
            </div>
          </article>

          <article className="metric-card">
            <div>
              <div className="metric-label">Average margin</div>
              <div className="metric-value">{pct(weightedMargin)}</div>
              <div className="metric-meta">Portfolio weighted by fee</div>
            </div>
            <div className="metric-icon">
              <TrendingUp size={24} />
            </div>
          </article>

          <article className="metric-card">
            <div>
              <div className="metric-label">Unbilled exposure</div>
              <div className="metric-value amber">{money(totalUnbilled)}</div>
              <div className="metric-meta">
                Across {exposedCount} {exposedCount === 1 ? "engagement" : "engagements"}
              </div>
            </div>
            <div className="metric-icon amber">
              <Clock3 size={24} />
            </div>
          </article>
        </section>

        <section className="panel full-panel">
          <div className="panel-header">
            <div className="panel-heading">
              <BriefcaseBusiness size={17} />
              <span>Engagement portfolio</span>
            </div>
            <span className="panel-note">Supabase · RLS · deterministic projection</span>
          </div>

          {error ? (
            <div style={{ padding: "28px" }}>
              <div className="danger-text">Unable to read engagement projection.</div>
              <p className="panel-note" style={{ marginTop: 8 }}>
                The authenticated query was denied or the local database is unavailable.
              </p>
            </div>
          ) : rows.length === 0 ? (
            <div style={{ padding: "32px" }}>
              <div className="engagement-name">No live engagements yet</div>
              <p className="panel-note" style={{ marginTop: 8 }}>
                The UI is connected to Supabase successfully. Add events for this
                organization and the deterministic projection will appear here.
              </p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Engagement</th>
                    <th>Client</th>
                    <th>Model</th>
                    <th>Margin</th>
                    <th>Burn</th>
                    <th>Unbilled</th>
                    <th>Risk</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const metrics = rowMetrics(row);

                    return (
                      <tr key={row.stream_id}>
                        <td className="engagement-name">
                          {row.name ?? "Untitled engagement"}
                        </td>
                        <td>{row.client ?? "—"}</td>
                        <td>{modelLabel(row.fee_model)}</td>
                        <td className={metrics.tone === "red" ? "danger-text" : ""}>
                          {pct(metrics.margin)}
                        </td>
                        <td
                          className={
                            metrics.tone === "red"
                              ? "danger-text"
                              : metrics.tone === "amber"
                                ? "amber-text"
                                : ""
                          }
                        >
                          {pct(metrics.burn)}
                        </td>
                        <td>{money(n(row.unbilled_amount))}</td>
                        <td>
                          <span className={`risk-pill ${metrics.tone}`}>
                            {metrics.risk}
                          </span>
                        </td>
                        <td>
                          <ArrowUpRight size={14} className="row-action" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </SignetShell>
  );
}
