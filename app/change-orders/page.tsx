import { Check, FileCheck2, ShieldAlert, X } from "lucide-react";
import { SignetShell } from "../../components/signet-shell";

const orders = [
  { id: "CO-021", engagement: "Atlas Transformation", desc: "Additional executive reporting", hours: "12h", fee: "€3,600", status: "Pending", tone: "amber" },
  { id: "CO-020", engagement: "Helix Advisory", desc: "Expanded discovery workshop", hours: "6h", fee: "€1,200", status: "Approved", tone: "clear" },
  { id: "CO-019", engagement: "Northstar Retainer", desc: "Client-requested migration support", hours: "8h", fee: "€0", status: "Absorbed", tone: "amber" },
];

export default function ChangeOrdersPage() {
  return (
    <SignetShell active="change-orders" crumb="Change Orders">
      <div className="content">
        <section className="hero page-hero">
          <div className="eyebrow">EXPLICIT SCOPE AUTHORITY</div>
          <h1>Change Orders</h1>
          <p>Scope beyond fixed-fee tolerance requires a recorded decision. Approve it, absorb it explicitly, or decline it — silent scope absorption is blocked.</p>
        </section>

        <section className="gate-banner">
          <div className="gate-icon"><ShieldAlert size={24}/></div>
          <div><span>CHANGE-ORDER GATE</span><h2>Atlas Transformation is blocked from silent overrun.</h2><p>+7.0 hours require an explicit commercial decision before additional out-of-scope time can be accepted.</p></div>
          <div className="gate-actions"><button className="approve"><Check size={14}/> Approve</button><button className="absorb">Absorb</button><button className="decline"><X size={14}/> Decline</button></div>
        </section>

        <section className="panel full-panel">
          <div className="panel-header"><div className="panel-heading"><FileCheck2 size={17}/><span>Change-order register</span></div><span className="panel-note">Every decision becomes a ledger event</span></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>ID</th><th>Engagement</th><th>Description</th><th>Hours</th><th>Fee</th><th>Status</th></tr></thead>
              <tbody>{orders.map(o => <tr key={o.id}><td className="mono-cell">{o.id}</td><td className="engagement-name">{o.engagement}</td><td>{o.desc}</td><td>{o.hours}</td><td>{o.fee}</td><td><span className={`risk-pill ${o.tone}`}>{o.status}</span></td></tr>)}</tbody>
            </table>
          </div>
        </section>
      </div>
    </SignetShell>
  );
}
