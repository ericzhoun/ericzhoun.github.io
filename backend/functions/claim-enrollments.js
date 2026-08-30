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

  return json({ claimed: res.rows.map((r) => r.id) }, 200);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
