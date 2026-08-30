// Payment fulfillment webhook, called by the Butterbase billing platform on
// order status changes. Fulfillment is idempotent (status-transition guard on
// the unique stripe_order_id).
//
// Limitation: the endpoint is public (auth "none") and the payload cannot be
// re-verified - Butterbase's billing/orders reads are strictly end-user-scoped
// (service keys and X-Butterbase-As-User both get "Order not found", verified
// 2026-07-15), and deliveries carry no signature. Mitigation: order ids are
// treated as secrets - guest-enroll and enroll-guard never return them to
// clients - so forging a confirmation requires guessing a UUID.
export async function handler(req, ctx) {
  let payload;
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { event, order_id, order_status } = payload;
  console.log("Webhook received:", { event, order_id, order_status });

  if (!order_id) {
    return json({ received: true }, 200);
  }

  let newStatus = null;
  if (order_status === "paid") {
    newStatus = "confirmed";
  } else if (order_status === "failed" || order_status === "refunded") {
    newStatus = "cancelled";
  }

  if (newStatus) {
    const result = await ctx.db.query(
      `UPDATE enrollments SET status = $1 WHERE stripe_order_id = $2 AND status != $1
       RETURNING id, status, schedule_id`,
      [newStatus, order_id]
    );

    if (result.rows.length > 0) {
      const row = result.rows[0];
      console.log(`Enrollment ${row.id} updated to ${newStatus}`);

      if (newStatus === "confirmed" && row.schedule_id) {
        // Create home bookings for all future sessions
        const sessionRes = await ctx.db.query(
          `SELECT id FROM class_sessions
           WHERE schedule_id = $1 AND class_date >= CURRENT_DATE AND status = 'scheduled'`,
          [row.schedule_id]
        );

        let bookingsCreated = 0;
        for (const session of sessionRes.rows) {
          const existing = await ctx.db.query(
            `SELECT id FROM bookings WHERE enrollment_id = $1 AND session_id = $2`,
            [row.id, session.id]
          );
          if (existing.rows.length === 0) {
            await ctx.db.query(
              `INSERT INTO bookings (enrollment_id, session_id, type, status)
               VALUES ($1, $2, 'home', 'scheduled')`,
              [row.id, session.id]
            );
            bookingsCreated++;
          }
        }
        console.log(`Created ${bookingsCreated} home bookings for enrollment ${row.id}`);

      } else if (newStatus === "cancelled") {
        // Payment failed or refunded: release any premature home bookings
        const deleted = await ctx.db.query(
          `DELETE FROM bookings WHERE enrollment_id = $1 AND type = 'home' AND status = 'scheduled'
           RETURNING id`,
          [row.id]
        );
        if (deleted.rows.length > 0) {
          console.log(`Cleaned up ${deleted.rows.length} premature home bookings for cancelled enrollment ${row.id}`);
        }
      }
    }
  }

  return json({ received: true }, 200);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
