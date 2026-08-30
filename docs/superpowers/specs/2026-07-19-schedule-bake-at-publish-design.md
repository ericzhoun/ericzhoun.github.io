# Bake schedule data at publish time

## Goal

Make `schedule.html` render the weekly calendar instantly for visitors, instead of showing a "Loading calendar…" placeholder while the browser makes cross-origin round trips to the Butterbase API. The class schedule changes rarely, so the data can be captured ahead of time and shipped with the page.

## Approach

A small Node script fetches the current schedule data from the existing public Butterbase endpoints and bakes it into `schedule.html` as an inline JSON snapshot. A scheduled GitHub Actions workflow runs this script periodically (and on manual trigger) and commits the result if it changed. `schedule.js` reads the inline snapshot first and only falls back to a live API call if the snapshot is missing or broken.

The schedule's underlying shape is expected to evolve (e.g. a program card that spans the whole week instead of one day/time slot), so the bake mechanism is deliberately kept dumb: it never interprets or reshapes rows, and it never hardcodes its own copy of the queries. See "Shared query source" and "Verbatim snapshot" below.

## Bake script (`scripts/bake-schedule.mjs`)

- Dependency-free Node script using the built-in `fetch`.
- Fetches, from the existing public (no-auth) Butterbase REST endpoints already used by `js/schedule.js`:
  - `semesters?active=eq.true&order=start_date.desc`
  - `programs?active=eq.true&order=sort_order.asc`
  - For each active semester: `class_schedules?semester_id=eq.<id>&active=eq.true&order=day_of_week.asc,start_time.asc`
- Assembles a payload:
  ```json
  {
    "generatedAt": "<ISO timestamp>",
    "semesters": [...],
    "programs": [...],
    "schedulesBySemester": { "<semesterId>": [...] }
  }
  ```
- Rewrites `schedule.html`, replacing everything between two HTML comment markers with a `<script type="application/json" id="schedule-snapshot">` tag containing the payload:
  ```html
  <!-- SCHEDULE_SNAPSHOT_START -->
  <script type="application/json" id="schedule-snapshot">{...}</script>
  <!-- SCHEDULE_SNAPSHOT_END -->
  ```
- The markers make re-running the script idempotent - it only ever replaces its own prior output.
- The script is run once by hand as part of building this feature, so the shipped page starts with a real, populated snapshot rather than an empty one.

### Shared query source

The three query paths above are defined once, as plain exported functions (e.g. `semestersQuery()`, `programsQuery()`, `scheduleQuery(semesterId)`) in `js/api.js`. `js/api.js` has no browser-only code at module load time (the one `window` reference lives inside a function body, not top-level), so it can be imported unmodified from both the browser (`schedule.js`) and the Node bake script. Both the live-fetch fallback and the bake script call the same functions to build request paths.

This means a future schema change - new filters, a renamed table, an additional query for a new kind of schedule entry - is made in exactly one place, and the baked snapshot and the live fallback can never silently diverge from each other.

### Verbatim snapshot

The bake script stores each query's raw JSON response in the snapshot unmodified - no field selection, renaming, or reshaping. `schedulesBySemester[semesterId]` is exactly what `class_schedules?semester_id=eq.<id>&...` returns today, whatever columns it has. If the schedule format later changes (e.g. a row representing a program that spans the whole week instead of a single day/time slot, via a new column or a `day_of_week: null` convention), those rows flow through the snapshot untouched. Only `schedule.js`'s `render()` function needs to learn how to draw the new shape - the bake mechanism itself does not need to change.

## GitHub Actions workflow (`.github/workflows/bake-schedule.yml`)

- Triggers: `schedule` (cron, every 6 hours) and `workflow_dispatch` (manual run from the Actions tab, for "I just edited the schedule and want it live sooner").
- Permissions: `contents: write`.
- Steps: checkout → run `node scripts/bake-schedule.mjs` → check `git diff` on `schedule.html` → if changed, commit as a bot and push to `main`; if unchanged, no-op (no empty commits, no history noise).
- No secrets needed: the script only reads public endpoints that already serve anonymous requests.
- Pushing to `main` is what GitHub Pages already serves from directly, so this redeploys automatically with no separate Pages workflow.

## Frontend changes

`schedule.html`:
- Adds the `SCHEDULE_SNAPSHOT_START`/`END` marker comments wrapping the `#schedule-snapshot` script tag (baked with real data as part of this change).

`js/api.js`:
- Adds `semestersQuery()`, `programsQuery()`, and `scheduleQuery(semesterId)` exports wrapping the three query strings above, replacing the ad-hoc template strings currently inlined in `schedule.js`.

`js/schedule.js`:
- Uses the new `js/api.js` query exports (via `apiGet`) for its live-fetch paths, instead of inline query strings.
- `init()` first tries to read and parse `#schedule-snapshot`.
  - If present and it contains at least one semester: populate `state.semesters`, `state.programs`, and an in-memory `schedulesBySemester` map directly from the snapshot; pick the default semester using the existing "Summer 2026, else first" rule; set `state.schedules` from the map; set `state.loading = false`; render. No network request is made for the default view.
  - If the tag is missing, empty, or fails to parse: fall back to the existing live-fetch behavior, unchanged.
- `changeSemester(id)`: if the requested semester's schedules are already in the baked `schedulesBySemester` map, switch to them immediately with no fetch. Otherwise (e.g. a semester created after the last bake and before the next cron tick), fall back to the existing live `apiGet` call.
- No visible UI changes. The existing loading/error states remain exactly as today's fallback behavior.

## Error handling / robustness

- A missing or malformed snapshot never breaks the page - it silently drops to the pre-existing live-fetch code path.
- The workflow only commits when the snapshot actually changed, keeping `schedule.html`'s git history meaningful.
- No new secrets or credentials are introduced.

## Testing

- Extend `test/schedule.test.mjs` (or a sibling test file) to cover:
  - `schedule.js` uses `#schedule-snapshot` data when present and valid, without calling the live API.
  - `schedule.js` falls back to `apiGet` when the snapshot tag is missing, empty, or malformed.
  - `changeSemester` uses the baked map when the semester is present in it, and falls back to a live fetch when it isn't.
- A test for the bake script's marker-replacement logic: idempotent re-run (replacing prior output) and correct behavior against the initial empty-snapshot state.
- A test that the bake script and `schedule.js` build the exact same query strings from `js/api.js`'s shared exports (guards against the two paths drifting apart).
- Existing tests (`schedulesBySlot`, `formatAgeGroup`, retry-button behavior) are unaffected and must keep passing.

## Scope

This change covers `schedule.html`'s calendar view and the shared query helpers in `js/api.js` it depends on. It does not change how the admin CMS edits schedules, does not add authentication/secrets to the workflow, and does not add a "last updated" indicator to the UI. It also does not implement rendering support for new schedule shapes (e.g. a whole-week program card) - it only ensures the bake mechanism won't need to change when that rendering work happens. Other pages and the live Butterbase API itself are untouched.
