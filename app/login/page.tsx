"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
      setError(signInError.message);
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
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          display: "grid",
          gap: 24,
        }}
      >
        <form onSubmit={handleSubmit}>
          <h1>Sign in to Signet</h1>

          <p>Verified operations access</p>

          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) =>
                setEmail(event.target.value)
              }
              required
              autoComplete="email"
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) =>
                setPassword(event.target.value)
              }
              required
              autoComplete="current-password"
            />
          </label>

          {error ? (
            <p role="alert">{error}</p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
          >
            {loading
              ? "Signing in..."
              : "Sign in"}
          </button>
        </form>

        <section
          style={{
            borderTop:
              "1px solid rgba(255,255,255,0.12)",
            paddingTop: 20,
          }}
        >
          <h2 style={{ marginBottom: 8 }}>
            Explore the demo workspace
          </h2>

          <p style={{ marginBottom: 16 }}>
            Open a read-only workspace with seeded
            engagements, deterministic risk signals,
            change-order history, and a tamper-evident Trust
            Ledger.
          </p>

          {demoError ? (
            <p
              role="alert"
              style={{ marginBottom: 16 }}
            >
              Demo login is temporarily unavailable.
            </p>
          ) : null}

          <a
            href={demoHref}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              minHeight: 44,
              textDecoration: "none",
              border: "1px solid currentColor",
              borderRadius: 8,
              fontWeight: 600,
            }}
          >
            Enter demo workspace
          </a>

          <p
            style={{
              marginTop: 12,
              fontSize: 13,
              opacity: 0.7,
            }}
          >
            Demo access is isolated and read-only.
          </p>
        </section>
      </div>
    </main>
  );
}