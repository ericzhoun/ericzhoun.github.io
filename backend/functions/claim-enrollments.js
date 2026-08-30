// Attaches unclaimed enrollments to the calling user by verified email match.
// HTTP trigger: auth "required". Deployed with allow_service_key_impersonation
// false so only genuine end-user tokens can claim.
export async function handler(req, ctx) {
  if (!ctx.user) {
    return json({ error: "Authentication required" }, 401);
  }

  // Resolve email + verification state from the auth service using the
  // forwarded end-user token. This is the proof of email ownership that
  // replaces a claim token.
  const apiBase = ctx.env.BUTTERBASE_API_URL || "https://api.butterbase.ai";
  const appId = ctx.env.BUTTERBASE_APP_ID;
  const authHeader = req.headers.get("authorization");
  const meRes = await fetch(`${apiBase}/auth/${appId}/me`, {
    headers: { Authorization: authHeader },
  });
  if (!meRes.ok) {
    return json({ error: "Could not verify identity" }, 403);
  }
  const meData = await meRes.json();
  const me = meData.user || meData;
  if (!me.email || me.id !== ctx.user.id) {
    return json({ error: "Could not verify identity" }, 403);
  }
  if (me.email_verified === false) {
    return json({ error: "Please verify your email before claiming enrollments" }, 403);
  }

  const res = await ctx.db.query(
    `UPDATE enrollments SET user_id = $1
     WHERE lower(student_email) = lower($2) AND user_id IS NULL
     RETURNING id`,
    [me.id, me.email]
  );

  // A family the admin recorded before this account existed. Matching on the
  // verified email is the same proof the enrollment claim above relies on.
  const claimedStudents = await claimPendingParent(ctx, me);

  return json({ claimed: res.rows.map((r) => r.id), claimed_students: claimedStudents }, 200);
}

// Mirrors mergePendingParent in admin-manage.js: fill the profile without
// clobbering anything the parent already set, repoint the students, drop the
// placeholder. Written against ctx.db because this function runs as the end
// user, not the service key.
async function claimPendingParent(ctx, me) {
  const found = await ctx.db.query(
    `SELECT id, parent_name, email, student_phone, emergency_contact, allergies
       FROM pending_parents WHERE lower(email) = lower($1) LIMIT 1`,
    [me.email]
  );
  const pending = found.rows[0];
  if (!pending) return [];

  // COALESCE keeps a value the parent has already saved; the placeholder only
  // fills blanks.
  await ctx.db.query(
    `INSERT INTO parent_profiles (user_id, email, parent_name, student_phone, emergency_contact, allergies)
     VALUES ($1, $2, COALESCE(NULLIF($3, ''), $2), $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET
       parent_name       = COALESCE(NULLIF(parent_profiles.parent_name, ''), EXCLUDED.parent_name),
       student_phone     = COALESCE(NULLIF(parent_profiles.student_phone, ''), EXCLUDED.student_phone),
       emergency_contact = COALESCE(NULLIF(parent_profiles.emergency_contact, ''), EXCLUDED.emergency_contact),
       allergies         = COALESCE(NULLIF(parent_profiles.allergies, ''), EXCLUDED.allergies),
       updated_at        = now()`,
    [me.id, me.email, pending.parent_name, pending.student_phone, pending.emergency_contact, pending.allergies]
  );

  const repointed = await ctx.db.query(
    `UPDATE students SET user_id = $1, pending_parent_id = NULL
      WHERE pending_parent_id = $2
      RETURNING id`,
    [me.id, pending.id]
  );

  await ctx.db.query(`DELETE FROM pending_parents WHERE id = $1`, [pending.id]);

  return repointed.rows.map((r) => r.id);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
