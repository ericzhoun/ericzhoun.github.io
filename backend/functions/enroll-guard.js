// Logged-in enrollment: creates a pending enrollment for the current user,
// creates a dynamically priced product, and initiates Stripe Checkout.
// HTTP trigger: auth "required".
// Changes from the original: pricing is computed server-side (client-sent
// prices are ignored), capacity counts only fresh pending holds, and the
// response no longer exposes order_id.
const EARLY_BIRD_MIN_CLASSES = 15;
const EARLY_BIRD_DEADLINE = "2026-08-15T00:00:00-07:00";
const EARLY_BIRD_PCT = 10;

export async function handler(req, ctx) {
  if (!ctx.user) {
    return json({ error: "Authentication required" }, 401);
  }

  let body;
  try { body = await req.json(); } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (Array.isArray(body.schedule_ids)) {
    return handleMultiDay(req, body, ctx);
  }

  const { schedule_id, student_name, student_email, student_phone, parent_name } = body;
  let numClasses = parseInt(body.num_classes_enrolled, 10);
  if (!schedule_id) {
    return json({ error: "schedule_id is required" }, 400);
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

  // Student ownership: a parent may only attach one of their own students.
  let studentId = null;
  if (body.student_id) {
    const studentRes = await ctx.db.query(
      `SELECT id FROM students WHERE id = $1 AND user_id = $2`,
      [body.student_id, ctx.user.id]
    );
    if (studentRes.rows.length === 0) {
      return json({ error: "Student not found" }, 400);
    }
    studentId = body.student_id;
  }

  // 3. Server-side pricing with the universal early-bird discount:
  //    10% off when booking 15+ classes before the 2026-08-15 deadline.
  const perClass = schedule.price_cents;
  const ebPct = EARLY_BIRD_PCT;
  const isEarlyBird = numClasses >= EARLY_BIRD_MIN_CLASSES && new Date() <= new Date(EARLY_BIRD_DEADLINE);
  const subtotal = perClass * numClasses;
  const discountAmount = isEarlyBird ? Math.round((subtotal * ebPct) / 100) : 0;
  const total = subtotal - discountAmount;

  // 4. Pending enrollment owned by the current user
  const enrollRes = await ctx.db.query(
    `INSERT INTO enrollments (schedule_id, user_id, student_name, student_email, student_phone,
                              status, num_classes_enrolled, price_per_class_cents, discount_pct, total_paid_cents,
                              parent_name, student_id)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [schedule_id, ctx.user.id, student_name || "", student_email || "", student_phone || "",
     numClasses, perClass, isEarlyBird ? ebPct : 0, total, parent_name || "", studentId]
  );
  const enrollmentId = enrollRes.rows[0].id;

  const apiBase = ctx.env.BUTTERBASE_API_URL || "https://api.butterbase.ai";
  const appId = ctx.env.BUTTERBASE_APP_ID;
  const siteUrl = ctx.env.SITE_URL || "https://olivistart.com";
  const serviceHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${ctx.env.SERVICE_KEY}`,
  };

  // 5. Dynamically priced product
  const productName = `${schedule.program_name} - ${numClasses} class${numClasses > 1 ? "es" : ""}` +
    (isEarlyBird ? ` (${ebPct}% early-bird)` : "");
  const productRes = await fetch(`${apiBase}/v1/${appId}/billing/products`, {
    method: "POST",
    headers: serviceHeaders,
    body: JSON.stringify({
      name: productName,
      priceCents: total,
      description: `${schedule.program_name} art class - ${numClasses} x $${(perClass / 100).toFixed(2)}/class` +
        (isEarlyBird ? `, ${ebPct}% early-bird discount` : ""),
      metadata: {
        enrollment_id: enrollmentId,
        schedule_id: schedule_id,
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

  // 6. Checkout session tied to the logged-in user
  const authHeader = req.headers.get("authorization");
  const purchaseRes = await fetch(`${apiBase}/v1/${appId}/billing/purchase`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader },
    body: JSON.stringify({
      productId: product.id,
      successUrl: `${siteUrl}/registration.html?enrollment=${enrollmentId}&payment=success`,
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

async function handleMultiDay(req, body, ctx) {
  const scheduleIds = [...new Set(body.schedule_ids)];
  if (scheduleIds.length === 0) {
    return json({ error: "schedule_ids must be a non-empty array" }, 400);
  }
  if (scheduleIds.length !== body.schedule_ids.length) {
    return json({ error: "schedule_ids must not contain duplicates" }, 400);
  }

  const { student_name, student_email, student_phone, parent_name } = body;

  let studentId = null;
  if (body.student_id) {
    const studentRes = await ctx.db.query(
      `SELECT id FROM students WHERE id = $1 AND user_id = $2`,
      [body.student_id, ctx.user.id]
    );
    if (studentRes.rows.length === 0) {
      return json({ error: "Student not found" }, 400);
    }
    studentId = body.student_id;
  }

  // 1. Fetch every schedule + program row and verify they share one bundle signature.
  const schedules = [];
  for (const scheduleId of scheduleIds) {
    const res = await ctx.db.query(
      `SELECT cs.*, p.name AS program_name, p.num_classes AS program_num_classes
       FROM class_schedules cs
       JOIN programs p ON cs.program_id = p.id
       WHERE cs.id = $1 AND cs.active = true`,
      [scheduleId]
    );
    if (res.rows.length === 0) {
      return json({ error: `Class schedule not found: ${scheduleId}` }, 404);
    }
    schedules.push(res.rows[0]);
  }
  // Note: intentionally NOT start_time/end_time - a multi-day class can run
  // at a different time on different days (e.g. Monday 4-5pm, Wed 5-6pm).
  const bundleKey = (s) => [s.program_id, s.semester_id, s.session_type,
    s.age_group, s.price_cents, s.max_seats].join("|");
  const firstKey = bundleKey(schedules[0]);
  if (!schedules.every((s) => bundleKey(s) === firstKey)) {
    return json({ error: "All selected days must belong to the same class bundle" }, 400);
  }

  // 2. Capacity: one check per selected day, all-or-nothing.
  for (const schedule of schedules) {
    const countRes = await ctx.db.query(
      `SELECT COUNT(*) AS held FROM enrollments
       WHERE schedule_id = $1
         AND (status = 'confirmed'
              OR (status = 'pending' AND created_at > now() - interval '60 minutes'))`,
      [schedule.id]
    );
    if (parseInt(countRes.rows[0].held, 10) >= schedule.max_seats) {
      return json({ error: `Class is full: ${schedule.day_of_week}`, spots_available: 0 }, 409);
    }
  }

  // 3. Pricing: one session per selected day (mirrors how camp bundles already price).
  const perClass = schedules[0].price_cents;
  const numClasses = schedules.length;
  const isEarlyBird = numClasses >= EARLY_BIRD_MIN_CLASSES && new Date() <= new Date(EARLY_BIRD_DEADLINE);
  const ebPct = EARLY_BIRD_PCT;
  const subtotal = perClass * numClasses;
  const discountAmount = isEarlyBird ? Math.round((subtotal * ebPct) / 100) : 0;
  const total = subtotal - discountAmount;
  const perDayDiscounted = perClass - Math.round((perClass * (isEarlyBird ? ebPct : 0)) / 100);

  // 4. One enrollments row per selected day; the last row absorbs any rounding remainder.
  const enrollmentIds = [];
  for (let i = 0; i < schedules.length; i += 1) {
    const schedule = schedules[i];
    const isLast = i === schedules.length - 1;
    const rowTotal = isLast ? total - perDayDiscounted * i : perDayDiscounted;
    const enrollRes = await ctx.db.query(
      `INSERT INTO enrollments (schedule_id, user_id, student_name, student_email, student_phone,
                                status, num_classes_enrolled, price_per_class_cents, discount_pct, total_paid_cents,
                                parent_name, student_id)
       VALUES ($1, $2, $3, $4, $5, 'pending', 1, $6, $7, $8, $9, $10)
       RETURNING id`,
      [schedule.id, ctx.user.id, student_name || "", student_email || "", student_phone || "",
       perClass, isEarlyBird ? ebPct : 0, rowTotal, parent_name || "", studentId]
    );
    enrollmentIds.push(enrollRes.rows[0].id);
  }

  const apiBase = ctx.env.BUTTERBASE_API_URL || "https://api.butterbase.ai";
  const appId = ctx.env.BUTTERBASE_APP_ID;
  const siteUrl = ctx.env.SITE_URL || "https://olivistart.com";
  const serviceHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${ctx.env.SERVICE_KEY}` };

  // 5. One Stripe product/checkout for the combined total.
  const dayList = schedules.map((s) => s.day_of_week).join(", ");
  const productName = `${schedules[0].program_name} - ${numClasses} day${numClasses > 1 ? "s" : ""} (${dayList})` +
    (isEarlyBird ? ` (${ebPct}% early-bird)` : "");
  const productRes = await fetch(`${apiBase}/v1/${appId}/billing/products`, {
    method: "POST",
    headers: serviceHeaders,
    body: JSON.stringify({
      name: productName,
      priceCents: total,
      description: `${schedules[0].program_name} art class - ${numClasses} day${numClasses > 1 ? "s" : ""} x $${(perClass / 100).toFixed(2)}` +
        (isEarlyBird ? `, ${ebPct}% early-bird discount` : ""),
      metadata: {
        enrollment_ids: enrollmentIds.join(","),
        schedule_ids: scheduleIds.join(","),
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
    await ctx.db.query(`DELETE FROM enrollments WHERE id = ANY($1)`, [enrollmentIds]);
    return json({ error: "Failed to create payment product" }, 502);
  }
  const product = await productRes.json();

  const authHeader = req.headers.get("authorization");
  const purchaseRes = await fetch(`${apiBase}/v1/${appId}/billing/purchase`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader },
    body: JSON.stringify({
      productId: product.id,
      successUrl: `${siteUrl}/registration.html?enrollment=${enrollmentIds[0]}&payment=success`,
      cancelUrl: `${siteUrl}/enroll.html?schedule=${scheduleIds[0]}&payment=cancelled`,
    }),
  });
  if (!purchaseRes.ok) {
    const errText = await purchaseRes.text();
    console.error("Failed to create checkout session:", errText);
    await ctx.db.query(`DELETE FROM enrollments WHERE id = ANY($1)`, [enrollmentIds]);
    return json({ error: "Failed to create checkout session" }, 502);
  }
  const purchase = await purchaseRes.json();

  await ctx.db.query(
    `UPDATE enrollments SET stripe_order_id = $1 WHERE id = ANY($2)`,
    [purchase.orderId, enrollmentIds]
  );

  return json({
    enrollment_id: enrollmentIds[0],
    checkout_url: purchase.url,
    total_cents: total,
  }, 200);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
