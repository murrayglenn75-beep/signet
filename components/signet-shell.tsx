"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BriefcaseBusiness,
  FileCheck2,
  LayoutDashboard,
  LogOut,
  ScrollText,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { createClient } from "../lib/supabase/client";

type Active =
  | "command"
  | "engagements"
  | "signals"
  | "change-orders"
  | "trust-ledger";

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
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

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
              <strong>Kernel online</strong>
              <span>Verified event boundaries active</span>
            </div>
          </div>

          <button
            type="button"
            className="profile-orb"
            onClick={signOut}
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut size={16} />
          </button>
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
            Production
          </div>
        </header>

        {children}
      </main>
    </div>
  );
}