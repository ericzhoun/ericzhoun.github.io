// Account page - enrollments, credits, upcoming classes, make-up booking.
// Ported from herfield app/account/AccountPageClient.js, compiled to vanilla JS.
import { apiGet, apiGetByIds, callFunction, formatPrice, formatTime, getQueryParam, compareDayOfWeek } from "./api.js";
import { isLoggedIn, getUser, isAdmin, logout, getToken, refreshToken, requireAuth, claimEnrollments } from "./auth.js";
import { calculateStudentAge } from "./student-age.js";
import { groupEnrollmentsByOrder } from "./enrollment-grouping.js";
import { getContactValue } from "./account-profile.js";

// Require login - redirect to login.html if not authenticated.
const user = requireAuth();

if (user) {

const paymentStatus = getQueryParam("payment");
const registrationStatus = getQueryParam("registration");

const state = {
  user,
  enrollments: [],
  bookings: [],
  sessions: [], // session rows for bookings
  schedules: [],
  programs: [],
  students: [],
  artworkPhotos: [], // artwork metadata rows loaded for display
  loading: true,
  error: "",
  actionError: "",
  currentTab: "enrollments",
  // make-up UI state, keyed by enrollment id
  showMakeup: {}, // { [enrollmentId]: { loading, sessions: [] } | false }
  // profile section state
  profileSaving: false,
  contactDraft: null,
  profile: null,
  // change-password UI state
  pwStep: "idle", // "idle" | "code-sent" | "confirming"
  pwLoading: false,
  pwError: "",
  pwSuccess: false,
  // student form state
  showStudentForm: false,
  editingStudent: null, // student object being edited, or null for add
  studentFormSaving: false,
  studentFormError: "",
  // artwork upload state
  uploadingForStudent: null, // student id currently uploading, or null
  uploadProgress: null,
};

const root = document.getElementById("account-root");
let dataLoadVersion = 0;

function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html != null) e.innerHTML = html;
  return e;
}

function createPasswordCodeInputs() {
  const group = el("div", "password-code-inputs");
  const inputs = Array.from({ length: 6 }, (_, index) => {
    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "numeric";
    input.autocomplete = index === 0 ? "one-time-code" : "off";
    input.maxLength = 1;
    input.className = "code-input";
    input.setAttribute("aria-label", `Digit ${index + 1} of 6`);
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(-1);
      if (input.value && index < inputs.length - 1) inputs[index + 1].focus();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && !input.value && index > 0) {
        inputs[index - 1].value = "";
        inputs[index - 1].focus();
      }
    });
    input.addEventListener("paste", (event) => {
      event.preventDefault();
      const digits = event.clipboardData.getData("text").replace(/\D/g, "");
      digits.slice(0, inputs.length - index).split("").forEach((digit, offset) => {
        inputs[index + offset].value = digit;
      });
      inputs[Math.min(index + digits.length, inputs.length - 1)].focus();
    });
    group.appendChild(input);
    return input;
  });

  return { group, inputs, readCode: () => inputs.map((input) => input.value).join("") };
}

// ---- lookups ----
function getScheduleForSession(sessionId) {
  const sess = state.sessions.find((s) => s.id === sessionId);
  if (!sess) return null;
  return state.schedules.find((sc) => sc.id === sess.schedule_id);
}

function getProgramForSession(sessionId) {
  const sched = getScheduleForSession(sessionId);
  if (!sched) return null;
  return state.programs.find((p) => p.id === sched.program_id);
}

function getSessionDate(sessionId) {
  const sess = state.sessions.find((s) => s.id === sessionId);
  return sess ? sess.class_date : null;
}

function getCreditBalance(enrollment) {
  if (enrollment.status !== "confirmed") return 0;
  const attended = state.bookings.filter(
    (b) => b.enrollment_id === enrollment.id && b.status === "attended"
  ).length;
  return (enrollment.num_classes_enrolled || 0) - attended;
}

function getUpcomingBookings(enrollmentId) {
  return state.bookings
    .filter((b) => b.enrollment_id === enrollmentId && b.status === "scheduled")
    .map((b) => {
      const date = getSessionDate(b.session_id);
      const sched = getScheduleForSession(b.session_id);
      return { ...b, date, schedule: sched };
    })
    .filter((b) => b.date && new Date(b.date) >= new Date(new Date().toDateString()))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

function isWithin24h(sessionId) {
  const date = getSessionDate(sessionId);
  const sched = getScheduleForSession(sessionId);
  if (!date || !sched) return true;
  const sessionDateTime = new Date(date + "T" + sched.start_time + ":00");
  return (sessionDateTime - new Date()) / (1000 * 60 * 60) < 24;
}

// ---- main render ----
function render() {
  root.innerHTML = "";
  state.actionError = ""; // cleared on full re-render

  // Header
  const header = el("div", "account-header");
  header.appendChild(el("h2", "", "My Account"));
  header.appendChild(el("p", "account-email", state.user.email));
  const logoutBtn = el("button", "btn btn-sm", "Log Out");
  logoutBtn.onclick = handleLogout;
  header.appendChild(logoutBtn);
  if (isAdmin()) {
    const adminLink = el("a", "btn btn-sm", "Open Admin CMS");
    adminLink.href = "admin.html";
    header.appendChild(adminLink);
  }
  root.appendChild(header);

  if (paymentStatus === "success") {
    const b = el("div", "payment-success-banner");
    b.appendChild(el("p", "", "✓ Payment successful! Please complete your registration below."));
    root.appendChild(b);
  }
  if (paymentStatus === "cancelled") {
    const b = el("div", "payment-cancel-banner");
    b.appendChild(el("p", "", "Payment was cancelled. You can try again anytime."));
    root.appendChild(b);
  }
  if (registrationStatus === "complete") {
    const b = el("div", "payment-success-banner");
    b.appendChild(el("p", "", "✓ Registration complete! Your enrollment is confirmed."));
    root.appendChild(b);
  }

  // Tab bar
  const tabs = el("div", "account-tabs");
  const tabItems = [
    { key: "enrollments", label: "My Enrollments" },
    { key: "profile", label: "Profile & Security" },
    { key: "students", label: "Students" },
    { key: "artwork", label: "Artwork" },
  ];
  tabItems.forEach((t) => {
    const btn = el("button", `account-tab${state.currentTab === t.key ? " is-active" : ""}`, t.label);
    btn.onclick = () => { state.currentTab = t.key; render(); };
    tabs.appendChild(btn);
  });
  root.appendChild(tabs);

  if (state.currentTab === "enrollments") {
    renderEnrollmentsTab();
    return;
  }
  if (state.currentTab === "profile") {
    renderProfileTab();
    return;
  }
  if (state.currentTab === "students") {
    renderStudentsTab();
    return;
  }
  if (state.currentTab === "artwork") {
    renderArtworkTab();
    return;
  }
}

function renderEnrollmentsTab() {
  root.appendChild(el("h3", "", "My Enrollments"));

  if (state.loading) {
    root.appendChild(el("p", "muted", "Loading…"));
    return;
  }
  if (state.error) {
    root.appendChild(el("p", "auth-error", state.error));
    return;
  }
  if (state.enrollments.length === 0) {
    const empty = el("div", "empty-state");
    empty.appendChild(el("p", "", "You haven't enrolled in any classes yet."));
    const browse = el("a", "btn", "Browse Classes");
    browse.href = "schedule.html";
    empty.appendChild(browse);
    root.appendChild(empty);
    return;
  }

  const list = el("div", "enrollment-list");
  groupEnrollmentsByOrder(state.enrollments).forEach((rows) => {
    list.appendChild(rows.length > 1 ? renderEnrollmentGroupCard(rows) : renderEnrollmentCard(rows[0]));
  });
  root.appendChild(list);
}

function renderEnrollmentCardHeader(rows, program) {
  const first = rows[0];
  const cardHeader = el("div", "enrollment-card-header");
  const info = el("div", "enrollment-info");
  info.appendChild(el("h4", "", program ? program.name : first.student_name));
  info.appendChild(el("p", "muted", first.student_email || ""));
  if (rows.length > 1) {
    const days = rows
      .map((en) => state.schedules.find((s) => s.id === en.schedule_id)?.day_of_week)
      .filter(Boolean)
      .sort(compareDayOfWeek);
    info.appendChild(el("p", "muted enrollment-group-days", days.join(", ")));
  }
  const totalClasses = rows.reduce((sum, en) => sum + (en.num_classes_enrolled || 0), 0);
  const totalPaid = rows.reduce((sum, en) => sum + (en.total_paid_cents || 0), 0);
  if (totalClasses) {
    info.appendChild(el("p", "muted",
      `${totalClasses} classes purchased` + (totalPaid ? ` · ${formatPrice(totalPaid)} paid` : "")));
  }
  cardHeader.appendChild(info);

  const statusCol = el("div", "enrollment-status");
  statusCol.appendChild(el("span", `status-badge status-${first.status}`, first.status));
  if (first.registration_complete) {
    statusCol.appendChild(el("span", "status-badge status-registered", "Registered"));
  } else {
    const reg = el("a", "btn btn-sm", "Complete Registration");
    reg.href = `registration.html?enrollment=${first.id}`;
    statusCol.appendChild(reg);
  }
  cardHeader.appendChild(statusCol);
  return cardHeader;
}

function renderEnrollmentDayDetail(en) {
  const creditBalance = getCreditBalance(en);
  const upcoming = getUpcomingBookings(en.id);
  const frag = document.createDocumentFragment();

  if (en.status === "confirmed") {
    const credit = el("div", `credit-balance ${creditBalance < 0 ? "credit-negative" : "credit-positive"}`);
    credit.appendChild(el("span", "credit-label", "Credits Remaining"));
    credit.appendChild(el("span", "credit-value", String(creditBalance)));
    frag.appendChild(credit);
  } else if (en.status === "pending") {
    frag.appendChild(el("p", "muted",
      "Payment pending - credits will be available once payment is confirmed."));
  } else {
    frag.appendChild(el("p", "muted", "This enrollment was cancelled."));
  }

  if (en.status === "confirmed" && upcoming.length > 0) {
    const wrap = el("div", "upcoming-classes");
    wrap.appendChild(el("h5", "", "Upcoming Classes"));
    upcoming.forEach((b) => {
      const within24 = isWithin24h(b.session_id);
      const sess = state.sessions.find((s) => s.id === b.session_id);
      const row = el("div", "upcoming-class-row");

      const left = el("div", "upcoming-class-info");
      left.appendChild(el("span", "upcoming-class-date",
        new Date(b.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })));
      left.appendChild(el("span", "muted",
        b.schedule ? `${formatTime(b.schedule.start_time)}–${formatTime(b.schedule.end_time)}` : ""));
      left.appendChild(el("span", `booking-type-badge booking-type-${b.type}`,
        b.type === "home" ? "Home" : "Make-up"));
      row.appendChild(left);

      const actions = el("div", "upcoming-class-actions");
      if (b.type === "home") {
        const skipBtn = el("button", "btn btn-sm btn-secondary", "Skip");
        skipBtn.disabled = within24;
        skipBtn.title = within24 ? "Cannot skip within 24h of class" : "";
        skipBtn.onclick = () => handleSkip(en.id, b.session_id);
        actions.appendChild(skipBtn);
      } else {
        const cancelBtn = el("button", "btn btn-sm btn-danger", "Cancel");
        cancelBtn.disabled = within24;
        cancelBtn.title = within24 ? "Cannot cancel within 24h of class" : "";
        cancelBtn.onclick = () => handleCancelMakeup(en.id, b.session_id);
        actions.appendChild(cancelBtn);
      }
      row.appendChild(actions);

      if (sess?.status === "cancelled") {
        row.appendChild(el("span", "status-badge status-cancelled", "Session Cancelled"));
      }
      wrap.appendChild(row);
    });
    frag.appendChild(wrap);
  }

  if (en.status === "confirmed") {
    frag.appendChild(renderMakeupSection(en));
  }

  return frag;
}

function renderEnrollmentCard(en) {
  const sched = state.schedules.find((s) => s.id === en.schedule_id);
  const program = state.programs.find((p) => p.id === sched?.program_id);

  const card = el("div", "enrollment-card enrollment-card-expanded");
  card.appendChild(renderEnrollmentCardHeader([en], program));
  card.appendChild(renderEnrollmentStudentAssignment(en));
  card.appendChild(renderEnrollmentDayDetail(en));
  return card;
}

function renderEnrollmentGroupCard(rows) {
  const first = rows[0];
  const sched = state.schedules.find((s) => s.id === first.schedule_id);
  const program = state.programs.find((p) => p.id === sched?.program_id);

  const card = el("div", "enrollment-card enrollment-card-expanded enrollment-group-card");
  card.appendChild(renderEnrollmentCardHeader(rows, program));
  card.appendChild(renderEnrollmentStudentAssignment(first));

  rows.forEach((en) => {
    const daySched = state.schedules.find((s) => s.id === en.schedule_id);
    const dayBlock = el("div", "enrollment-day-block");
    if (daySched?.day_of_week) {
      dayBlock.appendChild(el("h5", "enrollment-day-label", daySched.day_of_week));
    }
    dayBlock.appendChild(renderEnrollmentDayDetail(en));
    card.appendChild(dayBlock);
  });

  return card;
}

function renderEnrollmentStudentAssignment(en) {
  const section = el("div", "enrollment-student-assignment");
  const assignedStudent = state.students.find((student) => student.id === en.student_id);

  if (state.students.length === 0) {
    section.appendChild(el("p", "muted", "Add this student to associate the enrollment with their profile."));
    const addStudent = el("button", "btn btn-sm btn-secondary", "Add Student");
    addStudent.onclick = () => {
      state.currentTab = "students";
      state.showStudentForm = true;
      state.editingStudent = null;
      render();
    };
    section.appendChild(addStudent);
    return section;
  }

  const label = el("label", "", "Associate with student");
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Associate enrollment with student");
  if (!assignedStudent) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose a student";
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);
  }
  state.students.forEach((student) => {
    const option = document.createElement("option");
    option.value = student.id;
    option.textContent = student.name;
    option.selected = student.id === en.student_id;
    select.appendChild(option);
  });
  label.appendChild(select);
  section.appendChild(label);

  if (assignedStudent) {
    section.appendChild(el("p", "muted", `Currently associated with ${escapeHtml(assignedStudent.name)}.`));
  }

  const save = el("button", "btn btn-sm btn-secondary", assignedStudent ? "Change Student" : "Associate Student");
  save.disabled = !select.value;
  select.onchange = () => { save.disabled = !select.value; };
  save.onclick = () => assignEnrollmentStudent(en, select.value);
  section.appendChild(save);
  return section;
}

function renderMakeupSection(en) {
  const section = el("div", "makeup-section");
  const makeupState = state.showMakeup[en.id];
  const btn = el("button", "btn btn-sm",
    makeupState ? "Hide Make-up Options" : "Book a Make-up Class");
  btn.onclick = () => {
    if (makeupState) {
      delete state.showMakeup[en.id];
      render();
    } else {
      loadMakeupSessions(en);
    }
  };
  section.appendChild(btn);

  if (makeupState) {
    const list = el("div", "makeup-list");
    if (makeupState.loading) {
      list.appendChild(el("p", "muted", "Loading available sessions…"));
    } else if (makeupState.sessions.length === 0) {
      list.appendChild(el("p", "muted", "No make-up sessions available right now. Check back later!"));
    } else {
      makeupState.sessions.forEach((sess) => {
        const row = el("div", "makeup-session-row");
        const info = el("div", "makeup-session-info");
        info.appendChild(el("span", "makeup-session-date",
          new Date(sess.class_date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })));
        info.appendChild(el("span", "muted",
          `${formatTime(sess.schedule.start_time)}–${formatTime(sess.schedule.end_time)}`));
        info.appendChild(el("span", "muted", sess.schedule.age_group));
        info.appendChild(el("span", "muted", `${sess.available} spots open`));
        row.appendChild(info);

        const bookBtn = el("button", "btn btn-sm", "Book");
        bookBtn.onclick = () => handleBookMakeup(en.id, sess.id);
        row.appendChild(bookBtn);
        list.appendChild(row);
      });
    }
    section.appendChild(list);
  }
  return section;
}

// ==== Profile & Security Tab ====
function renderProfileTab() {
  // Contact info section
  root.appendChild(el("h3", "", "Contact Information"));

  // Fall back to legacy enrollment fields when the parent has no durable profile yet.
  const en = state.enrollments[0] || {};
  const form = el("div", "profile-form");

  const fields = [
    { key: "parent_name", label: "Parent / Guardian Name" },
    { key: "student_phone", label: "Phone" },
    { key: "emergency_contact", label: "Emergency Contact" },
    { key: "allergies", label: "Allergies / Notes" },
  ];
  fields.forEach((f) => {
    const label = el("label", "", f.label);
    let input = document.createElement("input");
    if (f.key === "allergies") {
      input = document.createElement("textarea");
      input.rows = 2;
    } else {
      input.type = "text";
    }
    input.name = f.key;
    input.value = getContactValue({
      draft: state.contactDraft,
      profile: state.profile,
      enrollment: en,
    }, f.key);
    input.oninput = (event) => {
      state.contactDraft = { ...(state.contactDraft || {}), [f.key]: event.target.value };
    };
    if (state.profileSaving) input.disabled = true;
    label.appendChild(input);
    form.appendChild(label);
  });
  const saveBtn = el("button", "btn btn-sm", state.profileSaving ? "Saving…" : "Save Contact Info");
  saveBtn.disabled = state.profileSaving;
  saveBtn.onclick = handleSaveContact;
  form.appendChild(saveBtn);
  if (state.actionError) form.appendChild(el("p", "auth-error action-error", state.actionError));
  root.appendChild(form);

  // Change password section
  root.appendChild(el("h3", "", "Change Password"));
  const pwSection = el("div", "password-section");

  if (state.pwSuccess) {
    pwSection.appendChild(el("p", "auth-info", "✓ Password changed successfully. Please log in again."));
    const loginLink = el("a", "btn btn-sm", "Log In");
    loginLink.href = "login.html";
    pwSection.appendChild(loginLink);
    root.appendChild(pwSection);
    return;
  }

  if (state.pwError) pwSection.appendChild(el("p", "auth-error", state.pwError));

  if (state.pwStep === "idle") {
    const desc = el("p", "muted", "We'll email a 6-digit code to " + escapeHtml(state.user.email) + " to verify your identity.");
    pwSection.appendChild(desc);
    const sendBtn = el("button", "btn btn-sm", state.pwLoading ? "Sending…" : "Send Reset Code");
    sendBtn.disabled = state.pwLoading;
    sendBtn.onclick = handlePwInit;
    pwSection.appendChild(sendBtn);
  } else {
    const codeLabel = el("label", "", "6-digit code");
    const { group: codeInputGroup, inputs: codeInputs, readCode } = createPasswordCodeInputs();
    codeLabel.appendChild(codeInputGroup);
    pwSection.appendChild(codeLabel);
    requestAnimationFrame(() => codeInputs[0].focus());

    const pwLabel = el("label", "", "New password");
    const pwInput = document.createElement("input");
    pwInput.type = "password";
    pwInput.name = "new_password";
    pwInput.required = true;
    pwInput.placeholder = "At least 8 characters";
    pwLabel.appendChild(pwInput);
    pwSection.appendChild(pwLabel);

    const pwLabel2 = el("label", "", "Confirm new password");
    const pwInput2 = document.createElement("input");
    pwInput2.type = "password";
    pwInput2.name = "new_password_confirm";
    pwInput2.required = true;
    pwInput2.placeholder = "Re-enter password";
    pwLabel2.appendChild(pwInput2);
    pwSection.appendChild(pwLabel2);

    const confirmBtn = el("button", "btn btn-sm", state.pwLoading ? "Resetting…" : "Reset Password");
    confirmBtn.disabled = state.pwLoading;
    confirmBtn.onclick = () => handlePwConfirm(readCode(), pwInput.value, pwInput2.value);
    pwSection.appendChild(confirmBtn);

    const resend = el("button", "btn btn-sm btn-secondary", "Resend code");
    resend.style.marginTop = "0.5rem";
    resend.onclick = handlePwInit;
    pwSection.appendChild(resend);
  }
  root.appendChild(pwSection);
}

async function handleSaveContact() {
  // Capture typed values before render() replaces the form with its saved values.
  const form = root.querySelector(".profile-form");
  if (!form) return;
  const body = { ...(state.contactDraft || {}) };
  ["parent_name", "student_phone", "emergency_contact", "allergies"].forEach((key) => {
    const input = form.querySelector(`[name="${key}"]`);
    if (!(key in body)) body[key] = input ? input.value.trim() : "";
  });

  state.profileSaving = true;
  state.actionError = "";
  render();
  try {
    const token = await refreshToken();
    const result = await callFunction("manage-account", { action: "update-contact", ...body }, token);
    state.contactDraft = null;
    state.profile = result.profile || null;
    state.actionError = "";
    await loadData(); // refresh enrollments and other compatibility data
  } catch (err) {
    showActionError(err.message);
  } finally {
    state.profileSaving = false;
    render();
  }
}

async function handlePwInit() {
  state.pwLoading = true;
  state.pwError = "";
  render();
  try {
    const token = await refreshToken();
    await callFunction("manage-account", { action: "change-password-init" }, token);
    state.pwStep = "code-sent";
  } catch (err) {
    state.pwError = err.message;
  } finally {
    state.pwLoading = false;
    render();
  }
}

async function handlePwConfirm(code, newPassword, confirmPassword) {
  state.pwLoading = true;
  state.pwError = "";
  render();
  if (!code || code.length < 6) { state.pwError = "Enter the 6-digit code"; state.pwLoading = false; render(); return; }
  if (!newPassword || newPassword.length < 8) { state.pwError = "Password must be at least 8 characters"; state.pwLoading = false; render(); return; }
  if (newPassword !== confirmPassword) { state.pwError = "Passwords do not match"; state.pwLoading = false; render(); return; }
  try {
    const token = await refreshToken();
    await callFunction("manage-account", { action: "change-password-confirm", code, new_password: newPassword }, token);
    state.pwSuccess = true;
  } catch (err) {
    state.pwError = err.message;
  } finally {
    state.pwLoading = false;
    render();
  }
}

// ==== Students Tab ====
function renderStudentsTab() {
  const section = el("div", "students-section");
  section.appendChild(el("h3", "", "My Students"));

  if (state.students.length === 0 && !state.showStudentForm) {
    section.appendChild(el("p", "muted", "Add your children to manage their profiles and see their artwork."));
  }

  // Student cards
  state.students.forEach((s) => {
    const card = el("div", "student-card");
    const info = el("div", "student-info");
    info.appendChild(el("h4", "", escapeHtml(s.name)));
    const details = [];
    if (s.age) details.push(`Age: ${escapeHtml(s.age)}`);
    if (s.dob) details.push(`DOB: ${escapeHtml(s.dob)}`);
    if (s.notes) details.push(escapeHtml(s.notes));
    info.appendChild(el("p", "muted", details.join(" · ") || "No details"));
    card.appendChild(info);

    const actions = el("div", "student-card-actions");
    const editBtn = el("button", "btn btn-sm btn-secondary", "Edit");
    editBtn.onclick = () => { state.editingStudent = s; state.showStudentForm = true; state.studentFormError = ""; render(); };
    actions.appendChild(editBtn);
    const delBtn = el("button", "btn btn-sm btn-danger", "Delete");
    delBtn.onclick = () => handleDeleteStudent(s.id);
    actions.appendChild(delBtn);
    card.appendChild(actions);
    section.appendChild(card);
  });

  // Add / Edit form
  if (state.showStudentForm) {
    const form = el("div", "student-form");
    form.appendChild(el("h4", "", state.editingStudent ? "Edit Student" : "Add Student"));
    if (state.studentFormError) form.appendChild(el("p", "auth-error", state.studentFormError));

    const nameL = el("label", "", "Name");
    const nameI = document.createElement("input"); nameI.type = "text"; nameI.name = "name";
    nameI.value = state.editingStudent?.name || ""; nameI.required = true;
    if (state.studentFormSaving) nameI.disabled = true;
    nameL.appendChild(nameI); form.appendChild(nameL);

    const dobL = el("label", "", "Date of Birth");
    const dobI = document.createElement("input"); dobI.type = "date"; dobI.name = "dob";
    dobI.value = state.editingStudent?.dob || ""; dobI.required = true;
    dobI.max = new Date().toISOString().slice(0, 10);
    if (state.studentFormSaving) dobI.disabled = true;
    dobL.appendChild(dobI); form.appendChild(dobL);

    const ageL = el("label", "", "Age");
    const ageI = document.createElement("input"); ageI.type = "text"; ageI.name = "age";
    ageI.readOnly = true;
    const updateAge = () => {
      const age = calculateStudentAge(dobI.value);
      ageI.value = age == null ? "" : String(age);
    };
    updateAge();
    dobI.oninput = () => updateAge();
    ageL.appendChild(ageI); form.appendChild(ageL);

    const notesL = el("label", "", "Notes (allergies, interests)");
    const notesI = document.createElement("textarea"); notesI.name = "notes"; notesI.rows = 2;
    notesI.value = state.editingStudent?.notes || "";
    notesL.appendChild(notesI); form.appendChild(notesL);

    const saveBtn = el("button", "btn btn-sm", state.studentFormSaving ? "Saving…" : "Save");
    saveBtn.disabled = state.studentFormSaving;
    saveBtn.onclick = () => handleSaveStudent(
      form.querySelector('[name="name"]').value.trim(),
      form.querySelector('[name="dob"]').value.trim(),
      form.querySelector('[name="notes"]').value.trim()
    );
    form.appendChild(saveBtn);

    const cancelBtn = el("button", "btn btn-sm btn-secondary", "Cancel");
    cancelBtn.onclick = () => { state.showStudentForm = false; state.editingStudent = null; state.studentFormError = ""; render(); };
    form.appendChild(cancelBtn);
    section.appendChild(form);
  } else {
    const addBtn = el("button", "btn btn-sm", "Add Student");
    addBtn.onclick = () => { state.showStudentForm = true; state.editingStudent = null; state.studentFormError = ""; render(); };
    section.appendChild(addBtn);
  }
  root.appendChild(section);
}

async function loadStudents() {
  try {
    const token = await refreshToken();
    const data = await callFunction("manage-students", { action: "list" }, token);
    state.students = data.students || [];
  } catch (err) {
    console.warn("Could not load students", err);
    state.students = [];
  }
}

async function handleSaveStudent(name, dob, notes) {
  if (!name) { state.studentFormError = "Name is required"; render(); return; }
  if (calculateStudentAge(dob) == null) {
    state.studentFormError = "A valid date of birth is required";
    render();
    return;
  }
  state.studentFormSaving = true;
  state.studentFormError = "";
  render();
  try {
    const token = await refreshToken();
    if (state.editingStudent) {
      await callFunction("manage-students", { action: "update", id: state.editingStudent.id, name, dob, notes }, token);
    } else {
      await callFunction("manage-students", { action: "add", name, dob, notes }, token);
    }
    state.showStudentForm = false;
    state.editingStudent = null;
    await loadStudents();
    if (state.currentTab === "artwork") await loadArtwork();
  } catch (err) {
    state.studentFormError = err.message;
  } finally {
    state.studentFormSaving = false;
    render();
  }
}

async function handleDeleteStudent(studentId) {
  if (!confirm("Delete this student and all their artwork photos?")) return;
  try {
    const token = await refreshToken();
    await callFunction("manage-students", { action: "delete", id: studentId }, token);
    state.students = state.students.filter((s) => s.id !== studentId);
    state.artworkPhotos = state.artworkPhotos.filter((p) => p.student_id !== studentId);
    render();
  } catch (err) {
    showActionError(err.message);
  }
}

async function assignEnrollmentStudent(en, studentId) {
  try {
    const token = await refreshToken();
    const data = await callFunction("manage-students", {
      action: "assign-enrollment", enrollment_id: en.id, student_id: studentId,
    }, token);
    en.student_id = data.enrollment.student_id;
    render();
  } catch (err) {
    showActionError(err.message);
  }
}

// ==== Artwork Tab ====
function renderArtworkTab() {
  const section = el("div", "artwork-section");
  section.appendChild(el("h3", "", "Children's Artwork"));

  if (state.students.length === 0) {
    section.appendChild(el("p", "muted", "Add students first to see and upload artwork. Go to the Students tab to add your children."));
    root.appendChild(section);
    return;
  }

  // Student artwork gallery - one gallery per student.
  state.students.forEach((student) => {
    const photos = state.artworkPhotos.filter((p) => p.student_id === student.id);
    const gallery = el("div", "artwork-gallery");

    const header = el("div", "artwork-gallery-header");
    header.appendChild(el("h4", "", escapeHtml(student.name)));

    // Upload button
    const uploadBtn = el("button", "btn btn-sm",
      state.uploadingForStudent === student.id ? "Uploading…" : "Upload Photo");
    uploadBtn.disabled = state.uploadingForStudent === student.id;
    uploadBtn.onclick = () => handleArtworkUpload(student.id);
    header.appendChild(uploadBtn);
    gallery.appendChild(header);

    if (photos.length === 0) {
      gallery.appendChild(el("p", "muted", "No photos yet."));
    } else {
      const grid = el("div", "artwork-grid");
      photos.forEach((photo) => {
        const thumb = el("button", "artwork-thumb", "");
        thumb.type = "button";
        thumb.setAttribute("aria-label", photo.caption ? `Artwork: ${escapeHtml(photo.caption)}` : "Student artwork");
        if (photo.download_url) {
          const img = document.createElement("img");
          img.src = photo.download_url;
          img.alt = photo.caption || "Student artwork";
          img.loading = "lazy";
          thumb.appendChild(img);
        } else {
          thumb.appendChild(el("span", "muted", "Loading…"));
        }
        thumb.onclick = () => openLightbox(photo.download_url || "", photo.caption || "Student artwork");

        // Delete button (overlay)
        const del = el("button", "artwork-thumb-delete", "×");
        del.type = "button";
        del.setAttribute("aria-label", "Delete photo");
        del.onclick = (e) => { e.stopPropagation(); handleDeleteArtwork(photo.id, student.id); };
        thumb.appendChild(del);

        if (photo.caption) {
          const cap = el("span", "artwork-thumb-caption", escapeHtml(photo.caption));
          thumb.appendChild(cap);
        }
        grid.appendChild(thumb);
      });
      gallery.appendChild(grid);
    }
    section.appendChild(gallery);
  });

  root.appendChild(section);
}

async function loadArtwork() {
  if (state.students.length === 0) { state.artworkPhotos = []; return; }
  try {
    const token = await refreshToken();
    // Fetch all artwork photo metadata (RLS filters to own students).
    const photos = await apiGet("artwork_photos?order=created_at.desc", token);
    if (photos.length === 0) { state.artworkPhotos = []; return; }
    // Resolve download URLs in parallel.
    const photoIds = photos.map((p) => p.id);
    const data = await callFunction("manage-artwork", { action: "download-urls", photo_ids: photoIds }, token);
    state.artworkPhotos = data.photos || [];
  } catch (err) {
    console.warn("Could not load artwork", err);
    state.artworkPhotos = [];
  }
}

async function handleArtworkUpload(studentId) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { showActionError("File too large (10 MB max)"); return; }
    state.uploadingForStudent = studentId;
    render();
    try {
      const token = await refreshToken();
      // Request presigned upload URL.
      const upData = await callFunction("manage-artwork", {
        action: "upload-url",
        student_id: studentId,
        filename: file.name,
        content_type: file.type || "image/jpeg",
        size_bytes: file.size,
      }, token);
      // Upload the file bytes to the presigned URL.
      await fetch(upData.upload_url, {
        method: "PUT",
        headers: { "Content-Type": file.type || "image/jpeg" },
        body: file,
      });
      // Refresh the artwork list.
      await loadArtwork();
    } catch (err) {
      showActionError(err.message);
    } finally {
      state.uploadingForStudent = null;
      render();
    }
  };
  input.click();
}

async function handleDeleteArtwork(photoId, studentId) {
  if (!confirm("Delete this photo?")) return;
  try {
    const token = await refreshToken();
    await callFunction("manage-artwork", { action: "delete", photo_id: photoId }, token);
    state.artworkPhotos = state.artworkPhotos.filter((p) => p.id !== photoId);
    render();
  } catch (err) {
    showActionError(err.message);
  }
}

// ==== Lightbox ====
function initLightbox() {
  const dialog = document.getElementById("account-lightbox");
  const lightboxImg = document.getElementById("account-lightbox-img");
  const closeBtn = document.getElementById("account-lightbox-close");
  if (!dialog || !lightboxImg || !closeBtn) return;
  closeBtn.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  // Store ref so openLightbox can use it.
  window._accountLightbox = dialog;
  window._accountLightboxImg = lightboxImg;
}

function openLightbox(src, alt) {
  const dialog = window._accountLightbox;
  const img = window._accountLightboxImg;
  if (!dialog || !img) return;
  img.src = src;
  img.alt = alt;
  dialog.showModal();
}

// ==== Utilities ====
function escapeHtml(s) {
  if (!s) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---- actions ----
async function handleLogout() {
  await logout();
  window.location.href = "index.html";
}

async function handleSkip(enrollmentId, sessionId) {
  await doBookAction("skip", enrollmentId, sessionId);
}

async function handleCancelMakeup(enrollmentId, sessionId) {
  await doBookAction("cancel", enrollmentId, sessionId);
}

async function handleBookMakeup(enrollmentId, sessionId) {
  await doBookAction("makeup", enrollmentId, sessionId);
}

async function doBookAction(action, enrollmentId, sessionId) {
  // optimistic: disable nothing globally - just reload on success/failure
  try {
    const token = getToken();
    await callFunction("book-class", {
      action,
      enrollment_id: enrollmentId,
      session_id: sessionId,
    }, token);
    delete state.showMakeup[enrollmentId];
    await loadData();
  } catch (err) {
    showActionError(err.message);
  }
}

function showActionError(msg) {
  // Insert an action-error banner at the top of the root, below the header.
  const existing = root.querySelector(".action-error");
  if (existing) existing.remove();
  const banner = el("p", "auth-error action-error", msg);
  const header = root.querySelector(".account-header");
  if (header && header.nextSibling) {
    root.insertBefore(banner, header.nextSibling);
  } else {
    root.appendChild(banner);
  }
}

async function loadMakeupSessions(enrollment) {
  state.showMakeup[enrollment.id] = { loading: true, sessions: [] };
  render();
  try {
    const token = getToken();
    const sched = state.schedules.find((s) => s.id === enrollment.schedule_id);
    if (!sched) {
      state.showMakeup[enrollment.id] = { loading: false, sessions: [] };
      render();
      return;
    }
    const progSchedules = state.schedules.filter((s) => s.program_id === sched.program_id);
    const schedIds = progSchedules.map((s) => s.id);

    const today = new Date().toISOString().split("T")[0];
    const sessPromises = schedIds.map((sid) =>
      apiGet(`class_sessions?schedule_id=eq.${sid}&class_date=gte.${today}&status=eq.scheduled&order=class_date.asc`, token)
    );
    const allSessions = (await Promise.all(sessPromises)).flat();

    const now = new Date();
    const available = allSessions.filter((sess) => {
      const s = state.schedules.find((sc) => sc.id === sess.schedule_id);
      if (!s) return false;
      const dt = new Date(sess.class_date + "T" + s.start_time + ":00");
      if ((dt - now) / (1000 * 60 * 60) < 24) return false;
      const alreadyBooked = state.bookings.some(
        (b) => b.session_id === sess.id && b.enrollment_id === enrollment.id && b.status === "scheduled"
      );
      return !alreadyBooked;
    });

    const withCapacity = await Promise.all(
      available.map(async (sess) => {
        const s = state.schedules.find((sc) => sc.id === sess.schedule_id);
        try {
          const bks = await apiGet(`bookings?session_id=eq.${sess.id}&status=in.(scheduled,attended)&select=id`, token);
          const booked = bks.length;
          return { ...sess, schedule: s, booked, available: s.max_seats - booked };
        } catch {
          return { ...sess, schedule: s, booked: 0, available: s.max_seats };
        }
      })
    );

    state.showMakeup[enrollment.id] = { loading: false, sessions: withCapacity.filter((s) => s.available > 0) };
  } catch (err) {
    state.showMakeup[enrollment.id] = { loading: false, sessions: [] };
    showActionError(err.message);
  }
  render();
}

function refreshAfterClaims() {
  claimEnrollments().then((claimed) => {
    if (claimed.length > 0) loadData();
  });
}

function syncPendingPayments(pending, token) {
  if (pending.length === 0) return;
  Promise.all(pending.map(async (enrollment) => {
    try {
      return await callFunction("sync-enrollment-payment", { enrollment_id: enrollment.id }, token);
    } catch {
      return null;
    }
  })).then((results) => {
    if (results.some((result) => result?.synced)) loadData();
  });
}

async function loadAccountDetails(token, version) {
  const sessionIds = [...new Set(state.bookings.map((booking) => booking.session_id).filter(Boolean))];
  const enrollmentScheduleIds = [...new Set(state.enrollments.map((enrollment) => enrollment.schedule_id).filter(Boolean))];

  try {
    const sessions = await apiGetByIds("class_sessions", sessionIds, token);
    if (version !== dataLoadVersion) return;

    const scheduleIds = [...new Set([
      ...enrollmentScheduleIds,
      ...sessions.map((session) => session.schedule_id).filter(Boolean),
    ])];
    const schedules = await apiGetByIds("class_schedules", scheduleIds, token);
    if (version !== dataLoadVersion) return;

    const programIds = [...new Set(schedules.map((schedule) => schedule.program_id).filter(Boolean))];
    const programs = await apiGetByIds("programs", programIds, token);
    if (version !== dataLoadVersion) return;

    state.sessions = sessions;
    state.schedules = schedules;
    state.programs = programs;
  } catch (err) {
    // The account itself is usable without these display details. Keep the
    // primary enrollment data visible and allow the next refresh to retry.
    console.warn("Could not load account schedule details", err);
  } finally {
    if (version === dataLoadVersion) render();
  }
}

// ---- data load ----
async function loadData() {
  const version = ++dataLoadVersion;
  state.loading = true;
  state.error = "";
  render();
  try {
    // Access tokens expire. Refresh before any protected account request so a
    // previously signed-in parent never sees a raw 401 response.
    const token = await refreshToken();
    if (!token) {
      const here = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `login.html?next=${here}`;
      return;
    }

    const [ens, bks, profiles] = await Promise.all([
      apiGet("enrollments?order=created_at.desc", token),
      apiGet("bookings?order=booked_at.desc", token),
      apiGet("parent_profiles?select=user_id,email,parent_name,student_phone,emergency_contact,allergies&limit=1", token),
    ]);
    state.enrollments = ens;
    state.bookings = bks;
    state.profile = profiles[0] || null;

    const pending = state.enrollments.filter((e) => e.status === "pending" && e.id);
    refreshAfterClaims();
    syncPendingPayments(pending, token);
    void loadAccountDetails(token, version);

    // Load student profiles and artwork for the new tabs.
    await loadStudents();
    await loadArtwork();
  } catch (err) {
    state.error = err.message;
  } finally {
    state.loading = false;
    render();
  }
}

loadData();
initLightbox();
} else {
  const root = document.getElementById("account-root");
  const here = encodeURIComponent(window.location.pathname + window.location.search);
  root.innerHTML = `<p class="auth-error">Your session has expired. <a href="login.html?next=${here}">Log in to view your account.</a></p>`;
}
