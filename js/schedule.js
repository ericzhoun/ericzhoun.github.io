// Weekly class schedule — calendar grid view.
// Ported from herfield app/art-class/CalendarView.js, compiled to vanilla JS.
import { apiGet, formatPrice, formatTime, semestersQuery, programsQuery, scheduleQuery, groupCampBundles } from "./api.js";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_SHORT = { Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed", Thursday: "Thu", Friday: "Fri", Saturday: "Sat", Sunday: "Sun" };

// Color palette per program (cycles through accent-themed colors)
const PROGRAM_COLORS = [
  { bg: "#f0e6d3", border: "#9f752c", text: "#7a5a1f" }, // gold
  { bg: "#dfe8da", border: "#5a8a4a", text: "#3d6b2e" }, // sage green
  { bg: "#e8d9d9", border: "#a05050", text: "#7a3838" }, // muted red
  { bg: "#d9e2e8", border: "#4a6a8a", text: "#2e4d6b" }, // dusty blue
  { bg: "#ece0e8", border: "#8a5a78", text: "#6b3a58" }, // muted purple
  { bg: "#e8e0d2", border: "#8a7a4a", text: "#6b5e2e" }, // olive
  { bg: "#dae8e5", border: "#4a8a82", text: "#2e6b65" }, // teal
];

function getColorForProgram(programId, programList) {
  const idx = programList.findIndex((p) => p.id === programId);
  return PROGRAM_COLORS[idx % PROGRAM_COLORS.length] || PROGRAM_COLORS[0];
}

export function schedulesBySlot(schedules) {
  return schedules.reduce((slots, schedule) => {
    const key = `${schedule.day_of_week}|${schedule.start_time}`;
    (slots[key] ||= []).push(schedule);
    return slots;
  }, {});
}

// Format the age group label, e.g. "7-12" -> "Age 7-12".
// Values that already include a label (e.g. "Age 7-12", "Teens") are returned unchanged.
function formatAgeGroup(ageGroup) {
  if (!ageGroup) return "";
  const trimmed = ageGroup.trim();
  if (/^\d+[-–]\d+$/.test(trimmed)) {
    return `Age ${trimmed}`;
  }
  return trimmed;
}

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

/**
 * Pick the default semester: `requestedName` if it matches one (case-insensitive),
 * else "Fall 2026" if present, else the first in the list.
 */
export function pickDefaultSemester(semesters, requestedName) {
  if (requestedName) {
    const requested = semesters.find(
      (s) => s.name.trim().toLowerCase() === requestedName.trim().toLowerCase()
    );
    if (requested) return requested;
  }
  const fall2026 = semesters.find((s) => s.name.trim().toLowerCase() === "fall 2026");
  return fall2026 || semesters[0];
}

const state = {
  semesters: [],
  programs: [],
  schedules: [],
  selectedSemester: null,
  schedulesBySemester: null,
  loading: true,
  error: "",
};

const root = document.getElementById("calendar-root");

function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html != null) e.innerHTML = html;
  return e;
}

// "Book a trial" button wired to the trial-modal delegated handler.
function trialBtn(scheduleId) {
  const b = el("button", "book-trial-btn btn btn-sm", "Book a trial");
  b.type = "button";
  b.dataset.schedule = scheduleId;
  return b;
}

function render() {
  root.innerHTML = "";

  // Semester tabs
  if (state.semesters.length > 0) {
    const tabs = el("div", "calendar-semester-tabs");
    state.semesters.forEach((s) => {
      const btn = el("button",
        `semester-tab ${state.selectedSemester === s.id ? "active" : ""}`, s.name);
      btn.type = "button";
      btn.onclick = () => changeSemester(s.id);
      tabs.appendChild(btn);
    });
    root.appendChild(tabs);
  }

  if (state.loading) {
    root.appendChild(el("p", "muted", "Loading calendar…"));
    return;
  }

  if (state.error) {
    const error = el("div", "calendar-load-error");
    error.appendChild(el("p", "auth-error", "Unable to load the schedule. Please try again."));
    const retry = el("button", "btn", "Try again");
    retry.type = "button";
    retry.addEventListener("click", retryScheduleLoad);
    error.appendChild(retry);
    root.appendChild(error);
    return;
  }

  const activeSemester = state.semesters.find((s) => s.id === state.selectedSemester);
  if (activeSemester) {
    const p = el("p", "calendar-semester", activeSemester.name);
    if (activeSemester.start_date && activeSemester.end_date) {
      const fmt = (d) => new Date(d).toLocaleDateString();
      const span = el("span", "muted",
        ` (${fmt(activeSemester.start_date)} – ${fmt(activeSemester.end_date)})`);
      p.appendChild(span);
    }
    root.appendChild(p);
  }

  if (state.schedules.length === 0) {
    const empty = el("div", "empty-state");
    empty.appendChild(el("p", "", "No classes scheduled for this semester. Please check back soon!"));
    const cta = el("a", "btn", "Contact Olivia");
    cta.href = "contact.html";
    empty.appendChild(cta);
    root.appendChild(empty);
    return;
  }

  // ---- Camp bundles vs. regular per-day schedules ----
  // Camps get their own table (see renderCampsTable) instead of sharing the
  // weekly grid, since a bundle's day span doesn't fit a single grid cell.
  const { bundles, singles } = groupCampBundles(state.schedules, state.programs);

  // ---- Camps: separate table, shown above the weekly grid ----
  if (bundles.length > 0) {
    root.appendChild(renderCampsTable(bundles));
    root.appendChild(el("h3", "calendar-camps-title", "Classes"));
  }

  // ---- Desktop weekly grid ----
  const byDay = {};
  DAYS.forEach((d) => (byDay[d] = []));
  singles.forEach((s) => { if (byDay[s.day_of_week]) byDay[s.day_of_week].push(s); });

  const allTimes = [...new Set(singles.map((s) => s.start_time))].sort();
  const slotMap = schedulesBySlot(singles);

  const wrapper = el("div", "calendar-grid-wrapper");
  const grid = el("div", "calendar-grid");

  const timeHeader = el("div", "calendar-cell calendar-corner", "Time");
  timeHeader.style.gridColumn = "1";
  timeHeader.style.gridRow = "1";
  grid.appendChild(timeHeader);
  DAYS.forEach((day, dayIndex) => {
    const header = el("div", "calendar-cell calendar-day-header", DAY_SHORT[day]);
    header.style.gridColumn = String(dayIndex + 2);
    header.style.gridRow = "1";
    grid.appendChild(header);
  });

  allTimes.forEach((time, timeIndex) => {
    const rowNum = timeIndex + 2;
    const timeLabel = el("div", "calendar-cell calendar-time-label", formatTime(time));
    timeLabel.style.gridColumn = "1";
    timeLabel.style.gridRow = String(rowNum);
    grid.appendChild(timeLabel);

    let dayIndex = 0;
    while (dayIndex < DAYS.length) {
      const day = DAYS[dayIndex];
      const schedules = slotMap[`${day}|${time}`] || [];
      const cellColumn = dayIndex + 2;
      if (schedules.length === 0) {
        const empty = el("div", "calendar-cell calendar-empty");
        empty.style.gridColumn = String(cellColumn);
        empty.style.gridRow = String(rowNum);
        grid.appendChild(empty);
        dayIndex += 1;
        continue;
      }
      const cell = el("div", "calendar-cell calendar-class-cell");
      cell.style.gridColumn = String(cellColumn);
      cell.style.gridRow = String(rowNum);
      schedules.forEach((sched) => {
        const prog = state.programs.find((p) => p.id === sched.program_id);
        const color = getColorForProgram(sched.program_id, state.programs);
        const a = el("a", "calendar-class");
        a.href = `enroll.html?schedule=${sched.id}`;
        a.style.background = color.bg;
        a.style.borderColor = color.border;
        a.style.color = color.text;
        a.appendChild(el("span", "calendar-class-program", prog ? prog.name : "Class"));
        a.appendChild(el("span", "calendar-class-time",
          `${formatTime(sched.start_time)}–${formatTime(sched.end_time)}`));
        a.appendChild(el("span", "calendar-class-age", formatAgeGroup(sched.age_group)));
        a.appendChild(el("span", "calendar-class-price", formatPrice(sched.price_cents)));
        cell.appendChild(a);
        cell.appendChild(trialBtn(sched.id));
      });
      grid.appendChild(cell);
      dayIndex += 1;
    }
  });
  wrapper.appendChild(grid);
  root.appendChild(wrapper);

  // ---- Mobile list grouped by day ----
  const mobile = el("div", "calendar-mobile");
  DAYS.filter((d) => byDay[d].length > 0).forEach((day) => {
    const group = el("div", "calendar-day-group");
    group.appendChild(el("h4", "calendar-day-title", day));
    const list = el("div", "calendar-day-classes");

    byDay[day].forEach((sched) => {
      const prog = state.programs.find((p) => p.id === sched.program_id);
      const color = getColorForProgram(sched.program_id, state.programs);
      const card = el("a", "calendar-class-mobile");
      card.href = `enroll.html?schedule=${sched.id}`;
      card.style.borderLeftColor = color.border;
      card.style.background = color.bg;
      const header = el("div", "calendar-class-mobile-header");
      header.style.color = color.text;
      header.appendChild(el("span", "calendar-class-program", prog ? prog.name : "Class"));
      header.appendChild(el("span", "calendar-class-price", formatPrice(sched.price_cents)));
      card.appendChild(header);
      const details = el("div", "calendar-class-mobile-details");
      details.appendChild(el("span", "", `${formatTime(sched.start_time)}–${formatTime(sched.end_time)}`));
      details.appendChild(el("span", "muted", formatAgeGroup(sched.age_group)));
          card.appendChild(details);
          list.appendChild(card);
          list.appendChild(trialBtn(sched.id));
        });
        group.appendChild(list);
    mobile.appendChild(group);
  });
  root.appendChild(mobile);
}

function renderCampsTable(bundles) {
  const section = el("section", "calendar-camps");
  section.appendChild(el("h3", "calendar-camps-title", "Summer Camp"));
  const wrapper = el("div", "camps-table-wrapper");
  const table = el("table", "camps-table");
  const thead = el("thead", "", "<tr><th>Program</th><th>Days</th><th>Time</th><th>Age Group</th><th>Price</th><th></th></tr>");
  table.appendChild(thead);
  const tbody = el("tbody");
  bundles.forEach((bundle) => {
    const prog = state.programs.find((p) => p.id === bundle.programId);
    const row = el("tr");
    row.appendChild(el("td", "", esc(prog ? prog.name : "Camp")));
    row.appendChild(el("td", "", bundle.days.join(", ")));
    row.appendChild(el("td", "", `${formatTime(bundle.startTime)}–${formatTime(bundle.endTime)}`));
    row.appendChild(el("td", "", esc(formatAgeGroup(bundle.ageGroup))));
    row.appendChild(el("td", "", `${formatPrice(bundle.pricePerClassCents)} × ${bundle.days.length} days = ${formatPrice(bundle.totalCents)}`));
    const actionCell = el("td");
    const link = el("a", "btn btn-sm", "Enroll");
    link.href = `enroll.html?schedule=${bundle.schedules[0].id}`;
    actionCell.appendChild(link);
    row.appendChild(actionCell);
    row.style.cursor = "pointer";
    row.addEventListener("click", (e) => {
      if (e.target.closest("a")) return;
      window.location.href = link.href;
    });
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  wrapper.appendChild(table);
  section.appendChild(wrapper);
  return section;
}

function esc(v = "") {
  return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}

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

async function init() {
  const requestedSemester = new URLSearchParams(window.location.search).get("semester");
  const snapshotEl = document.getElementById("schedule-snapshot");
  const snapshot = snapshotEl ? parseSnapshot(snapshotEl.textContent) : null;

  if (snapshot) {
    state.semesters = snapshot.semesters;
    state.programs = snapshot.programs;
    state.schedulesBySemester = snapshot.schedulesBySemester;
    const defaultSemester = pickDefaultSemester(snapshot.semesters, requestedSemester);
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
      const defaultSemester = pickDefaultSemester(sems, requestedSemester);
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

async function retryScheduleLoad() {
  state.loading = true;
  state.error = "";
  render();
  await init();
}

init();
