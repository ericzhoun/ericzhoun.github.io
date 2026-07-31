// Backend API config — shared across all pages.
// The backend lives at herfield.butterbase.ai (app_48ul5eszfv7v).
export const APP_ID = "app_48ul5eszfv7v";
export const API_BASE = `https://api.butterbase.ai/v1/${APP_ID}`;
export const AUTH_BASE = `https://api.butterbase.ai/auth/${APP_ID}`;
export const SITE_URL = "https://olivistart.com";
export const ADMIN_KEY = "bb_sk_f13dbc117c3c7cb653e416dea8c706be7e800a9e";

export async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Request timed out. Please try again.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch wrapper for Butterbase REST API with public (anon) access.
 * No auth header — relies on RLS public read policies.
 * Pass an optional JWT token to read private rows (e.g. own enrollments).
 */
export async function apiGet(path, token) {
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetchWithTimeout(`${API_BASE}/${path}`, { headers });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/** Fetch rows by a set of UUIDs in one request instead of issuing one request per row. */
export function apiGetByIds(table, ids, token) {
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  if (uniqueIds.length === 0) return Promise.resolve([]);
  return apiGet(`${table}?id=in.(${uniqueIds.join(",")})`, token);
}

export async function adminApi(path, options = {}) {
  const method = options.method || "GET";
  const headers = { Authorization: `Bearer ${ADMIN_KEY}`, ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  const res = await fetchWithTimeout(`${API_BASE}/${path}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) throw new Error(`Admin API error ${res.status}: ${await res.text()}`);
  return method === "DELETE" ? true : res.json();
}

/**
 * Call a Butterbase serverless function (enroll-guard, book-class) with auth.
 */
export async function callFunction(name, body, token, extraHeaders) {
  const headers = { "Content-Type": "application/json", ...(extraHeaders || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetchWithTimeout(`${API_BASE}/fn/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    // Our own functions return a flat { error: "message" }; the platform edge
    // (auth, routing, validation) returns { error: { code, message } }. Without
    // unwrapping the nested shape the message renders as "[object Object]".
    const detail = data.error;
    const nested = detail && typeof detail === "object" ? detail : null;
    const err = new Error(
      (nested ? nested.message : detail) || data.message || `Function error: ${res.status}`
    );
    err.code = data.code || nested?.code;
    throw err;
  }
  return data;
}

/** Format cents to dollar string: 5500 → "$55.00" */
export function formatPrice(cents) {
  if (cents == null) return "";
  return `$${(cents / 100).toFixed(2)}`;
}

/** Format time from "16:00" to "4:00 PM" */
export function formatTime(time) {
  if (!time) return "";
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${m} ${ampm}`;
}

/** Read a query-string param from the current URL. */
export function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/** Canonical weekly day order, Monday through Sunday. */
export const WEEK_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Comparator for sorting day_of_week strings into WEEK_DAYS order. */
export function compareDayOfWeek(a, b) {
  return WEEK_DAYS.indexOf(a) - WEEK_DAYS.indexOf(b);
}

/** Grouping key shared by every class_schedules row that belongs to the same
 *  bundle: same program, semester, session, time, age group, price, and
 *  capacity. Used to collapse a camp's Mon-Fri rows into one enrollable unit. */
export function scheduleBundleKey(schedule) {
  return [
    schedule.program_id, schedule.semester_id, schedule.session_type,
    schedule.start_time, schedule.end_time, schedule.age_group,
    schedule.price_cents, schedule.max_seats,
  ].join("|");
}

/** Partition a semester's class_schedules rows into camp bundles (grouped by
 *  scheduleBundleKey, one entry per bundle) and singles (every row that
 *  isn't a camp program's row, kept as-is). `programs` supplies program_type. */
export function groupCampBundles(schedules, programs) {
  const programTypeById = new Map(programs.map((p) => [p.id, p.program_type || "class"]));
  const singles = [];
  const byKey = new Map();
  for (const schedule of schedules) {
    if (programTypeById.get(schedule.program_id) !== "camp") {
      singles.push(schedule);
      continue;
    }
    const key = scheduleBundleKey(schedule);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(schedule);
  }
  const bundles = [...byKey.entries()].map(([key, group]) => {
    const sorted = [...group].sort((a, b) => compareDayOfWeek(a.day_of_week, b.day_of_week));
    return {
      key,
      programId: sorted[0].program_id,
      days: sorted.map((s) => s.day_of_week),
      schedules: sorted,
      startTime: sorted[0].start_time,
      endTime: sorted[0].end_time,
      ageGroup: sorted[0].age_group,
      pricePerClassCents: sorted[0].price_cents,
      totalCents: sorted[0].price_cents * sorted.length,
    };
  });
  return { bundles, singles };
}

/** Grouping key for schedules that belong to the same class but may run at a
 *  different time on different days (e.g. Monday 4-5pm, Wednesday 5-6pm) -
 *  same as scheduleBundleKey but without start_time/end_time. Used by
 *  enroll.js to offer day-of-week selection for a multi-day class without
 *  requiring every day to share one time slot. */
export function looseScheduleBundleKey(schedule) {
  return [
    schedule.program_id, schedule.semester_id, schedule.session_type,
    schedule.age_group, schedule.price_cents, schedule.max_seats,
  ].join("|");
}

/** REST query for every class_schedules row sharing `schedule`'s loose
 *  bundle key (program/semester/session/age group/price/capacity, but NOT
 *  time) - siblings may run at different times on different days. Used by
 *  enroll.js to discover which days a multi-day class is offered on. */
export function looseBundleQuery(schedule) {
  return `class_schedules?program_id=eq.${schedule.program_id}` +
    `&semester_id=eq.${schedule.semester_id}` +
    `&session_type=eq.${schedule.session_type}` +
    `&age_group=eq.${encodeURIComponent(schedule.age_group)}` +
    `&price_cents=eq.${schedule.price_cents}` +
    `&max_seats=eq.${schedule.max_seats}` +
    `&active=eq.true&order=day_of_week.asc`;
}

/** REST query for every class_schedules row in the same camp bundle as
 *  `schedule` (same program/semester/session/time/age group/price/capacity).
 *  Used by enroll.js to fetch a camp's full day list. */
export function campBundleQuery(schedule) {
  return `class_schedules?program_id=eq.${schedule.program_id}` +
    `&semester_id=eq.${schedule.semester_id}` +
    `&session_type=eq.${schedule.session_type}` +
    `&start_time=eq.${schedule.start_time}` +
    `&end_time=eq.${schedule.end_time}` +
    `&age_group=eq.${encodeURIComponent(schedule.age_group)}` +
    `&price_cents=eq.${schedule.price_cents}` +
    `&max_seats=eq.${schedule.max_seats}` +
    `&active=eq.true&order=day_of_week.asc`;
}

/** Diff a camp program's full class_schedules row set (active + inactive)
 *  against the days it should have active, per bundle instance (grouped by
 *  scheduleBundleKey). Pure - makes no API calls. Bundle groups with no
 *  currently-active row are skipped (retired bundles, left untouched).
 *  Returns one plan per live bundle:
 *  { key, deactivateIds, reactivateIds, createRows }. Used by the admin
 *  Programs form to resync schedule rows when a camp's day checkboxes
 *  change. */
export function planCampBundleSync(scheduleRows, targetDays) {
  const targetSet = new Set(targetDays);
  const byKey = new Map();
  for (const row of scheduleRows) {
    const key = scheduleBundleKey(row);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
  }
  const plans = [];
  for (const [key, group] of byKey) {
    if (!group.some((row) => row.active)) continue;
    const byDay = new Map(group.map((row) => [row.day_of_week, row]));
    const deactivateIds = group
      .filter((row) => row.active && !targetSet.has(row.day_of_week))
      .map((row) => row.id);
    const reactivateIds = [];
    const createRows = [];
    for (const day of targetDays) {
      const existing = byDay.get(day);
      if (!existing) {
        const template = group[0];
        createRows.push({
          program_id: template.program_id, semester_id: template.semester_id,
          session_type: template.session_type, start_time: template.start_time,
          end_time: template.end_time, age_group: template.age_group,
          price_cents: template.price_cents, max_seats: template.max_seats,
          day_of_week: day, active: true,
        });
      } else if (!existing.active) {
        reactivateIds.push(existing.id);
      }
    }
    plans.push({ key, deactivateIds, reactivateIds, createRows });
  }
  return plans;
}

/** Query paths for the schedule page's semesters, programs, and per-semester class
 *  schedules. Shared between the live in-browser fetch (schedule.js) and the
 *  build-time bake script (scripts/bake-schedule.mjs) so both stay in sync if the
 *  schema or filters ever change. */
export function semestersQuery() {
  return "semesters?active=eq.true&order=start_date.desc";
}

export function programsQuery() {
  return "programs?active=eq.true&order=sort_order.asc";
}

export function scheduleQuery(semesterId) {
  return `class_schedules?semester_id=eq.${semesterId}&active=eq.true&order=day_of_week.asc,start_time.asc`;
}
