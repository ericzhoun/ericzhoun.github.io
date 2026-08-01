// Admin-only management: create parent accounts, manage their students,
// grant comped enrollments, and adjust credits.
//
// HTTP trigger: auth "required", so the platform edge rejects anonymous
// callers before this runs. Authorization must carry the admin's end-user JWT:
// it is the only cross-origin header Butterbase's CORS allowlist permits
// besides Content-Type, and requireAdmin re-verifies it against
// /auth/{appId}/me rather than trusting ctx.user.
//
// Data access deliberately does NOT use ctx.db. students and enrollments carry
// user-isolation RLS policies (USING and WITH CHECK on
// user_id = current_user_id()), and a function invoked with an end-user JWT
// binds butterbase_user, so ctx.db can neither read another parent's rows nor
// insert rows owned by them - which is the entire feature. Every read and
// write therefore goes through the REST data API with the app service key,
// which the *_service_bypass policies admit, the same way guest-enroll uses
// SERVICE_KEY for billing calls.
const ADMIN_EMAILS = ["herfield8@gmail.com", "lightbyolivia@gmail.com"];

export async function handler(req, ctx) {
  const adminEmail = await requireAdmin(req, ctx);
  if (!adminEmail) return json({ error: "Admin access required" }, 403);

  let body;
  try { body = await req.json(); } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  try {
    switch (body.action) {
      case "create-account":
        return await createAccount(ctx, body);
      case "add-student":
        return await addStudent(ctx, body);
      case "update-student":
        return await updateStudent(ctx, body);
      case "create-enrollment":
        return await createEnrollment(ctx, body);
      case "set-credits":
        return await setCredits(ctx, body);
      case "list-accounts":
        return await listAccounts(ctx);
      case "resend-invitation":
        return await resendInvitation(ctx, body);
      case "recover-account":
        return await recoverAccount(ctx, body);
      case "admin-data":
        return await adminData(ctx, body);
      case "publish-schedule":
        return await publishSchedule(ctx, body);
      case "mark-attendance":
        return await markAttendance(ctx, body);
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (error) {
    if (error && error.status === 400) return json({ error: error.message }, 400);
    if (error && error.status === 404) return json({ error: "Record not found" }, 404);
    console.error("admin-manage action failed:", body.action, error && error.message);
    return json({ error: "Something went wrong. Please try again." }, 502);
  }
}

// Resolves the caller's identity from the bearer token and returns their email
// only if the auth service verifies it and the email is on the allowlist.
// Returns null on anything else, so every failure path (no token, unverifiable
// token, non-admin, network error) denies access. ctx.user is never treated as
// proof on its own.
async function requireAdmin(req, ctx) {
  const header = req.headers.get("authorization");
  const token = str(header && header.replace(/^Bearer\s+/i, ""));
  if (!token) return null;

  try {
    const res = await fetch(`${apiBase(ctx)}/auth/${ctx.env.BUTTERBASE_APP_ID}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    const email = (data.user || data || {}).email || null;
    return email && ADMIN_EMAILS.includes(email) ? email : null;
  } catch (error) {
    console.error("admin-manage identity check failed:", error && error.message);
    return null;
  }
}

function apiBase(ctx) {
  return ctx.env.BUTTERBASE_API_URL || "https://api.butterbase.ai";
}

// REST data-API call carrying the service key, which bypasses RLS. Throws with
// .status set so the handler can map a missing row to 404.
async function data(ctx, path, options = {}) {
  const res = await fetch(`${apiBase(ctx)}/v1/${ctx.env.BUTTERBASE_APP_ID}/${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${ctx.env.SERVICE_KEY}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    const error = new Error((detail.error && detail.error.message) || `Data API error ${res.status}`);
    error.status = res.status;
    throw error;
  }
  if ((options.method || "GET") === "DELETE" || res.status === 204) return true;
  return res.json();
}

async function serviceFunction(ctx, name, body) {
  const res = await fetch(`${apiBase(ctx)}/v1/${ctx.env.BUTTERBASE_APP_ID}/fn/${name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ctx.env.SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error((result.error && result.error.message) || result.error || `Function error ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return result;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY_VALUES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const STATUS_VALUES = ["pending", "confirmed", "cancelled"];

const ADMIN_DATA_RESOURCES = {
  programs: {
    read: ["id", "name", "slug", "description", "image_url", "sort_order", "num_classes", "active", "program_type", "created_at", "updated_at"],
    filters: { id: "uuid", active: "boolean" },
    order: ["sort_order", "created_at"],
    create: {
      name: "text", slug: "slug", description: "nullableText", image_url: "nullableText",
      sort_order: "integer", num_classes: "nonNegativeInteger", active: "boolean",
      program_type: ["class", "camp"],
    },
    update: {
      name: "text", slug: "slug", description: "nullableText", image_url: "nullableText",
      sort_order: "integer", num_classes: "nonNegativeInteger", active: "boolean",
      program_type: ["class", "camp"],
    },
    delete: true,
  },
  semesters: {
    read: ["id", "name", "start_date", "end_date", "active", "created_at", "updated_at"],
    filters: { id: "uuid", active: "boolean" },
    order: ["start_date", "created_at"],
    create: { name: "text", start_date: "nullableDate", end_date: "nullableDate", active: "boolean" },
    update: { name: "text", start_date: "nullableDate", end_date: "nullableDate", active: "boolean" },
    delete: true,
  },
  class_schedules: {
    read: [
      "id", "program_id", "semester_id", "day_of_week", "session_type", "start_time",
      "end_time", "age_group", "price_cents", "max_seats", "notes", "active", "created_at", "updated_at",
    ],
    filters: { id: "uuid", program_id: "uuid", semester_id: "uuid", active: "boolean" },
    order: ["created_at", "day_of_week", "start_time"],
    create: {
      program_id: "uuid", semester_id: "uuid", day_of_week: DAY_VALUES,
      session_type: ["standard", "extended", "full"], start_time: "time", end_time: "time",
      age_group: "text", price_cents: "nonNegativeInteger", max_seats: "positiveInteger",
      notes: "nullableText", active: "boolean",
    },
    update: {
      program_id: "uuid", semester_id: "uuid", day_of_week: DAY_VALUES,
      session_type: ["standard", "extended", "full"], start_time: "time", end_time: "time",
      age_group: "text", price_cents: "nonNegativeInteger", max_seats: "positiveInteger",
      notes: "nullableText", active: "boolean",
    },
    delete: true,
  },
  enrollments: {
    read: [
      "id", "user_id", "student_id", "schedule_id", "student_name", "student_email",
      "student_phone", "parent_name", "customer_name", "status", "num_classes_enrolled",
      "created_at", "updated_at",
    ],
    filters: { id: "uuid", user_id: "uuid" },
    order: ["created_at"],
    update: { status: STATUS_VALUES },
  },
  class_sessions: {
    read: ["id", "schedule_id", "class_date", "status", "created_at", "updated_at"],
    filters: { id: "uuid" },
    order: ["class_date"],
  },
  bookings: {
    read: ["id", "enrollment_id", "session_id", "status", "type", "booked_at", "created_at", "updated_at"],
    filters: { status: ["scheduled", "attended", "no_show", "skipped", "cancelled"], session_id: "uuid" },
    order: ["booked_at"],
  },
  students: {
    read: ["id", "user_id", "name", "age", "dob", "notes", "created_at", "updated_at"],
    filters: { user_id: "uuid" },
    order: ["created_at"],
  },
};

async function adminData(ctx, body) {
  assertOnlyKeys(body, ["action", "operation", "resource", "query", "id", "fields"]);
  const operation = str(body.operation);
  const resource = str(body.resource);
  const policy = resource && ADMIN_DATA_RESOURCES[resource];
  if (!policy) throw requestError("Resource is not allowed");
  if (!operation || !["read", "create", "update", "delete"].includes(operation)) {
    throw requestError("Operation is not allowed");
  }

  if (operation === "read") {
    if (body.id !== undefined || body.fields !== undefined) throw requestError("Read request is invalid");
    const query = buildAdminQuery(policy, body.query);
    const result = await data(ctx, `${resource}${query ? `?${query}` : ""}`);
    return json({ rows: rows(result) }, 200);
  }

  if (body.query !== undefined) throw requestError("Write request is invalid");
  if (operation === "create") {
    if (!policy.create || body.id !== undefined) throw requestError("Create is not allowed for this resource");
    const fields = validateAdminFields(body.fields, policy.create);
    return json({ rows: rows(await data(ctx, resource, { method: "POST", body: fields })) }, 200);
  }

  const id = validateUuid(body.id, "Record id");
  if (operation === "update") {
    if (!policy.update) throw requestError("Update is not allowed for this resource");
    const fields = validateAdminFields(body.fields, policy.update);
    return json({ rows: rows(await data(ctx, `${resource}/${id}`, { method: "PATCH", body: fields })) }, 200);
  }

  if (!policy.delete || body.fields !== undefined) throw requestError("Delete is not allowed for this resource");
  await data(ctx, `${resource}/${id}`, { method: "DELETE" });
  return json({ deleted: true }, 200);
}

async function publishSchedule(ctx, body) {
  assertOnlyKeys(body, ["action"]);
  return json(await serviceFunction(ctx, "trigger-schedule-bake", {}), 200);
}

async function markAttendance(ctx, body) {
  assertOnlyKeys(body, ["action", "booking_id", "status"]);
  const bookingId = validateUuid(body.booking_id, "Booking id");
  if (!["attended", "no_show"].includes(body.status)) throw requestError("Attendance status is invalid");
  return json(await serviceFunction(ctx, "mark-attendance", {
    booking_id: bookingId,
    status: body.status,
  }), 200);
}

function buildAdminQuery(policy, candidate) {
  if (candidate === undefined) return "";
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw requestError("Query is invalid");
  assertOnlyKeys(candidate, ["select", "order", "filters", "limit"]);
  const params = new URLSearchParams();

  if (candidate.select !== undefined) {
    if (!Array.isArray(candidate.select) || candidate.select.length === 0) throw requestError("Select is invalid");
    const selected = candidate.select.map((field) => str(field));
    if (selected.some((field) => !field || !policy.read.includes(field))) throw requestError("Select field is not allowed");
    params.set("select", [...new Set(selected)].join(","));
  }

  if (candidate.order !== undefined) {
    if (!Array.isArray(candidate.order) || candidate.order.length === 0 || candidate.order.length > 3) {
      throw requestError("Order is invalid");
    }
    const order = candidate.order.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw requestError("Order is invalid");
      assertOnlyKeys(item, ["field", "direction"]);
      const field = str(item.field);
      const direction = str(item.direction);
      if (!field || !policy.order.includes(field) || !["asc", "desc"].includes(direction)) {
        throw requestError("Order is not allowed");
      }
      return `${field}.${direction}`;
    });
    params.set("order", order.join(","));
  }

  if (candidate.filters !== undefined) {
    if (!Array.isArray(candidate.filters) || candidate.filters.length > 20) throw requestError("Filters are invalid");
    for (const filter of candidate.filters) {
      if (!filter || typeof filter !== "object" || Array.isArray(filter)) throw requestError("Filter is invalid");
      assertOnlyKeys(filter, ["field", "operator", "value"]);
      const field = str(filter.field);
      const operator = str(filter.operator);
      const validator = field && policy.filters[field];
      if (!validator || !["eq", "in"].includes(operator)) throw requestError("Filter is not allowed");
      if (operator === "in") {
        if (!Array.isArray(filter.value) || filter.value.length === 0 || filter.value.length > 200) {
          throw requestError("Filter values are invalid");
        }
        const values = filter.value.map((value) => validateAdminValue(value, validator, field));
        params.append(field, `in.(${values.join(",")})`);
      } else {
        params.append(field, `eq.${validateAdminValue(filter.value, validator, field)}`);
      }
    }
  }

  if (candidate.limit !== undefined) {
    if (!Number.isInteger(candidate.limit) || candidate.limit < 1 || candidate.limit > 500) {
      throw requestError("Limit is invalid");
    }
    params.set("limit", String(candidate.limit));
  }
  return params.toString();
}

function validateAdminFields(candidate, policy) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw requestError("Fields are required");
  const keys = Object.keys(candidate);
  if (keys.length === 0) throw requestError("Fields are required");
  for (const key of keys) {
    if (!Object.hasOwn(policy, key)) throw requestError(`Field is not allowed: ${key}`);
  }
  return Object.fromEntries(keys.map((key) => [key, validateAdminValue(candidate[key], policy[key], key)]));
}

function validateAdminValue(value, validator, label) {
  if (Array.isArray(validator)) {
    if (!validator.includes(value)) throw requestError(`${label} is invalid`);
    return value;
  }
  if (validator === "uuid") return validateUuid(value, label);
  if (validator === "boolean") {
    if (typeof value !== "boolean") throw requestError(`${label} must be boolean`);
    return value;
  }
  if (["integer", "nonNegativeInteger", "positiveInteger"].includes(validator)) {
    if (!Number.isInteger(value)) throw requestError(`${label} must be an integer`);
    if (validator === "nonNegativeInteger" && value < 0) throw requestError(`${label} must not be negative`);
    if (validator === "positiveInteger" && value < 1) throw requestError(`${label} must be positive`);
    return value;
  }
  if (validator === "nullableText" && value === null) return null;
  if (validator === "nullableDate" && value === null) return null;
  if (typeof value !== "string") throw requestError(`${label} must be text`);
  const valueText = value.trim();
  if (!valueText || valueText.length > 4000) throw requestError(`${label} is invalid`);
  if (validator === "slug" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(valueText)) throw requestError(`${label} is invalid`);
  if ((validator === "nullableDate" || validator === "date") && !/^\d{4}-\d{2}-\d{2}$/.test(valueText)) {
    throw requestError(`${label} is invalid`);
  }
  if (validator === "time" && !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(valueText)) {
    throw requestError(`${label} is invalid`);
  }
  return valueText;
}

function validateUuid(value, label) {
  const id = str(value);
  if (!id || !UUID_PATTERN.test(id)) throw requestError(`${label} is invalid`);
  return id;
}

function assertOnlyKeys(candidate, allowed) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw requestError("Request is invalid");
  const extra = Object.keys(candidate).find((key) => !allowed.includes(key));
  if (extra) throw requestError(`Field is not allowed: ${extra}`);
}

function requestError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

const rows = (result) => (Array.isArray(result) ? result : result == null ? [] : [result]);

function str(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function normalizeEmail(value) {
  const email = str(value)?.toLowerCase();
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
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
  const email = normalizeEmail(body.email);
  const displayName = str(body.display_name);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "A valid email is required" }, 400);
  }

  const res = await fetch(`${apiBase(ctx)}/auth/${ctx.env.BUTTERBASE_APP_ID}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: randomPassword(), display_name: displayName || email }),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = String(result.error || result.message || "");
    if (/already exists|already registered/i.test(message)) {
      return json({ error: "An account with this email already exists.", code: "EMAIL_EXISTS" }, 409);
    }
    console.error("admin create-account signup failed:", message);
    return json({ error: "Could not create the account. Please try again." }, 502);
  }

  const parentName = displayName || email;
  const account = { user_id: result.user.id, email, name: parentName };
  let profileSaved = false;
  try {
    await data(ctx, "parent_profiles", {
      method: "POST",
      body: { user_id: account.user_id, email, parent_name: parentName },
    });
    profileSaved = true;
  } catch (error) {
    console.error("admin create-account profile save failed:", error && error.message);
  }

  let welcomeSent = false;
  try {
    welcomeSent = await sendWelcomeEmail(ctx, { email, parentName });
  } catch (error) {
    console.error("admin create-account welcome request failed:", error && error.message);
  }
  return json({
    account_exists: true,
    account,
    profile_saved: profileSaved,
    code_sent: true,
    welcome_sent: welcomeSent,
    recovery_required: !profileSaved || !welcomeSent,
  }, 200);
}

export async function sendWelcomeEmail(ctx, { email, parentName }) {
  const loginUrl = new URL("/login.html", ctx.env.SITE_URL || "https://olivistart.com");
  loginUrl.search = new URLSearchParams({ mode: "magic-verify", email, next: "account.html" });
  const body = [
    `Hello${parentName ? ` ${parentName}` : ""},`,
    "",
    "The admin of OliVista Art Studio has created an account for you. Butterbase has sent a separate security email containing your sign-in code. Please use that code to log in:",
    "",
    loginUrl.toString(),
    "",
    "Sign-in codes expire after 15 minutes and can be used only once. If your code has expired, request a new one from the login page.",
    "",
    "If you did not expect these emails, please contact OliVista Art Studio.",
  ].join("\n");
  const res = await fetch(`${apiBase(ctx)}/v1/${ctx.env.BUTTERBASE_APP_ID}/integrations/execute`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ctx.env.SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      toolName: "GMAIL_SEND_EMAIL",
      userId: ctx.env.INVITATION_GMAIL_USER_ID,
      params: { to: email, subject: "Your OliVista Art Studio account", body },
    }),
  });
  const result = await res.json().catch(() => ({}));
  return res.ok && result.successful === true;
}

// Resends the two onboarding messages from the authoritative stored profile.
// The client-supplied email is intentionally ignored so an admin browser
// cannot redirect account messages to an unrelated address.
async function resendInvitation(ctx, body) {
  const userId = str(body.user_id);
  if (!userId) return json({ error: "Parent account id is required" }, 400);

  const profile = rows(await data(
    ctx,
    `parent_profiles?user_id=eq.${encodeURIComponent(userId)}&select=email,parent_name`,
  ))[0];
  const email = profile && str(profile.email);
  if (!email) return json({ error: "Parent profile not found" }, 404);

  return json(await deliverOnboarding(ctx, email, str(profile.parent_name) || email), 200);
}

async function deliverOnboarding(ctx, email, parentName) {
  const [magicLink, welcome] = await Promise.allSettled([
    fetch(`${apiBase(ctx)}/auth/${ctx.env.BUTTERBASE_APP_ID}/magic-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }),
    sendWelcomeEmail(ctx, { email, parentName }),
  ]);
  return {
    code_sent: magicLink.status === "fulfilled" && magicLink.value.ok,
    welcome_sent: welcome.status === "fulfilled" && welcome.value === true,
  };
}

async function recoverAccount(ctx, body) {
  assertOnlyKeys(body, ["action", "user_id", "email", "parent_name"]);
  const userId = validateUuid(body.user_id, "Parent account id");
  const email = normalizeEmail(body.email);
  const parentName = str(body.parent_name);
  if (!email) throw requestError("A valid email is required");
  if (!parentName || parentName.length > 200) throw requestError("Parent name is required");
  const account = { user_id: userId, email, name: parentName };

  let profileSaved = false;
  try {
    const existing = rows(await data(
      ctx,
      `parent_profiles?user_id=eq.${encodeURIComponent(userId)}&select=user_id,email,parent_name`,
    ))[0];
    if (existing) {
      await data(ctx, `parent_profiles/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        body: { email, parent_name: parentName },
      });
    } else {
      await data(ctx, "parent_profiles", {
        method: "POST",
        body: { user_id: userId, email, parent_name: parentName },
      });
    }
    profileSaved = true;
  } catch (error) {
    console.error("admin recover-account profile save failed:", error && error.message);
  }

  const delivery = await deliverOnboarding(ctx, email, parentName);
  return json({
    account_exists: true,
    account,
    profile_saved: profileSaved,
    ...delivery,
    recovery_required: !profileSaved || !delivery.code_sent || !delivery.welcome_sent,
  }, 200);
}

// Same generator guest-enroll uses: satisfies the uppercase/lower/number/
// special password policy while remaining unknown to anyone.
function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const base = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "");
  return `Aa1!${base}`;
}

// Inserts a student owned by the target user_id (not the admin), which the
// service key allows despite the user-isolation WITH CHECK.
async function addStudent(ctx, body) {
  const userId = str(body.user_id);
  const name = str(body.name);
  const dob = str(body.dob);
  if (!userId) return json({ error: "Parent account id is required" }, 400);
  if (!name) return json({ error: "Student name is required" }, 400);
  const age = calculateStudentAge(dob);
  if (age == null) return json({ error: "A valid date of birth is required" }, 400);

  const created = await data(ctx, "students", {
    method: "POST",
    body: { user_id: userId, name, age: String(age), dob, notes: str(body.notes) },
  });
  return json({ student: rows(created)[0] || null }, 200);
}

// Updates any student, since this is admin-only.
async function updateStudent(ctx, body) {
  const id = str(body.id);
  const name = str(body.name);
  const dob = str(body.dob);
  if (!id) return json({ error: "Student id is required" }, 400);
  const age = calculateStudentAge(dob);
  if (age == null) return json({ error: "A valid date of birth is required" }, 400);

  const fields = { age: String(age), dob };
  if (name !== null) fields.name = name;
  if (body.notes !== undefined) fields.notes = str(body.notes);

  const updated = await data(ctx, `students/${encodeURIComponent(id)}`, { method: "PATCH", body: fields });
  const student = rows(updated)[0];
  if (!student) return json({ error: "Student not found" }, 404);
  return json({ student }, 200);
}

// Grants a comped, already-confirmed enrollment. Price comes from the schedule
// (never the client); the student must belong to the parent. The student and
// parent fields are denormalized so the row reads consistently in the
// enrollments list, attendance sheet, and the parent's account page.
async function createEnrollment(ctx, body) {
  const userId = str(body.user_id);
  const studentId = str(body.student_id);
  const scheduleId = str(body.schedule_id);
  const numClasses = parseInt(body.num_classes_enrolled, 10);
  if (!userId || !studentId || !scheduleId) {
    return json({ error: "Parent, student, and schedule are required" }, 400);
  }
  if (!Number.isFinite(numClasses) || numClasses < 1) {
    return json({ error: "Number of classes must be at least 1" }, 400);
  }

  const schedules = rows(await data(
    ctx,
    `class_schedules?id=eq.${encodeURIComponent(scheduleId)}&active=eq.true&select=price_cents`,
  ));
  if (schedules.length === 0) return json({ error: "Class schedule not found" }, 404);
  const priceCents = schedules[0].price_cents;

  const students = rows(await data(
    ctx,
    `students?id=eq.${encodeURIComponent(studentId)}&user_id=eq.${encodeURIComponent(userId)}&select=name`,
  ));
  if (students.length === 0) {
    return json({ error: "That student does not belong to this parent" }, 400);
  }

  const created = await data(ctx, "enrollments", {
    method: "POST",
    body: {
      schedule_id: scheduleId,
      user_id: userId,
      student_id: studentId,
      student_name: students[0].name,
      student_email: str(body.student_email),
      student_phone: str(body.student_phone),
      parent_name: str(body.parent_name),
      status: "confirmed",
      num_classes_enrolled: numClasses,
      price_per_class_cents: priceCents,
      discount_pct: 0,
      total_paid_cents: 0,
    },
  });
  return json({ enrollment: { id: (rows(created)[0] || {}).id || null } }, 200);
}

// Adjusts an enrollment's paid class count (credits = this minus attended,
// computed in account.js). Below-attended values are allowed as an admin
// override; the UI warns before sending them.
async function setCredits(ctx, body) {
  const id = str(body.enrollment_id);
  const numClasses = parseInt(body.num_classes_enrolled, 10);
  if (!id) return json({ error: "Enrollment id is required" }, 400);
  if (!Number.isFinite(numClasses) || numClasses < 0) {
    return json({ error: "Number of classes must be zero or more" }, 400);
  }
  const status = str(body.status);
  if (status && !["pending", "confirmed", "cancelled"].includes(status)) {
    return json({ error: "Invalid status" }, 400);
  }

  const fields = { num_classes_enrolled: numClasses };
  if (status) fields.status = status;

  const updated = await data(ctx, `enrollments/${encodeURIComponent(id)}`, { method: "PATCH", body: fields });
  const enrollment = rows(updated)[0];
  if (!enrollment) return json({ error: "Enrollment not found" }, 404);
  return json({ enrollment }, 200);
}

// Derives the parent list from app tables, since the auth app_users table is
// not reachable from a function. parent_profiles is authoritative for contact
// details and also represents accounts with no activity yet. Enrollment rows
// remain the fallback for legacy accounts created before profiles existed.
async function listAccounts(ctx) {
  const [profileRows, studentRows, enrollmentRows] = await Promise.all([
    data(ctx, "parent_profiles?select=user_id,email,parent_name"),
    data(ctx, "students?select=user_id"),
    // Newest rows carry the most recently saved contact information. Keep the
    // ordering explicit because the REST API does not guarantee row order.
    data(ctx, "enrollments?select=user_id,student_email,parent_name,created_at&order=created_at.desc"),
  ]);

  const accounts = new Map();
  const entry = (userId) => {
    if (!accounts.has(userId)) {
      accounts.set(userId, { user_id: userId, email: null, name: null, student_count: 0, enrollment_count: 0 });
    }
    return accounts.get(userId);
  };

  for (const row of rows(profileRows)) {
    if (!row.user_id) continue;
    const account = entry(row.user_id);
    account.email = str(row.email);
    account.name = str(row.parent_name);
  }
  for (const row of rows(studentRows)) {
    if (!row.user_id) continue;
    entry(row.user_id).student_count += 1;
  }
  for (const row of rows(enrollmentRows)) {
    if (!row.user_id) continue;
    const account = entry(row.user_id);
    account.enrollment_count += 1;
    if (account.email === null) account.email = str(row.student_email);
    if (account.name === null) account.name = str(row.parent_name);
  }

  const list = [...accounts.values()].sort((a, b) => (a.name || "￿").localeCompare(b.name || "￿"));
  return json({ accounts: list }, 200);
}

// Copied verbatim from manage-students.js (functions are single-file, so the
// helper must be self-contained and keep the same UTC convention).
function calculateStudentAge(dob, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob || "")) return null;
  const [year, month, day] = dob.split("-").map(Number);
  const birthDate = new Date(Date.UTC(year, month - 1, day));
  if (
    birthDate.getUTCFullYear() !== year ||
    birthDate.getUTCMonth() !== month - 1 ||
    birthDate.getUTCDate() !== day
  ) return null;
  const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (birthDate > todayDate) return null;
  const age = today.getUTCFullYear() - year;
  const birthdayHasPassed =
    today.getUTCMonth() > month - 1 ||
    (today.getUTCMonth() === month - 1 && today.getUTCDate() >= day);
  return age - (birthdayHasPassed ? 0 : 1);
}
