import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

const sql = postgres(
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
);

const uuid = () => randomUUID();

async function appendTrusted(
  org: string,
  streamType: string,
  streamId: string,
  eventType: string,
  payload: Record<string, unknown>
) {
  const [row] = await sql`
    select append_event(
      ${org}::uuid,
      ${streamType},
      ${streamId}::uuid,
      ${eventType},
      ${sql.json(payload)}::jsonb,
      'human',
      'idempotency-test'
    ) as seq
  `;

  return Number(row.seq);
}

describe("change-order command idempotency", () => {
  it("returns the original event for the same idempotency key and command", async () => {
    const org = uuid();
    const engagement = uuid();
    const changeOrder = uuid();
    const key = uuid();

    await appendTrusted(org, "engagement", engagement, "engagement.created", {
      name: "Idempotency test",
      client: "Test",
      fee_model: "fixed",
      fee_amount: 1000,
      planned_hours: 10,
      planned_cost: 0,
    });

    await appendTrusted(
      org,
      "change_order",
      changeOrder,
      "change_order.requested",
      {
        engagement_id: engagement,
        description: "Extra scope",
        est_hours: 2,
        est_fee: 500,
      }
    );

    const [first] = await sql`
      select decide_change_order(
        ${org}::uuid,
        ${changeOrder}::uuid,
        'approve',
        2,
        500,
        ${key}::uuid
      ) as seq
    `;

    const [second] = await sql`
      select decide_change_order(
        ${org}::uuid,
        ${changeOrder}::uuid,
        'approve',
        2,
        500,
        ${key}::uuid
      ) as seq
    `;

    expect(Number(second.seq)).toBe(Number(first.seq));

    const [count] = await sql`
      select count(*)::int as count
      from events
      where org_id = ${org}::uuid
        and stream_id = ${changeOrder}::uuid
        and event_type = 'change_order.decided'
    `;

    expect(Number(count.count)).toBe(1);
  });

  it("rejects reuse of an idempotency key for a different command", async () => {
    const org = uuid();
    const engagement = uuid();
    const changeOrder = uuid();
    const key = uuid();

    await appendTrusted(org, "engagement", engagement, "engagement.created", {
      name: "Conflict test",
      client: "Test",
      fee_model: "fixed",
      fee_amount: 1000,
      planned_hours: 10,
      planned_cost: 0,
    });

    await appendTrusted(
      org,
      "change_order",
      changeOrder,
      "change_order.requested",
      {
        engagement_id: engagement,
        description: "Extra scope",
        est_hours: 2,
        est_fee: 500,
      }
    );

    await sql`
      select decide_change_order(
        ${org}::uuid,
        ${changeOrder}::uuid,
        'approve',
        2,
        500,
        ${key}::uuid
      )
    `;

    await expect(
      sql`
        select decide_change_order(
          ${org}::uuid,
          ${changeOrder}::uuid,
          'decline',
          0,
          0,
          ${key}::uuid
        )
      `
    ).rejects.toThrow(/idempotency key reused for a different command/);
  });
});

describe("change-order command concurrency", () => {
  it("collapses concurrent duplicate submissions into one event", async () => {
    const org = uuid();
    const engagement = uuid();
    const changeOrder = uuid();
    const key = uuid();

    await appendTrusted(org, "engagement", engagement, "engagement.created", {
      name: "Concurrent idempotency test",
      client: "Test",
      fee_model: "fixed",
      fee_amount: 1000,
      planned_hours: 10,
      planned_cost: 0,
    });

    await appendTrusted(
      org,
      "change_order",
      changeOrder,
      "change_order.requested",
      {
        engagement_id: engagement,
        description: "Concurrent extra scope",
        est_hours: 2,
        est_fee: 500,
      }
    );

    const attempt = async () => {
      const [row] = await sql`
        select decide_change_order(
          ${org}::uuid,
          ${changeOrder}::uuid,
          'approve',
          2,
          500,
          ${key}::uuid
        ) as seq
      `;

      return Number(row.seq);
    };

    const results = await Promise.all([attempt(), attempt()]);

    expect(results[0]).toBe(results[1]);

    const [count] = await sql`
      select count(*)::int as count
      from events
      where org_id = ${org}::uuid
        and stream_id = ${changeOrder}::uuid
        and event_type = 'change_order.decided'
    `;

    expect(Number(count.count)).toBe(1);
  });
});
