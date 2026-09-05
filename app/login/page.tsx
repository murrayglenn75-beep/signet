"use client";

import {
  ArrowRight,
  Check,
  Diamond,
  Eye,
  EyeOff,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [nextPath, setNextPath] = useState("/");
  const [demoError, setDemoError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    const next = params.get("next");

    const safeNext =
      next && next.startsWith("/") && !next.startsWith("//")
        ? next
        : "/";

    setNextPath(safeNext);
    setDemoError(params.get("demo_error"));
  }, []);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError("");
    setLoading(true);

    const supabase = createClient();

    const { error: signInError } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (signInError) {
      setError("Email or password is incorrect.");
      setLoading(false);
      return;
    }

    router.replace(nextPath);
    router.refresh();
  }

  const demoHref = `/auth/demo?next=${encodeURIComponent(
    nextPath
  )}`;

  return (
    <main className="login-shell">
      <div
        className="ambient ambient-one"
        aria-hidden="true"
      />

      <div
        className="ambient ambient-two"
        aria-hidden="true"
      />

      <section
        className="login-frame"
        aria-label="Signet access"
      >
        <div className="story-panel">
          <div>
            <div className="brand">
              <span
                className="brand-mark"
                aria-hidden="true"
              >
                <Diamond size={25} strokeWidth={1.8} />
              </span>

              <span>SIGNET</span>
            </div>

            <div className="story-copy">
              <div className="eyebrow">
                VERIFIED OPERATIONS CONTROL
              </div>

              <h1>
                Operational truth,
                <br />
                without the guesswork.
              </h1>

              <p className="story-description">
                Signet combines deterministic risk detection,
                controlled operational workflows, and a
                tamper-evident event ledger in one verified
                command environment.
              </p>
            </div>
          </div>

          <div className="trust-list">
            <div className="trust-item">
              <span
                className="trust-icon"
                aria-hidden="true"
              >
                <Check size={14} strokeWidth={2.4} />
              </span>

              Append-only operational event kernel
            </div>

            <div className="trust-item">
              <span
                className="trust-icon"
                aria-hidden="true"
              >
                <Check size={14} strokeWidth={2.4} />
              </span>

              Deterministic risk and control signals
            </div>

            <div className="trust-item">
              <span
                className="trust-icon"
                aria-hidden="true"
              >
                <Check size={14} strokeWidth={2.4} />
              </span>

              Isolated, read-only public demo workspace
            </div>
          </div>

          <div className="story-footer">
            <ShieldCheck
              size={16}
              strokeWidth={1.8}
              aria-hidden="true"
            />

            Security boundaries enforced at the data layer
          </div>
        </div>

        <div className="access-panel">
          <div className="access-content">
            <div className="mobile-brand">
              <span
                className="brand-mark"
                aria-hidden="true"
              >
                <Diamond size={22} strokeWidth={1.8} />
              </span>

              <span>SIGNET</span>
            </div>

            <div className="access-heading">
              <span className="access-kicker">
                PUBLIC DEMO
              </span>

              <h2>Explore Signet</h2>

              <p>
                Enter a fully seeded, isolated workspace and
                inspect the system without changing operational
                state.
              </p>
            </div>

            {demoError ? (
              <div className="alert" role="alert">
                Demo access is temporarily unavailable. You can
                still sign in with an authorized account.
              </div>
            ) : null}

            <a
              className={`demo-button ${
                demoLoading ? "is-loading" : ""
              }`}
              href={demoHref}
              onClick={(event) => {
                if (demoLoading) {
                  event.preventDefault();
                  return;
                }

                setDemoLoading(true);
              }}
              aria-disabled={demoLoading}
              aria-busy={demoLoading}
            >
              <span>
                {demoLoading
                  ? "Opening workspace..."
                  : "Enter demo workspace"}
              </span>

              <ArrowRight
                size={18}
                strokeWidth={1.9}
                aria-hidden="true"
              />
            </a>

            <div className="demo-meta">
              <span>
                <LockKeyhole
                  size={14}
                  aria-hidden="true"
                />
                Read only
              </span>

              <span aria-hidden="true">•</span>

              <span>No credentials required</span>
            </div>

            <div className="divider">
              <span>Authorized access</span>
            </div>

            <form
              className="login-form"
              onSubmit={handleSubmit}
              aria-busy={loading}
            >
              <div className="form-heading">
                <h3>Operator sign in</h3>
                <p>Use your authorized Signet account.</p>
              </div>

              <div className="field">
                <label htmlFor="email">
                  Email address
                </label>

                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) =>
                    setEmail(event.target.value)
                  }
                  required
                  autoComplete="email"
                  placeholder="name@company.com"
                  disabled={loading}
                  aria-invalid={Boolean(error)}
                  aria-describedby={
                    error ? "login-error" : undefined
                  }
                />
              </div>

              <div className="field">
                <label htmlFor="password">
                  Password
                </label>

                <div className="password-wrap">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) =>
                      setPassword(event.target.value)
                    }
                    required
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    disabled={loading}
                    aria-invalid={Boolean(error)}
                    aria-describedby={
                      error ? "login-error" : undefined
                    }
                  />

                  <button
                    className="password-toggle"
                    type="button"
                    onClick={() =>
                      setShowPassword((current) => !current)
                    }
                    aria-label={
                      showPassword
                        ? "Hide password"
                        : "Show password"
                    }
                  >
                    {showPassword ? (
                      <EyeOff
                        size={17}
                        aria-hidden="true"
                      />
                    ) : (
                      <Eye
                        size={17}
                        aria-hidden="true"
                      />
                    )}
                  </button>
                </div>
              </div>

              {error ? (
                <div
                  id="login-error"
                  className="alert"
                  role="alert"
                  aria-live="assertive"
                >
                  {error}
                </div>
              ) : null}

              <button
                className="sign-in-button"
                type="submit"
                disabled={loading}
              >
                {loading ? (
                  "Signing in..."
                ) : (
                  <>
                    Sign in

                    <ArrowRight
                      size={17}
                      strokeWidth={1.9}
                      aria-hidden="true"
                    />
                  </>
                )}
              </button>
            </form>

            <div className="access-footer">
              <ShieldCheck
                size={15}
                strokeWidth={1.8}
                aria-hidden="true"
              />

              Authenticated access · Verified boundaries
            </div>
          </div>
        </div>
      </section>

      <style>{`
        * {
          box-sizing: border-box;
        }

        .login-shell {
          position: relative;
          min-height: 100vh;
          overflow: hidden;
          display: grid;
          place-items: center;
          padding: 28px;
          background:
            radial-gradient(
              circle at 18% 12%,
              rgba(69, 93, 255, 0.12),
              transparent 34%
            ),
            radial-gradient(
              circle at 82% 88%,
              rgba(30, 184, 142, 0.07),
              transparent 30%
            ),
            #080b10;
          color: #f4f6f8;
        }

        .ambient {
          position: absolute;
          border-radius: 999px;
          filter: blur(100px);
          pointer-events: none;
          opacity: 0.28;
        }

        .ambient-one {
          width: 340px;
          height: 340px;
          top: -150px;
          left: -100px;
          background: #3248d8;
        }

        .ambient-two {
          width: 280px;
          height: 280px;
          right: -100px;
          bottom: -140px;
          background: #178969;
        }

        .login-frame {
          position: relative;
          z-index: 1;
          width: min(1080px, 100%);
          min-height: 670px;
          display: grid;
          grid-template-columns: 1.05fr 0.95fr;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.09);
          border-radius: 22px;
          background: rgba(12, 16, 22, 0.94);
          box-shadow:
            0 35px 90px rgba(0, 0, 0, 0.45),
            inset 0 1px 0 rgba(255, 255, 255, 0.03);
          backdrop-filter: blur(18px);
        }

        .story-panel {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 52px;
          border-right: 1px solid rgba(255, 255, 255, 0.07);
          background:
            linear-gradient(
              145deg,
              rgba(255, 255, 255, 0.035),
              transparent 55%
            ),
            #0b0f15;
        }

        .brand,
        .mobile-brand {
          display: flex;
          align-items: center;
          gap: 11px;
          font-size: 15px;
          font-weight: 760;
          letter-spacing: 0.19em;
        }

        .brand-mark {
          display: inline-grid;
          place-items: center;
          color: #aeb8ff;
        }

        .story-copy {
          margin-top: 92px;
          max-width: 500px;
        }

        .eyebrow,
        .access-kicker {
          margin-bottom: 18px;
          font-size: 11px;
          line-height: 1;
          font-weight: 750;
          letter-spacing: 0.17em;
          color: #9da8ff;
        }

        .story-copy h1 {
          margin: 0;
          font-size: clamp(42px, 4.2vw, 62px);
          line-height: 1.02;
          letter-spacing: -0.048em;
          font-weight: 640;
        }

        .story-description {
          max-width: 465px;
          margin: 25px 0 0;
          color: #a6afba;
          font-size: 15px;
          line-height: 1.75;
        }

        .trust-list {
          display: grid;
          gap: 13px;
          margin-top: 48px;
        }

        .trust-item {
          display: flex;
          align-items: center;
          gap: 11px;
          color: #b7bec8;
          font-size: 13px;
        }

        .trust-icon {
          width: 22px;
          height: 22px;
          display: grid;
          place-items: center;
          flex: 0 0 auto;
          border: 1px solid rgba(112, 217, 174, 0.4);
          border-radius: 999px;
          color: #8be5bf;
          background: rgba(112, 217, 174, 0.08);
        }

        .story-footer,
        .access-footer {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #a6afba;
          font-size: 11px;
          letter-spacing: 0.02em;
        }

        .access-panel {
          display: grid;
          place-items: center;
          padding: 50px 52px;
          background: rgba(14, 18, 24, 0.84);
        }

        .access-content {
          width: min(390px, 100%);
        }

        .mobile-brand {
          display: none;
          margin-bottom: 44px;
        }

        .access-heading {
          margin-bottom: 27px;
        }

        .access-heading h2 {
          margin: 0;
          color: #f6f7f9;
          font-size: 31px;
          line-height: 1.15;
          letter-spacing: -0.035em;
          font-weight: 650;
        }

        .access-heading p {
          margin: 12px 0 0;
          color: #a6afba;
          font-size: 13.5px;
          line-height: 1.65;
        }

        .demo-button,
        .sign-in-button {
          width: 100%;
          min-height: 50px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          border-radius: 9px;
          font-size: 13.5px;
          font-weight: 680;
          transition:
            transform 150ms ease,
            border-color 150ms ease,
            background 150ms ease,
            opacity 150ms ease;
        }

        .demo-button {
          justify-content: space-between;
          padding: 0 18px;
          color: #0a0d12;
          text-decoration: none;
          background: #eef1ff;
          border: 1px solid #eef1ff;
        }

        .demo-button:hover {
          transform: translateY(-1px);
          background: #ffffff;
        }

        .demo-button:focus-visible {
          outline: 3px solid #aeb8ff;
          outline-offset: 4px;
        }

        .demo-button.is-loading {
          pointer-events: none;
          opacity: 0.78;
        }

        .demo-meta {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-top: 11px;
          color: #a6afba;
          font-size: 11px;
        }

        .demo-meta span {
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .divider {
          position: relative;
          display: flex;
          justify-content: center;
          margin: 31px 0 27px;
          color: #a6afba;
          font-size: 10px;
          font-weight: 650;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .divider::before {
          content: "";
          position: absolute;
          top: 50%;
          left: 0;
          right: 0;
          height: 1px;
          background: rgba(255, 255, 255, 0.16);
        }

        .divider span {
          position: relative;
          padding: 0 12px;
          background: #0e1218;
        }

        .login-form {
          display: grid;
          gap: 18px;
        }

        .form-heading {
          margin-bottom: 1px;
        }

        .form-heading h3 {
          margin: 0;
          font-size: 15px;
          font-weight: 650;
          color: #e7eaf0;
        }

        .form-heading p {
          margin: 5px 0 0;
          color: #a6afba;
          font-size: 12px;
        }

        .field {
          display: grid;
          gap: 8px;
        }

        .field label {
          color: #b7bec8;
          font-size: 11.5px;
          font-weight: 620;
        }

        .field input {
          width: 100%;
          height: 48px;
          outline: none;
          border: 1px solid rgba(255, 255, 255, 0.18);
          border-radius: 8px;
          padding: 0 13px;
          color: #f1f3f5;
          background: rgba(255, 255, 255, 0.025);
          font: inherit;
          font-size: 13px;
          transition:
            border-color 150ms ease,
            box-shadow 150ms ease,
            background 150ms ease;
        }

        .field input::placeholder {
          color: #a6afba;
          opacity: 1;
        }

        .field input:hover {
          border-color: rgba(255, 255, 255, 0.3);
        }

        .field input:focus-visible {
          border-color: #aeb8ff;
          box-shadow:
            0 0 0 3px rgba(174, 184, 255, 0.22);
          background: rgba(255, 255, 255, 0.04);
          outline: 2px solid #aeb8ff;
          outline-offset: 2px;
        }

        .field input:disabled {
          opacity: 0.65;
        }

        .field input[aria-invalid="true"] {
          border-color: #ffa0a0;
        }

        .password-wrap {
          position: relative;
        }

        .password-wrap input {
          padding-right: 48px;
        }

        .password-toggle {
          position: absolute;
          top: 50%;
          right: 7px;
          transform: translateY(-50%);
          width: 36px;
          height: 36px;
          display: grid;
          place-items: center;
          border: 0;
          border-radius: 7px;
          color: #b7bec8;
          background: transparent;
          cursor: pointer;
        }

        .password-toggle:hover {
          color: #ffffff;
          background: rgba(255, 255, 255, 0.07);
        }

        .password-toggle:focus-visible {
          outline: 3px solid #aeb8ff;
          outline-offset: 2px;
        }

        .sign-in-button {
          border: 1px solid rgba(255, 255, 255, 0.2);
          color: #f4f6f8;
          background: rgba(255, 255, 255, 0.06);
          cursor: pointer;
        }

        .sign-in-button:hover:not(:disabled) {
          border-color: rgba(174, 184, 255, 0.5);
          background: rgba(174, 184, 255, 0.1);
        }

        .sign-in-button:focus-visible {
          outline: 3px solid #aeb8ff;
          outline-offset: 3px;
        }

        .sign-in-button:disabled {
          cursor: wait;
          opacity: 0.7;
        }

        .alert {
          padding: 11px 12px;
          border: 1px solid rgba(255, 160, 160, 0.34);
          border-radius: 8px;
          color: #ffb1b1;
          background: rgba(255, 77, 77, 0.075);
          font-size: 11.5px;
          line-height: 1.5;
        }

        .access-footer {
          justify-content: center;
          margin-top: 29px;
        }

        @media (prefers-reduced-motion: reduce) {
          *,
          *::before,
          *::after {
            scroll-behavior: auto !important;
            transition-duration: 0.01ms !important;
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
          }
        }

        @media (max-width: 820px) {
          .login-shell {
            padding: 16px;
          }

          .login-frame {
            min-height: auto;
            grid-template-columns: 1fr;
          }

          .story-panel {
            display: none;
          }

          .access-panel {
            min-height: calc(100vh - 32px);
            padding: 42px 28px;
          }

          .mobile-brand {
            display: flex;
          }

          .access-content {
            width: min(410px, 100%);
          }
        }

        @media (max-width: 480px) {
          .login-shell {
            padding: 0;
          }

          .login-frame {
            min-height: 100vh;
            border: 0;
            border-radius: 0;
          }

          .access-panel {
            min-height: 100vh;
            padding: 34px 22px;
          }

          .mobile-brand {
            margin-bottom: 52px;
          }

          .access-heading h2 {
            font-size: 28px;
          }
        }
      `}</style>
    </main>
  );
}