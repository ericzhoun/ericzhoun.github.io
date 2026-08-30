// Trial / drop-in booking modal for the schedule page.
// Self-initializing module: a delegated click handler on #calendar-root so it
// covers both the desktop grid and the mobile list. Talks to the public
// list-trial-sessions / book-trial functions (no auth required).
import { listTrialSessions, bookTrial, formatTime } from "./api.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let overlay = null;

function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html != null) e.innerHTML = html;
  return e;
}

function closeModal() {
  if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  overlay = null;
}

function setBoxError(box, msg) {
  let p = box.querySelector(".trial-error");
  if (!p) {
    p = el("p", "auth-error trial-error");
    box.appendChild(p);
  }
  p.textContent = msg;
}

function openModal(scheduleId) {
  closeModal();
  overlay = el("div", "trial-modal-overlay");
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });

  const box = el("div", "trial-modal");
  const close = el("button", "trial-modal-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.onclick = closeModal;
  box.appendChild(close);

  box.appendChild(el("h3", "", "Book a Free Trial Class"));
  box.appendChild(el("p", "muted", "Pick a date — your first class is free, no card required."));

  const dateWrap = el("div", "trial-dates");
  box.appendChild(dateWrap);
  const form = el("form", "trial-form");
  box.appendChild(form);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  loadDates(scheduleId, dateWrap, form, box);
}

async function loadDates(scheduleId, dateWrap, form, box) {
  dateWrap.appendChild(el("p", "muted", "Loading available dates…"));
  try {
    const data = await listTrialSessions(scheduleId);
    dateWrap.innerHTML = "";
    const sessions = (data && data.sessions) || [];
    if (sessions.length === 0) {
      dateWrap.appendChild(el("p", "", "No trial dates available right now. Please check back soon."));
      return;
    }
    let selected = null;
    sessions.forEach((s) => {
      const disabled = s.available <= 0;
      const label = el("label", "trial-date" + (disabled ? " is-full" : ""));
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "trial-date";
      radio.value = s.class_date;
      radio.disabled = disabled;
      radio.onchange = () => { selected = s.class_date; };
      label.appendChild(radio);
      label.appendChild(document.createTextNode(
        `${s.class_date} · ${formatTime(s.start_time)}–${formatTime(s.end_time)} (${s.available} of ${s.max_seats} spots)`
      ));
      dateWrap.appendChild(label);
      if (!disabled && !selected) { selected = s.class_date; radio.checked = true; }
    });
    renderForm(scheduleId, form, box, () => selected);
  } catch (err) {
    dateWrap.innerHTML = "";
    dateWrap.appendChild(el("p", "auth-error", (err && err.message) || "Could not load dates."));
  }
}

function renderForm(scheduleId, form, box, getSelected) {
  form.innerHTML = "";
  const fields = [
    ["parent_name", "Parent Name", "text", true],
    ["student_name", "Student Name", "text", true],
    ["student_email", "Email", "email", true],
    ["student_phone", "Phone (optional)", "tel", false],
  ];
  const inputs = {};
  fields.forEach(([name, label, type, required]) => {
    const l = el("label", "", label);
    const inp = document.createElement("input");
    inp.type = type; inp.name = name; inp.required = required;
    if (name === "student_email") inp.placeholder = "you@example.com";
    inputs[name] = inp;
    l.appendChild(inp);
    form.appendChild(l);
  });

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "btn auth-btn";
  submit.textContent = "Book my free trial";
  form.appendChild(submit);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const class_date = getSelected();
    if (!class_date) { setBoxError(box, "Please choose a date."); return; }
    const email = inputs.student_email.value.trim();
    if (!EMAIL_RE.test(email)) { setBoxError(box, "Please enter a valid email address."); return; }
    submit.disabled = true; submit.textContent = "Booking…";
    try {
      const res = await bookTrial({
        schedule_id: scheduleId,
        class_date,
        parent_name: inputs.parent_name.value.trim(),
        student_name: inputs.student_name.value.trim(),
        student_email: email,
        student_phone: inputs.student_phone.value.trim(),
      });
      showConfirmation(box, res);
    } catch (err) {
      submit.disabled = false; submit.textContent = "Book my free trial";
      setBoxError(box, (err && err.message) || "Something went wrong. Please try again.");
    }
  };
}

function showConfirmation(box, res) {
  box.innerHTML = "";
  box.appendChild(el("h3", "", "You're booked!"));
  box.appendChild(el("p", "", "Your free trial is confirmed. Check your email to finish setting up your account."));
  const link = el("a", "btn", "Set up my account");
  link.href = (res && res.claim_url) || "account.html";
  box.appendChild(link);
  const close = el("button", "btn btn-sm", "Close");
  close.type = "button"; close.onclick = closeModal;
  box.appendChild(close);
}

function init() {
  const root = document.getElementById("calendar-root");
  if (!root) return;
  root.addEventListener("click", (e) => {
    const btn = e.target.closest(".book-trial-btn");
    if (!btn) return;
    e.preventDefault();
    openModal(btn.dataset.schedule);
  });
}

init();
