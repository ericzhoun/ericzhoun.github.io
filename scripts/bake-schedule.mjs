#!/usr/bin/env node
// Fetches the current schedule data from the public Butterbase API and bakes
// it into schedule.html as an inline JSON snapshot, so the page can render
// its default view with no live API call. Run manually, or by the
// bake-schedule GitHub Actions workflow on a schedule.
import { readFile, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { apiGet, semestersQuery, programsQuery, scheduleQuery } from "../js/api.js";

const SCHEDULE_HTML = fileURLToPath(new URL("../schedule.html", import.meta.url));
const START_MARKER = "<!-- SCHEDULE_SNAPSHOT_START -->";
const END_MARKER = "<!-- SCHEDULE_SNAPSHOT_END -->";

/** Replace the content between the snapshot markers in schedule.html with a
 *  <script> tag holding payload as JSON. Pure string transform, no I/O. */
export function injectSnapshot(html, payload) {
  const startIdx = html.indexOf(START_MARKER);
  const endIdx = html.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error("schedule.html is missing the SCHEDULE_SNAPSHOT markers");
  }
  const before = html.slice(0, startIdx + START_MARKER.length);
  const after = html.slice(endIdx);
  const tag = `\n    <script type="application/json" id="schedule-snapshot">${JSON.stringify(payload)}</script>\n    `;
  return `${before}${tag}${after}`;
}

async function buildPayload() {
  const [semesters, programs] = await Promise.all([
    apiGet(semestersQuery()),
    apiGet(programsQuery()),
  ]);

  const schedulesBySemester = {};
  for (const semester of semesters) {
    schedulesBySemester[semester.id] = await apiGet(scheduleQuery(semester.id));
  }

  return { generatedAt: new Date().toISOString(), semesters, programs, schedulesBySemester };
}

async function main() {
  const payload = await buildPayload();
  const html = await readFile(SCHEDULE_HTML, "utf8");
  const updated = injectSnapshot(html, payload);
  await writeFile(SCHEDULE_HTML, updated);
  const scheduleCount = Object.values(payload.schedulesBySemester).reduce((n, rows) => n + rows.length, 0);
  console.log(`Baked ${payload.semesters.length} semester(s), ${scheduleCount} schedule row(s) into schedule.html`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
