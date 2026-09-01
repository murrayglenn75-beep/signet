"use client";

import { useActionState, useRef } from "react";
import { Check, ShieldCheck, X } from "lucide-react";
import {
  decideChangeOrderWithState,
  type ChangeOrderActionState,
} from "../../app/actions/change-orders";

type Props = {
  changeOrderId: string;
  estHours: number | string | null;
  estFee: number | string | null;
};

const initialState: ChangeOrderActionState = {
  status: "idle",
};

export function ChangeOrderActions({
  changeOrderId,
  estHours,
  estFee,
}: Props) {
  const [state, action, pending] = useActionState(
    decideChangeOrderWithState,
    initialState
  );

  const approveKey = useRef(crypto.randomUUID());
  const absorbKey = useRef(crypto.randomUUID());
  const declineKey = useRef(crypto.randomUUID());

  return (
    <div className="decision-stack">
      <div className="gate-actions">
        <form action={action}>
          <input
            type="hidden"
            name="change_order_id"
            value={changeOrderId}
          />
          <input
            type="hidden"
            name="idempotency_key"
            value={approveKey.current}
          />
          <input type="hidden" name="decision" value="approve" />
          <input
            type="hidden"
            name="approved_hours"
            value={String(estHours ?? 0)}
          />
          <input
            type="hidden"
            name="approved_fee"
            value={String(estFee ?? 0)}
          />

          <button
            className="approve"
            type="submit"
            disabled={pending}
          >
            <Check size={14} />
            Approve
          </button>
        </form>

        <form action={action}>
          <input
            type="hidden"
            name="change_order_id"
            value={changeOrderId}
          />
          <input
            type="hidden"
            name="idempotency_key"
            value={absorbKey.current}
          />
          <input type="hidden" name="decision" value="absorb" />
          <input
            type="hidden"
            name="approved_hours"
            value={String(estHours ?? 0)}
          />
          <input type="hidden" name="approved_fee" value="0" />

          <button
            className="absorb"
            type="submit"
            disabled={pending}
          >
            Absorb
          </button>
        </form>

        <form action={action}>
          <input
            type="hidden"
            name="change_order_id"
            value={changeOrderId}
          />
          <input
            type="hidden"
            name="idempotency_key"
            value={declineKey.current}
          />
          <input type="hidden" name="decision" value="decline" />
          <input type="hidden" name="approved_hours" value="0" />
          <input type="hidden" name="approved_fee" value="0" />

          <button
            className="decline"
            type="submit"
            disabled={pending}
          >
            <X size={14} />
            Decline
          </button>
        </form>
      </div>

      {pending && (
        <div className="decision-pending">
          Recording verified ledger event…
        </div>
      )}

      {state.status === "success" && (
        <div className="verified-receipt">
          <ShieldCheck size={16} />

          <div>
            <strong>VERIFIED EVENT RECORDED</strong>
            <span>
              Ledger sequence #{state.seq} ·{" "}
              {state.decision.toUpperCase()}
            </span>
          </div>
        </div>
      )}

      {state.status === "error" && (
        <div className="decision-error">
          Decision rejected: {state.error}
        </div>
      )}
    </div>
  );
}
