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
