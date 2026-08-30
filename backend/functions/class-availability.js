// Public seat availability for a class schedule. Anonymous REST reads of
// enrollments are blocked by RLS, so the enroll page asks this function
// instead. Counts confirmed seats plus pending holds younger than 60 minutes.
// HTTP trigger: auth "none" (public).
export async function handler(req, ctx) {
  let body;
  try { body = await req.json(); } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!body.schedule_id) {
    return json({ error: "schedule_id is required" }, 400);
  }

  const scheduleRes = await ctx.db.query(
    `SELECT max_seats FROM class_schedules WHERE id = $1 AND active = true`,
    [body.schedule_id]
  );
  if (scheduleRes.rows.length === 0) {
    return json({ error: "Class schedule not found" }, 404);
  }

  const countRes = await ctx.db.query(
    `SELECT COUNT(*) AS held FROM enrollments
     WHERE schedule_id = $1
       AND (status = 'confirmed'
            OR (status = 'pending' AND created_at > now() - interval '60 minutes'))`,
    [body.schedule_id]
  );

  return json({
    spots_taken: parseInt(countRes.rows[0].held, 10),
    max_seats: scheduleRes.rows[0].max_seats,
  }, 200);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
