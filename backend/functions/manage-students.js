// Student profile management (CRUD). Parents manage a list of their children
// independent of enrollments. Admins (Olivia) can manage any student.
// HTTP trigger: auth "required". Writes run as the end user (RLS-enforced);
// ownership is re-checked server-side as defense in depth.
export async function handler(req, ctx) {
  if (!ctx.user) return json({ error: "Authentication required" }, 401);

  let body;
  try { body = await req.json(); } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const action = body.action;
  const isAdminUser = isAdmin(ctx);

  if (action === "list") return list(ctx, isAdminUser);
  if (action === "add") return add(ctx, body);
  if (action === "update") return update(ctx, body, isAdminUser);
  if (action === "delete") return del(ctx, body, isAdminUser);
  if (action === "assign-enrollment") return assignEnrollment(ctx, body);
  return json({ error: "Unknown action" }, 400);
}

async function list(ctx, isAdminUser) {
  // Admin sees all students (so Olivia can tag artwork to any child); parents
  // see only their own via the RLS user-isolation policy.
  const res = isAdminUser
    ? await ctx.db.query(`SELECT * FROM students ORDER BY created_at DESC`)
    : await ctx.db.query(
        `SELECT * FROM students WHERE user_id = $1 ORDER BY created_at DESC`,
        [ctx.user.id]
      );
  return json({ students: res.rows }, 200);
}

async function add(ctx, body) {
  const name = str(body.name);
  if (!name) return json({ error: "Student name is required" }, 400);
  const dob = str(body.dob);
  const age = calculateStudentAge(dob);
  if (age == null) return json({ error: "A valid date of birth is required" }, 400);

  const res = await ctx.db.query(
    `INSERT INTO students (user_id, name, age, dob, notes)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [ctx.user.id, name, String(age), dob, str(body.notes)]
  );
  return json({ student: res.rows[0] }, 200);
}

async function update(ctx, body, isAdminUser) {
  const id = str(body.id);
  if (!id) return json({ error: "Student id is required" }, 400);
  const dob = str(body.dob);
  const age = calculateStudentAge(dob);
  if (age == null) return json({ error: "A valid date of birth is required" }, 400);

  const fields = {};
  if (str(body.name) !== null) fields.name = str(body.name);
  fields.age = String(age);
  fields.dob = dob;
  if (body.notes !== undefined) fields.notes = str(body.notes);

  const keys = Object.keys(fields);
  if (keys.length === 0) return json({ error: "No fields to update" }, 400);

  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const values = keys.map((k) => fields[k]);
  values.push(id);
  // Ownership guard: non-admins can only update their own students.
  const where = isAdminUser ? `id = $${values.length}` : `id = $${values.length} AND user_id = $${values.length + 1}`;
  if (!isAdminUser) values.push(ctx.user.id);

  const res = await ctx.db.query(
    `UPDATE students SET ${sets} WHERE ${where} RETURNING *`,
    values
  );
  if (res.rows.length === 0) return json({ error: "Student not found" }, 404);
  return json({ student: res.rows[0] }, 200);
}

async function del(ctx, body, isAdminUser) {
  const id = str(body.id);
  if (!id) return json({ error: "Student id is required" }, 400);

  const values = [id];
  const where = isAdminUser ? `id = $1` : `id = $1 AND user_id = $2`;
  if (!isAdminUser) values.push(ctx.user.id);

  const res = await ctx.db.query(`DELETE FROM students WHERE ${where}`, values);
  if ((res.rowCount || 0) === 0) return json({ error: "Student not found" }, 404);
  return json({ deleted: true }, 200);
}

// An enrollment may only be linked to one of the caller's students. Keeping
// both ownership checks in this statement prevents a parent from attaching a
// child they do not own or modifying another parent's enrollment.
async function assignEnrollment(ctx, body) {
  const enrollmentId = str(body.enrollment_id);
  const studentId = str(body.student_id);
  if (!enrollmentId) return json({ error: "Enrollment id is required" }, 400);
  if (!studentId) return json({ error: "Student id is required" }, 400);

  const res = await ctx.db.query(
    `UPDATE enrollments SET student_id = $1
     WHERE id = $2 AND user_id = $3
       AND EXISTS (SELECT 1 FROM students WHERE id = $1 AND user_id = $3)
     RETURNING id, student_id`,
    [studentId, enrollmentId, ctx.user.id]
  );
  if (res.rows.length === 0) return json({ error: "Enrollment or student not found" }, 404);
  return json({ enrollment: res.rows[0] }, 200);
}

// Injected by deploy.sh from backend/admin-emails.json, the single place the
// allowlist is written down. Functions are single-file and cannot import a
// shared module, so the list is passed as config rather than copied here.
// Fails closed: a missing or malformed value grants nobody admin.
function isAdmin(ctx) {
  const email = ctx.user && ctx.user.email;
  if (!email) return false;
  try {
    const parsed = JSON.parse(ctx.env.ADMIN_EMAILS || "[]");
    return Array.isArray(parsed) && parsed.includes(email);
  } catch {
    console.error("admin allowlist is missing or malformed; denying admin access");
    return false;
  }
}

function str(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// Butterbase deploys this function as one source file, so DOB validation must
// remain self-contained while matching the account helper's UTC convention.
function calculateStudentAge(dob, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob || "")) return null;

  const [year, month, day] = dob.split("-").map(Number);
  const birthDate = new Date(Date.UTC(year, month - 1, day));
  if (
    birthDate.getUTCFullYear() !== year ||
    birthDate.getUTCMonth() !== month - 1 ||
    birthDate.getUTCDate() !== day
  ) return null;

  const todayDate = new Date(Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  ));
  if (birthDate > todayDate) return null;

  const age = today.getUTCFullYear() - year;
  const birthdayHasPassed =
    today.getUTCMonth() > month - 1 ||
    (today.getUTCMonth() === month - 1 && today.getUTCDate() >= day);
  return age - (birthdayHasPassed ? 0 : 1);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
