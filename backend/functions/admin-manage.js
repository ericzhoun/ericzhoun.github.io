// Admin-only management: create parent accounts, manage their students,
// grant comped enrollments, and adjust credits. HTTP trigger: auth "required".
// Every action is gated on the admin email allowlist server-side (defense in
// depth - the frontend also guards, but this never trusts it). Account
// creation calls the auth signup endpoint (mirroring guest-enroll); all other
// reads/writes run through ctx.db. The auth app_users table is not reachable
// from a function, so account enumeration is derived from app tables.
const ADMIN_EMAILS = ["herfield8@gmail.com", "lightbyolivia@gmail.com"];

export async function handler(req, ctx) {
  const adminEmail = await requireAdmin(req, ctx);
  if (!adminEmail) return json({ error: "Admin access required" }, 403);

  let body;
  try { body = await req.json(); } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  switch (body.action) {
    case "create-account":
      return createAccount(ctx, body);
    case "add-student":
      return addStudent(ctx, body);
    case "update-student":
      return updateStudent(ctx, body);
    case "create-enrollment":
      return createEnrollment(ctx, body);
    case "set-credits":
      return setCredits(ctx, body);
    default:
      return json({ error: "Unknown action" }, 400);
  }
}

// Resolves the caller's email and confirms it is an admin. Prefers the email
// on the verified token (ctx.user.email, as manage-students.js relies on);
// falls back to /auth/{appId}/me only if the token omitted it.
async function requireAdmin(req, ctx) {
  if (!ctx.user) return null;
  let email = ctx.user.email || null;
  if (!email) {
    const apiBase = ctx.env.BUTTERBASE_API_URL || "https://api.butterbase.ai";
    const appId = ctx.env.BUTTERBASE_APP_ID;
    const authHeader = req.headers.get("authorization");
    if (authHeader) {
      const res = await fetch(`${apiBase}/auth/${appId}/me`, { headers: { Authorization: authHeader } });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const user = data.user || data;
        if (user?.id === ctx.user.id) email = user.email || null;
      }
    }
  }
  return email && ADMIN_EMAILS.includes(email) ? email : null;
}

function str(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Creates a passwordless parent account via the auth signup endpoint. Nobody
// keeps the random password; the parent signs in later with an email code.
async function createAccount(ctx, body) {
  const email = str(body.email)?.toLowerCase();
  const displayName = str(body.display_name);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "A valid email is required" }, 400);
  }

  const apiBase = ctx.env.BUTTERBASE_API_URL || "https://api.butterbase.ai";
  const appId = ctx.env.BUTTERBASE_APP_ID;
  const res = await fetch(`${apiBase}/auth/${appId}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: randomPassword(), display_name: displayName || email }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = String(data.error || data.message || "");
    if (/already exists|already registered/i.test(msg)) {
      return json({ error: "An account with this email already exists.", code: "EMAIL_EXISTS" }, 409);
    }
    console.error("admin create-account signup failed:", msg);
    return json({ error: "Could not create the account. Please try again." }, 502);
  }
  return json({ account: { user_id: data.user.id, email, name: displayName || email } }, 200);
}

// Same generator guest-enroll uses: satisfies the uppercase/lower/number/
// special password policy while remaining unknown to anyone.
function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const base = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "");
  return `Aa1!${base}`;
}

// Inserts a student owned by the target user_id (not the admin), allowing
// admins to add students to any parent account.
async function addStudent(ctx, body) {
  const userId = str(body.user_id);
  const name = str(body.name);
  const dob = str(body.dob);
  if (!userId) return json({ error: "Parent account id is required" }, 400);
  if (!name) return json({ error: "Student name is required" }, 400);
  const age = calculateStudentAge(dob);
  if (age == null) return json({ error: "A valid date of birth is required" }, 400);

  const res = await ctx.db.query(
    `INSERT INTO students (user_id, name, age, dob, notes)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [userId, name, String(age), dob, str(body.notes)],
  );
  return json({ student: res.rows[0] }, 200);
}

// Updates a student (any student, since this is admin-only).
async function updateStudent(ctx, body) {
  const id = str(body.id);
  const name = str(body.name);
  const dob = str(body.dob);
  if (!id) return json({ error: "Student id is required" }, 400);
  const age = calculateStudentAge(dob);
  if (age == null) return json({ error: "A valid date of birth is required" }, 400);

  const fields = { age: String(age), dob };
  if (name !== null) fields.name = name;
  if (body.notes !== undefined) fields.notes = str(body.notes);
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const values = keys.map((k) => fields[k]);
  values.push(id);

  const res = await ctx.db.query(
    `UPDATE students SET ${sets} WHERE id = $${values.length} RETURNING *`,
    values,
  );
  if (res.rows.length === 0) return json({ error: "Student not found" }, 404);
  return json({ student: res.rows[0] }, 200);
}

// Grants a comped, already-confirmed enrollment. Price comes from the
// schedule (never the client); the student must belong to the parent. The
// student/parent fields are denormalized so the row reads consistently in the
// enrollments list, attendance sheet, and the parent's account page.
async function createEnrollment(ctx, body) {
  const userId = str(body.user_id);
  const studentId = str(body.student_id);
  const scheduleId = str(body.schedule_id);
  const numClasses = parseInt(body.num_classes_enrolled, 10);
  if (!userId || !studentId || !scheduleId) {
    return json({ error: "Parent, student, and schedule are required" }, 400);
  }
  if (!Number.isFinite(numClasses) || numClasses < 1) {
    return json({ error: "Number of classes must be at least 1" }, 400);
  }

  const scheduleRes = await ctx.db.query(
    `SELECT price_cents FROM class_schedules WHERE id = $1 AND active = true`,
    [scheduleId],
  );
  if (scheduleRes.rows.length === 0) return json({ error: "Class schedule not found" }, 404);
  const priceCents = scheduleRes.rows[0].price_cents;

  const studentRes = await ctx.db.query(
    `SELECT name FROM students WHERE id = $1 AND user_id = $2`,
    [studentId, userId],
  );
  if (studentRes.rows.length === 0) {
    return json({ error: "That student does not belong to this parent" }, 400);
  }
  const studentName = studentRes.rows[0].name;

  const res = await ctx.db.query(
    `INSERT INTO enrollments (schedule_id, user_id, student_name, student_email, student_phone,
                              status, num_classes_enrolled, price_per_class_cents, discount_pct,
                              total_paid_cents, parent_name, student_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [scheduleId, userId, studentName, str(body.student_email), str(body.student_phone),
     'confirmed', numClasses, priceCents, 0, 0, str(body.parent_name), studentId],
  );
  return json({ enrollment: { id: res.rows[0].id } }, 200);
}

// Adjusts an enrollment's paid class count (credits = this minus attended,
// computed in account.js). Below-attended values are allowed as an admin
// override; the UI warns before sending them.
async function setCredits(ctx, body) {
  const id = str(body.enrollment_id);
  const numClasses = parseInt(body.num_classes_enrolled, 10);
  if (!id) return json({ error: "Enrollment id is required" }, 400);
  if (!Number.isFinite(numClasses) || numClasses < 0) {
    return json({ error: "Number of classes must be zero or more" }, 400);
  }

  const fields = ["num_classes_enrolled = $1"];
  const values = [numClasses];
  const status = str(body.status);
  if (status) { values.push(status); fields.push(`status = $${values.length}`); }
  values.push(id);

  const res = await ctx.db.query(
    `UPDATE enrollments SET ${fields.join(", ")} WHERE id = $${values.length} RETURNING *`,
    values,
  );
  if (res.rows.length === 0) return json({ error: "Enrollment not found" }, 404);
  return json({ enrollment: res.rows[0] }, 200);
}

// Copied verbatim from manage-students.js (functions are single-file, so the
// helper must be self-contained and keep the same UTC convention).
function calculateStudentAge(dob, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob || "")) return null;
  const [year, month, day] = dob.split("-").map(Number);
  const birthDate = new Date(Date.UTC(year, month - 1, day));
  if (
    birthDate.getUTCFullYear() !== year ||
    birthDate.getUTCMonth() !== month - 1 ||
    birthDate.getUTCDate() !== day
  ) return null;
  const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (birthDate > todayDate) return null;
  const age = today.getUTCFullYear() - year;
  const birthdayHasPassed =
    today.getUTCMonth() > month - 1 ||
    (today.getUTCMonth() === month - 1 && today.getUTCDate() >= day);
  return age - (birthdayHasPassed ? 0 : 1);
}
