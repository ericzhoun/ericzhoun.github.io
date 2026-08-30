// Public: book ONE FREE trial on a specific dated session.
// Mirrors guest-enroll's provisional-account provisioning so the trial account
// can later convert to a paid enrollment. No Stripe — total is 0.
// Auth "none" (public). Server-side validation only; client prices ignored.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function handler(req, ctx) {
  let body;
  try { body = await req.json(); } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const schedule_id = body.schedule_id;
  const class_date = body.class_date; // 'YYYY-MM-DD'
  const student_name = String(body.student_name || "").trim();
  const student_email = String(body.student_email || "").trim().toLowerCase();
  const parent_name = String(body.parent_name || "").trim();
  const student_phone = String(body.student_phone || "").trim();

  if (!schedule_id) return json({ error: "schedule_id is required" }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(class_date || "")) {
    return json({ error: "A valid class_date (YYYY-MM-DD) is required" }, 400);
  }
  if (!student_name) return json({ error: "Student name is required" }, 400);
  if (!EMAIL_RE.test(student_email)) return json({ error: "A valid email is required" }, 400);

  const apiBase = ctx.env.BUTTERBASE_API_URL || "https://api.butterbase.ai";
  const appId = ctx.env.BUTTERBASE_APP_ID;
  const siteUrl = ctx.env.SITE_URL || "https://olivistart.com";

  // 1. Schedule + program (source of truth)
  const schedRes = await ctx.db.query(
    `SELECT cs.id, cs.max_seats, p.name AS program_name
     FROM class_schedules cs JOIN programs p ON cs.program_id = p.id
     WHERE cs.id = $1 AND cs.active = true`,
    [schedule_id]
  );
  if (schedRes.rows.length === 0) return json({ error: "Class schedule not found" }, 404);
  const schedule = schedRes.rows[0];

  // 2. The specific dated session must exist, be scheduled, and not be in the past.
  //    Include the UTC-date guard server-side: the UI hides past dates, but a
  //    direct POST must not be able to book a class_date whose row is still 'scheduled'.
  //    Pin to UTC to match the rest of the codebase (sync-student-ages, etc.).
  const sessionRes = await ctx.db.query(
    `SELECT id FROM class_sessions
     WHERE schedule_id = $1 AND class_date = $2 AND status = 'scheduled'
       AND class_date >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date`,
    [schedule_id, class_date]
  );
  if (sessionRes.rows.length === 0) {
    return json({ error: "That class date is not available" }, 400);
  }
  const sessionId = sessionRes.rows[0].id;

  // 3. Capacity on the SPECIFIC date (trial + weekly 'home' bookings)
  const countRes = await ctx.db.query(
    `SELECT COUNT(*) AS taken FROM bookings
     WHERE session_id = $1 AND status = 'scheduled'`,
    [sessionId]
  );
  if (parseInt(countRes.rows[0].taken, 10) >= schedule.max_seats) {
    return json({ error: "This class date is full", code: "CLASS_FULL" }, 409);
  }

  // 4. One free trial per email
  const claimedRes = await ctx.db.query(
    `SELECT id FROM enrollments
     WHERE enrollment_type = 'trial' AND student_email = $1 LIMIT 1`,
    [student_email]
  );
  if (claimedRes.rows.length > 0) {
    return json({ error: "This email has already used its free trial", code: "TRIAL_ALREADY_CLAIMED" }, 409);
  }

  // 5. Provisional account (mirrors guest-enroll; enables later conversion)
  const password = randomPassword();
  const signupRes = await fetch(`${apiBase}/auth/${appId}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: student_email, password, display_name: student_name }),
  });
  const signupData = await signupRes.json();
  if (!signupRes.ok) {
    const msg = String(signupData.error || signupData.message || "");
    if (/already exists|already registered/i.test(msg)) {
      return json({ error: "An account with this email already exists. Please log in to book.", code: "EMAIL_EXISTS" }, 409);
    }
    console.error("Failed to create trial account:", msg);
    return json({ error: "Could not start your trial. Please try again." }, 502);
  }
  const guestUser = signupData.user;

  // 6. Trial enrollment (free) + booking on the dated session
  const enrollRes = await ctx.db.query(
    `INSERT INTO enrollments (schedule_id, user_id, student_name, student_email, student_phone,
                              status, num_classes_enrolled, price_per_class_cents, discount_pct,
                              total_paid_cents, parent_name, enrollment_type)
     VALUES ($1, $2, $3, $4, $5, 'confirmed', 1, 0, 0, 0, $6, 'trial')
     RETURNING id`,
    [schedule_id, guestUser.id, student_name, student_email, student_phone, parent_name]
  );
  const enrollmentId = enrollRes.rows[0].id;

  await ctx.db.query(
    `INSERT INTO bookings (enrollment_id, session_id, type, status)
     VALUES ($1, $2, 'trial', 'scheduled')`,
    [enrollmentId, sessionId]
  );

  const claim_url = `${siteUrl}/checkout-success.html?enrollment=${enrollmentId}&trial=1`;
  return json({ enrollment_id: enrollmentId, claim_url, total_cents: 0 }, 200);
}

function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const base = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "");
  return `Aa1!${base}`;
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
