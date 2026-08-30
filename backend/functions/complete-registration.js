// Saves the post-payment registration form for an enrollment the caller owns.
// HTTP trigger: auth "required". Replaces the former client-side service-key
// PATCH (the service key must never ship to browsers).
const FIELDS = [
  "child_name", "child_dob", "parent_name", "student_phone",
  "emergency_contact", "allergies", "referred_by",
];

export async function handler(req, ctx) {
  if (!ctx.user) {
    return json({ error: "Authentication required" }, 401);
  }

  let body;
  try { body = await req.json(); } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!body.enrollment_id) {
    return json({ error: "enrollment_id is required" }, 400);
  }
  const childAge = calculateAge(body.child_dob);
  if (childAge == null) {
    return json({ error: "A valid date of birth is required" }, 400);
  }

  const sets = [];
  const values = [];
  for (const f of FIELDS) {
    if (body[f] !== undefined) {
      values.push(String(body[f]));
      sets.push(`${f} = $${values.length}`);
    }
  }
  values.push(String(childAge));
  sets.push(`child_age = $${values.length}`);
  values.push(body.enrollment_id, ctx.user.id);

  const res = await ctx.db.query(
    `UPDATE enrollments
     SET ${sets.length ? sets.join(", ") + "," : ""}
         agreement_signed = true, agreement_date = now(), registration_complete = true
     WHERE user_id = $${values.length}
       AND (
         id = $${values.length - 1}
         OR stripe_order_id = (SELECT stripe_order_id FROM enrollments WHERE id = $${values.length - 1} AND user_id = $${values.length})
       )
     RETURNING id`,
    values
  );
  if (res.rows.length === 0) {
    return json({ error: "Enrollment not found" }, 404);
  }

  return json({ id: res.rows[0].id }, 200);
}

export function calculateAge(dob, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob || "")) return null;

  const [year, month, day] = dob.split("-").map(Number);
  const birthDate = new Date(Date.UTC(year, month - 1, day));
  if (
    birthDate.getUTCFullYear() !== year ||
    birthDate.getUTCMonth() !== month - 1 ||
    birthDate.getUTCDate() !== day
  ) return null;

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
