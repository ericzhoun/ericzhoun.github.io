import { callFunction, formatPrice, formatTime, planCampBundleSync } from "./api.js";
import { createAdminDataClient } from "./admin-data.js";
import {
  getAccountCreationMessage,
  getOnboardingDeliveryMessage,
  getRecoveryMessage,
  replaceAdminNotice,
} from "./admin-account-messages.js";
import { createLatestEventListener } from "./admin-account-view-listener.js";
import { getToken, getUser, isAdmin, logout, refreshToken } from "./auth.js";

const nav = [
  ["dashboard", "Dashboard"], ["programs", "Programs"], ["semesters", "Semesters"],
  ["schedules", "Schedules"], ["sessions", "Sessions"], ["enrollments", "Enrollments"],
  ["students", "Students"], ["accounts", "Accounts"],
];
const app = document.querySelector("#admin-app");
const accountViewClick = createLatestEventListener();
let notification = "";
const esc = (v = "") => String(v).replace(/[&<>\"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" }[c]));
const date = (v) => v ? new Date(v).toLocaleDateString() : "-";
const query = () => location.hash.slice(1) || "dashboard";
const button = (label, action = "", cls = "btn btn-sm") => `<button class="${cls}" data-action="${action}">${label}</button>`;
// Sends the admin's own JWT: admin-manage is auth "required" and re-verifies
// it server-side. Authorization is the only header Butterbase's CORS allowlist
// permits here, so the token cannot be moved to a custom header. It has to be
// fresh, since a stored access token expires after an hour and the platform
// then rejects the call at the edge before the function runs.
const adminFn = async (action, body = {}) =>
  callFunction("admin-manage", { action, ...body }, (await refreshToken()) || getToken());
const adminData = createAdminDataClient(adminFn);

function notify(message) { notification = message; }
function renderNotification() {
  if (!notification) return;
  replaceAdminNotice(app, `<p class="admin-notice" data-transient-notice role="status">✓ ${esc(notification)}</p>`);
  notification = "";
}

function guard() {
  if (!isAdmin()) { location.href = `login.html?next=${encodeURIComponent("admin.html")}`; return false; }
  return true;
}
function renderNav() { document.querySelector("#admin-nav").innerHTML = nav.map(([id, label]) => `<a href="#${id}" class="${query() === id ? "active" : ""}">${label}</a>`).join(""); }
function table(headers, rows) { return `<div class="admin-table-wrapper"><table class="admin-table"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}" class="muted">No records found.</td></tr>`}</tbody></table></div>`; }
function form(fields, values = {}, title = "Edit record") {
  const inputValue = (key, type) => {
    const value = values[key] ?? "";
    return type === "date" && value ? String(value).slice(0, 10) : value;
  };
  const field = ([key, label, type = "text", extra = ""]) => {
    if (type === "select") {
      const options = extra;
      const selected = values[key] ?? options[0][0];
      return `<label>${label}<select name="${key}">${options.map(([value, text]) => `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(text)}</option>`).join("")}</select></label>`;
    }
    return `<label>${label}<${type === "textarea" ? "textarea" : "input"} name="${key}" type="${type}" value="${esc(inputValue(key, type))}" ${extra}>${type === "textarea" ? esc(values[key] ?? "") : ""}</${type === "textarea" ? "textarea" : "input"}></label>`;
  };
  return `<form id="record-form" class="admin-form"><h3>${title}</h3><p class="auth-error" id="form-error" hidden></p>${fields.map(field).join("")}<div class="form-actions"><button type="submit" class="btn btn-sm" data-save-button>Save</button><button type="button" class="btn btn-sm btn-secondary" data-action="cancel-form">Cancel</button></div></form>`;
}

async function dashboard() {
  const [programs, schedules, enrollments] = await Promise.all([
    adminData.read("programs", { select: ["id"] }),
    adminData.read("class_schedules", { select: ["id"] }),
    adminData.read("enrollments", { select: ["id"] }),
  ]);
  app.innerHTML = `<h1>Dashboard</h1><div class="stat-grid">${[[programs.length,"Programs","programs"],[schedules.length,"Class Schedules","schedules"],[enrollments.length,"Enrollments","enrollments"]].map(([n,l,id]) => `<a href="#${id}" class="stat-card"><span class="stat-number">${n}</span><span class="stat-label">${l}</span></a>`).join("")}</div><section class="dashboard-quick-links"><h2>Quick Actions</h2><div class="quick-link-grid"><a class="quick-link" href="#schedules"><h3>Manage Schedules →</h3><p>Add class times, prices, and capacity.</p></a><a class="quick-link" href="#programs"><h3>Manage Programs →</h3><p>Create or update art program types.</p></a><a class="quick-link" href="#enrollments"><h3>View Enrollments →</h3><p>Review students and payment status.</p></a></div></section>`;
}
const configs = {
  programs: { title: "Programs", resource: "programs", query: { order: [{ field: "sort_order", direction: "asc" }] }, fields: [], cols: ["name","program_type","num_classes","active"], labels: ["Name","Type","Classes","Active"] },
  semesters: { title: "Semesters", resource: "semesters", query: { order: [{ field: "start_date", direction: "desc" }] }, fields: [["name","Name"],["start_date","Start Date","date"],["end_date","End Date","date"]], cols: ["name","start_date","end_date","active"], labels: ["Name","Start","End","Active"] },
  schedules: { title: "Class Schedules", resource: "class_schedules", query: { order: [{ field: "created_at", direction: "desc" }] }, fields: [], cols: ["program_id","semester_id","day_of_week","session_type","start_time","age_group","price_cents","max_seats","active"], labels: ["Program","Semester","Day","Session","Start","Age","Price","Seats","Active"] },
};
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SESSION_TYPES = {
  standard: { label: "Standard Session", minutes: 60, priceDollars: 35 },
  extended: { label: "Extended Session", minutes: 90, priceDollars: 42 },
  full: { label: "Full Session", minutes: 120, priceDollars: 56 },
};

function sessionTypeFor(values) {
  if (SESSION_TYPES[values.session_type]) return values.session_type;
  if (!values.start_time || !values.end_time) return "standard";
  const [startHours, startMinutes] = values.start_time.split(":").map(Number);
  const [endHours, endMinutes] = values.end_time.split(":").map(Number);
  const duration = ((endHours * 60 + endMinutes) - (startHours * 60 + startMinutes) + 1440) % 1440;
  return Object.entries(SESSION_TYPES).find(([, type]) => type.minutes === duration)?.[0] || "standard";
}

function addMinutes(time, minutes) {
  const [hours, mins] = time.split(":").map(Number);
  const result = (hours * 60 + mins + minutes) % 1440;
  return `${String(Math.floor(result / 60)).padStart(2, "0")}:${String(result % 60).padStart(2, "0")}`;
}

function scheduleForm(values, programs, semesters, title, isEditing = false) {
  const selectedDays = values.days || (isEditing ? [values.day_of_week] : []);
  const sessionType = sessionTypeFor(values);
  const priceDollars = values.price_cents != null ? (values.price_cents / 100).toFixed(2) : SESSION_TYPES[sessionType].priceDollars.toFixed(2);
  return `<form id="record-form" class="admin-form">
    <h3>${title}</h3><p class="auth-error" id="form-error" hidden></p>
    <label>Program<select name="program_id" required><option value="">Select a program</option>${programs.map((p) => `<option value="${esc(p.id)}" ${p.id === values.program_id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
    <label>Semester<select name="semester_id" required><option value="">Select a semester</option>${semesters.map((s) => `<option value="${esc(s.id)}" ${s.id === values.semester_id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
    <label class="checkbox-label"><input name="active" type="checkbox" ${values.active !== false ? "checked" : ""}> Active (visible and available for booking)</label>
    <fieldset class="day-picker"><legend>${isEditing ? "Day of week" : "Days of week"}</legend><p class="hint">${isEditing ? "Editing changes this schedule's day." : "A separate schedule will be created for each selected day."}</p><div>${DAYS.map((day) => `<label><input type="checkbox" name="days" value="${day}" ${selectedDays.includes(day) ? "checked" : ""}> ${day}</label>`).join("")}</div></fieldset>
    <label>Session type<select name="session_type" id="session-type" required>${Object.entries(SESSION_TYPES).map(([key, type]) => `<option value="${key}" ${key === sessionType ? "selected" : ""}>${type.label}</option>`).join("")}</select></label>
    <div class="form-row"><label>Start time<input name="start_time" id="start-time" type="time" required value="${esc(values.start_time || "10:00")}"></label><label>End time<input name="end_time" id="end-time" type="time" required readonly value="${esc(values.end_time || addMinutes(values.start_time || "10:00", SESSION_TYPES[sessionType].minutes))}"></label></div>
    <div class="form-row"><label>Age group<input name="age_group" required value="${esc(values.age_group || "")}" placeholder="e.g. Ages 6-10"></label><label>Max seats<input name="max_seats" type="number" min="1" required value="${esc(values.max_seats || 8)}"></label></div>
    <label>Price per class ($)<input name="price_dollars" id="price-dollars" type="number" min="0" step="0.01" required value="${esc(priceDollars)}"><span class="hint">Defaults by session type: $35 standard, $42 extended, $56 full. You can adjust it if needed.</span></label>
    <label>Notes<textarea name="notes">${esc(values.notes || "")}</textarea></label>
    <div class="form-actions"><button type="submit" class="btn btn-sm" data-save-button>${isEditing ? "Update" : "Create schedules"}</button><button type="button" class="btn btn-sm btn-secondary" data-action="cancel-form">Cancel</button></div>
  </form>`;
}

function programForm(values, title) {
  const programType = values.program_type || "class";
  const campDays = values.campDays || [];
  return `<form id="record-form" class="admin-form">
    <h3>${title}</h3><p class="auth-error" id="form-error" hidden></p>
    <label>Name<input name="name" required value="${esc(values.name || "")}"></label>
    <label>Slug<input name="slug" required value="${esc(values.slug || "")}"></label>
    <label>Description<textarea name="description">${esc(values.description || "")}</textarea></label>
    <label>Image URL<input name="image_url" value="${esc(values.image_url || "")}"></label>
    <label>Sort Order<input name="sort_order" type="number" value="${esc(values.sort_order ?? 0)}"></label>
    <label>Program Type<select name="program_type" id="program-type">${[["class", "Class"], ["camp", "Camp"]].map(([value, text]) => `<option value="${value}" ${value === programType ? "selected" : ""}>${text}</option>`).join("")}</select></label>
    <div id="num-classes-field" ${programType === "camp" ? "hidden" : ""}><label>Number of Classes<input name="num_classes" type="number" value="${esc(values.num_classes ?? 0)}"></label></div>
    <fieldset id="camp-days-field" class="day-picker" ${programType === "camp" ? "" : "hidden"}>
      <legend>Days per week</legend>
      <p class="hint">Selected days become this camp's weekly schedule; the class count is calculated automatically.</p>
      <div>${DAYS.map((day) => `<label><input type="checkbox" name="camp_days" value="${day}" ${campDays.includes(day) ? "checked" : ""}> ${day}</label>`).join("")}</div>
    </fieldset>
    <div class="form-actions"><button type="submit" class="btn btn-sm" data-save-button>Save</button><button type="button" class="btn btn-sm btn-secondary" data-action="cancel-form">Cancel</button></div>
  </form>`;
}

async function crud(id) {
  const c = configs[id];
  const [items, programs, semesters] = await Promise.all([
    adminData.read(c.resource, c.query),
    id === "schedules" ? adminData.read("programs", { order: [{ field: "sort_order", direction: "asc" }] }) : Promise.resolve([]),
    id === "schedules" ? adminData.read("semesters", { order: [{ field: "start_date", direction: "desc" }] }) : Promise.resolve([]),
  ]);
  const displayValue = (item, key) => {
    if (id === "schedules" && key === "program_id") return programs.find((p) => p.id === item.program_id)?.name || "-";
    if (id === "schedules" && key === "semester_id") return semesters.find((s) => s.id === item.semester_id)?.name || "-";
    if (id === "schedules" && key === "session_type") return SESSION_TYPES[sessionTypeFor(item)].label;
    if (id === "programs" && key === "program_type") return item.program_type === "camp" ? "Camp" : "Class";
    if (key.includes("date")) return date(item[key]);
    if (key === "price_cents") return formatPrice(item[key]);
    return item[key] ?? (key === "active" ? "✓" : "-");
  };
  const dayOrder = Object.fromEntries(DAYS.map((day, index) => [day, index]));
  const scheduleGroups = id === "schedules" ? Object.values(items.reduce((groups, item) => {
    const key = JSON.stringify([item.program_id, item.semester_id, item.session_type || sessionTypeFor(item), item.start_time, item.end_time, item.age_group, item.price_cents, item.max_seats, item.notes]);
    if (!groups[key]) groups[key] = { item, members: [] };
    groups[key].members.push(item);
    return groups;
  }, {})).map((group) => ({
    ...group,
    days: group.members.map((item) => item.day_of_week).sort((a, b) => dayOrder[a] - dayOrder[b]),
    activeDays: group.members.filter((item) => item.active !== false).map((item) => item.day_of_week).sort((a, b) => dayOrder[a] - dayOrder[b]),
  })) : [];
  const tableRows = id === "schedules"
    ? scheduleGroups.map((group) => {
      const cells = c.cols.map((key) => `<td>${esc(key === "day_of_week" ? (group.activeDays.join(", ") || "None") : key === "active" ? (group.activeDays.length === 0 ? "Inactive" : group.activeDays.length === group.members.length ? "Active" : "Partial") : displayValue(group.item, key))}</td>`);
      const actions = `<td>${button("Copy", `copy-group:${group.members.map((item) => item.id).join(",")}`)} ${button("Edit", `edit-group:${group.members.map((item) => item.id).join(",")}`)} ${button("Delete", `delete-group:${group.members.map((item) => item.id).join(",")}`, "btn btn-sm btn-danger")}</td>`;
      return `<tr>${cells[0]}${actions}${cells.slice(1).join("")}</tr>`;
    }).join("")
    : items.map((item) => `<tr>${c.cols.map((key) => `<td>${esc(displayValue(item, key))}</td>`).join("")}<td>${button("Edit", `edit:${item.id}`)} ${button("Delete", `delete:${item.id}`, "btn btn-sm btn-danger")}</td></tr>`).join("");
  const headers = id === "schedules" ? [c.labels[0], "Actions", ...c.labels.slice(1)] : c.labels.concat("Actions");
  const publishButton = id === "schedules" ? button("Publish schedule now", "publish-schedule", "btn btn-sm btn-secondary") : "";
  app.innerHTML = `<div class="admin-crud-header"><h1>${c.title}</h1>${publishButton}${button(`+ New ${c.title.slice(0,-1)}`, "new-record")}</div><div id="form-slot"></div>${table(headers, tableRows)}`;
  app.addEventListener("click", crudActions, { once: true });
  async function crudActions(e) {
    const action = e.target.dataset.action || "";
    if (action === "publish-schedule") {
      e.target.disabled = true;
      e.target.textContent = "Publishing…";
      try {
        await adminFn("publish-schedule");
        notify("Schedule publish triggered. schedule.html will update in about a minute.");
      } catch (error) {
        alert(error.message || "Could not trigger the schedule publish.");
      }
      render();
    } else if (action === "new-record") {
      document.querySelector("#form-slot").innerHTML = id === "schedules" ? scheduleForm({}, programs, semesters, "New Class Schedules") : id === "programs" ? programForm({}, "New Program") : form(c.fields, {}, `New ${c.title.slice(0,-1)}`);
      bindForm();
    } else if (action.startsWith("copy-group:")) {
      const ids = action.slice("copy-group:".length).split(",");
      const group = scheduleGroups.find((candidate) => candidate.members.every((item) => ids.includes(item.id)) && candidate.members.length === ids.length);
      document.querySelector("#form-slot").innerHTML = scheduleForm({ ...group.item, days: group.days, active: group.activeDays.length > 0 }, programs, semesters, "Copy Class Schedule");
      bindForm();
    } else if (action.startsWith("edit-group:")) {
      const ids = action.slice("edit-group:".length).split(",");
      const group = scheduleGroups.find((candidate) => candidate.members.every((item) => ids.includes(item.id)) && candidate.members.length === ids.length);
      document.querySelector("#form-slot").innerHTML = scheduleForm({ ...group.item, days: group.days, active: group.activeDays.length > 0 }, programs, semesters, "Edit Class Schedules", true);
      bindForm(group.members);
    } else if (action.startsWith("edit:")) {
      const item = items.find((x) => String(x.id) === action.slice(5));
      if (id === "programs") {
        const campDays = item.program_type === "camp"
          ? [...new Set((await adminData.read("class_schedules", { filters: [
            { field: "program_id", operator: "eq", value: item.id },
            { field: "active", operator: "eq", value: true },
          ] })).map((row) => row.day_of_week))]
          : [];
        document.querySelector("#form-slot").innerHTML = programForm({ ...item, campDays }, "Edit Program");
      } else {
        document.querySelector("#form-slot").innerHTML = id === "schedules" ? scheduleForm(item, programs, semesters, "Edit Class Schedule", true) : form(c.fields, item, `Edit ${c.title.slice(0,-1)}`);
      }
      bindForm(item.id);
    } else if (action.startsWith("delete-group:") && confirm("Delete these class schedules?")) {
      const ids = action.slice("delete-group:".length).split(",");
      await Promise.all(ids.map((scheduleId) => adminData.remove("class_schedules", scheduleId)));
      render();
    } else if (action.startsWith("delete:") && confirm(`Delete this ${c.title.slice(0,-1).toLowerCase()}?`)) {
      await adminData.remove(id === "schedules" ? "class_schedules" : id, action.slice(7));
      render();
    }
  }
  function bindForm(editId) {
    const formElement = document.querySelector("#record-form");
    const saveButton = formElement.querySelector("[data-save-button]");
    const formError = formElement.querySelector("#form-error");
    document.querySelector('[data-action="cancel-form"]').addEventListener("click", () => render());
    if (id === "schedules") {
      const sessionType = document.querySelector("#session-type");
      const startTime = document.querySelector("#start-time");
      const endTime = document.querySelector("#end-time");
      const priceDollars = document.querySelector("#price-dollars");
      const updateSessionDetails = () => {
        const type = SESSION_TYPES[sessionType.value];
        endTime.value = addMinutes(startTime.value, type.minutes);
        priceDollars.value = type.priceDollars.toFixed(2);
      };
      sessionType.addEventListener("change", updateSessionDetails);
      startTime.addEventListener("change", updateSessionDetails);
    }
    if (id === "programs") {
      const programType = document.querySelector("#program-type");
      const numClassesField = document.querySelector("#num-classes-field");
      const campDaysField = document.querySelector("#camp-days-field");
      programType.addEventListener("change", () => {
        const isCamp = programType.value === "camp";
        numClassesField.hidden = isCamp;
        campDaysField.hidden = !isCamp;
      });
    }
    formElement.addEventListener("submit", async (e) => {
      e.preventDefault();
      saveButton.disabled = true;
      saveButton.textContent = "Saving…";
      formError.hidden = true;
      const data = new FormData(e.currentTarget);
      const body = Object.fromEntries(data);
      try {
        ["sort_order", "num_classes", "price_cents", "max_seats"].forEach((k) => { if (k in body) body[k] = Number(body[k]) || 0; });
        ["start_date", "end_date"].forEach((key) => {
          if (key in body && !body[key]) body[key] = null;
        });
        body.active = id === "schedules" ? data.get("active") === "on" : true;
        if (id === "schedules") {
          const days = data.getAll("days");
          const existingSchedules = Array.isArray(editId) ? editId : [];
          if (!days.length && !existingSchedules.length) throw new Error("Select at least one day of the week.");
          delete body.days;
          body.price_cents = Math.round(Number(body.price_dollars) * 100);
          delete body.price_dollars;
          if (existingSchedules.length) {
            const existingByDay = new Map(existingSchedules.map((schedule) => [schedule.day_of_week, schedule]));
            const selectedDays = new Set(days);
            await Promise.all([
              ...existingSchedules.map((schedule) => adminData.update(
                "class_schedules",
                schedule.id,
                { ...body, day_of_week: schedule.day_of_week, active: body.active && selectedDays.has(schedule.day_of_week) },
              )),
              ...days.map((day_of_week) => {
                const existing = existingByDay.get(day_of_week);
                return existing
                  ? Promise.resolve()
                  : adminData.create("class_schedules", { ...body, day_of_week });
              }),
            ]);
          } else {
            await Promise.all(days.map((day_of_week) => adminData.create("class_schedules", { ...body, day_of_week })));
          }
        } else if (id === "programs") {
          const isCamp = body.program_type === "camp";
          const campDays = data.getAll("camp_days");
          if (isCamp) {
            if (!campDays.length) throw new Error("Select at least one day of the week.");
            body.num_classes = campDays.length;
          }
          delete body.camp_days;
          await (editId ? adminData.update("programs", editId, body) : adminData.create("programs", body));
          if (isCamp && editId) {
            const allRows = await adminData.read("class_schedules", {
              filters: [{ field: "program_id", operator: "eq", value: editId }],
            });
            const plans = planCampBundleSync(allRows, campDays);
            await Promise.all(plans.flatMap((plan) => [
              ...plan.deactivateIds.map((rowId) => adminData.update("class_schedules", rowId, { active: false })),
              ...plan.reactivateIds.map((rowId) => adminData.update("class_schedules", rowId, { active: true })),
              ...plan.createRows.map((row) => adminData.create("class_schedules", row)),
            ]));
          }
        } else {
          await (editId ? adminData.update(id, editId, body) : adminData.create(id, body));
        }
        notify(editId ? `${c.title.slice(0, -1)} saved.` : `${c.title.slice(0, -1)} created.`);
        render();
      } catch (error) {
        formError.textContent = error.message || "Could not save this item. Please try again.";
        formError.hidden = false;
        saveButton.disabled = false;
        saveButton.textContent = editId ? "Save" : "Create";
      }
    });
  }
}
async function enrollments() {
  const items = await adminData.read("enrollments", { order: [{ field: "created_at", direction: "desc" }] });
  const rows = items.map((enrollment) => {
    const customerName = enrollment.parent_name || enrollment.customer_name || "Not provided";
    return `<tr><td>${esc(enrollment.student_name)}</td><td>${esc(customerName)}</td><td>${esc(enrollment.student_email)}</td><td><span class="status-badge status-${enrollment.status}">${esc(enrollment.status)}</span></td><td>${date(enrollment.created_at)}</td><td>${enrollment.status === "pending" ? button("Confirm", `confirm:${enrollment.id}`) : ""} ${["pending", "confirmed"].includes(enrollment.status) ? button("Cancel", `cancel:${enrollment.id}`, "btn btn-sm btn-danger") : ""}</td></tr>`;
  }).join("");
  app.innerHTML = `<div class="admin-crud-header"><h1>Enrollments</h1></div>${table(["Student Name", "Customer Name", "Customer Email", "Status", "Date", "Actions"], rows)}`;
  app.addEventListener("click", async (event) => {
    const action = event.target.dataset.action || "";
    if (!action.startsWith("confirm:") && !action.startsWith("cancel:")) return;
    await adminData.update("enrollments", action.slice(8), {
      status: action.startsWith("confirm:") ? "confirmed" : "cancelled",
    });
    render();
  }, { once: true });
}
async function students() { const items = await adminData.read("enrollments", { order: [{ field: "created_at", direction: "desc" }] }); const map = new Map(); items.forEach((e) => { const key = e.student_email || e.student_name; const s = map.get(key) || { name: e.student_name, email: e.student_email, phone: e.student_phone, total: 0, confirmed: 0, pending: 0, last: e.created_at }; s.total++; if (e.status === "confirmed") s.confirmed++; if (e.status === "pending") s.pending++; map.set(key, s); }); app.innerHTML = `<h1>Students</h1>${table(["Name","Email","Phone","Total","Confirmed","Pending","Last Active"], [...map.values()].map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.email)}</td><td>${esc(s.phone || "-")}</td><td>${s.total}</td><td>${s.confirmed}</td><td>${s.pending}</td><td>${date(s.last)}</td></tr>`).join(""))}`; }
async function sessions() {
  const [items, schedules, programs] = await Promise.all([
    adminData.read("class_sessions", { order: [{ field: "class_date", direction: "asc" }], limit: 200 }),
    adminData.read("class_schedules"),
    adminData.read("programs"),
  ]);
  const sessionIds = items.map((session) => session.id).filter(Boolean);
  const attendedBookings = sessionIds.length
    ? await adminData.read("bookings", {
      select: ["session_id"],
      filters: [
        { field: "status", operator: "eq", value: "attended" },
        { field: "session_id", operator: "in", value: sessionIds },
      ],
    })
    : [];
  const attendedSessionIds = new Set(attendedBookings.map((booking) => booking.session_id));
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const name = (id) => {
    const schedule = schedules.find((item) => item.id === id);
    const program = schedule && programs.find((item) => item.id === schedule.program_id);
    return program ? `${program.name} - ${schedule.day_of_week} ${formatTime(schedule.start_time)}` : "-";
  };
  const statusFor = (session) => {
    if (session.status === "cancelled") return { label: "Cancelled", className: "cancelled" };
    if (session.class_date < today) {
      return attendedSessionIds.has(session.id)
        ? { label: "Completed", className: "confirmed" }
        : { label: "Date passed", className: "date-passed" };
    }
    return { label: "Scheduled", className: "confirmed" };
  };
  app.innerHTML = `<div class="admin-crud-header"><h1>Class Sessions</h1></div>${table(["Program / Schedule", "Date", "Status", "Actions"], items.map((session) => {
    const status = statusFor(session);
    return `<tr><td>${esc(name(session.schedule_id))}</td><td>${date(session.class_date)}</td><td><span class="status-badge status-${status.className}">${status.label}</span></td><td>${button("Attendance", `attendance:${session.id}`)}</td></tr>`;
  }).join(""))}`;
  app.addEventListener("click", (event) => {
    const action = event.target.dataset.action || "";
    if (action.startsWith("attendance:")) attendance(action.slice("attendance:".length));
  }, { once: true });
}

async function attendance(sessionId) {
  const [sessionRows, bookings] = await Promise.all([
    adminData.read("class_sessions", { filters: [{ field: "id", operator: "eq", value: sessionId }] }),
    adminData.read("bookings", {
      filters: [{ field: "session_id", operator: "eq", value: sessionId }],
      order: [{ field: "booked_at", direction: "asc" }],
    }),
  ]);
  const session = sessionRows[0];
  if (!session) throw new Error("Session not found.");
  const [scheduleRows, enrollmentResults] = await Promise.all([
    adminData.read("class_schedules", { filters: [{ field: "id", operator: "eq", value: session.schedule_id }] }),
    Promise.all([...new Set(bookings.map((booking) => booking.enrollment_id))].map((id) => (
      adminData.read("enrollments", { filters: [{ field: "id", operator: "eq", value: id }] })
    ))),
  ]);
  const schedule = scheduleRows[0];
  const programRows = schedule ? await adminData.read("programs", {
    filters: [{ field: "id", operator: "eq", value: schedule.program_id }],
  }) : [];
  const enrollments = enrollmentResults.flat();
  const enrollmentFor = (id) => enrollments.find((enrollment) => enrollment.id === id);
  const activeBookings = bookings.filter((booking) => ["scheduled", "attended", "no_show"].includes(booking.status));
  const attendanceRows = activeBookings.map((booking) => {
    const enrollment = enrollmentFor(booking.enrollment_id);
    const label = booking.status === "scheduled" ? "Pending" : booking.status === "attended" ? "Attended" : "No-show";
    const statusClass = booking.status === "scheduled" ? "pending" : booking.status === "attended" ? "confirmed" : "cancelled";
    return `<tr><td>${esc(enrollment?.student_name || "-")}</td><td>${esc(enrollment?.student_email || "-")}${enrollment?.student_phone ? `<br>${esc(enrollment.student_phone)}` : ""}</td><td>${esc(booking.type === "home" ? "Home" : "Make-up")}</td><td><span class="status-badge status-${statusClass}">${label}</span></td><td>${button("✓ Attended", `mark:${booking.id}:attended`)} ${button("✗ No-show", `mark:${booking.id}:no_show`, "btn btn-sm btn-danger")}</td></tr>`;
  }).join("");
  const skipped = bookings.filter((booking) => ["skipped", "cancelled"].includes(booking.status));
  app.innerHTML = `<div class="admin-crud-header"><h1>Attendance Sheet</h1>${button("← Back to Sessions", "back-to-sessions")}</div><section class="attendance-session-info"><h3>${esc(programRows[0]?.name || "Class session")}</h3><p class="muted">${esc(schedule ? `${schedule.day_of_week} ${formatTime(schedule.start_time)}-${formatTime(schedule.end_time)} · ${schedule.age_group}` : "")}</p><p class="muted">${date(session.class_date)}</p></section>${activeBookings.length ? table(["Student", "Contact", "Type", "Status", "Actions"], attendanceRows) : `<div class="empty-state"><p>No students booked for this session.</p></div>`}${skipped.length ? `<section class="attendance-section-muted"><h3>Skipped / Cancelled</h3>${table(["Student", "Type", "Status"], skipped.map((booking) => `<tr><td>${esc(enrollmentFor(booking.enrollment_id)?.student_name || "-")}</td><td>${esc(booking.type)}</td><td><span class="status-badge status-cancelled">${esc(booking.status)}</span></td></tr>`).join(""))}</section>` : ""}`;
  app.addEventListener("click", async (event) => {
    const action = event.target.dataset.action || "";
    if (action === "back-to-sessions") { await sessions(); return; }
    if (!action.startsWith("mark:")) return;
    const [, bookingId, status] = action.split(":");
    event.target.disabled = true;
    try {
      await adminFn("mark-attendance", { booking_id: bookingId, status });
      await attendance(sessionId);
    } catch (error) {
      event.target.disabled = false;
      alert(error.message || "Could not update attendance.");
    }
  }, { once: true });
}
async function accounts() {
  const { accounts: list } = await adminFn("list-accounts");
  const rows = list.map((a) => `<tr>
    <td>${esc(a.name || "-")}</td><td>${esc(a.email || "-")}</td>
    <td>${a.student_count}</td><td>${a.enrollment_count}</td>
    <td>${button("Manage", `account:${esc(a.user_id)}`)}</td>
  </tr>`).join("");
  app.innerHTML = `<div class="admin-crud-header"><h1>Accounts</h1>${button("+ New account", "new-account")}</div>
    <div id="form-slot"></div>
    ${table(["Parent", "Email", "Students", "Enrollments", "Actions"], rows)}`;
  accountViewClick.listen(app, "click", async (event) => {
    const action = event.target.dataset.action || "";
    if (action === "new-account") { renderNewAccountForm(); return; }
    if (action.startsWith("account:")) {
      const userId = action.slice("account:".length);
      const account = list.find((a) => a.user_id === userId);
      if (account) await accountDetail(account.user_id, account.email, account.name);
    }
  });
}

function renderNewAccountForm() {
  document.querySelector("#form-slot").innerHTML = `<form id="record-form" class="admin-form">
    <h3>New parent account</h3><p class="auth-error" id="form-error" hidden></p>
    <label>Email<input name="email" type="email" required></label>
    <label>Parent name<input name="display_name" required></label>
    <p class="hint">The parent gets no password - they sign in later with an email code.</p>
    <div class="form-actions"><button type="submit" class="btn btn-sm" data-save-button>Create account</button>
    <button type="button" class="btn btn-sm btn-secondary" data-action="cancel-form">Cancel</button></div>
  </form>`;
  const formEl = document.querySelector("#record-form");
  const errorEl = formEl.querySelector("#form-error");
  formEl.querySelector('[data-action="cancel-form"]').addEventListener("click", () => render());
  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const saveButton = formEl.querySelector("[data-save-button]");
    saveButton.disabled = true; saveButton.textContent = "Creating…"; errorEl.hidden = true;
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const res = await adminFn("create-account", { email: data.email, display_name: data.display_name });
      notify(getAccountCreationMessage(res));
      await accountDetail(res.account.user_id, res.account.email, res.account.name, res);
    } catch (error) {
      errorEl.textContent = error.code === "EMAIL_EXISTS"
        ? "An account with this email already exists."
        : (error.message || "Could not create the account.");
      errorEl.hidden = false;
      saveButton.disabled = false; saveButton.textContent = "Create account";
    }
  });
}

async function accountDetail(userId, email, name, accountState = null) {
  const [students, enrollments, schedules, programs] = await Promise.all([
    adminData.read("students", {
      filters: [{ field: "user_id", operator: "eq", value: userId }],
      order: [{ field: "created_at", direction: "desc" }],
    }),
    adminData.read("enrollments", {
      filters: [{ field: "user_id", operator: "eq", value: userId }],
      order: [{ field: "created_at", direction: "desc" }],
    }),
    adminData.read("class_schedules", {
      filters: [{ field: "active", operator: "eq", value: true }],
      order: [{ field: "created_at", direction: "desc" }],
    }),
    adminData.read("programs", { order: [{ field: "sort_order", direction: "asc" }] }),
  ]);
  const programName = (id) => programs.find((p) => p.id === id)?.name || "-";
  const scheduleLabel = (s) => `${programName(s.program_id)} - ${s.day_of_week} ${formatTime(s.start_time)} (${s.age_group})`;
  const studentRows = students.map((s) => `<tr>
    <td>${esc(s.name)}</td><td>${esc(s.age ?? "-")}</td><td>${esc(s.dob ?? "-")}</td>
    <td>${button("Edit", `edit-student:${esc(s.id)}`)}</td></tr>`).join("");
  const enrollmentRows = enrollments.map((en) => {
    const schedule = schedules.find((s) => s.id === en.schedule_id);
    return `<tr>
      <td>${esc(en.student_name)}</td>
      <td>${esc(schedule ? scheduleLabel(schedule) : "-")}</td>
      <td><span class="status-badge status-${esc(en.status)}">${esc(en.status)}</span></td>
      <td>${esc(en.num_classes_enrolled ?? 0)}</td>
      <td>${button("Edit credits", `edit-credits:${esc(en.id)}:${esc(en.num_classes_enrolled ?? 0)}`)}</td>
    </tr>`;
  }).join("");
  const studentOptions = students.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
  const scheduleOptions = schedules.map((s) => `<option value="${esc(s.id)}">${esc(scheduleLabel(s))}</option>`).join("");
  const needsProfileRecovery = accountState?.profile_saved === false;
  const onboardingLabel = needsProfileRecovery
    ? "Complete setup and resend onboarding"
    : "Resend onboarding emails";
  const recoveryNotice = needsProfileRecovery
    ? `<p class="admin-notice" role="status">This account exists, but its profile setup is incomplete. Complete setup here instead of creating the account again.</p>`
    : "";

  app.innerHTML = `<div class="admin-crud-header">
      <h1>${esc(name || email || "Parent")}</h1><div class="admin-header-actions">${button(onboardingLabel, "resend-onboarding", "btn btn-sm btn-secondary")}${button("← Back to Accounts", "back-to-accounts")}</div></div>
    <p class="muted">${esc(email || "")}</p>
    ${recoveryNotice}
    <div id="form-slot"></div>
    <section><div class="admin-crud-header"><h2>Students</h2>${button("+ Add student", "add-student-form")}</div>
      ${table(["Name", "Age", "DOB", "Actions"], studentRows)}</section>
    <section><div class="admin-crud-header"><h2>Enrollments</h2>
      ${students.length ? button("+ Comp enrollment", "add-enrollment-form") : ""}</div>
      ${table(["Student", "Class", "Status", "Credits", "Actions"], enrollmentRows)}</section>`;
  renderNotification();

  const slot = () => document.querySelector("#form-slot");

  function bindFormEl(onSubmit) {
    const formEl = document.querySelector("#record-form");
    const errorEl = formEl.querySelector("#form-error");
    formEl.querySelector('[data-action="cancel-form"]').addEventListener("click", () => accountDetail(userId, email, name, accountState));
    formEl.addEventListener("submit", async (e) => {
      e.preventDefault();
      const saveButton = formEl.querySelector("[data-save-button]");
      saveButton.disabled = true; saveButton.textContent = "Saving…"; errorEl.hidden = true;
      try {
        await onSubmit(Object.fromEntries(new FormData(e.currentTarget)));
        await accountDetail(userId, email, name);
      } catch (error) {
        errorEl.textContent = error.message || "Could not save. Please try again.";
        errorEl.hidden = false; saveButton.disabled = false; saveButton.textContent = "Save";
      }
    });
  }

  accountViewClick.listen(app, "click", async (event) => {
    const action = event.target.dataset.action || "";
    if (action === "back-to-accounts") { await accounts(); return; }
    if (action === "resend-onboarding") {
      const resendButton = event.target;
      resendButton.disabled = true;
      resendButton.textContent = needsProfileRecovery ? "Completing setup…" : "Resending…";
      try {
        if (needsProfileRecovery) {
          const result = await adminFn("recover-account", {
            user_id: userId,
            email,
            parent_name: name || email,
          });
          notify(getRecoveryMessage(result));
          await accountDetail(userId, email, name, result);
        } else {
          const result = await adminFn("resend-invitation", { user_id: userId });
          notify(getOnboardingDeliveryMessage(result));
          renderNotification();
        }
      } catch (error) {
        alert(error.message || "Could not resend onboarding emails.");
      } finally {
        resendButton.disabled = false;
        resendButton.textContent = onboardingLabel;
      }
      return;
    }

    if (action === "add-student-form" || action.startsWith("edit-student:")) {
      const editing = action.startsWith("edit-student:") ? students.find((s) => s.id === action.split(":")[1]) : null;
      slot().innerHTML = `<form id="record-form" class="admin-form">
        <h3>${editing ? "Edit student" : "Add student"}</h3><p class="auth-error" id="form-error" hidden></p>
        <label>Name<input name="name" required value="${esc(editing?.name || "")}"></label>
        <label>Date of birth<input name="dob" type="date" required value="${esc((editing?.dob || "").slice(0, 10))}"></label>
        <label>Notes<textarea name="notes">${esc(editing?.notes || "")}</textarea></label>
        <div class="form-actions"><button type="submit" class="btn btn-sm" data-save-button>Save</button>
        <button type="button" class="btn btn-sm btn-secondary" data-action="cancel-form">Cancel</button></div></form>`;
      bindFormEl(async (data) => {
        if (editing) await adminFn("update-student", { id: editing.id, name: data.name, dob: data.dob, notes: data.notes });
        else await adminFn("add-student", { user_id: userId, name: data.name, dob: data.dob, notes: data.notes });
        notify(editing ? "Student updated." : "Student added.");
      });
      return;
    }

    if (action === "add-enrollment-form") {
      slot().innerHTML = `<form id="record-form" class="admin-form">
        <h3>Comp enrollment</h3><p class="auth-error" id="form-error" hidden></p>
        <label>Student<select name="student_id" required>${studentOptions}</select></label>
        <label>Class<select name="schedule_id" required>${scheduleOptions}</select></label>
        <label>Number of classes (credits)<input name="num_classes_enrolled" type="number" min="1" required value="8"></label>
        <p class="hint">Creates a confirmed, comped enrollment - no payment.</p>
        <div class="form-actions"><button type="submit" class="btn btn-sm" data-save-button>Create</button>
        <button type="button" class="btn btn-sm btn-secondary" data-action="cancel-form">Cancel</button></div></form>`;
      bindFormEl(async (data) => {
        await adminFn("create-enrollment", {
          user_id: userId, student_id: data.student_id, schedule_id: data.schedule_id,
          num_classes_enrolled: Number(data.num_classes_enrolled),
          student_email: email, parent_name: name,
        });
        notify("Comped enrollment created.");
      });
      return;
    }

    if (action.startsWith("edit-credits:")) {
      const [, enrollmentId, current] = action.split(":");
      slot().innerHTML = `<form id="record-form" class="admin-form">
        <h3>Edit credits</h3><p class="auth-error" id="form-error" hidden></p>
        <label>Number of classes (credits)<input name="num_classes_enrolled" type="number" min="0" required value="${esc(current)}"></label>
        <p class="hint">Credits = classes minus attended sessions. Lowering this below the attended count leaves a negative balance.</p>
        <div class="form-actions"><button type="submit" class="btn btn-sm" data-save-button>Save</button>
        <button type="button" class="btn btn-sm btn-secondary" data-action="cancel-form">Cancel</button></div></form>`;
      bindFormEl(async (data) => {
        await adminFn("set-credits", { enrollment_id: enrollmentId, num_classes_enrolled: Number(data.num_classes_enrolled) });
        notify("Credits updated.");
      });
      return;
    }
  });
}

async function render() { accountViewClick.clear(); if (!guard()) return; renderNav(); try { const id = query(); if (id === "dashboard") await dashboard(); else if (configs[id]) await crud(id); else if (id === "enrollments") await enrollments(); else if (id === "students") await students(); else if (id === "sessions") await sessions(); else if (id === "accounts") await accounts(); else app.innerHTML = `<h1>${id[0].toUpperCase() + id.slice(1)}</h1><p class="muted">Section unavailable.</p>`; renderNotification(); } catch (err) { app.innerHTML = `<p class="auth-error">${esc(err.message)}</p>`; } }
window.addEventListener("hashchange", render); document.querySelector("#admin-logout").addEventListener("click", async () => { await logout(); location.href = "index.html"; }); render();
