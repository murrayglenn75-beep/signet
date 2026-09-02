import { describe, it, expect, afterAll } from "vitest";
import postgres from "postgres";

const DB_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const sql = postgres(DB_URL, { max: 5 });
const uuid = () => crypto.randomUUID();

afterAll(async () => {
  await sql.end();
});

describe("11. trust ledger security boundaries", () => {
  it("denies anon execution of browser trust ledger RPCs", async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx`set local role anon`;
        return tx`select * from get_trust_ledger_head()`;
      })
    ).rejects.toThrow(/permission denied for function get_trust_ledger_head/i);

    await expect(
      sql.begin(async (tx) => {
        await tx`set local role anon`;
        return tx`
          select *
          from get_trust_ledger_evidence(array[1::bigint])
        `;
      })
    ).rejects.toThrow(
      /permission denied for function get_trust_ledger_evidence/i
    );
  });

  it("denies authenticated execution of the AI trust ledger RPC", async () => {
    const org = uuid();
    const userId = uuid();

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

        return tx`select * from get_trust_ledger_for_ai() limit 1`;
      })
    ).rejects.toThrow(
      /permission denied for function get_trust_ledger_for_ai/i
    );
  });

  it("denies ai_narrator direct reads from events", async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx`set local role ai_narrator`;
        return tx`select seq from events limit 1`;
      })
    ).rejects.toThrow(/permission denied for table events/i);
  });

  it("keeps the legacy trust_ledger view removed", async () => {
    const [result] = await sql`
      select to_regclass('public.trust_ledger')::text as relation
    `;

    expect(result.relation).toBeNull();
  });
});