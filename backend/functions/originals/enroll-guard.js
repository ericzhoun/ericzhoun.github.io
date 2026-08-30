export async function handler(req, ctx) {
  if (!ctx.user) {
    return new Response(JSON.stringify({ error: "Authentication required" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const { schedule_id, student_name, student_email, student_phone,
          num_classes_enrolled, price_per_class_cents, discount_pct, total_paid_cents } = body;
  if (!schedule_id) {
    return new Response(JSON.stringify({ error: "schedule_id is required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  // 1. Fetch the class schedule with program info
  const scheduleRes = await ctx.db.query(
    `SELECT cs.*, p.name AS program_name, p.num_classes
     FROM class_schedules cs
     JOIN programs p ON cs.program_id = p.id
     WHERE cs.id = $1 AND cs.active = true`,
    [schedule_id]
  );
  if (scheduleRes.rows.length === 0) {
    return new Response(JSON.stringify({ error: "Class schedule not found" }), {
      status: 404, headers: { "Content-Type": "application/json" },
    });
  }
  const schedule = scheduleRes.rows[0];

  // 2. Count existing confirmed/pending enrollments and check seat availability
  const countRes = await ctx.db.query(
    `SELECT COUNT(*) AS enrolled FROM enrollments
     WHERE schedule_id = $1 AND status IN ('pending', 'confirmed')`,
    [schedule_id]
  );
  const enrolledCount = parseInt(countRes.rows[0].enrolled, 10);
  if (enrolledCount >= schedule.max_seats) {
    return new Response(JSON.stringify({ error: "Class is full", spots_available: 0 }), {
      status: 409, headers: { "Content-Type": "application/json" },
    });
  }

  // 3. Create a pending enrollment record with pricing data
  const enrollRes = await ctx.db.query(
    `INSERT INTO enrollments (schedule_id, user_id, student_name, student_email, student_phone, status,
                               num_classes_enrolled, price_per_class_cents, discount_pct, total_paid_cents)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9)
     RETURNING id`,
    [schedule_id, ctx.user.id, student_name || "", student_email || "", student_phone || "",
     num_classes_enrolled || null, price_per_class_cents || null, discount_pct || 0, total_paid_cents || null]
  );
  const enrollmentId = enrollRes.rows[0].id;

  // 4. Create a dynamic Stripe product with the correct total price
  const origin = new URL(req.url).origin;
  const authHeader = req.headers.get("authorization");
  const apiKey = ctx.env.BUTTERBASE_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Billing service is not configured" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  const numClasses = num_classes_enrolled || 1;
  const perClass = price_per_class_cents || schedule.price_cents;
  const discount = discount_pct || 0;
  const subtotal = perClass * numClasses;
  const discountAmount = Math.round(subtotal * discount / 100);
  const total = subtotal - discountAmount;

  const productName = `${schedule.program_name} - ${numClasses} class${numClasses > 1 ? "es" : ""}` +
    (discount > 0 ? ` (${discount}% early-bird)` : "");

  const productRes = await fetch(`${origin}/v1/${ctx.env.APP_ID}/billing/products`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      name: productName,
      priceCents: total,
      description: `${schedule.program_name} art class - ${numClasses} × $${(perClass / 100).toFixed(2)}/class` +
        (discount > 0 ? `, ${discount}% early-bird discount` : ""),
      metadata: {
        enrollment_id: enrollmentId,
        schedule_id: schedule_id,
        num_classes: String(numClasses),
        price_per_class_cents: String(perClass),
        discount_pct: String(discount),
        total_cents: String(total),
      },
    }),
  });

  if (!productRes.ok) {
    const errText = await productRes.text();
    console.error("Failed to create product:", errText);
    await ctx.db.query(`DELETE FROM enrollments WHERE id = $1`, [enrollmentId]);
    return new Response(JSON.stringify({ error: "Failed to create payment product", details: errText }), {
      status: 502, headers: { "Content-Type": "application/json" },
    });
  }
  const product = await productRes.json();

  // 5. Initiate the purchase with the dynamically priced product.
  //    Redirect URLs point to the static olivistart.com frontend.
  const purchaseRes = await fetch(`${origin}/v1/${ctx.env.APP_ID}/billing/purchase`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": authHeader,
    },
    body: JSON.stringify({
      productId: product.id,
      successUrl: `${ctx.env.SITE_URL}/registration.html?enrollment=${enrollmentId}&payment=success`,
      cancelUrl: `${ctx.env.SITE_URL}/enroll.html?schedule=${schedule_id}&payment=cancelled`,
    }),
  });

  if (!purchaseRes.ok) {
    const errText = await purchaseRes.text();
    console.error("Failed to create checkout session:", errText);
    await ctx.db.query(`DELETE FROM enrollments WHERE id = $1`, [enrollmentId]);
    return new Response(JSON.stringify({ error: "Failed to create checkout session", details: errText }), {
      status: 502, headers: { "Content-Type": "application/json" },
    });
  }
  const purchase = await purchaseRes.json();

  // 6. Store the order ID on the enrollment
  await ctx.db.query(
    `UPDATE enrollments SET stripe_order_id = $1 WHERE id = $2`,
    [purchase.orderId, enrollmentId]
  );

  return new Response(JSON.stringify({
    enrollment_id: enrollmentId,
    checkout_url: purchase.url,
    order_id: purchase.orderId,
    total_cents: total,
  }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
