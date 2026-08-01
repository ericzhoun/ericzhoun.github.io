// Account management: contact-info updates and password change.
// Butterbase auth exposes no "change password with current password" endpoint,
// so change-password uses the forgot-password (email code) -> reset-password
// flow, driven server-side so the target email is always the caller's own.
// HTTP trigger: auth "required". Enrollment compatibility writes run as the
// verified end user. Authoritative profile writes use the server-only service
// credential because parents have SELECT-only access to parent_profiles.
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
    try {
      return await updateContact(ctx, me, body);
    } catch (error) {
      console.error("manage-account profile update failed:", error && error.message);
      return json({ error: "Could not save profile. Please try again." }, 502);
    }
  }
  if (action === "change-password-init") {
    return changePasswordInit(me.email, apiBase, appId);
  }
  if (action === "change-password-confirm") {
    return changePasswordConfirm(me.email, body, apiBase, appId);
  }
  return json({ error: "Unknown action" }, 400);
}

// Persists the caller's durable profile with trusted service access, then
// keeps the caller's legacy enrollment contact columns in sync under normal
// user-isolation RLS. Identity fields come only from the verified auth user.
async function updateContact(ctx, me, body) {
  const parentName = str(body.parent_name) || str(me.display_name) || str(me.email);
  const phone = str(body.student_phone);
  const emergency = str(body.emergency_contact);
  const allergies = str(body.allergies);

  if (!parentName) return json({ error: "Parent name is required" }, 400);

  const fields = {
    email: me.email,
    parent_name: parentName,
    student_phone: phone,
    emergency_contact: emergency,
    allergies,
    updated_at: new Date().toISOString(),
  };
  const profile = await saveProfile(ctx, ctx.user.id, fields);
  const enrollments = await ctx.db.query(
    `UPDATE enrollments SET
      parent_name = $2,
      student_phone = $3,
      emergency_contact = $4,
      allergies = $5
    WHERE user_id = $1
    RETURNING id`,
    [ctx.user.id, parentName, phone, emergency, allergies]
  );
  return json({ profile, updated_enrollments: enrollments.rowCount ?? enrollments.rows.length }, 200);
}

async function saveProfile(ctx, userId, fields) {
  const path = `parent_profiles/${encodeURIComponent(userId)}`;
  const existing = await serviceData(ctx, path, { allowNotFound: true });
  if (existing !== null) {
    return firstRow(await serviceData(ctx, path, { method: "PATCH", body: fields }));
  }

  try {
    return firstRow(await serviceData(ctx, "parent_profiles", {
      method: "POST",
      body: { user_id: userId, ...fields },
    }));
  } catch (error) {
    // A concurrent first save can win between the existence check and insert.
    // Retrying as an update makes the create path idempotent without relying
    // on an undocumented REST upsert extension.
    if (error.status !== 409) throw error;
    return firstRow(await serviceData(ctx, path, { method: "PATCH", body: fields }));
  }
}

async function serviceData(ctx, path, options = {}) {
  const res = await fetch(
    `${ctx.env.BUTTERBASE_API_URL || "https://api.butterbase.ai"}/v1/${ctx.env.BUTTERBASE_APP_ID}/${path}`,
    {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${ctx.env.SERVICE_KEY}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    }
  );
  if (options.allowNotFound && res.status === 404) return null;
  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error((result.error && result.error.message) || result.error || `Data API error ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return result;
}

function firstRow(result) {
  const row = Array.isArray(result) ? result[0] : result;
  if (!row || typeof row !== "object") throw new Error("Profile save returned no row");
  return row;
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

  try {
    const res = await fetch(`${apiBase}/auth/${appId}/me`, {
      headers: { Authorization: authHeader },
    });
    if (!res.ok) return null;

    const data = await res.json().catch(() => ({}));
    const user = data.user || data;
    const email = normalizeEmail(user && user.email);
    return email && user.id === ctx.user.id ? { ...user, email } : null;
  } catch {
    return null;
  }
}

function normalizeEmail(value) {
  const email = str(value)?.toLowerCase();
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
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
