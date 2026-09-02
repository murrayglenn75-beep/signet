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

  const idempotencyKey = String(
    formData.get("idempotency_key") ?? ""
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

  if (!idempotencyKey) {
    return {
      ok: false,
      error: "Missing idempotency key.",
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
    "decide_change_order_with_receipt",
    {
      p_org: orgId,
      p_change_order_id: changeOrderId,
      p_decision: decision,
      p_approved_hours:
        decision === "decline" ? 0 : approvedHours,
      p_approved_fee:
        decision === "approve" ? approvedFee : 0,
      p_idempotency_key: idempotencyKey,
    }
  );

  if (error) {
    console.error("Signet decide_change_order_with_receipt failed", {
      code: error.code,
      message: error.message,
    });

    return {
      ok: false,
      error: error.message,
    };
  }

  const receipt =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;

  const seq = Number(receipt?.seq);

  const eventId =
    typeof receipt?.event_id === "string"
      ? receipt.event_id
      : "";

  const hash =
    typeof receipt?.hash === "string"
      ? receipt.hash
      : "";

  const occurredAt =
    typeof receipt?.occurred_at === "string"
      ? receipt.occurred_at
      : "";

  const streamType =
    typeof receipt?.stream_type === "string"
      ? receipt.stream_type
      : "";

  const streamId =
    typeof receipt?.stream_id === "string"
      ? receipt.stream_id
      : "";

  const eventType =
    typeof receipt?.event_type === "string"
      ? receipt.event_type
      : "";

  if (
    !Number.isSafeInteger(seq) ||
    seq <= 0 ||
    !eventId ||
    !hash ||
    !occurredAt ||
    streamType !== "change_order" ||
    streamId !== changeOrderId ||
    eventType !== "change_order.decided"
  ) {
    console.error("Signet receipt verification failed", {
      seq,
      receipt,
    });

    return {
      ok: false,
      error: "Kernel returned an invalid verified receipt.",
    };
  }

  revalidatePath("/change-orders");
  revalidatePath("/");
  revalidatePath("/signals");
  revalidatePath("/trust-ledger");

  return {
    ok: true,
    seq,
    eventId,
    hash,
    occurredAt,
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
