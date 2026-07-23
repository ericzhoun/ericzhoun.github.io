// Guest checkout. Creates a provisional account for the guest's email (random
// password, unverified), a pending enrollment owned by it, and a Stripe
// Checkout session purchased with that account's JWT (the billing API requires
// an end-user purchaser). The buyer gains access to the account afterwards via
// a magic-link email code on checkout-success.html; until then nobody holds
// usable credentials for it. Existing emails are rejected with EMAIL_EXISTS so
// the frontend can route to login (which uses enroll-guard instead).
// HTTP trigger: auth "none" (public). Pricing is computed server-side from the
// database; client-sent prices are never trusted.
const EARLY_BIRD_MIN_CLASSES = 15;
const EARLY_BIRD_DEADLINE = "2026-08-15T00:00:00-07:00";
const EARLY_BIRD_PCT = 10;

export async function handler(req, ctx) {
  let body;
  try { body = await req.json(); } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const schedule_id = body.schedule_id;
  const student_name = String(body.student_name || "").trim();
  const student_email = String(body.student_email || "").trim().toLowerCase();
  const student_phone = String(body.student_phone || "").trim();
  const parent_name = String(body.parent_name || "").trim();
  let numClasses = parseInt(body.num_classes_enrolled, 10);

  if (!schedule_id) return json({ error: "schedule_id is required" }, 400);
  if (!student_name) return json({ error: "Student name is required" }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(student_email)) {
    return json({ error: "A valid email is required" }, 400);
  }

  // 1. Schedule + program (pricing source of truth)
  const scheduleRes = await ctx.db.query(
    `SELECT cs.*, p.name AS program_name, p.num_classes AS program_num_classes
     FROM class_schedules cs
     JOIN programs p ON cs.program_id = p.id
     WHERE cs.id = $1 AND cs.active = true`,
    [schedule_id]
  );
  if (scheduleRes.rows.length === 0) {
    return json({ error: "Class schedule not found" }, 404);
  }
  const schedule = scheduleRes.rows[0];

  const maxClasses = schedule.program_num_classes || 8;
  if (!Number.isFinite(numClasses) || numClasses < 1) numClasses = maxClasses;
  numClasses = Math.min(numClasses, maxClasses);

  // 2. Capacity: confirmed seats plus pending holds younger than 60 minutes
  const countRes = await ctx.db.query(
    `SELECT COUNT(*) AS held FROM enrollments
     WHERE schedule_id = $1
       AND (status = 'confirmed'
            OR (status = 'pending' AND created_at > now() - interval '60 minutes'))`,
    [schedule_id]
  );
  if (parseInt(countRes.rows[0].held, 10) >= schedule.max_seats) {
    return json({ error: "Class is full", spots_available: 0 }, 409);
  }

  // 3. Server-side pricing with the universal early-bird discount:
  //    10% off when booking 15+ classes before the 2026-08-15 deadline.
  const perClass = schedule.price_cents;
  const ebPct = EARLY_BIRD_PCT;
  const isEarlyBird = numClasses >= EARLY_BIRD_MIN_CLASSES && new Date() <= new Date(EARLY_BIRD_DEADLINE);
  const subtotal = perClass * numClasses;
  const discountAmount = isEarlyBird ? Math.round((subtotal * ebPct) / 100) : 0;
  const total = subtotal - discountAmount;

  const apiBase = ctx.env.BUTTERBASE_API_URL || "https://api.butterbase.ai";
  const appId = ctx.env.BUTTERBASE_APP_ID;
  const siteUrl = ctx.env.SITE_URL || "https://olivistart.com";

  // 4. Provisional account for the guest (random password nobody knows;
  //    the buyer signs in later with a magic-link code)
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
      return json({
        error: "An account with this email already exists. Please log in to enroll.",
        code: "EMAIL_EXISTS",
      }, 409);
    }
    console.error("Failed to create guest account:", msg);
    return json({ error: "Could not start checkout. Please try again." }, 502);
  }
  const guestUser = signupData.user;

  // 5. Sign in as the provisional account (billing purchases require an
  //    end-user JWT; service keys and impersonation are not accepted there)
  const loginRes = await fetch(`${apiBase}/auth/${appId}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: student_email, password }),
  });
  const loginData = await loginRes.json();
  if (!loginRes.ok) {
    console.error("Failed to sign in guest account:", loginData.error || loginData.message);
    return json({ error: "Could not start checkout. Please try again." }, 502);
  }
  const guestToken = loginData.access_token;

  // 6. Pending enrollment owned by the provisional account
  const enrollRes = await ctx.db.query(
    `INSERT INTO enrollments (schedule_id, user_id, student_name, student_email, student_phone,
                              status, num_classes_enrolled, price_per_class_cents, discount_pct, total_paid_cents,
                              parent_name)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10)
     RETURNING id`,
    [schedule_id, guestUser.id, student_name, student_email, student_phone,
     numClasses, perClass, isEarlyBird ? ebPct : 0, total, parent_name]
  );
  const enrollmentId = enrollRes.rows[0].id;

  // 7. Dynamically priced product (service key)
  const productName = `${schedule.program_name} - ${numClasses} class${numClasses > 1 ? "es" : ""}` +
    (isEarlyBird ? ` (${ebPct}% early-bird)` : "");
  const productRes = await fetch(`${apiBase}/v1/${appId}/billing/products`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ctx.env.SERVICE_KEY}`,
    },
    body: JSON.stringify({
      name: productName,
      priceCents: total,
      description: `${schedule.program_name} art class - ${numClasses} x $${(perClass / 100).toFixed(2)}/class` +
        (isEarlyBird ? `, ${ebPct}% early-bird discount` : ""),
      metadata: {
        enrollment_id: enrollmentId,
        schedule_id: schedule_id,
        guest: "true",
        num_classes: String(numClasses),
        price_per_class_cents: String(perClass),
        discount_pct: String(isEarlyBird ? ebPct : 0),
        total_cents: String(total),
      },
    }),
  });
  if (!productRes.ok) {
    const errText = await productRes.text();
    console.error("Failed to create product:", errText);
    await ctx.db.query(`DELETE FROM enrollments WHERE id = $1`, [enrollmentId]);
    return json({ error: "Failed to create payment product" }, 502);
  }
  const product = await productRes.json();

  // 8. Checkout session purchased as the provisional account
  const purchaseRes = await fetch(`${apiBase}/v1/${appId}/billing/purchase`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${guestToken}` },
    body: JSON.stringify({
      productId: product.id,
      successUrl: `${siteUrl}/checkout-success.html?enrollment=${enrollmentId}`,
      cancelUrl: `${siteUrl}/enroll.html?schedule=${schedule_id}&payment=cancelled`,
    }),
  });
  if (!purchaseRes.ok) {
    const errText = await purchaseRes.text();
    console.error("Failed to create checkout session:", errText);
    await ctx.db.query(`DELETE FROM enrollments WHERE id = $1`, [enrollmentId]);
    return json({ error: "Failed to create checkout session" }, 502);
  }
  const purchase = await purchaseRes.json();

  await ctx.db.query(
    `UPDATE enrollments SET stripe_order_id = $1 WHERE id = $2`,
    [purchase.orderId, enrollmentId]
  );

  // Note: order_id is intentionally not returned to the client.
  return json({
    enrollment_id: enrollmentId,
    checkout_url: purchase.url,
    total_cents: total,
  }, 200);
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
