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

  const { action, enrollment_id, session_id } = body;
  if (!action || !enrollment_id || !session_id) {
    return new Response(JSON.stringify({ error: "action, enrollment_id, and session_id are required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  // Verify the enrollment belongs to the user
  const enrollCheck = await ctx.db.query(
    `SELECT id, schedule_id FROM enrollments WHERE id = $1 AND user_id = $2`,
    [enrollment_id, ctx.user.id]
  );
  if (enrollCheck.rows.length === 0) {
    return new Response(JSON.stringify({ error: "Enrollment not found or not owned by you" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }
  const enrollment = enrollCheck.rows[0];

  // Fetch the session with schedule info
  const sessionRes = await ctx.db.query(
    `SELECT cs.*, cs2.program_id, cs2.max_seats, cs2.start_time, cs2.end_time
     FROM class_sessions cs
     JOIN class_schedules cs2 ON cs.schedule_id = cs2.id
     WHERE cs.id = $1`,
    [session_id]
  );
  if (sessionRes.rows.length === 0) {
    return new Response(JSON.stringify({ error: "Session not found" }), {
      status: 404, headers: { "Content-Type": "application/json" },
    });
  }
  const session = sessionRes.rows[0];

  // 24h cutoff check
  const sessionDateTime = new Date(session.class_date + "T" + session.start_time + ":00");
  const now = new Date();
  const hoursUntil = (sessionDateTime - now) / (1000 * 60 * 60);
  if (hoursUntil < 24) {
    return new Response(JSON.stringify({ error: "This action requires at least 24 hours notice" }), {
      status: 409, headers: { "Content-Type": "application/json" },
    });
  }

  if (action === "makeup") {
    // Verify the session is in the same program as the enrollment's schedule
    const enrollSchedRes = await ctx.db.query(
      `SELECT program_id FROM class_schedules WHERE id = $1`,
      [enrollment.schedule_id]
    );
    if (enrollSchedRes.rows.length === 0 || enrollSchedRes.rows[0].program_id !== session.program_id) {
      return new Response(JSON.stringify({ error: "Make-up must be in the same program" }), {
        status: 403, headers: { "Content-Type": "application/json" },
      });
    }

    // Check open seats (server-side re-check)
    const seatRes = await ctx.db.query(
      `SELECT COUNT(*) AS booked FROM bookings
       WHERE session_id = $1 AND status IN ('scheduled', 'attended')`,
      [session_id]
    );
    const booked = parseInt(seatRes.rows[0].booked, 10);
    if (booked >= session.max_seats) {
      return new Response(JSON.stringify({ error: "This session is full" }), {
        status: 409, headers: { "Content-Type": "application/json" },
      });
    }

    // Check for duplicate booking
    const dupRes = await ctx.db.query(
      `SELECT id FROM bookings WHERE enrollment_id = $1 AND session_id = $2 AND status IN ('scheduled', 'attended')`,
      [enrollment_id, session_id]
    );
    if (dupRes.rows.length > 0) {
      return new Response(JSON.stringify({ error: "You already have a booking for this session" }), {
        status: 409, headers: { "Content-Type": "application/json" },
      });
    }

    // Create the makeup booking
    const bookRes = await ctx.db.query(
      `INSERT INTO bookings (enrollment_id, session_id, type, status)
       VALUES ($1, $2, 'makeup', 'scheduled') RETURNING id, status`,
      [enrollment_id, session_id]
    );

    return new Response(JSON.stringify({
      success: true, booking_id: bookRes.rows[0].id, status: bookRes.rows[0].status,
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } else if (action === "skip") {
    // Find the home booking for this session
    const bookRes = await ctx.db.query(
      `UPDATE bookings SET status = 'skipped'
       WHERE enrollment_id = $1 AND session_id = $2 AND type = 'home' AND status = 'scheduled'
       RETURNING id, status`,
      [enrollment_id, session_id]
    );
    if (bookRes.rows.length === 0) {
      return new Response(JSON.stringify({ error: "No schedulable home booking found for this session" }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      success: true, booking_id: bookRes.rows[0].id, status: bookRes.rows[0].status,
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } else if (action === "cancel") {
    // Cancel a makeup booking
    const bookRes = await ctx.db.query(
      `UPDATE bookings SET status = 'cancelled'
       WHERE enrollment_id = $1 AND session_id = $2 AND type = 'makeup' AND status = 'scheduled'
       RETURNING id, status`,
      [enrollment_id, session_id]
    );
    if (bookRes.rows.length === 0) {
      return new Response(JSON.stringify({ error: "No schedulable make-up booking found for this session" }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      success: true, booking_id: bookRes.rows[0].id, status: bookRes.rows[0].status,
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } else {
    return new Response(JSON.stringify({ error: "Unknown action. Use: makeup, skip, or cancel" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
}