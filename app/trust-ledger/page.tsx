import { CheckCircle2, Hash, RefreshCw, ScrollText, ShieldCheck } from "lucide-react";
import { SignetShell } from "../../components/signet-shell";

const events = [
  { seq: "#184", type: "time_entry.logged", actor: "human", stream: "Atlas Transformation", hash: "71b8c2…9d4e" },
  { seq: "#183", type: "change_order.requested", actor: "human", stream: "Atlas Transformation", hash: "4cd120…e88a" },
  { seq: "#182", type: "time_entry.logged", actor: "human", stream: "Meridian Launch", hash: "a73f91…0bd1" },
  { seq: "#181", type: "time_entry.logged", actor: "human", stream: "Atlas Transformation", hash: "6e9c11…2f04" },
  { seq: "#180", type: "ai.narrated", actor: "ai", stream: "Signal summary", hash: "82aa4f…1b73" },
];

export default function LedgerPage() {
  return (
    <SignetShell active="trust-ledger" crumb="Trust Ledger">
      <div className="content">
        <section className="hero page-hero ledger-hero">
          <div>
            <div className="eyebrow">TAMPER-EVIDENT OPERATIONAL HISTORY</div>
            <h1>Trust Ledger</h1>
            <p>The append-only event stream is the source of truth. Each event links to the previous hash, making corruption detectable under the tested application model.</p>
          </div>
          <button className="verify-button"><RefreshCw size={14}/> Verify chain</button>
        </section>

        <section className="ledger-summary">
          <div><ShieldCheck size={20}/><span><strong>Chain verified</strong><small>No broken links detected</small></span></div>
          <div><Hash size={20}/><span><strong>184 events</strong><small>Latest sequence</small></span></div>
          <div><ScrollText size={20}/><span><strong>GENESIS → #184</strong><small>Current chain window</small></span></div>
        </section>

        <section className="panel full-panel">
          <div className="panel-header"><div className="panel-heading"><ScrollText size={17}/><span>Event stream</span></div><span className="panel-note">Payload hidden from AI narrator</span></div>
          <div className="table-wrap">
            <table className="ledger-table">
              <thead><tr><th>Seq</th><th>Event type</th><th>Actor</th><th>Stream</th><th>Hash</th><th>Chain</th></tr></thead>
              <tbody>
                {events.map(event => (
                  <tr key={event.seq}>
                    <td className="mono-cell">{event.seq}</td><td className="event-type">{event.type}</td><td><span className={`actor-pill ${event.actor}`}>{event.actor}</span></td>
                    <td>{event.stream}</td><td className="mono-cell hash-cell">{event.hash}</td>
                    <td><span className="chain-ok"><CheckCircle2 size={13}/> Verified</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <p className="ledger-footnote">Signet’s Postgres hash chain is tamper-evident, not tamper-proof against a malicious database administrator.</p>
      </div>
    </SignetShell>
  );
}
