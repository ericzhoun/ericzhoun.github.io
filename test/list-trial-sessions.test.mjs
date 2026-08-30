import assert from "node:assert/strict";
import { test } from "node:test";
import { handler } from "../backend/functions/list-trial-sessions.js";

function request(body) {
  return new Request("https://example.test/list-trial-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeCtx(queryResults) {
  const queries = [];
  let i = 0;
  return {
    ctx: {
      env: { BUTTERBASE_APP_ID: "app_test", SITE_URL: "https://example.test" },
      db: {
        async query(sql, values) {
          queries.push({ sql, values });
          const result = queryResults[i] ?? { rows: [] };
          i += 1;
          return result;
        },
      },
    },
    queries,
  };
}

test("returns upcoming sessions with derived availability", async () => {
  const { ctx, queries } = makeCtx([
    { rows: [{ id: "sched-1", max_seats: 10, day_of_week: "Monday", start_time: "16:00", end_time: "17:00" }] },
    { rows: [
      { id: "sess-1", class_date: "2026-09-01" },
      { id: "sess-2", class_date: "2026-09-08" },
    ] },
    { rows: [
      { session_id: "sess-1", taken: "3" },
      { session_id: "sess-2", taken: "10" },
    ] },
  ]);

  const res = await handler(request({ schedule_id: "sched-1" }), ctx);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.sessions.length, 2);
  assert.equal(data.sessions[0].available, 7); // 10 - 3
  assert.equal(data.sessions[1].available, 0); // 10 - 10
  assert.equal(data.sessions[0].day_of_week, "Monday");
  assert.equal(data.sessions[0].start_time, "16:00");
  // N+1 fix: availability comes from one grouped query, not one COUNT per session.
  assert.match(queries[2].sql, /GROUP BY session_id/);
  assert.match(queries[2].sql, /= ANY\(\$1\)/);
});

test("404 when schedule missing or inactive", async () => {
  const { ctx } = makeCtx([{ rows: [] }]);
  const res = await handler(request({ schedule_id: "nope" }), ctx);
  assert.equal(res.status, 404);
});

test("400 when schedule_id missing", async () => {
  const { ctx } = makeCtx([]);
  const res = await handler(request({}), ctx);
  assert.equal(res.status, 400);
});
