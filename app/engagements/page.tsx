import { ArrowUpRight, BriefcaseBusiness, Clock3, TrendingUp } from "lucide-react";
import { SignetShell } from "../../components/signet-shell";

const rows = [
  { name: "Atlas Transformation", client: "Atlas Group", model: "Fixed fee", margin: "23%", burn: "108%", unbilled: "€4.9k", risk: "Scope drift", tone: "red" },
  { name: "Meridian Launch", client: "Meridian", model: "Fixed fee", margin: "34%", burn: "89%", unbilled: "€2.1k", risk: "Budget watch", tone: "amber" },
  { name: "Northstar Retainer", client: "Northstar", model: "Retainer", margin: "41%", burn: "72%", unbilled: "€1.4k", risk: "Clear", tone: "clear" },
  { name: "Helix Advisory", client: "Helix", model: "T&M", margin: "47%", burn: "61%", unbilled: "€0", risk: "Clear", tone: "clear" },
];

export default function EngagementsPage() {
  return (
    <SignetShell active="engagements" crumb="Engagements">
      <div className="content">
        <section className="hero page-hero">
          <div className="eyebrow">OPERATING PORTFOLIO</div>
          <h1>Engagements</h1>
          <p>Live commercial state rebuilt from the append-only event stream. Margin, burn and billing exposure are deterministic projections.</p>
        </section>

        <section className="metrics page-metrics">
          <article className="metric-card"><div><div className="metric-label">Active engagements</div><div className="metric-value">4</div><div className="metric-meta">Across 4 clients</div></div><div className="metric-icon"><BriefcaseBusiness size={24}/></div></article>
          <article className="metric-card"><div><div className="metric-label">Average margin</div><div className="metric-value">36.4%</div><div className="metric-meta">Portfolio weighted</div></div><div className="metric-icon"><TrendingUp size={24}/></div></article>
          <article className="metric-card"><div><div className="metric-label">Unbilled exposure</div><div className="metric-value amber">€8.4k</div><div className="metric-meta">Across 3 engagements</div></div><div className="metric-icon amber"><Clock3 size={24}/></div></article>
        </section>

        <section className="panel full-panel">
          <div className="panel-header"><div className="panel-heading"><BriefcaseBusiness size={17}/><span>Engagement portfolio</span></div><span className="panel-note">Deterministic projection</span></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Engagement</th><th>Client</th><th>Model</th><th>Margin</th><th>Burn</th><th>Unbilled</th><th>Risk</th><th></th></tr></thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.name}>
                    <td className="engagement-name">{row.name}</td><td>{row.client}</td><td>{row.model}</td>
                    <td className={row.tone === "red" ? "danger-text" : ""}>{row.margin}</td>
                    <td className={row.tone === "red" ? "danger-text" : row.tone === "amber" ? "amber-text" : ""}>{row.burn}</td>
                    <td>{row.unbilled}</td><td><span className={`risk-pill ${row.tone}`}>{row.risk}</span></td>
                    <td><ArrowUpRight size={14} className="row-action"/></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </SignetShell>
  );
}
