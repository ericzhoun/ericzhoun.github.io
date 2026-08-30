export async function handler(req, ctx) {
  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const { schedule_id } = body;
  if (!schedule_id) {
    return new Response(JSON.stringify({ error: "schedule_id is required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  // 1. Fetch schedule + semester
  const schedRes = await ctx.db.query(
    `SELECT cs.day_of_week, cs.semester_id, s.start_date, s.end_date
     FROM class_schedules cs
     JOIN semesters s ON cs.semester_id = s.id
     WHERE cs.id = $1`,
    [schedule_id]
  );
  if (schedRes.rows.length === 0) {
    return new Response(JSON.stringify({ error: "Schedule not found" }), {
      status: 404, headers: { "Content-Type": "application/json" },
    });
  }
  const { day_of_week, start_date, end_date } = schedRes.rows[0];
  if (!start_date || !end_date) {
    return new Response(JSON.stringify({ error: "Semester missing start/end dates" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  // 2. Generate dates matching day_of_week in the semester range
  const dayMap = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
  const targetDay = dayMap[day_of_week];
  const sessions = [];
  const d = new Date(start_date);
  const end = new Date(end_date);
  while (d <= end) {
    if (d.getDay() === targetDay) {
      sessions.push(d.toISOString().split("T")[0]);
    }
    d.setDate(d.getDate() + 1);
  }

  // 3. Insert sessions (skip existing)
  let insertedCount = 0;
  for (const dateStr of sessions) {
    const res = await ctx.db.query(
      `INSERT INTO class_sessions (schedule_id, class_date, status)
       VALUES ($1, $2, 'scheduled')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [schedule_id, dateStr]
    );
    if (res.rows.length > 0) insertedCount++;
  }

  // 4. Backfill home bookings ONLY for confirmed enrollments
  const enrollRes = await ctx.db.query(
    `SELECT e.id FROM enrollments e
     WHERE e.schedule_id = $1 AND e.status = 'confirmed'`,
    [schedule_id]
  );

  let bookingsCreated = 0;
  for (const enrollment of enrollRes.rows) {
    const sessionRes = await ctx.db.query(
      `SELECT cs.id FROM class_sessions cs
       WHERE cs.schedule_id = $1 AND cs.class_date >= CURRENT_DATE AND cs.status = 'scheduled'
         AND cs.id NOT IN (SELECT session_id FROM bookings WHERE enrollment_id = $2)`,
      [schedule_id, enrollment.id]
    );
    for (const session of sessionRes.rows) {
      await ctx.db.query(
        `INSERT INTO bookings (enrollment_id, session_id, type, status)
         VALUES ($1, $2, 'home', 'scheduled')`,
        [enrollment.id, session.id]
      );
      bookingsCreated++;
    }
  }

  return new Response(JSON.stringify({
    sessions_created: insertedCount,
    total_sessions: sessions.length,
    bookings_created: bookingsCreated,
  }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}