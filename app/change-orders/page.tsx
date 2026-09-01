import {
  Check,
  FileCheck2,
  ShieldAlert,
  X,
} from "lucide-react";
import { redirect } from "next/navigation";
import { SignetShell } from "../../components/signet-shell";
import { createClient } from "../../lib/supabase/server";
import { ChangeOrderActions } from "../../components/change-orders/change-order-actions";

export const dynamic = "force-dynamic";

type ChangeOrderRow = {
  stream_id: string;
  engagement_id: string;
  description: string | null;
  est_hours: number | string | null;
  est_fee: number | string | null;
  status: "requested" | "approve" | "absorb" | "decline";
  approved_hours: number | string;
  approved_fee: number | string;
  last_event_seq: number;
};

type EngagementRow = {
  stream_id: string;
  name: string;
};

function money(value: number | string | null) {
  const amount = Number(value ?? 0);

  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function hours(value: number | string | null) {
  const parsed = Number(value ?? 0);
  return `${Number.isFinite(parsed) ? parsed : 0}h`;
}

function statusLabel(status: ChangeOrderRow["status"]) {
  switch (status) {
    case "approve":
      return "Approved";
    case "absorb":
      return "Absorbed";
    case "decline":
      return "Declined";
    default:
      return "Pending";
  }
}

function statusTone(status: ChangeOrderRow["status"]) {
  switch (status) {
    case "approve":
      return "clear";
    case "decline":
      return "red";
    default:
      return "amber";
  }
}

export default async function ChangeOrdersPage() {
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims) {
    redirect("/auth/demo");
  }

  const [
    { data: changeOrders, error: changeOrdersError },
    { data: engagements, error: engagementsError },
  ] = await Promise.all([
    supabase
      .from("proj_change_orders")
      .select(
        "stream_id, engagement_id, description, est_hours, est_fee, status, approved_hours, approved_fee, last_event_seq"
      )
      .order("last_event_seq", { ascending: false }),

    supabase
      .from("proj_engagements")
      .select("stream_id, name"),
  ]);

  if (changeOrdersError) {
    throw new Error(
      `Failed to load change orders: ${changeOrdersError.message}`
    );
  }

  if (engagementsError) {
    throw new Error(
      `Failed to load engagements: ${engagementsError.message}`
    );
  }

  const orders = (changeOrders ?? []) as ChangeOrderRow[];
  const engagementRows = (engagements ?? []) as EngagementRow[];

  const engagementNames = new Map(
    engagementRows.map((engagement) => [
      engagement.stream_id,
      engagement.name,
    ])
  );

  const pending = orders.find(
    (order) => order.status === "requested"
  );

  return (
    <SignetShell active="change-orders" crumb="Change Orders">
      <div className="content">
        <section className="hero page-hero">
          <div className="eyebrow">
            EXPLICIT SCOPE AUTHORITY
          </div>

          <h1>Change Orders</h1>

          <p>
            Scope beyond fixed-fee tolerance requires a recorded
            decision. Approve it, absorb it explicitly, or decline it —
            silent scope absorption is blocked.
          </p>
        </section>

        {pending ? (
          <section className="gate-banner">
            <div className="gate-icon">
              <ShieldAlert size={24} />
            </div>

            <div>
              <span>CHANGE-ORDER GATE</span>

              <h2>
                {engagementNames.get(pending.engagement_id) ??
                  "Engagement"}{" "}
                requires an explicit decision.
              </h2>

              <p>
                {pending.description ??
                  "Additional scope requires authorization before it can be treated as approved work."}
              </p>
            </div>

            <ChangeOrderActions
              changeOrderId={pending.stream_id}
              estHours={pending.est_hours}
              estFee={pending.est_fee}
            />
          </section>
        ) : (
          <section className="gate-banner">
            <div className="gate-icon">
              <Check size={24} />
            </div>

            <div>
              <span>CHANGE-ORDER GATE</span>
              <h2>No pending commercial decisions.</h2>
              <p>
                Every current change order has an explicit recorded
                outcome.
              </p>
            </div>
          </section>
        )}

        <section className="panel full-panel">
          <div className="panel-header">
            <div className="panel-heading">
              <FileCheck2 size={17} />
              <span>Change-order register</span>
            </div>

            <span className="panel-note">
              Every decision becomes a ledger event
            </span>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Engagement</th>
                  <th>Description</th>
                  <th>Hours</th>
                  <th>Fee</th>
                  <th>Status</th>
                  <th>Ledger seq</th>
                </tr>
              </thead>

              <tbody>
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      No change orders recorded.
                    </td>
                  </tr>
                ) : (
                  orders.map((order) => (
                    <tr key={order.stream_id}>
                      <td className="mono-cell">
                        {order.stream_id.slice(0, 8)}
                      </td>

                      <td className="engagement-name">
                        {engagementNames.get(
                          order.engagement_id
                        ) ?? "Unknown engagement"}
                      </td>

                      <td>
                        {order.description ?? "—"}
                      </td>

                      <td>{hours(order.est_hours)}</td>

                      <td>{money(order.est_fee)}</td>

                      <td>
                        <span
                          className={`risk-pill ${statusTone(
                            order.status
                          )}`}
                        >
                          {statusLabel(order.status)}
                        </span>
                      </td>

                      <td className="mono-cell">
                        #{order.last_event_seq}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </SignetShell>
  );
}
