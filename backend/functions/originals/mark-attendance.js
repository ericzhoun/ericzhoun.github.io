export async function handler(req, ctx) {
  if (!ctx.user) {
    return new Response(JSON.stringify({ error: "Authentication required" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const { booking_id, status } = body;
  if (!booking_id || !status) {
    return new Response(JSON.stringify({ error: "booking_id and status are required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  if (!["attended", "no_show"].includes(status)) {
    return new Response(JSON.stringify({ error: "status must be 'attended' or 'no_show'" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  // Update booking — idempotent (re-marking just updates status)
  const result = await ctx.db.query(
    `UPDATE bookings SET status = $1, marked_at = now(), marked_by = $2
     WHERE id = $3 AND status IN ('scheduled', 'attended', 'no_show')
     RETURNING id, status, marked_at`,
    [status, ctx.user.id, booking_id]
  );

  if (result.rows.length === 0) {
    return new Response(JSON.stringify({ error: "Booking not found or already in a terminal status (skipped/cancelled)" }), {
      status: 404, headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({
    success: true,
    booking_id: result.rows[0].id,
    status: result.rows[0].status,
    marked_at: result.rows[0].marked_at,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}