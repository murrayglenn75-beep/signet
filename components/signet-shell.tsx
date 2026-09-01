import type { ReactNode } from "react";
import Link from "next/link";
import {
  BriefcaseBusiness,
  FileCheck2,
  LayoutDashboard,
  ScrollText,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

type Active = "command" | "engagements" | "signals" | "change-orders" | "trust-ledger";

const nav = [
  { key: "command", href: "/", label: "Command Center", icon: LayoutDashboard },
  { key: "engagements", href: "/engagements", label: "Engagements", icon: BriefcaseBusiness },
  { key: "signals", href: "/signals", label: "Signals", icon: TriangleAlert },
  { key: "change-orders", href: "/change-orders", label: "Change Orders", icon: FileCheck2 },
  { key: "trust-ledger", href: "/trust-ledger", label: "Trust Ledger", icon: ScrollText },
] as const;

export function SignetShell({
  active,
  crumb,
  children,
}: {
  active: Active;
  crumb: string;
  children: ReactNode;
}) {
  return (
    <div className="signet-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <span className="brand-mark">◇</span>
          <span className="brand-name">SIGNET</span>
        </div>

        <nav className="side-nav" aria-label="Primary">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.key}
                href={item.href}
                className={`nav-link ${active === item.key ? "active" : ""}`}
              >
                <Icon size={18} strokeWidth={1.7} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="kernel-status">
            <ShieldCheck size={22} strokeWidth={1.7} />
            <div>
              <strong>Kernel verified</strong>
              <span>10 / 10 tests passing</span>
            </div>
          </div>
          <div className="profile-orb">N</div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="crumbs">
            <span>Operations</span>
            <span>/</span>
            <strong>{crumb}</strong>
          </div>
          <div className="demo-state">
            <span className="demo-dot" />
            Local demo state
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
