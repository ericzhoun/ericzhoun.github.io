// Daily service job. Keep denormalized enrollment and student ages in sync
// with their dates of birth so reports can read them without recalculating.
export async function handler(_req, ctx) {
  const enrollmentResult = await ctx.db.query(
    `WITH utc_today AS (
       SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date AS date
     )
     UPDATE enrollments
     SET child_age = EXTRACT(YEAR FROM age(utc_today.date, to_date(child_dob, 'FXYYYY-MM-DD')))::int::text
     FROM utc_today
     WHERE child_dob ~ '^\\d{4}-\\d{2}-\\d{2}$'
       AND to_char(to_date(child_dob, 'FXYYYY-MM-DD'), 'YYYY-MM-DD') = child_dob
       AND to_date(child_dob, 'FXYYYY-MM-DD') <= utc_today.date
       AND child_age IS DISTINCT FROM EXTRACT(YEAR FROM age(utc_today.date, to_date(child_dob, 'FXYYYY-MM-DD')))::int::text
     RETURNING id`
  );

  const studentResult = await ctx.db.query(
    `WITH utc_today AS (
       SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date AS date
     )
     UPDATE students
     SET age = EXTRACT(YEAR FROM age(utc_today.date, to_date(dob, 'FXYYYY-MM-DD')))::int::text
     FROM utc_today
     WHERE dob ~ '^\\d{4}-\\d{2}-\\d{2}$'
       AND to_char(to_date(dob, 'FXYYYY-MM-DD'), 'YYYY-MM-DD') = dob
       AND to_date(dob, 'FXYYYY-MM-DD') <= utc_today.date
       AND age IS DISTINCT FROM EXTRACT(YEAR FROM age(utc_today.date, to_date(dob, 'FXYYYY-MM-DD')))::int::text
     RETURNING id`
  );

  return json({ updated: enrollmentResult.rows.length + studentResult.rows.length }, 200);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
