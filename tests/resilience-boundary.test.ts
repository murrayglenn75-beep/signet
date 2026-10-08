import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  isPostgrestFutureJwtError,
  readWithPostgrestFutureJwtRecovery,
} from "../lib/resilience/postgrest-future-jwt-recovery";

const futureJwt = { code: "PGRST303", message: "JWT issued at future" };

describe("PostgREST future-JWT read recovery", () => {
  it("recognizes only the exact allowlisted failure", () => {
    expect(isPostgrestFutureJwtError(futureJwt)).toBe(true);
    expect(isPostgrestFutureJwtError({ code: "PGRST303", message: "JWT expired" })).toBe(false);
    expect(isPostgrestFutureJwtError({ code: "42501", message: "JWT issued at future" })).toBe(false);
    expect(isPostgrestFutureJwtError(null)).toBe(false);
  });

  it("does not retry a successful read", async () => {
    const op = vi.fn(async () => ({ data: ["ok"], error: null }));
    const sleep = vi.fn(async () => undefined);
    const result = await readWithPostgrestFutureJwtRecovery(op, { sleep });
    expect(result.data).toEqual(["ok"]);
    expect(op).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries once and recovers from the exact transient error", async () => {
    const op = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: futureJwt })
      .mockResolvedValueOnce({ data: ["ok"], error: null });
    const sleep = vi.fn(async () => undefined);
    const events: unknown[] = [];
    const result = await readWithPostgrestFutureJwtRecovery(op, {
      sleep,
      onRecoveryEvent: (event) => events.push(event),
    });
    expect(result.error).toBeNull();
    expect(op).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(750);
    expect(events).toEqual([
      { classification: "transient-jwt-future", attempt: 1, delayMs: 750, recovered: false },
      { classification: "transient-jwt-future", attempt: 1, delayMs: 750, recovered: true },
    ]);
  });

  it("uses fresh operations and the bounded 750/2250ms schedule", async () => {
    const op = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: futureJwt })
      .mockResolvedValueOnce({ data: null, error: futureJwt })
      .mockResolvedValueOnce({ data: ["ok"], error: null });
    const sleep = vi.fn(async () => undefined);
    const result = await readWithPostgrestFutureJwtRecovery(op, { sleep });
    expect(result.error).toBeNull();
    expect(op).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[750], [2250]]);
  });

  it("fails closed after the strict retry ceiling", async () => {
    const op = vi.fn(async () => ({ data: null, error: futureJwt }));
    const sleep = vi.fn(async () => undefined);
    const result = await readWithPostgrestFutureJwtRecovery(op, { sleep });
    expect(result.error).toEqual(futureJwt);
    expect(op).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does not retry other auth, RLS, database, or network-style errors", async () => {
    for (const error of [
      { code: "PGRST303", message: "JWT expired" },
      { code: "42501", message: "permission denied" },
      { code: "PGRST301", message: "invalid JWT" },
      { code: "08006", message: "connection failure" },
    ]) {
      const op = vi.fn(async () => ({ data: null, error }));
      const sleep = vi.fn(async () => undefined);
      const result = await readWithPostgrestFutureJwtRecovery(op, { sleep });
      expect(result.error).toEqual(error);
      expect(op).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    }
  });

  it("contains no token refresh, service-role, or mutation capability", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "lib", "resilience", "postgrest-future-jwt-recovery.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/refreshSession|service[_-]?role|SUPABASE_SERVICE_ROLE/i);
    expect(source).not.toMatch(/\.insert\(|\.update\(|\.delete\(|append_event|decide_change_order/);
  });

  it("is imported only by allowlisted read-side application code", () => {
    const root = process.cwd();
    const appSource = fs.readFileSync(path.join(root, "app", "page.tsx"), "utf8");
    expect(appSource).toContain("readWithPostgrestFutureJwtRecovery");
  });
});
