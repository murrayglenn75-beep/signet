import {
  Activity,
  Clock3,
  Radio,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  TrendingUp,
} from "lucide-react";
import { SignetShell } from "../components/signet-shell";

const engagements = [
  { name: "Northstar Retainer", client: "Northstar", margin: "41%", burn: "72%", risk: "Clear", tone: "clear" },
  { name: "Atlas Transformation", client: "Atlas Group", margin: "23%", burn: "108%", risk: "Scope drift", tone: "red" },
  { name: "Meridian Launch", client: "Meridian", margin: "34%", burn: "89%", risk: "Budget watch", tone: "amber" },
  { name: "Helix Advisory", client: "Helix", margin: "47%", burn: "61%", risk: "Clear", tone: "clear" },
];

const signals = [
  { level: "red", title: "SCOPE_DRIFT", copy: "Atlas Transformation has exceeded planned fixed-fee capacity.", seq: "#184" },
  { level: "amber", title: "OVER_BUDGET", copy: "Meridian Build budget line is above 85% utilization.", seq: "#179" },
  { level: "amber", title: "UNBILLED", copy: "€8.4k remains unbilled beyond the current billing window.", seq: "#171" },
];

function MetricCard({
  label, value, meta, tone = "default", icon
}: {
  label: string; value: string; meta: string;
  tone?: "default" | "red" | "amber" | "green";
  icon: React.ReactNode;
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

export default function Home() {
  return (
    <SignetShell active="command" crumb="Command Center">
      <div className="content">
        <section className="hero">
          <div className="eyebrow">VERIFIED OPERATIONS KERNEL</div>
          <h1>Command Center</h1>
          <p>Margin and delivery risk derived from deterministic operational signals. AI explains the evidence — it never becomes the source of truth.</p>
        </section>

        <section className="metrics">
          <MetricCard label="Portfolio margin" value="36.4%" meta="Across active engagements" icon={<TrendingUp size={24} />} />
          <MetricCard label="Revenue at risk" value="€24.8k" meta="2 engagements require attention" tone="red" icon={<TriangleAlert size={24} />} />
          <MetricCard label="Unbilled work" value="€8.4k" meta="Oldest exposure: 37 days" tone="amber" icon={<Clock3 size={24} />} />
          <MetricCard label="Ledger integrity" value="Verified" meta="Append-only chain operational" tone="green" icon={<ShieldCheck size={24} />} />
        </section>

        <section className="dashboard-grid">
          <div className="panel">
            <div className="panel-header"><div className="panel-heading"><Activity size={17} /><span>Engagement health</span></div></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Engagement</th><th>Client</th><th>Margin</th><th>Burn</th><th>Signal</th></tr></thead>
                <tbody>
                  {engagements.map((item) => (
                    <tr key={item.name}>
                      <td className="engagement-name">{item.name}</td>
                      <td>{item.client}</td>
                      <td className={item.tone === "red" ? "danger-text" : ""}>{item.margin}</td>
                      <td className={item.tone === "red" ? "danger-text" : item.tone === "amber" ? "amber-text" : ""}>{item.burn}</td>
                      <td><span className={`risk-pill ${item.tone}`}>{item.risk}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header"><div className="panel-heading"><Radio size={17} /><span>Active signals</span></div></div>
            <div className="signal-list">
              {signals.map((signal) => (
                <article className="signal-row" key={signal.title}>
                  <span className={`signal-dot ${signal.level}`} />
                  <div className="signal-copy">
                    <strong>{signal.title}</strong><p>{signal.copy}</p><small>Evidence event {signal.seq}</small>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="ai-panel">
          <div className="ai-copy">
            <div className="ai-label"><Sparkles size={16} />AI NARRATION — READ ONLY</div>
            <h2>Atlas Transformation needs an explicit scope decision.</h2>
            <p>Current burn has moved beyond the fixed-fee tolerance while margin is compressing. Signet would require an approved change order or an explicit absorb decision before additional out-of-scope time can be silently accepted.</p>
            <small>Narrative derived from deterministic signals. Operational state remains controlled by the verified event ledger.</small>
          </div>
          <div className="signal-art" aria-hidden="true">
            {Array.from({ length: 11 }).map((_, row) => (
              <div className="wave-row" key={row}>
                {Array.from({ length: 28 }).map((_, col) => (
                  <i key={col} style={{ opacity: Math.max(0.08, .7 - Math.abs(col - 20) * .025 - Math.abs(row - 5) * .05), transform: `translateY(${Math.sin((col + row) / 2.35) * (4 + row * .55)}px)` }} />
                ))}
              </div>
            ))}
          </div>
        </section>
      </div>
    </SignetShell>
  );
}
