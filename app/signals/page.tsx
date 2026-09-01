import { CircleDot, Filter, Radio, ShieldCheck } from "lucide-react";
import { SignetShell } from "../../components/signet-shell";

const cards = [
  { code: "SCOPE_DRIFT", level: "red", title: "Atlas Transformation", copy: "Net fixed-fee burn has crossed the 110% threshold.", evidence: ["#176 time_entry.logged +4h", "#181 time_entry.logged +3h", "#184 time_entry.logged +2h"] },
  { code: "OVER_BUDGET", level: "amber", title: "Meridian / Build", copy: "Budget-line utilization is now at 89%.", evidence: ["#169 time_entry.logged +6h", "#175 time_entry.logged +3h"] },
  { code: "UNBILLED", level: "amber", title: "Atlas Transformation", copy: "€4.9k remains unbilled beyond the 30-day threshold.", evidence: ["#160 time_entry.logged", "#171 time_entry.logged"] },
];

export default function SignalsPage() {
  return (
    <SignetShell active="signals" crumb="Signals">
      <div className="content">
        <section className="hero page-hero">
          <div className="eyebrow">DETERMINISTIC RISK ENGINE</div>
          <h1>Signals</h1>
          <p>Every alert is computed from operational state and carries exact event evidence. No LLM creates, clears or changes a signal.</p>
        </section>

        <div className="signal-toolbar">
          <div><Radio size={16}/><strong>3 active</strong><span>1 red · 2 amber</span></div>
          <button><Filter size={14}/> Filter</button>
        </div>

        <section className="signal-card-grid">
          {cards.map(card => (
            <article className={`evidence-card ${card.level}`} key={card.code}>
              <div className="evidence-head">
                <div><span className={`signal-dot ${card.level}`}/><strong>{card.code}</strong></div>
                <span className={`risk-pill ${card.level}`}>{card.level.toUpperCase()}</span>
              </div>
              <h2>{card.title}</h2>
              <p>{card.copy}</p>
              <div className="evidence-block">
                <div className="evidence-label"><ShieldCheck size={13}/> Evidence chain</div>
                {card.evidence.map(item => <div className="evidence-event" key={item}><CircleDot size={11}/><span>{item}</span></div>)}
              </div>
            </article>
          ))}
        </section>
      </div>
    </SignetShell>
  );
}
