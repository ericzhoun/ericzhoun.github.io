import assert from "node:assert/strict";
import { test } from "node:test";
import { injectSnapshot } from "../scripts/bake-schedule.mjs";

const START = "<!-- SCHEDULE_SNAPSHOT_START -->";
const END = "<!-- SCHEDULE_SNAPSHOT_END -->";

function fixtureHtml(innerScriptJson) {
  return `<main>\n  ${START}\n    <script type="application/json" id="schedule-snapshot">${innerScriptJson}</script>\n  ${END}\n</main>`;
}

test("injectSnapshot replaces the content between the snapshot markers", () => {
  const html = fixtureHtml("{}");
  const payload = {
    generatedAt: "2026-07-19T00:00:00.000Z",
    semesters: [{ id: "s1" }],
    programs: [],
    schedulesBySemester: { s1: [] },
  };

  const updated = injectSnapshot(html, payload);

  const match = updated.match(/id="schedule-snapshot">([\s\S]*?)<\/script>/);
  assert.ok(match, "snapshot script tag should still be present");
  assert.deepEqual(JSON.parse(match[1]), payload);
});

test("injectSnapshot is idempotent when re-run against its own prior output", () => {
  const html = fixtureHtml("{}");
  const first = injectSnapshot(html, { semesters: [{ id: "a" }], programs: [], schedulesBySemester: {} });
  const second = injectSnapshot(first, { semesters: [{ id: "b" }], programs: [], schedulesBySemester: {} });

  assert.equal((second.match(/SCHEDULE_SNAPSHOT_START/g) || []).length, 1);
  assert.equal((second.match(/SCHEDULE_SNAPSHOT_END/g) || []).length, 1);
  const match = second.match(/id="schedule-snapshot">([\s\S]*?)<\/script>/);
  assert.deepEqual(JSON.parse(match[1]).semesters, [{ id: "b" }]);
});

test("injectSnapshot throws when schedule.html is missing the snapshot markers", () => {
  assert.throws(
    () => injectSnapshot("<main></main>", { semesters: [] }),
    /missing the SCHEDULE_SNAPSHOT markers/
  );
});
