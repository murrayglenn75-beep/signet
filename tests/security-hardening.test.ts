import { describe, it, expect, afterAll } from "vitest";
import postgres from "postgres";

const DB_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const sql = postgres(DB_URL, { max: 10 });
const uuid = () => crypto.randomUUID();

async function appendTrusted(
  org: string,
  streamType: string,
  streamId: string,
  eventType: string,
  payload: Parameters<typeof sql.json>[0],
  actorType = "human",
  actorId = "security-test"
): Promise<number> {
  const [row] = await sql`
    select append_event(
      ${org}::uuid,
      ${streamType},
      ${streamId}::uuid,
      ${eventType},
      ${sql.json(payload)},
      ${actorType},
      ${actorId}
    ) as seq
  `;
  return Number(row.seq);
}

async function createEngagement(
  org: string,
  opts: { fixed?: boolean; plannedHours?: number } = {}
) {
  const id = uuid();
  await appendTrusted(org, "engagement", id, "engagement.created", {
    name: `Security ${id.slice(0, 6)}`,
    client: "Security Test",
    fee_model: opts.fixed === false ? "tm" : "fixed",
    fee_amount: 10000,
    planned_cost: 6000,
    planned_hours: opts.plannedHours ?? 10,
  });
  return id;
}

afterAll(async () => {
  await sql.end();
});

describe("8. authenticated write boundary", () => {
  it("rejects an authenticated caller attempting another org", async () => {
    const orgA = uuid();
    const orgB = uuid();
    const userId = uuid();
    const engagement = await createEngagement(orgA, { fixed: false });

    await expect(
      sql.begin(async (tx) => {
        await tx`select set_config(
          'request.jwt.claims',
          ${JSON.stringify({
            sub: userId,
            role: "authenticated",
            org_id: orgA,
          })},
          true
        )`;
        await tx`set local role authenticated`;

        await tx`
          select append_event(
            ${orgB}::uuid,
            'engagement',
            ${engagement}::uuid,
            'engagement.status_changed',
            ${tx.json({ status: "paused" })},
            'human',
            ${userId}
          )
        `;
      })
    ).rejects.toThrow(/requested org does not match authenticated org/);
  });

  it("rejects actor spoofing and derives the authenticated actor id", async () => {
    const org = uuid();
    const userId = uuid();
    const engagement = await createEngagement(org, { fixed: false });

    await expect(
      sql.begin(async (tx) => {
        await tx`select set_config(
          'request.jwt.claims',
          ${JSON.stringify({
            sub: userId,
            role: "authenticated",
            org_id: org,
          })},
          true
        )`;
        await tx`set local role authenticated`;

        await tx`
          select append_event(
            ${org}::uuid,
            'engagement',
            ${engagement}::uuid,
            'engagement.status_changed',
            ${tx.json({ status: "paused" })},
            'human',
            'spoofed-user'
          )
        `;
      })
    ).rejects.toThrow(/actor_id does not match authenticated user/);

    const stream = uuid();

    await sql.begin(async (tx) => {
      await tx`select set_config(
        'request.jwt.claims',
        ${JSON.stringify({
          sub: userId,
          role: "authenticated",
          org_id: org,
        })},
        true
      )`;
      await tx`set local role authenticated`;

      await tx`
        select append_event(
          ${org}::uuid,
          'engagement',
          ${stream}::uuid,
          'engagement.created',
          ${tx.json({
            name: "Auth-bound actor",
            client: "Security Test",
            fee_model: "tm",
            fee_amount: 5000,
            planned_cost: 3000,
            planned_hours: 20,
          })},
          'human',
          null
        )
      `;
    });

    const [stored] = await sql`
      select actor_id
      from events
      where org_id = ${org}::uuid and stream_id = ${stream}::uuid
      order by seq desc
      limit 1
    `;

    expect(stored.actor_id).toBe(userId);
  });

  it("rejects a time entry referencing another org's engagement", async () => {
    const orgA = uuid();
    const orgB = uuid();
    const engagementB = await createEngagement(orgB, { fixed: false });

    await expect(
      appendTrusted(orgA, "time_entry", uuid(), "time_entry.logged", {
        engagement_id: engagementB,
        budget_line_id: null,
        hours: 1,
        person: "security-test",
        cost_rate: 100,
        billable: true,
        note: "cross-org attempt",
      })
    ).rejects.toThrow(/engagement does not belong to event org/);
  });
});

describe("9. change-order authorization hardening", () => {
  it("does not let a small approved CO become an unlimited override", async () => {
    const org = uuid();
    const engagement = await createEngagement(org, {
      fixed: true,
      plannedHours: 10,
    });

    await appendTrusted(org, "time_entry", uuid(), "time_entry.logged", {
      engagement_id: engagement,
      budget_line_id: null,
      hours: 10,
      person: "security-test",
      cost_rate: 100,
      billable: true,
      note: "within original scope",
    });

    const co = uuid();

    await appendTrusted(org, "change_order", co, "change_order.requested", {
      engagement_id: engagement,
      description: "Tiny approved extension",
      est_hours: 1,
      est_fee: 300,
    });

    await appendTrusted(org, "change_order", co, "change_order.decided", {
      change_order_id: co,
      decision: "approve",
      approved_hours: 1,
      approved_fee: 300,
    });

    await expect(
      appendTrusted(org, "time_entry", uuid(), "time_entry.logged", {
        engagement_id: engagement,
        budget_line_id: null,
        hours: 3,
        person: "security-test",
        cost_rate: 100,
        billable: true,
        note: "attempt to over-consume CO",
        override: { change_order_id: co },
      })
    ).rejects.toThrow(/CHANGE_ORDER/);
  });

  it("serializes concurrent fixed-fee entries so they cannot jointly bypass the gate", async () => {
    const org = uuid();
    const engagement = await createEngagement(org, {
      fixed: true,
      plannedHours: 10,
    });

    await appendTrusted(org, "time_entry", uuid(), "time_entry.logged", {
      engagement_id: engagement,
      budget_line_id: null,
      hours: 10,
      person: "security-test",
      cost_rate: 100,
      billable: true,
      note: "base burn",
    });

    const attempt = () =>
      appendTrusted(org, "time_entry", uuid(), "time_entry.logged", {
        engagement_id: engagement,
        budget_line_id: null,
        hours: 0.75,
        person: "security-test",
        cost_rate: 100,
        billable: true,
        note: "concurrent gate probe",
      });

    const results = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    if (rejected[0]?.status === "rejected") {
      expect(String(rejected[0].reason)).toMatch(/CHANGE_ORDER/);
    }

    const [projection] = await sql`
      select hours_logged
      from proj_engagements
      where org_id = ${org}::uuid and stream_id = ${engagement}::uuid
    `;

    expect(Number(projection.hours_logged)).toBe(10.75);
  });
});

describe("10. authenticated database isolation", () => {
  it("rejects a cross-org decide_change_order command", async () => {
    const orgA = uuid();
    const orgB = uuid();
    const userId = uuid();

    await expect(
      sql.begin(async (tx) => {
        await tx`select set_config(
          'request.jwt.claims',
          ${JSON.stringify({
            sub: userId,
            role: "authenticated",
            org_id: orgA,
          })},
          true
        )`;

        await tx`set local role authenticated`;

        await tx`
          select decide_change_order(
            ${orgB}::uuid,
            ${uuid()}::uuid,
            'approve',
            1,
            100,
            ${uuid()}::uuid
          )
        `;
      })
    ).rejects.toThrow(
      /requested org does not match authenticated org/
    );
  });

  it("denies authenticated direct mutation of the events table", async () => {
    const org = uuid();
    const userId = uuid();
    const engagement = await createEngagement(org, { fixed: false });

    await expect(
      sql.begin(async (tx) => {
        await tx`select set_config(
          'request.jwt.claims',
          ${JSON.stringify({
            sub: userId,
            role: "authenticated",
            org_id: org,
          })},
          true
        )`;

        await tx`set local role authenticated`;

        await tx`
          update events
          set actor_id = 'direct-write-attempt'
          where org_id = ${org}::uuid
            and stream_id = ${engagement}::uuid
        `;
      })
    ).rejects.toThrow(/permission denied|append-only/i);

    await expect(
      sql.begin(async (tx) => {
        await tx`select set_config(
          'request.jwt.claims',
          ${JSON.stringify({
            sub: userId,
            role: "authenticated",
            org_id: org,
          })},
          true
        )`;

        await tx`set local role authenticated`;

        await tx`
          delete from events
          where org_id = ${org}::uuid
            and stream_id = ${engagement}::uuid
        `;
      })
    ).rejects.toThrow(/permission denied|append-only/i);
  });

  it("returns a verified receipt through the authenticated command boundary", async () => {
    const org = uuid();
    const userId = uuid();
    const engagement = await createEngagement(org, { fixed: false });
    const changeOrderId = uuid();
    const idempotencyKey = uuid();

    await appendTrusted(
      org,
      "change_order",
      changeOrderId,
      "change_order.requested",
      {
        engagement_id: engagement,
        description: "Receipt boundary regression",
        est_hours: 2,
        est_fee: 500,
      }
    );

    const [result] = await sql.begin(async (tx) => {
      await tx`select set_config(
        'request.jwt.claims',
        ${JSON.stringify({
          sub: userId,
          role: "authenticated",
          org_id: org,
        })},
        true
      )`;

      await tx`set local role authenticated`;

      return tx`
        select decide_change_order_with_receipt(
          ${org}::uuid,
          ${changeOrderId}::uuid,
          'approve',
          2::numeric,
          500::numeric,
          ${idempotencyKey}::uuid
        ) as receipt
      `;
    });

    const receipt = result.receipt;

    expect(receipt).toBeTruthy();
    expect(Number(receipt.seq)).toBeGreaterThan(0);
    expect(receipt.event_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(receipt.hash).toBeTruthy();
    expect(receipt.occurred_at).toBeTruthy();
    expect(receipt.stream_type).toBe("change_order");
    expect(receipt.stream_id).toBe(changeOrderId);
    expect(receipt.event_type).toBe("change_order.decided");
  });

  it("denies authenticated direct reads from the events table", async () => {
    const org = uuid();
    const userId = uuid();

    await createEngagement(org, { fixed: false });

    await expect(
      sql.begin(async (tx) => {
        await tx`select set_config(
          'request.jwt.claims',
          ${JSON.stringify({
            sub: userId,
            role: "authenticated",
            org_id: org,
          })},
          true
        )`;

        await tx`set local role authenticated`;

        return tx`
          select seq
          from events
          where org_id = ${org}::uuid
          limit 1
        `;
      })
    ).rejects.toThrow(/permission denied for table events/i);
  });
});
