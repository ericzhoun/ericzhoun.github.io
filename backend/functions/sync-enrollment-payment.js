// On-demand payment sync for an enrollment.
//
// Butterbase billing does not push order-status events to app functions — it
// processes Stripe Connect webhooks internally and updates the order row in its
// own database (see the billing docs: "The platform handles
// checkout.session.completed … marks order as paid"). There is no
// billing-webhook forward URL. So instead of waiting for a push that never
// arrives, the account / checkout-success pages call this function for any
// pending enrollment; it reads the order status from the billing API and runs
// the same fulfillment as stripe-webhook.js (flip status, create home bookings).
//
// Order reads (GET /billing/orders/{id}) are end-user-scoped. The caller's JWT
// is forwarded as the Authorization header — the caller is the order's
// purchaser (guest-enroll creates the purchase as the provisional account's
// JWT, and the buyer ends up signed into that same account after claiming), so
// the lookup succeeds. A service key cannot read orders (returns "Order not
// found"), which is why we require auth and forward the caller token.
//
// Fulfillment is idempotent: the status-transition guard (`status != $1`) and
// the existing-bookings check both make repeated calls safe.
//
// HTTP trigger: auth "required". allow_service_key_impersonation: false.
export async function handler(req, ctx) {
  let body;
  try { body = await req.json(); } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const enrollmentId = body.enrollment_id;
  if (!enrollmentId) return json({ error: "enrollment_id is required" }, 400);

  // 1. Load the enrollment, scoped to the caller (RLS-safe via ctx.user).
  const enRes = await ctx.db.query(
    `SELECT id, status, stripe_order_id, schedule_id
     FROM enrollments
     WHERE id = $1 AND user_id = $2`,
    [enrollmentId, ctx.user.id]
  );
  if (enRes.rows.length === 0) {
    return json({ error: "Enrollment not found" }, 404);
  }
  const en = enRes.rows[0];

  // Only pending enrollments need syncing. Confirmed/cancelled are terminal.
  if (en.status !== "pending") {
    return json({ status: en.status, synced: false }, 200);
  }
  if (!en.stripe_order_id) {
    return json({ status: "pending", synced: false, reason: "no_order_id" }, 200);
  }

  // 2. Read the order status from the billing API as the caller (end-user).
  //    req.headers.get("authorization") is the caller's JWT, forwarded by the
  //    platform on auth:"required" functions.
  const apiBase = ctx.env.BUTTERBASE_API_URL || "https://api.butterbase.ai";
  const appId = ctx.env.BUTTERBASE_APP_ID;
  const callerAuth = req.headers.get("authorization") || "";

  const orderRes = await fetch(
    `${apiBase}/v1/${appId}/billing/orders/${en.stripe_order_id}`,
    { headers: { Authorization: callerAuth } }
  );
  if (!orderRes.ok) {
    // Most likely 404 "Order not found" if the caller isn't the purchaser, or
    // a transient billing-API error. Either way, don't flip status — leave it
    // pending and let the caller retry on next page load.
    console.log(`Order lookup failed for enrollment ${enrollmentId}: ${orderRes.status}`);
    return json({ status: "pending", synced: false, reason: "order_lookup_failed" }, 200);
  }
  const order = await orderRes.json();

  // 3. Map order status → enrollment status and fulfill (same logic as the
  //    stripe-webhook function).
  let newStatus = null;
  if (order.status === "paid") {
    newStatus = "confirmed";
  } else if (order.status === "failed" || order.status === "refunded") {
    newStatus = "cancelled";
  }
  if (!newStatus) {
    return json({ status: "pending", synced: false, order_status: order.status }, 200);
  }

  const upd = await ctx.db.query(
    `UPDATE enrollments SET status = $1
     WHERE id = $2 AND status != $1
     RETURNING id, status, schedule_id`,
    [newStatus, enrollmentId]
  );

  if (upd.rows.length === 0) {
    // Already at newStatus (race with another call / the webhook endpoint).
    return json({ status: newStatus, synced: false, reason: "already_set" }, 200);
  }

  if (newStatus === "confirmed" && en.schedule_id) {
    await createHomeBookings(ctx, enrollmentId, en.schedule_id);
  } else if (newStatus === "cancelled") {
    await ctx.db.query(
      `DELETE FROM bookings WHERE enrollment_id = $1 AND type = 'home' AND status = 'scheduled'`,
      [enrollmentId]
    );
  }

  console.log(`Enrollment ${enrollmentId} synced to ${newStatus} via polling`);
  return json({ status: newStatus, synced: true }, 200);
}

// Create 'home' bookings for all future scheduled sessions of this schedule.
// Shared with stripe-webhook.js; duplicated here so this function is standalone.
async function createHomeBookings(ctx, enrollmentId, scheduleId) {
  const sessionRes = await ctx.db.query(
    `SELECT id FROM class_sessions
     WHERE schedule_id = $1 AND class_date >= CURRENT_DATE AND status = 'scheduled'`,
    [scheduleId]
  );
  let created = 0;
  for (const session of sessionRes.rows) {
    const existing = await ctx.db.query(
      `SELECT id FROM bookings WHERE enrollment_id = $1 AND session_id = $2`,
      [enrollmentId, session.id]
    );
    if (existing.rows.length === 0) {
      await ctx.db.query(
        `INSERT INTO bookings (enrollment_id, session_id, type, status)
         VALUES ($1, $2, 'home', 'scheduled')`,
        [enrollmentId, session.id]
      );
      created++;
    }
  }
  console.log(`Created ${created} home bookings for enrollment ${enrollmentId}`);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
