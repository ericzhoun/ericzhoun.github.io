// Account management: contact-info updates and password change.
// Butterbase auth exposes no "change password with current password" endpoint,
// so change-password uses the forgot-password (email code) -> reset-password
// flow, driven server-side so the target email is always the caller's own.
// HTTP trigger: auth "required". Writes run as the end user (RLS-enforced).
export async function handler(req, ctx) {
  if (!ctx.user) return json({ error: "Authentication required" }, 401);

  let body;
  try { body = await req.json(); } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const action = body.action;
  const apiBase = ctx.env.BUTTERBASE_API_URL || "https://api.butterbase.ai";
  const appId = ctx.env.BUTTERBASE_APP_ID;

  const me = await currentUser(req, ctx, apiBase, appId);
  if (!me) return json({ error: "Could not verify identity" }, 403);
  if (action === "update-contact") {
    return updateContact(ctx, me, body);
  }
  if (action === "change-password-init") {
    return changePasswordInit(me.email, apiBase, appId);
  }
  if (action === "change-password-confirm") {
    return changePasswordConfirm(me.email, body, apiBase, appId);
  }
  return json({ error: "Unknown action" }, 400);
}

// Persists the caller's durable profile and keeps legacy enrollment contact
// columns in sync. The CTE makes both changes in one database statement.
async function updateContact(ctx, me, body) {
  const parentName = str(body.parent_name) || str(me.display_name) || str(me.email);
  const phone = str(body.student_phone);
  const emergency = str(body.emergency_contact);
  const allergies = str(body.allergies);

  if (!parentName) return json({ error: "Parent name is required" }, 400);

  const res = await ctx.db.query(
    `WITH saved_profile AS (
      INSERT INTO parent_profiles
        (user_id, email, parent_name, student_phone, emergency_contact, allergies, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, now())
      ON CONFLICT (user_id) DO UPDATE SET
        email = EXCLUDED.email,
        parent_name = EXCLUDED.parent_name,
        student_phone = EXCLUDED.student_phone,
        emergency_contact = EXCLUDED.emergency_contact,
        allergies = EXCLUDED.allergies,
        updated_at = now()
      RETURNING *
    ), updated_enrollments AS (
      UPDATE enrollments SET
        parent_name = $3,
        student_phone = $4,
        emergency_contact = $5,
        allergies = $6
      WHERE user_id = $1
      RETURNING id
    )
    SELECT saved_profile.*, (SELECT count(*)::int FROM updated_enrollments) AS updated_enrollments
    FROM saved_profile`,
    [ctx.user.id, me.email, parentName, phone, emergency, allergies]
  );
  const { updated_enrollments: updatedEnrollments, ...profile } = res.rows[0];
  return json({ profile, updated_enrollments: updatedEnrollments }, 200);
}

// Triggers a forgot-password email for the caller's own email.
async function changePasswordInit(email, apiBase, appId) {
  if (!email) return json({ error: "Account has no email on file" }, 400);

  const res = await fetch(`${apiBase}/auth/${appId}/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  // The endpoint always returns success regardless of email existence, but
  // since the email came from the verified token we know it's real.
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return json({ error: data.error || "Could not send reset code" }, 502);
  }
  return json({ sent: true, email }, 200);
}

// Completes the password reset with the emailed code + new password.
async function changePasswordConfirm(email, body, apiBase, appId) {
  const code = str(body.code);
  const newPassword = str(body.new_password);

  if (!code) return json({ error: "Code is required" }, 400);
  if (!newPassword || newPassword.length < 8) {
    return json({ error: "Password must be at least 8 characters" }, 400);
  }

  const res = await fetch(`${apiBase}/auth/${appId}/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code, new_password: newPassword }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return json({ error: data.error || data.message || "Could not reset password" }, 400);
  }
  // reset-password invalidates all sessions; the client must re-login.
  return json({ success: true }, 200);
}

// Function auth exposes the user id but not necessarily the profile email.
// Resolve it from the forwarded end-user token and verify it matches ctx.user.
async function currentUser(req, ctx, apiBase, appId) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;

  const res = await fetch(`${apiBase}/auth/${appId}/me`, {
    headers: { Authorization: authHeader },
  });
  if (!res.ok) return null;

  const data = await res.json().catch(() => ({}));
  const user = data.user || data;
  return user?.email && user.id === ctx.user.id ? user : null;
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
