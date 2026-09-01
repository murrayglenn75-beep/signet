"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../../lib/supabase/server";

export type ChangeOrderDecision =
  | "approve"
  | "absorb"
  | "decline";

export type ChangeOrderResult =
  | {
      ok: true;
      seq: number;
      eventId: string;
      hash: string;
      occurredAt: string;
      changeOrderId: string;
      decision: ChangeOrderDecision;
    }
  | {
      ok: false;
      error: string;
    };

export type ChangeOrderActionState =
  | { status: "idle" }
  | {
      status: "success";
      seq: number;
      eventId: string;
      hash: string;
      occurredAt: string;
      changeOrderId: string;
      decision: ChangeOrderDecision;
    }
  | {
      status: "error";
      error: string;
    };

function asNumber(value: FormDataEntryValue | null): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function decideChangeOrder(
  formData: FormData
): Promise<ChangeOrderResult> {
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims) {
    return {
      ok: false,
      error: "Authentication required.",
    };
  }

  const claims = claimsData.claims;

  const orgId =
    typeof claims.org_id === "string"
      ? claims.org_id
      : null;

  if (!orgId) {
    return {
      ok: false,
      error: "Authenticated session has no organization claim.",
    };
  }

  const changeOrderId = String(
    formData.get("change_order_id") ?? ""
  );

  const decision = String(
    formData.get("decision") ?? ""
  ) as ChangeOrderDecision;

  const approvedHours = asNumber(
    formData.get("approved_hours")
  );

  const approvedFee = asNumber(
    formData.get("approved_fee")
  );

  if (!changeOrderId) {
    return {
      ok: false,
      error: "Missing change-order ID.",
    };
  }

  if (
    decision !== "approve" &&
    decision !== "absorb" &&
    decision !== "decline"
  ) {
    return {
      ok: false,
      error: "Invalid change-order decision.",
    };
  }

  const { data, error } = await supabase.rpc(
    "append_event",
    {
      p_org: orgId,
      p_stream_type: "change_order",
      p_stream_id: changeOrderId,
      p_event_type: "change_order.decided",
      p_payload: {
        change_order_id: changeOrderId,
        decision,
        approved_hours:
          decision === "decline" ? 0 : approvedHours,
        approved_fee:
          decision === "approve" ? approvedFee : 0,
      },
      p_actor_type: "human",
      p_actor_id: null,
    }
  );

  if (error) {
    console.error("Signet append_event failed", {
      code: error.code,
      message: error.message,
    });

    return {
      ok: false,
      error: error.message,
    };
  }

  const seq = Number(data);

  if (!Number.isSafeInteger(seq) || seq <= 0) {
    return {
      ok: false,
      error: "Kernel returned an invalid event sequence.",
    };
  }

  const { data: receipt, error: receiptError } = await supabase
    .from("events")
    .select(
      "seq,event_id,hash,occurred_at,stream_type,stream_id,event_type"
    )
    .eq("seq", seq)
    .eq("org_id", orgId)
    .eq("stream_type", "change_order")
    .eq("stream_id", changeOrderId)
    .eq("event_type", "change_order.decided")
    .single();

  if (
    receiptError ||
    !receipt ||
    receipt.seq !== seq ||
    !receipt.event_id ||
    !receipt.hash ||
    !receipt.occurred_at
  ) {
    console.error("Signet receipt verification failed", {
      seq,
      receiptError,
    });

    return {
      ok: false,
      error: "Event was appended but its verified receipt could not be read.",
    };
  }

  revalidatePath("/change-orders");
  revalidatePath("/");
  revalidatePath("/signals");
  revalidatePath("/trust-ledger");

  return {
    ok: true,
    seq,
    eventId: receipt.event_id,
    hash: receipt.hash,
    occurredAt: receipt.occurred_at,
    changeOrderId,
    decision,
  };
}

export async function decideChangeOrderWithState(
  _previousState: ChangeOrderActionState,
  formData: FormData
): Promise<ChangeOrderActionState> {
  const result = await decideChangeOrder(formData);

  if (!result.ok) {
    return {
      status: "error",
      error: result.error,
    };
  }

  return {
    status: "success",
    seq: result.seq,
    eventId: result.eventId,
    hash: result.hash,
    occurredAt: result.occurredAt,
    changeOrderId: result.changeOrderId,
    decision: result.decision,
  };
}
