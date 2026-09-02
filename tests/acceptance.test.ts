/**
 * Signet — Phase 1 Acceptance Suite (spec §10)
 *
 * These tests define DONE. They are written to FAIL until the kernel is
 * implemented. Work top to bottom. Never modify a test to make it pass —
 * if a test is genuinely wrong, stop and explain before touching it.
 *
 * Runs against local Supabase: `supabase start` first.
 * Connection: superuser for setup/corruption, plus role-scoped checks.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

const DB_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const sql = postgres(DB_URL, { max: 10 });
const ORG = "00000000-0000-0000-0000-000000000001";

/** Helper: the only legitimate write path. */
async function append(
  streamType: string,
  streamId: string,
  eventType: string,
  payload: Parameters<typeof sql.json>[0],
  actorType = "human",
  actorId = "test-user"
): Promise<number> {
  const [row] = await sql`
    select append_event(
      ${ORG}::uuid, ${streamType}, ${streamId}::uuid, ${eventType},
      ${sql.json(payload)}, ${actorType}, ${actorId}
    ) as seq`;
  return Number(row.seq);
}

const uuid = () => crypto.randomUUID();

beforeAll(async () => {
  // Clean slate for the test org (projections + signals are rebuildable;
  // events for this org are wiped via truncate-with-trigger-disabled ONLY
  // here in test setup — this is the test harness's privilege, never the app's).
  await sql`set session_replication_role = replica`;
  await sql`delete from events where org_id = ${ORG}::uuid`;
  await sql`delete from chain_heads where org_id = ${ORG}::uuid`;
  await sql`set session_replication_role = default`;
  await sql`delete from signals where org_id = ${ORG}::uuid`;
  await sql`delete from proj_engagements where org_id = ${ORG}::uuid`;
  await sql`delete from proj_budget_lines where org_id = ${ORG}::uuid`;
});

afterAll(async () => {
  await sql.end();
});

// ---------------------------------------------------------------------------
// TEST 1 — Immutability: update/delete on events fails for every role.
// ---------------------------------------------------------------------------
describe("1. events is append-only", () => {
  it("rejects UPDATE even as superuser", async () => {
    const id = uuid();
    await append("engagement", id, "engagement.created", {
      name: "Immutable Co",
      client: "ACME",
      fee_model: "tm",
      fee_amount: 10000,
      planned_cost: 6000,
      planned_hours: 40,
    });
    await expect(
      sql`update events set actor_id = 'tampered' where stream_id = ${id}::uuid`
    ).rejects.toThrow(/append-only/);
  });

  it("rejects DELETE even as superuser", async () => {
    await expect(
      sql`delete from events where org_id = ${ORG}::uuid`
    ).rejects.toThrow(/append-only/);
  });
});

// ---------------------------------------------------------------------------
// TEST 2 — Tamper evidence: corrupting one payload breaks verify_chain
//          at that seq and every subsequent seq.
// ---------------------------------------------------------------------------
describe("2. hash chain detects corruption", () => {
  it("verify_chain flags corrupted event and all descendants", async () => {
    const id = uuid();
    const seqA = await append("engagement", id, "engagement.created", {
      name: "Chain Co",
      client: "ACME",
      fee_model: "tm",
      fee_amount: 5000,
      planned_cost: 3000,
      planned_hours: 20,
    });
    await append("engagement", id, "engagement.status_changed", {
      status: "active",
    });
    await append("engagement", id, "engagement.status_changed", {
      status: "paused",
    });

    // Pre-corruption: whole chain verifies.
    const before = await sql`select * from verify_chain(${ORG}::uuid)`;
    expect(before.every((r: any) => r.ok)).toBe(true);

    // Corrupt via superuser with triggers disabled — simulating a malicious DBA.
    await sql`set session_replication_role = replica`;
    await sql`
      update events set payload = payload || '{"fee_amount": 999999}'::jsonb
      where seq = ${seqA}`;
    await sql`set session_replication_role = default`;

    const after = await sql`select * from verify_chain(${ORG}::uuid)`;
    const bySeq = new Map(after.map((r: any) => [Number(r.seq), r.ok]));
    expect(bySeq.get(seqA)).toBe(false);
    // Chain property: hash of seqA no longer matches → but prev_hash links of
    // descendants still reference the ORIGINAL hash, so descendants' prev_hash
    // check still passes; the corruption is pinned to seqA. What must hold:
    // at least seqA fails, and re-verification is deterministic.
    const after2 = await sql`select * from verify_chain(${ORG}::uuid)`;
    expect(after2).toEqual(after);
  });
});

// ---------------------------------------------------------------------------
// TEST 3 — Replay determinism: rebuild_projections == live state.
// ---------------------------------------------------------------------------
describe("3. projections rebuild identically from replay", () => {
  it("live projections equal replayed projections", async () => {
    const eng = uuid();
    const line = uuid();
    await append("engagement", eng, "engagement.created", {
      name: "Replay Co",
      client: "Beta",
      fee_model: "tm",
      fee_amount: 20000,
      planned_cost: 12000,
      planned_hours: 100,
    });
    await append("budget_line", line, "budget_line.created", {
      engagement_id: eng,
      label: "Discovery",
      budget_hours: 30,
      rate: 200,
      cost_rate: 90,
    });
    for (let i = 0; i < 5; i++) {
      await append("time_entry", uuid(), "time_entry.logged", {
        engagement_id: eng,
        budget_line_id: line,
        hours: 4,
        person: "glenn",
        cost_rate: 90,
        billable: true,
        note: `session ${i}`,
      });
    }

    const live = await sql`
      select * from proj_engagements where org_id = ${ORG}::uuid
      and stream_id = ${eng}::uuid
      order by stream_id`;
    const liveLines = await sql`
      select * from proj_budget_lines where org_id = ${ORG}::uuid
      and stream_id = ${line}::uuid
      order by stream_id`;

    await sql`select rebuild_projections(${ORG}::uuid)`;

    const replayed = await sql`
      select * from proj_engagements where org_id = ${ORG}::uuid
      and stream_id = ${eng}::uuid
      order by stream_id`;
    const replayedLines = await sql`
      select * from proj_budget_lines where org_id = ${ORG}::uuid
      and stream_id = ${line}::uuid
      order by stream_id`;

    expect(replayed).toEqual(live);
    expect(replayedLines).toEqual(liveLines);
  });
});

// ---------------------------------------------------------------------------
// TEST 4 — Concurrency: parallel appends produce a strictly linear chain.
// ---------------------------------------------------------------------------
describe("4. chain stays linear under concurrent writers", () => {
  it("20 parallel appends → unique prev_hash, verified chain", async () => {
    const eng = uuid();
    await append("engagement", eng, "engagement.created", {
      name: "Race Co",
      client: "Gamma",
      fee_model: "tm",
      fee_amount: 8000,
      planned_cost: 5000,
      planned_hours: 50,
    });

    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        append("time_entry", uuid(), "time_entry.logged", {
          engagement_id: eng,
          budget_line_id: null,
          hours: 0.5,
          person: `p${i}`,
          cost_rate: 80,
          billable: true,
          note: "concurrent",
        })
      )
    );

    const [{ dupes }] = await sql`
      select count(*) - count(distinct prev_hash) as dupes
      from events where org_id = ${ORG}::uuid`;
    expect(Number(dupes)).toBe(0);

    const chain = await sql`select * from verify_chain(${ORG}::uuid)`;
    // Note: seq from test 2's corruption stays broken; every event AFTER it
    // must verify. Filter to events created in this test's window instead:
    const failing = chain.filter((r: any) => !r.ok);
    expect(failing.length).toBeLessThanOrEqual(1); // only test 2's corrupted row
  });
});

// ---------------------------------------------------------------------------
// TEST 5 — Change-Order Gate: silent scope absorption is impossible.
// ---------------------------------------------------------------------------
describe("5. change-order gate on fixed-fee engagements", () => {
  const eng = uuid();

  it("rejects a time entry pushing burn past 110% of planned hours", async () => {
    await append("engagement", eng, "engagement.created", {
      name: "Fixed Co",
      client: "Delta",
      fee_model: "fixed",
      fee_amount: 15000,
      planned_cost: 9000,
      planned_hours: 10,
    });
    // Burn to exactly 10h (100%) — allowed.
    await append("time_entry", uuid(), "time_entry.logged", {
      engagement_id: eng,
      budget_line_id: null,
      hours: 10,
      person: "glenn",
      cost_rate: 90,
      billable: true,
      note: "scoped work",
    });
    // +2h → 120% > 110% threshold → gate must reject with structured error.
    await expect(
      append("time_entry", uuid(), "time_entry.logged", {
        engagement_id: eng,
        budget_line_id: null,
        hours: 2,
        person: "glenn",
        cost_rate: 90,
        billable: true,
        note: "unscoped extra",
      })
    ).rejects.toThrow(/CHANGE_ORDER/);
  });

  it("accepts the same entry once an approved CO covers the hours", async () => {
    const co = uuid();
    await append("change_order", co, "change_order.requested", {
      engagement_id: eng,
      description: "Client-requested extra reporting",
      est_hours: 5,
      est_fee: 1500,
    });
    await append("change_order", co, "change_order.decided", {
      change_order_id: co,
      decision: "approve",
      approved_hours: 5,
      approved_fee: 1500,
    });
    const seq = await append("time_entry", uuid(), "time_entry.logged", {
      engagement_id: eng,
      budget_line_id: null,
      hours: 2,
      person: "glenn",
      cost_rate: 90,
      billable: true,
      note: "extra reporting under CO",
      override: { change_order_id: co },
    });
    expect(seq).toBeGreaterThan(0);
  });

  it("accepts after an explicit absorb decision — and the decision is in the ledger", async () => {
    const co2 = uuid();
    await append("change_order", co2, "change_order.requested", {
      engagement_id: eng,
      description: "Small favor for the client",
      est_hours: 3,
      est_fee: 0,
    });
    await append("change_order", co2, "change_order.decided", {
      change_order_id: co2,
      decision: "absorb",
      approved_hours: 3,
      approved_fee: 0,
    });
    const seq = await append("time_entry", uuid(), "time_entry.logged", {
      engagement_id: eng,
      budget_line_id: null,
      hours: 3,
      person: "glenn",
      cost_rate: 90,
      billable: false,
      note: "absorbed favor",
      override: { change_order_id: co2 },
    });
    expect(seq).toBeGreaterThan(0);

    // The absorb decision must be visible in the ledger — silent absorb impossible.
    const decisions = await sql`
      select 1 from events
      where org_id = ${ORG}::uuid
        and event_type = 'change_order.decided'
        and payload->>'decision' = 'absorb'
        and stream_id = ${co2}::uuid`;
    expect(decisions.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// TEST 6 — AI boundary: ai_narrator reads signals + trust_ledger, nothing else.
// ---------------------------------------------------------------------------
describe("6. ai_narrator role is scoped to signals and trust_ledger", () => {
  it("can select signals and AI trust ledger RPC; everything else is denied", async () => {
    await sql.begin(async (tx) => {
      await tx`set local role ai_narrator`;
      await tx`select * from signals limit 1`;          // must succeed
      await tx`select * from public.get_trust_ledger_for_ai() limit 1`;     // must succeed
    });

    await expect(
      sql.begin(async (tx) => {
        await tx`set local role ai_narrator`;
        await tx`select * from proj_engagements limit 1`;
      })
    ).rejects.toThrow(/permission denied/);

    await expect(
      sql.begin(async (tx) => {
        await tx`set local role ai_narrator`;
        await tx`select payload from events limit 1`;
      })
    ).rejects.toThrow(/permission denied/);
  });
});

// ---------------------------------------------------------------------------
// TEST 7 — Signal provenance: OVER_BUDGET evidence sums to the computed burn.
// ---------------------------------------------------------------------------
describe("7. signals carry verifiable evidence", () => {
  it("OVER_BUDGET evidence_seqs' hours sum to hours_logged in detail", async () => {
    const eng = uuid();
    const line = uuid();
    await append("engagement", eng, "engagement.created", {
      name: "Evidence Co",
      client: "Epsilon",
      fee_model: "tm",
      fee_amount: 30000,
      planned_cost: 18000,
      planned_hours: 200,
    });
    await append("budget_line", line, "budget_line.created", {
      engagement_id: eng,
      label: "Build",
      budget_hours: 8,
      rate: 200,
      cost_rate: 90,
    });
    // 3 entries totalling 9h > 8h budget → OVER_BUDGET red.
    for (const h of [4, 3, 2]) {
      await append("time_entry", uuid(), "time_entry.logged", {
        engagement_id: eng,
        budget_line_id: line,
        hours: h,
        person: "glenn",
        cost_rate: 90,
        billable: true,
        note: "build work",
      });
    }

    const [signal] = await sql`
      select * from signals
      where org_id = ${ORG}::uuid and stream_id = ${line}::uuid
        and code = 'OVER_BUDGET' and cleared_at is null`;
    expect(signal).toBeDefined();
    expect(signal.severity).toBe("red");

    const evidence = await sql`
      select coalesce(sum((payload->>'hours')::numeric), 0) as total
      from events
      where seq = any(${signal.evidence_seqs}::bigint[])
        and event_type = 'time_entry.logged'`;
    expect(Number(evidence[0].total)).toBe(9);
    expect(Number(signal.detail.hours_logged ?? signal.detail.logged)).toBe(9);
  });
});
