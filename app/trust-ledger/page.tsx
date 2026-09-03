import {
  CheckCircle2,
  Hash,
  ScrollText,
  ShieldCheck,
} from "lucide-react";
import { redirect } from "next/navigation";
import { SignetShell } from "../../components/signet-shell";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

type LedgerEvent = {
  seq: number | string;
  event_id: string;
  stream_type: string;
  stream_id: string;
  event_type: string;
  actor_type: string;
  actor_id: string | null;
  occurred_at: string;
  prev_hash: string | null;
  hash: string | null;
};

function shortHash(value: string | null) {
  if (!value) return "—";
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function actorLabel(event: LedgerEvent) {
  return event.actor_type || "unknown";
}

export default async function LedgerPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/trust-ledger");
  }

  const { data, error } = await supabase.rpc(
    "get_trust_ledger_window",
    { p_limit: 50 }
  );

  const events = (data ?? []) as LedgerEvent[];
  const latest = events[0] ?? null;
  const oldest = events.at(-1) ?? null;

  return (
    <SignetShell active="trust-ledger" crumb="Trust Ledger">
      <div className="content">
        <section className="hero page-hero ledger-hero">
          <div>
            <div className="eyebrow">
              TAMPER-EVIDENT OPERATIONAL HISTORY
            </div>
            <h1>Trust Ledger</h1>
            <p>
              The append-only event stream is the source of truth.
              Each event links to the previous hash, making corruption
              detectable under the tested application model.
            </p>
          </div>
        </section>

        <section className="ledger-summary">
          <div>
            <ShieldCheck size={20} />
            <span>
              <strong>
                {error
                  ? "Ledger unavailable"
                  : events.length > 0
                    ? "Ledger available"
                    : "Ledger empty"}
              </strong>
              <small>
                {error
                  ? error.message
                  : events.length > 0
                    ? "Authenticated, org-scoped metadata"
                    : "No production events recorded yet"}
              </small>
            </span>
          </div>

          <div>
            <Hash size={20} />
            <span>
              <strong>
                {latest ? `#${latest.seq}` : "0 events"}
              </strong>
              <small>Latest sequence</small>
            </span>
          </div>

          <div>
            <ScrollText size={20} />
            <span>
              <strong>
                {oldest && latest
                  ? `#${oldest.seq} → #${latest.seq}`
                  : "No chain window"}
              </strong>
              <small>Current visible window</small>
            </span>
          </div>
        </section>

        <section className="panel full-panel">
          <div className="panel-header">
            <div className="panel-heading">
              <ScrollText size={17} />
              <span>Event stream</span>
            </div>
            <span className="panel-note">
              Payload excluded from browser ledger boundary
            </span>
          </div>

          <div className="table-wrap">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Seq</th>
                  <th>Event type</th>
                  <th>Actor</th>
                  <th>Stream</th>
                  <th>Hash</th>
                  <th>Chain</th>
                </tr>
              </thead>

              <tbody>
                {events.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      {error
                        ? `Unable to load ledger: ${error.message}`
                        : "No production ledger events yet."}
                    </td>
                  </tr>
                ) : (
                  events.map((event) => (
                    <tr key={event.event_id}>
                      <td className="mono-cell">#{event.seq}</td>

                      <td className="event-type">
                        {event.event_type}
                      </td>

                      <td>
                        <span
                          className={`actor-pill ${actorLabel(event)}`}
                        >
                          {actorLabel(event)}
                        </span>
                      </td>

                      <td>
                        {event.stream_type}
                        <br />
                        <span className="mono-cell">
                          {event.stream_id}
                        </span>
                      </td>

                      <td className="mono-cell hash-cell">
                        {shortHash(event.hash)}
                      </td>

                      <td>
                        <span className="chain-ok">
                          <CheckCircle2 size={13} />
                          Recorded
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <p className="ledger-footnote">
          Signet&apos;s Postgres hash chain is tamper-evident, not
          tamper-proof against a malicious database administrator.
        </p>
      </div>
    </SignetShell>
  );
}