// Public read: upcoming dated sessions for a schedule, with per-date availability.
// Auth "none" (public). Reuses the existing class_sessions + bookings tables;
// capacity is DERIVED (count bookings for a session_id) so there is no counter
// to keep in sync. Day/time come from the schedule (sessions only store a date).
export async function handler(req, ctx) {
  let body;
  try { body = await req.json(); } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const scheduleId = body.schedule_id;
  if (!scheduleId) return json({ error: "schedule_id is required" }, 400);

  const schedRes = await ctx.db.query(
    `SELECT id, max_seats, day_of_week, start_time, end_time
     FROM class_schedules WHERE id = $1 AND active = true`,
    [scheduleId]
  );
  if (schedRes.rows.length === 0) {
    return json({ error: "Class schedule not found" }, 404);
  }
  const schedule = schedRes.rows[0];

  const sessionRes = await ctx.db.query(
    `SELECT id, class_date FROM class_sessions
     WHERE schedule_id = $1 AND status = 'scheduled'
       AND class_date >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
     ORDER BY class_date ASC`,
    [scheduleId]
  );

  // Derived availability in ONE grouped query (no N+1 COUNT per session).
  const takenBySession = new Map();
  if (sessionRes.rows.length > 0) {
    const countRes = await ctx.db.query(
      `SELECT session_id, COUNT(*) AS taken
       FROM bookings
       WHERE session_id = ANY($1) AND status = 'scheduled'
       GROUP BY session_id`,
      [sessionRes.rows.map((s) => s.id)]
    );
    countRes.rows.forEach((r) => takenBySession.set(r.session_id, parseInt(r.taken, 10)));
  }

  const sessions = sessionRes.rows.map((s) => {
    const taken = takenBySession.get(s.id) || 0;
    return {
      session_id: s.id,
      class_date: s.class_date,
      day_of_week: schedule.day_of_week,
      start_time: schedule.start_time,
      end_time: schedule.end_time,
      spots_taken: taken,
      max_seats: schedule.max_seats,
      available: Math.max(0, schedule.max_seats - taken),
    };
  });

  return json({ schedule_id: scheduleId, max_seats: schedule.max_seats, sessions }, 200);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
