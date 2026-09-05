"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BriefcaseBusiness,
  Diamond,
  FileCheck2,
  LayoutDashboard,
  LogOut,
  Maximize2,
  Minimize2,
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
  {
    key: "command",
    href: "/",
    label: "Command Center",
    icon: LayoutDashboard,
  },
  {
    key: "engagements",
    href: "/engagements",
    label: "Engagements",
    icon: BriefcaseBusiness,
  },
  {
    key: "signals",
    href: "/signals",
    label: "Signals",
    icon: TriangleAlert,
  },
  {
    key: "change-orders",
    href: "/change-orders",
    label: "Change Orders",
    icon: FileCheck2,
  },
  {
    key: "trust-ledger",
    href: "/trust-ledger",
    label: "Trust Ledger",
    icon: ScrollText,
  },
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

  const [isDemoWorkspace, setIsDemoWorkspace] =
    useState(false);

  const [isFullscreen, setIsFullscreen] =
    useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadWorkspaceMode() {
      const supabase = createClient();

      const { data, error } =
        await supabase.auth.getClaims();

      if (cancelled || error) {
        return;
      }

      const claims = data?.claims;

      setIsDemoWorkspace(
        claims?.demo_mode === true &&
          claims?.org_id ===
            "d0000000-0000-0000-0000-000000000001"
      );
    }

    void loadWorkspaceMode();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(
        Boolean(document.fullscreenElement)
      );
    }

    document.addEventListener(
      "fullscreenchange",
      handleFullscreenChange
    );

    handleFullscreenChange();

    return () => {
      document.removeEventListener(
        "fullscreenchange",
        handleFullscreenChange
      );
    };
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }

      await document.documentElement.requestFullscreen();
    } catch (error) {
      console.error(
        "Unable to change fullscreen mode:",
        error
      );
    }
  }

  async function signOut() {
    const supabase = createClient();

    await supabase.auth.signOut();

    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="signet-shell">
      <aside
        className="sidebar"
        aria-label="Signet navigation"
      >
        <div className="brand-row">
          <span
            className="brand-mark"
            aria-hidden="true"
          >
            <Diamond size={24} strokeWidth={1.8} />
          </span>

          <span className="brand-name">SIGNET</span>
        </div>

        <nav
          className="side-nav"
          aria-label="Primary navigation"
        >
          {nav.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.key;

            return (
              <Link
                key={item.key}
                href={item.href}
                className={`nav-link ${
                  isActive ? "active" : ""
                }`}
                aria-current={
                  isActive ? "page" : undefined
                }
              >
                <Icon
                  size={18}
                  strokeWidth={1.7}
                  aria-hidden="true"
                />

                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <div
            className="kernel-status"
            aria-label="Kernel status: online"
          >
            <ShieldCheck
              size={22}
              strokeWidth={1.7}
              aria-hidden="true"
            />

            <div>
              <strong>Kernel online</strong>
              <span>
                Verified event boundaries active
              </span>
            </div>
          </div>

          <button
            type="button"
            className="profile-orb"
            onClick={signOut}
            title="Sign out"
            aria-label="Sign out of Signet"
          >
            <LogOut
              size={16}
              aria-hidden="true"
            />
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div
            className="crumbs"
            aria-label="Breadcrumb"
          >
            <span>Operations</span>

            <span aria-hidden="true">/</span>

            <strong>{crumb}</strong>
          </div>

          <div className="topbar-actions">
            <button
              type="button"
              className="fullscreen-button"
              onClick={toggleFullscreen}
              aria-label={
                isFullscreen
                  ? "Exit full screen"
                  : "Enter full screen"
              }
              aria-pressed={isFullscreen}
              title={
                isFullscreen
                  ? "Exit full screen"
                  : "Enter full screen"
              }
            >
              {isFullscreen ? (
                <Minimize2
                  size={16}
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
              ) : (
                <Maximize2
                  size={16}
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
              )}

              <span>
                {isFullscreen
                  ? "Exit full screen"
                  : "Full screen"}
              </span>
            </button>

            <div
              className="demo-state"
              role="status"
              aria-live="polite"
            >
              <span
                className="demo-dot"
                aria-hidden="true"
              />

              <span>
                {isDemoWorkspace
                  ? "DEMO WORKSPACE · READ ONLY"
                  : "PRODUCTION"}
              </span>
            </div>
          </div>
        </header>

        {children}
      </main>

      <style>{`
        .topbar-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .fullscreen-button {
          min-height: 36px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 0 12px;
          border: 1px solid var(--line-strong);
          border-radius: 8px;
          color: var(--text-secondary);
          background: rgba(255, 255, 255, 0.025);
          font: inherit;
          font-size: 11px;
          font-weight: 650;
          letter-spacing: 0.02em;
          cursor: pointer;
          transition:
            background 150ms ease,
            border-color 150ms ease,
            color 150ms ease,
            transform 150ms ease;
        }

        .fullscreen-button:hover {
          color: var(--text-primary);
          border-color: var(--accent-border);
          background: var(--accent-bg);
          transform: translateY(-1px);
        }

        .fullscreen-button:focus-visible {
          outline: 3px solid var(--focus);
          outline-offset: 3px;
        }

        .fullscreen-button[aria-pressed="true"] {
          color: var(--accent-strong);
          border-color: var(--accent-border);
          background: var(--accent-bg);
        }

        @media (max-width: 760px) {
          .topbar-actions {
            gap: 8px;
          }

          .fullscreen-button {
            width: 38px;
            min-width: 38px;
            padding: 0;
          }

          .fullscreen-button span {
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
            border: 0;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .fullscreen-button {
            transition: none;
          }
        }
      `}</style>
    </div>
  );
}