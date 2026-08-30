# Bake Schedule Data at Publish Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `schedule.html` render the weekly calendar instantly by shipping a baked JSON snapshot of the schedule data with the page, instead of fetching it live on every load.

**Architecture:** A Node bake script fetches semesters, programs, and each active semester's class schedules from the existing public Butterbase REST endpoints and writes them into a `<script type="application/json" id="schedule-snapshot">` tag inside `schedule.html`, between two marker comments. `schedule.js` reads that snapshot first; only when it is missing or invalid does it fall back to the pre-existing live-fetch code path. A scheduled GitHub Actions workflow re-runs the bake script periodically and commits the result when it changes.

**Tech Stack:** Vanilla ES modules (no build tooling, no npm dependencies), Node's built-in `fetch`/`node:test`, static HTML/CSS, GitHub Actions, GitHub Pages.

## Global Constraints

- No `package.json` or npm dependencies exist in this repo; new scripts must stay dependency-free and use Node's built-ins only.
- Tests run with `node --test test/*.test.mjs` from the repo root; there is no other test runner.
- Never use the em dash "-" (U+2014) anywhere, including code comments, docs, and commit messages; use a plain "-" instead.
- Commit messages must never add an agent name as a co-author.
- The schedule's Butterbase endpoints (`semesters`, `programs`, `class_schedules`) are public reads (RLS allows anonymous access); never use `ADMIN_KEY` from `js/api.js` for these reads.
- This site is served directly from the `main` branch via GitHub Pages (see `CNAME`); any push to `main` deploys live to `olivistart.com`. Pushing to `origin/main`, or triggering the new GitHub Actions workflow against the real repository, requires explicit confirmation from the user before doing so - do not push or dispatch the workflow automatically.

## File Structure

- Modify: `js/api.js` - add three shared query-path helper exports used by both the browser and the bake script.
- Modify: `js/schedule.js` - use the shared query helpers; add two pure snapshot helpers; hydrate `init()`/`changeSemester()` from the baked snapshot with a live-fetch fallback.
- Modify: `schedule.html` - add the `SCHEDULE_SNAPSHOT_START`/`END` marker comments wrapping an (initially empty) `#schedule-snapshot` tag.
- Create: `scripts/bake-schedule.mjs` - the bake script, with an exported pure `injectSnapshot` function.
- Create: `.github/workflows/bake-schedule.yml` - scheduled + manually-dispatchable workflow that runs the bake script and commits changes.
- Modify: `test/schedule.test.mjs` - tests for the new query helpers and the snapshot-hydration logic.
- Create: `test/bake-schedule.test.mjs` - tests for `injectSnapshot`.

---

### Task 1: Shared query helpers in `js/api.js`

**Files:**
- Modify: `js/api.js` (append near the end of the file)
- Modify: `js/schedule.js:3` (import), `js/schedule.js` inside `changeSemester` and `init` (call sites)
- Test: `test/schedule.test.mjs`

**Interfaces:**
- Produces: `semestersQuery(): string`, `programsQuery(): string`, `scheduleQuery(semesterId: string): string`, all exported from `js/api.js`. Later tasks (bake script, snapshot hydration) import these same functions.

- [ ] **Step 1: Write the failing tests**

Add to `test/schedule.test.mjs` (new imports at the top, new tests anywhere in the file):

```js
import { semestersQuery, programsQuery, scheduleQuery } from "../js/api.js";
```

```js
test("schedule query helpers produce the exact REST paths schedule.js and the bake script share", () => {
  assert.equal(semestersQuery(), "semesters?active=eq.true&order=start_date.desc");
  assert.equal(programsQuery(), "programs?active=eq.true&order=sort_order.asc");
  assert.equal(
    scheduleQuery("abc-123"),
    "class_schedules?semester_id=eq.abc-123&active=eq.true&order=day_of_week.asc,start_time.asc"
  );
});

test("schedule.js uses the shared query helpers instead of inline query strings", async () => {
  const script = await readSchedule();
  assert.match(script, /semestersQuery\(\)/);
  assert.match(script, /programsQuery\(\)/);
  assert.match(script, /scheduleQuery\(/);
  assert.doesNotMatch(script, /class_schedules\?semester_id=eq\.\$\{/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/schedule.test.mjs`
Expected: FAIL - `semestersQuery is not a function` (or similar) and the "uses the shared query helpers" test failing because `schedule.js` still has inline query strings.

- [ ] **Step 3: Add the helpers to `js/api.js`**

Append to the end of `js/api.js`:

```js
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
```

- [ ] **Step 4: Update `js/schedule.js` to use the helpers**

Replace the import on line 3:

```js
import { apiGet, formatPrice, formatTime } from "./api.js";
```

with:

```js
import { apiGet, formatPrice, formatTime, semestersQuery, programsQuery, scheduleQuery } from "./api.js";
```

In `changeSemester`, replace:

```js
    state.schedules = await apiGet(
      `class_schedules?semester_id=eq.${semesterId}&active=eq.true&order=day_of_week.asc,start_time.asc`
    );
```

with:

```js
    state.schedules = await apiGet(scheduleQuery(semesterId));
```

In `init`, replace:

```js
    const [sems, programs] = await Promise.all([
      apiGet("semesters?active=eq.true&order=start_date.desc"),
      apiGet("programs?active=eq.true&order=sort_order.asc"),
    ]);
```

with:

```js
    const [sems, programs] = await Promise.all([
      apiGet(semestersQuery()),
      apiGet(programsQuery()),
    ]);
```

and replace:

```js
      state.schedules = await apiGet(
        `class_schedules?semester_id=eq.${defaultSemester.id}&active=eq.true&order=day_of_week.asc,start_time.asc`
      );
```

with:

```js
      state.schedules = await apiGet(scheduleQuery(defaultSemester.id));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/schedule.test.mjs`
Expected: PASS - all tests green, including the two new ones.

- [ ] **Step 6: Commit**

```bash
git add js/api.js js/schedule.js test/schedule.test.mjs
git commit -m "Share schedule query paths between the live fetch and the future bake script"
```

---

### Task 2: Pure snapshot-parsing helpers in `js/schedule.js`

**Files:**
- Modify: `js/schedule.js` (add two exported functions after `formatAgeGroup`, before the `state` object)
- Test: `test/schedule.test.mjs`

**Interfaces:**
- Consumes: nothing from Task 1 directly (these are standalone pure functions).
- Produces: `parseSnapshot(rawText: string | null): { semesters, programs, schedulesBySemester } | null` and `pickDefaultSemester(semesters: Array<{ id, name }>): { id, name }`. Task 3 wires both into `init()`.

- [ ] **Step 1: Write the failing tests**

Add to `test/schedule.test.mjs`:

```js
test("parseSnapshot returns null for missing, empty, or malformed snapshot data", async () => {
  const script = await readSchedule();
  const match = script.match(/export function parseSnapshot[\s\S]*?\n}\n/);
  assert.ok(match, "parseSnapshot helper should be exported");

  const moduleUrl = new URL(`data:text/javascript,${encodeURIComponent(`${match[0]}\nexport default parseSnapshot;`)}`);
  const { default: parseSnapshot } = await import(moduleUrl);

  assert.equal(parseSnapshot(""), null);
  assert.equal(parseSnapshot(null), null);
  assert.equal(parseSnapshot("not json"), null);
  assert.equal(parseSnapshot(JSON.stringify({ semesters: [] })), null);
  assert.equal(parseSnapshot(JSON.stringify({ semesters: [{ id: "s1" }] })), null);

  const valid = JSON.stringify({
    semesters: [{ id: "s1", name: "Summer 2026" }],
    programs: [],
    schedulesBySemester: { s1: [] },
  });
  assert.deepEqual(parseSnapshot(valid), JSON.parse(valid));
});

test("pickDefaultSemester prefers Summer 2026, else falls back to the first semester", async () => {
  const script = await readSchedule();
  const match = script.match(/export function pickDefaultSemester[\s\S]*?\n}\n/);
  assert.ok(match, "pickDefaultSemester helper should be exported");

  const moduleUrl = new URL(`data:text/javascript,${encodeURIComponent(`${match[0]}\nexport default pickDefaultSemester;`)}`);
  const { default: pickDefaultSemester } = await import(moduleUrl);

  const semesters = [{ id: "s1", name: "Fall 2025" }, { id: "s2", name: "Summer 2026" }];
  assert.equal(pickDefaultSemester(semesters).id, "s2");
  assert.equal(pickDefaultSemester([{ id: "s3", name: "Fall 2025" }]).id, "s3");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/schedule.test.mjs`
Expected: FAIL - `assert.ok(match, "parseSnapshot helper should be exported")` fails because the function doesn't exist yet.

- [ ] **Step 3: Add the helpers to `js/schedule.js`**

Insert right after `formatAgeGroup`'s closing brace and before the `const state = {` line:

```js
/** Parse the baked #schedule-snapshot payload. Returns null when missing, empty, or malformed. */
export function parseSnapshot(rawText) {
  if (!rawText) return null;
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    return null;
  }
  if (!data || !Array.isArray(data.semesters) || data.semesters.length === 0) return null;
  if (!Array.isArray(data.programs)) return null;
  if (!data.schedulesBySemester || typeof data.schedulesBySemester !== "object") return null;
  return data;
}

/** Pick the default semester: "Summer 2026" if present, else the first in the list. */
export function pickDefaultSemester(semesters) {
  const summer2026 = semesters.find((s) => s.name.trim().toLowerCase() === "summer 2026");
  return summer2026 || semesters[0];
}
```

Also add a `schedulesBySemester: null,` field to the initial `state` object, so it reads:

```js
const state = {
  semesters: [],
  programs: [],
  schedules: [],
  selectedSemester: null,
  schedulesBySemester: null,
  loading: true,
  error: "",
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/schedule.test.mjs`
Expected: PASS - all tests green.

- [ ] **Step 5: Commit**

```bash
git add js/schedule.js test/schedule.test.mjs
git commit -m "Add pure snapshot-parsing helpers for the baked schedule data"
```

---

### Task 3: Wire snapshot hydration into `init()`/`changeSemester()`, add markers to `schedule.html`

**Files:**
- Modify: `js/schedule.js` (`init` and `changeSemester` functions)
- Modify: `schedule.html` (add marker comments + empty snapshot tag)
- Test: `test/schedule.test.mjs`

**Interfaces:**
- Consumes: `parseSnapshot`, `pickDefaultSemester` (Task 2), `semestersQuery`, `programsQuery`, `scheduleQuery` (Task 1).
- Produces: `state.schedulesBySemester` populated whenever a valid snapshot is present; this is what Task 4/5's baked data will flow into at runtime.

- [ ] **Step 1: Write the failing tests**

Add to `test/schedule.test.mjs`:

```js
test("init hydrates from the baked snapshot before falling back to a live fetch", async () => {
  const script = await readSchedule();
  assert.match(script, /getElementById\("schedule-snapshot"\)/);
  assert.match(script, /parseSnapshot\(/);
  assert.match(script, /pickDefaultSemester\(/);
});

test("changeSemester prefers the baked schedulesBySemester map before falling back to a live fetch", async () => {
  const script = await readSchedule();
  const fn = script.match(/async function changeSemester[\s\S]*?\n}\n/);
  assert.ok(fn, "changeSemester should be defined");
  assert.match(fn[0], /state\.schedulesBySemester\[semesterId\]/);
  assert.match(fn[0], /scheduleQuery\(semesterId\)/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/schedule.test.mjs`
Expected: FAIL - neither `getElementById("schedule-snapshot")` nor the `schedulesBySemester` lookup exist yet.

- [ ] **Step 3: Update `changeSemester` in `js/schedule.js`**

Replace the whole function:

```js
async function changeSemester(semesterId) {
  state.selectedSemester = semesterId;
  state.loading = true;
  render();
  try {
    state.schedules = await apiGet(scheduleQuery(semesterId));
    state.error = "";
  } catch (err) {
    state.error = err.message;
  } finally {
    state.loading = false;
    render();
  }
}
```

with:

```js
async function changeSemester(semesterId) {
  state.selectedSemester = semesterId;

  if (state.schedulesBySemester && state.schedulesBySemester[semesterId]) {
    state.schedules = state.schedulesBySemester[semesterId];
    state.error = "";
    render();
    return;
  }

  state.loading = true;
  render();
  try {
    state.schedules = await apiGet(scheduleQuery(semesterId));
    state.error = "";
  } catch (err) {
    state.error = err.message;
  } finally {
    state.loading = false;
    render();
  }
}
```

- [ ] **Step 4: Update `init` in `js/schedule.js`**

Replace the whole function:

```js
async function init() {
  try {
    const [sems, programs] = await Promise.all([
      apiGet(semestersQuery()),
      apiGet(programsQuery()),
    ]);
    state.semesters = sems;
    state.programs = programs;

    if (sems.length > 0) {
      const summer2026 = sems.find((semester) => semester.name.trim().toLowerCase() === "summer 2026");
      const defaultSemester = summer2026 || sems[0];
      state.selectedSemester = defaultSemester.id;
      state.schedules = await apiGet(scheduleQuery(defaultSemester.id));
    }
  } catch (err) {
    state.error = err.message;
  } finally {
    state.loading = false;
    render();
  }
}
```

with:

```js
async function init() {
  const snapshotEl = document.getElementById("schedule-snapshot");
  const snapshot = snapshotEl ? parseSnapshot(snapshotEl.textContent) : null;

  if (snapshot) {
    state.semesters = snapshot.semesters;
    state.programs = snapshot.programs;
    state.schedulesBySemester = snapshot.schedulesBySemester;
    const defaultSemester = pickDefaultSemester(snapshot.semesters);
    state.selectedSemester = defaultSemester.id;
    state.schedules = snapshot.schedulesBySemester[defaultSemester.id] || [];
    state.loading = false;
    render();
    return;
  }

  try {
    const [sems, programs] = await Promise.all([
      apiGet(semestersQuery()),
      apiGet(programsQuery()),
    ]);
    state.semesters = sems;
    state.programs = programs;

    if (sems.length > 0) {
      const defaultSemester = pickDefaultSemester(sems);
      state.selectedSemester = defaultSemester.id;
      state.schedules = await apiGet(scheduleQuery(defaultSemester.id));
    }
  } catch (err) {
    state.error = err.message;
  } finally {
    state.loading = false;
    render();
  }
}
```

- [ ] **Step 5: Add the snapshot markers to `schedule.html`**

Replace:

```html
    <section class="container art-calendar">
      <div id="calendar-root" aria-live="polite">
        <p class="muted">Loading calendar…</p>
      </div>
    </section>
  </main>
```

with:

```html
    <section class="container art-calendar">
      <div id="calendar-root" aria-live="polite">
        <p class="muted">Loading calendar…</p>
      </div>
    </section>

    <!-- SCHEDULE_SNAPSHOT_START -->
    <script type="application/json" id="schedule-snapshot">{}</script>
    <!-- SCHEDULE_SNAPSHOT_END -->
  </main>
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test test/schedule.test.mjs`
Expected: PASS - all tests green.

- [ ] **Step 7: Manually verify the fallback path still works in a browser**

The snapshot tag currently holds `{}`, which `parseSnapshot` treats as invalid, so the page must still render exactly as it did before this plan, via a live fetch. Verify this regression case:

```bash
python3 -m http.server 8080
```

Using the claude-in-chrome tools (load them first if deferred, via `ToolSearch` with `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__read_network_requests`):
1. Navigate to `http://localhost:8080/schedule.html`.
2. Confirm the calendar renders (semester tabs, grid, classes) exactly as it did before this change.
3. Check `read_network_requests` shows requests to `api.butterbase.ai` for `semesters`, `programs`, and `class_schedules` (the live fallback firing, as expected with an empty snapshot).
4. Stop the `http.server` process.

- [ ] **Step 8: Commit**

```bash
git add js/schedule.js schedule.html test/schedule.test.mjs
git commit -m "Hydrate the schedule page from a baked snapshot, falling back to a live fetch"
```

---

### Task 4: Bake script (`scripts/bake-schedule.mjs`)

**Files:**
- Create: `scripts/bake-schedule.mjs`
- Create: `test/bake-schedule.test.mjs`

**Interfaces:**
- Consumes: `apiGet`, `semestersQuery`, `programsQuery`, `scheduleQuery` from `js/api.js` (Task 1).
- Produces: `injectSnapshot(html: string, payload: object): string`, exported for tests and reused by `main()`.

- [ ] **Step 1: Write the failing tests**

Create `test/bake-schedule.test.mjs`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/bake-schedule.test.mjs`
Expected: FAIL - `Cannot find module '../scripts/bake-schedule.mjs'`.

- [ ] **Step 3: Create `scripts/bake-schedule.mjs`**

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/bake-schedule.test.mjs`
Expected: PASS - all three tests green. Importing the module must not trigger a network call; the entrypoint guard only calls `main()` when the file is run directly with `node scripts/bake-schedule.mjs`, not when imported by the test.

- [ ] **Step 5: Commit**

```bash
git add scripts/bake-schedule.mjs test/bake-schedule.test.mjs
git commit -m "Add the schedule bake script"
```

---

### Task 5: Run the bake script for real and verify in a browser

**Files:**
- Modify: `schedule.html` (real baked data replaces the empty `{}` placeholder)

**Interfaces:**
- Consumes: `scripts/bake-schedule.mjs` (Task 4).

- [ ] **Step 1: Run the bake script against the live API**

```bash
node scripts/bake-schedule.mjs
```

Expected output: `Baked N semester(s), M schedule row(s) into schedule.html` with N >= 1.

- [ ] **Step 2: Confirm the diff looks right**

```bash
git diff schedule.html
```

Expected: only the content inside the `SCHEDULE_SNAPSHOT_START`/`END` markers changed, now containing real semester/program/schedule JSON instead of `{}`.

- [ ] **Step 3: Manually verify in a browser that the page now loads with zero schedule API calls**

```bash
python3 -m http.server 8080
```

Using the claude-in-chrome tools:
1. Navigate to `http://localhost:8080/schedule.html`.
2. Confirm the calendar renders correctly (semester tabs, grid, mobile list) and matches what production `schedule.html` shows today.
3. Check `read_network_requests`: there should be **no** requests to `api.butterbase.ai` for `semesters`, `programs`, or `class_schedules` on initial load.
4. Click a different semester tab (if more than one is baked) and confirm switching is instant with no network request; if only one semester is active, confirm the single tab still renders correctly.
5. Stop the `http.server` process.

- [ ] **Step 4: Run the full test suite once more**

Run: `node --test test/*.test.mjs`
Expected: PASS - every test in the repo still passes.

- [ ] **Step 5: Commit**

```bash
git add schedule.html
git commit -m "Bake the current schedule snapshot into schedule.html"
```

---

### Task 6: GitHub Actions workflow to keep the snapshot fresh

**Files:**
- Create: `.github/workflows/bake-schedule.yml`

**Interfaces:**
- Consumes: `scripts/bake-schedule.mjs` (Task 4).

- [ ] **Step 1: Create the workflow file**

```yaml
name: Bake schedule snapshot

on:
  schedule:
    - cron: "0 */6 * * *"
  workflow_dispatch: {}

permissions:
  contents: write

jobs:
  bake:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Bake schedule snapshot
        run: node scripts/bake-schedule.mjs

      - name: Commit and push if changed
        run: |
          if git diff --quiet -- schedule.html; then
            echo "No schedule changes to bake."
            exit 0
          fi
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add schedule.html
          git commit -m "Bake updated schedule snapshot"
          git push
```

- [ ] **Step 2: Validate the YAML parses**

```bash
python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/bake-schedule.yml'))" 2>/dev/null || node -e "require('node:util').styleText; JSON.stringify(require('node:fs').readFileSync('.github/workflows/bake-schedule.yml','utf8'))"
```

If `python3 -c "import yaml..."` fails only because PyYAML isn't installed (not because of a syntax error), that's fine - the important check is that the file has no tab characters and consistent indentation. Confirm with:

```bash
grep -nP '\t' .github/workflows/bake-schedule.yml
```

Expected: no output (no tabs).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/bake-schedule.yml
git commit -m "Add scheduled workflow to keep the baked schedule snapshot fresh"
```

- [ ] **Step 4: Stop and ask the user before going further**

Do **not** push to `origin/main` or manually trigger the workflow yet. Pushing deploys live to `olivistart.com` and activates a recurring cron job on the real repository - both are outside this plan's automatic scope. Report back to the user that all six tasks are complete and committed locally, and ask whether they want to push now (which will also make the new cron schedule live).
