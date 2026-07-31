// Admin-only management: create parent accounts, manage their students,
// grant comped enrollments, and adjust credits.
//
// HTTP trigger: auth "required", so the platform edge rejects anonymous
// callers before this runs. Authorization must carry the admin's end-user JWT:
// it is the only cross-origin header Butterbase's CORS allowlist permits
// besides Content-Type, and requireAdmin re-verifies it against
// /auth/{appId}/me rather than trusting ctx.user.
//
// Data access deliberately does NOT use ctx.db. students and enrollments carry
// user-isolation RLS policies (USING and WITH CHECK on
// user_id = current_user_id()), and a function invoked with an end-user JWT
// binds butterbase_user, so ctx.db can neither read another parent's rows nor
// insert rows owned by them - which is the entire feature. Every read and
// write therefore goes through the REST data API with the app service key,
// which the *_service_bypass policies admit, the same way guest-enroll uses
// SERVICE_KEY for billing calls.
const ADMIN_EMAILS = ["herfield8@gmail.com", "lightbyolivia@gmail.com"];

export async function handler(req, ctx) {
  const adminEmail = await requireAdmin(req, ctx);
  if (!adminEmail) return json({ error: "Admin access required" }, 403);

  let body;
  try { body = await req.json(); } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  try {
    switch (body.action) {
      case "create-account":
        return await createAccount(ctx, body);
      case "add-student":
        return await addStudent(ctx, body);
      case "update-student":
        return await updateStudent(ctx, body);
      case "create-enrollment":
        return await createEnrollment(ctx, body);
      case "set-credits":
        return await setCredits(ctx, body);
      case "list-accounts":
        return await listAccounts(ctx);
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (error) {
    if (error && error.status === 404) return json({ error: "Record not found" }, 404);
    console.error("admin-manage action failed:", body.action, error && error.message);
    return json({ error: "Something went wrong. Please try again." }, 502);
  }
}

// Resolves the caller's identity from the bearer token and returns their email
// only if the auth service verifies it and the email is on the allowlist.
// Returns null on anything else, so every failure path (no token, unverifiable
// token, non-admin, network error) denies access. ctx.user is never treated as
// proof on its own.
async function requireAdmin(req, ctx) {
  const header = req.headers.get("authorization");
  const token = str(header && header.replace(/^Bearer\s+/i, ""));
  if (!token) return null;

  try {
    const res = await fetch(`${apiBase(ctx)}/auth/${ctx.env.BUTTERBASE_APP_ID}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    const email = (data.user || data || {}).email || null;
    return email && ADMIN_EMAILS.includes(email) ? email : null;
  } catch (error) {
    console.error("admin-manage identity check failed:", error && error.message);
    return null;
  }
}

function apiBase(ctx) {
  return ctx.env.BUTTERBASE_API_URL || "https://api.butterbase.ai";
}

// REST data-API call carrying the service key, which bypasses RLS. Throws with
// .status set so the handler can map a missing row to 404.
async function data(ctx, path, options = {}) {
  const res = await fetch(`${apiBase(ctx)}/v1/${ctx.env.BUTTERBASE_APP_ID}/${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${ctx.env.SERVICE_KEY}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    const error = new Error((detail.error && detail.error.message) || `Data API error ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

const rows = (result) => (Array.isArray(result) ? result : result == null ? [] : [result]);

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

  const res = await fetch(`${apiBase(ctx)}/auth/${ctx.env.BUTTERBASE_APP_ID}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: randomPassword(), display_name: displayName || email }),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = String(result.error || result.message || "");
    if (/already exists|already registered/i.test(message)) {
      return json({ error: "An account with this email already exists.", code: "EMAIL_EXISTS" }, 409);
    }
    console.error("admin create-account signup failed:", message);
    return json({ error: "Could not create the account. Please try again." }, 502);
  }
  return json({ account: { user_id: result.user.id, email, name: displayName || email } }, 200);
}

// Same generator guest-enroll uses: satisfies the uppercase/lower/number/
// special password policy while remaining unknown to anyone.
function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const base = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "");
  return `Aa1!${base}`;
}

// Inserts a student owned by the target user_id (not the admin), which the
// service key allows despite the user-isolation WITH CHECK.
async function addStudent(ctx, body) {
  const userId = str(body.user_id);
  const name = str(body.name);
  const dob = str(body.dob);
  if (!userId) return json({ error: "Parent account id is required" }, 400);
  if (!name) return json({ error: "Student name is required" }, 400);
  const age = calculateStudentAge(dob);
  if (age == null) return json({ error: "A valid date of birth is required" }, 400);

  const created = await data(ctx, "students", {
    method: "POST",
    body: { user_id: userId, name, age: String(age), dob, notes: str(body.notes) },
  });
  return json({ student: rows(created)[0] || null }, 200);
}

// Updates any student, since this is admin-only.
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

  const updated = await data(ctx, `students/${encodeURIComponent(id)}`, { method: "PATCH", body: fields });
  const student = rows(updated)[0];
  if (!student) return json({ error: "Student not found" }, 404);
  return json({ student }, 200);
}

// Grants a comped, already-confirmed enrollment. Price comes from the schedule
// (never the client); the student must belong to the parent. The student and
// parent fields are denormalized so the row reads consistently in the
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

  const schedules = rows(await data(
    ctx,
    `class_schedules?id=eq.${encodeURIComponent(scheduleId)}&active=eq.true&select=price_cents`,
  ));
  if (schedules.length === 0) return json({ error: "Class schedule not found" }, 404);
  const priceCents = schedules[0].price_cents;

  const students = rows(await data(
    ctx,
    `students?id=eq.${encodeURIComponent(studentId)}&user_id=eq.${encodeURIComponent(userId)}&select=name`,
  ));
  if (students.length === 0) {
    return json({ error: "That student does not belong to this parent" }, 400);
  }

  const created = await data(ctx, "enrollments", {
    method: "POST",
    body: {
      schedule_id: scheduleId,
      user_id: userId,
      student_id: studentId,
      student_name: students[0].name,
      student_email: str(body.student_email),
      student_phone: str(body.student_phone),
      parent_name: str(body.parent_name),
      status: "confirmed",
      num_classes_enrolled: numClasses,
      price_per_class_cents: priceCents,
      discount_pct: 0,
      total_paid_cents: 0,
    },
  });
  return json({ enrollment: { id: (rows(created)[0] || {}).id || null } }, 200);
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
  const status = str(body.status);
  if (status && !["pending", "confirmed", "cancelled"].includes(status)) {
    return json({ error: "Invalid status" }, 400);
  }

  const fields = { num_classes_enrolled: numClasses };
  if (status) fields.status = status;

  const updated = await data(ctx, `enrollments/${encodeURIComponent(id)}`, { method: "PATCH", body: fields });
  const enrollment = rows(updated)[0];
  if (!enrollment) return json({ error: "Enrollment not found" }, 404);
  return json({ enrollment }, 200);
}

// Derives the parent list from app tables, since the auth app_users table is
// not reachable from a function. Email and name come from the parent's
// enrollment rows (the account email is stored as student_email); a parent
// with only students and no enrollments still appears, with null email/name.
async function listAccounts(ctx) {
  const [studentRows, enrollmentRows] = await Promise.all([
    data(ctx, "students?select=user_id"),
    // Newest rows carry the most recently saved contact information. Keep the
    // ordering explicit because the REST API does not guarantee row order.
    data(ctx, "enrollments?select=user_id,student_email,parent_name,created_at&order=created_at.desc"),
  ]);

  const accounts = new Map();
  const entry = (userId) => {
    if (!accounts.has(userId)) {
      accounts.set(userId, { user_id: userId, email: null, name: null, student_count: 0, enrollment_count: 0 });
    }
    return accounts.get(userId);
  };

  for (const row of rows(studentRows)) {
    if (!row.user_id) continue;
    entry(row.user_id).student_count += 1;
  }
  for (const row of rows(enrollmentRows)) {
    if (!row.user_id) continue;
    const account = entry(row.user_id);
    account.enrollment_count += 1;
    account.email = account.email || row.student_email || null;
    account.name = account.name || row.parent_name || null;
  }

  const list = [...accounts.values()].sort((a, b) => (a.name || "￿").localeCompare(b.name || "￿"));
  return json({ accounts: list }, 200);
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
