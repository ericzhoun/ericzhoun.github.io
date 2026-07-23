// Enroll page — class details, pricing breakdown, Stripe checkout.
// Ported from herfield app/art-class/enroll/[scheduleId]/EnrollPageClient.js.
import { apiGet, callFunction, formatPrice, formatTime, getQueryParam, campBundleQuery, looseBundleQuery, compareDayOfWeek } from "./api.js";
import { isLoggedIn, getUser, getToken } from "./auth.js";
import { EARLY_BIRD_MIN_CLASSES, EARLY_BIRD_PCT, computeEarlyBird } from "./pricing.js";

const scheduleId = getQueryParam("schedule");
const paymentCancelled = getQueryParam("payment") === "cancelled";

const state = {
  user: null,
  schedule: null,
  program: null,
  enrollmentCount: 0,
  loading: true,
  error: "",
  enrolling: false,
  parentName: "",
  students: [],
  studentId: null,
  studentName: "",
  studentEmail: "",
  studentPhone: "",
  numClasses: 15,
  isCamp: false,
  campDays: [],
  siblingSchedules: [],
  selectedScheduleIds: new Set(),
};

const root = document.getElementById("enroll-root");

function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html != null) e.innerHTML = html;
  return e;
}

function getNumClasses() {
  return state.numClasses;
}

// Labels a sibling's day, appending its time only when it differs from the
// clicked schedule's time - siblings can run at a different time on a
// different day (e.g. Monday 4-5pm, Wednesday 5-6pm), so the differing
// slot needs to be called out rather than silently assumed identical.
function formatDayLabel(sibling) {
  const base = state.schedule;
  const differentTime = base && (sibling.start_time !== base.start_time || sibling.end_time !== base.end_time);
  return differentTime
    ? `${sibling.day_of_week} ${formatTime(sibling.start_time)}–${formatTime(sibling.end_time)}`
    : sibling.day_of_week;
}

function selectedDayNames() {
  return state.siblingSchedules
    .filter((s) => state.selectedScheduleIds.has(s.id))
    .map((s) => formatDayLabel(s));
}

function render() {
  root.innerHTML = "";

  if (state.loading) {
    root.appendChild(el("p", "muted", "Loading…"));
    return;
  }

  if (state.error && !state.schedule) {
    root.appendChild(el("p", "auth-error", state.error));
    const back = el("a", "btn", "Back to Schedule");
    back.href = "schedule.html";
    root.appendChild(back);
    return;
  }

  root.appendChild(el("h2", "", "Enroll in Class"));

  if (paymentCancelled) {
    const banner = el("div", "payment-cancel-banner");
    banner.appendChild(el("p", "", "Payment was cancelled. You can try again below."));
    root.appendChild(banner);
  }
  if (state.error) {
    const errEl = el("p", "auth-error", state.error);
    if (/already exists/i.test(state.error)) {
      errEl.appendChild(document.createTextNode(" "));
      const link = el("a", "", "Log in");
      link.href = `login.html?next=${encodeURIComponent(`enroll.html?schedule=${scheduleId}`)}`;
      errEl.appendChild(link);
      errEl.appendChild(document.createTextNode(" and your enrollment will use your account."));
    }
    root.appendChild(errEl);
  }

  // Program info
  if (state.program) {
    const info = el("div", "enroll-program-info");
    info.appendChild(el("h3", "", state.program.name));
    info.appendChild(el("p", "muted", state.program.description || ""));
    const sessionType = state.schedule?.session_type || state.program.session_type;
    if (sessionType && sessionType !== "standard") {
      info.appendChild(el("span", "session-badge", `${sessionType} session`));
    }
    root.appendChild(info);
  }

  // Schedule details
  const schedule = state.schedule;
  const program = state.program;
  const pricePerClass = schedule ? schedule.price_cents : 0;
  const maxClasses = program ? Math.max(program.num_classes || 15, 15) : 15;
  const minClasses = 10;
  const isEarlyBird = computeEarlyBird(getNumClasses());

  const subtotal = pricePerClass * getNumClasses();
  const discountAmount = isEarlyBird ? Math.round((subtotal * EARLY_BIRD_PCT) / 100) : 0;
  const totalDue = subtotal - discountAmount;

  const maxSeats = schedule ? schedule.max_seats : 0;
  const spotsTaken = state.enrollmentCount;
  const spotsAvailable = Math.max(0, maxSeats - spotsTaken);
  const isFull = spotsAvailable === 0;

  if (schedule) {
    const details = el("div", "enroll-schedule-details");

    const rowDay = el("div", "detail-row");
    rowDay.appendChild(el("span", "detail-label", "Day"));
    rowDay.appendChild(el("span", "", state.isCamp ? state.campDays.join(", ")
      : state.siblingSchedules.length > 1 ? selectedDayNames().join(", ")
      : schedule.day_of_week));
    details.appendChild(rowDay);

    // In multi-day mode, per-day times (when they differ) are already shown
    // inline in the Day row above - a single fixed Time row here would be
    // misleading once the selected days don't share one time slot.
    if (state.siblingSchedules.length <= 1) {
      const rowTime = el("div", "detail-row");
      rowTime.appendChild(el("span", "detail-label", "Class Time"));
      rowTime.appendChild(el("span", "", `${formatTime(schedule.start_time)} – ${formatTime(schedule.end_time)}`));
      details.appendChild(rowTime);
    }

    const rowAge = el("div", "detail-row");
    rowAge.appendChild(el("span", "detail-label", "Age Group"));
    rowAge.appendChild(el("span", "", schedule.age_group));
    details.appendChild(rowAge);

    const rowSpots = el("div", "detail-row");
    rowSpots.appendChild(el("span", "detail-label", "Available Spots"));
    rowSpots.appendChild(el("span", isFull ? "spots-full" : "spots-available",
      `${spotsAvailable} of ${maxSeats} remaining`));
    details.appendChild(rowSpots);

    if (schedule.notes) {
      details.appendChild(el("p", "schedule-note muted", schedule.notes));
    }
    root.appendChild(details);
  }

  // Pricing breakdown
  const pricing = el("div", "pricing-breakdown");
  pricing.appendChild(el("h4", "", "Price Breakdown"));

  const rowPrice = el("div", "pricing-row");
  rowPrice.appendChild(el("span", "", "Price per class"));
  rowPrice.appendChild(el("span", "", formatPrice(pricePerClass)));
  pricing.appendChild(rowPrice);

  if (state.isCamp) {
    // Camp: fixed to the bundle size, not adjustable.
    const rowClasses = el("div", "pricing-row");
    const lbl = el("label", "", "Number of classes");
    lbl.setAttribute("for", "num-classes");
    rowClasses.appendChild(lbl);
    rowClasses.appendChild(el("span", "num-classes-value",
      `${state.numClasses} (${state.campDays.join(", ")} - included, not adjustable)`));
    pricing.appendChild(rowClasses);
  } else {
    // Class Time: which weekly day/time slot(s) this enrollment attends.
    // Only rendered here when 2+ day-parts matched - the single-match case
    // is already shown by the "Class Time" detail row above.
    if (state.siblingSchedules.length > 1) {
      const rowClassTime = el("div", "pricing-row");
      rowClassTime.appendChild(el("label", "", "Class Time"));
      const dayCheckboxes = el("div", "day-checkboxes");
      state.siblingSchedules.forEach((sib) => {
        const lbl = el("label", "checkbox-label");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = state.selectedScheduleIds.has(sib.id);
        cb.disabled = cb.checked && state.selectedScheduleIds.size === 1;
        cb.onchange = (e) => {
          if (e.target.checked) state.selectedScheduleIds.add(sib.id);
          else state.selectedScheduleIds.delete(sib.id);
          render();
        };
        lbl.appendChild(cb);
        lbl.appendChild(document.createTextNode(` ${formatDayLabel(sib)}`));
        dayCheckboxes.appendChild(lbl);
      });
      rowClassTime.appendChild(dayCheckboxes);
      pricing.appendChild(rowClassTime);
    }

    // Number of Classes: total sessions purchased, independent of which
    // Class Time day-part(s) are selected above.
    const rowClasses = el("div", "pricing-row");
    const lbl = el("label", "", "Number of Classes");
    lbl.setAttribute("for", "num-classes");
    rowClasses.appendChild(lbl);

    const ctrl = el("div", "num-classes-control");
    const minusBtn = el("button", "", "−");
    minusBtn.type = "button";
    minusBtn.disabled = state.numClasses <= minClasses || isFull;
    minusBtn.onclick = () => { state.numClasses = Math.max(minClasses, state.numClasses - 1); render(); };
    ctrl.appendChild(minusBtn);

    ctrl.appendChild(el("span", "num-classes-value", String(state.numClasses)));

    const plusBtn = el("button", "", "+");
    plusBtn.type = "button";
    plusBtn.disabled = state.numClasses >= maxClasses || isFull;
    plusBtn.onclick = () => { state.numClasses = Math.min(maxClasses, state.numClasses + 1); render(); };
    ctrl.appendChild(plusBtn);

    ctrl.appendChild(el("span", "muted num-classes-max", `of ${maxClasses}`));
    rowClasses.appendChild(ctrl);
    pricing.appendChild(rowClasses);
  }

  const rowSub = el("div", "pricing-row pricing-subtotal");
  rowSub.appendChild(el("span", "", "Subtotal"));
  rowSub.appendChild(el("span", "", formatPrice(subtotal)));
  pricing.appendChild(rowSub);

  if (isEarlyBird) {
    const rowDisc = el("div", "pricing-row pricing-discount");
    rowDisc.appendChild(el("span", "", `Early-bird discount (${EARLY_BIRD_PCT}%)`));
    rowDisc.appendChild(el("span", "", `−${formatPrice(discountAmount)}`));
    pricing.appendChild(rowDisc);
  } else if (getNumClasses() < EARLY_BIRD_MIN_CLASSES) {
    pricing.appendChild(el("p", "early-bird-hint muted",
      `Book ${EARLY_BIRD_MIN_CLASSES}+ classes before 8/15/2026 to get ${EARLY_BIRD_PCT}% off.`));
  }

  const rowTotal = el("div", "pricing-row pricing-total");
  rowTotal.appendChild(el("span", "", "Total Due"));
  const totalSpan = el("span", "price-highlight", formatPrice(totalDue));
  rowTotal.appendChild(totalSpan);
  pricing.appendChild(rowTotal);
  root.appendChild(pricing);

  // Footer section: full / auth / form
  if (isFull) {
    const full = el("div", "enroll-full-prompt");
    full.appendChild(el("h4", "", "This class is currently full"));
    full.appendChild(el("p", "", "Please check back later or browse other available classes."));
    const browse = el("a", "btn", "Browse Other Classes");
    browse.href = "schedule.html";
    full.appendChild(browse);
    root.appendChild(full);
  } else {
    const form = el("form", "enroll-form");
    form.onsubmit = handleEnroll;

    if (!state.user) {
      form.appendChild(el("p", "muted enroll-guest-note",
        "No account needed - pay now and create your account afterwards. " +
        "Already have one? <a href=\"login.html?next=" +
        encodeURIComponent(`enroll.html?schedule=${scheduleId}`) + "\">Log in</a>."));

      const lblEmail = el("label", "", "Email");
      const inpEmail = document.createElement("input");
      inpEmail.type = "email";
      inpEmail.value = state.studentEmail;
      inpEmail.required = true;
      inpEmail.placeholder = "you@example.com";
      inpEmail.oninput = (e) => (state.studentEmail = e.target.value);
      lblEmail.appendChild(inpEmail);
      form.appendChild(lblEmail);
    }

    const lblParent = el("label", "", "Parent Name");
    const inpParent = document.createElement("input");
    inpParent.type = "text";
    inpParent.value = state.parentName;
    inpParent.required = true;
    inpParent.placeholder = "Parent/guardian full name";
    inpParent.oninput = (e) => (state.parentName = e.target.value);
    lblParent.appendChild(inpParent);
    form.appendChild(lblParent);

    const lblName = el("label", "", "Student Name");
    if (state.students.length > 0) {
      const select = document.createElement("select");
      state.students.forEach((s) => {
        const opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = s.name;
        if (state.studentId === s.id) opt.selected = true;
        select.appendChild(opt);
      });
      const optOther = document.createElement("option");
      optOther.value = "__other__";
      optOther.textContent = "Other / New student";
      if (!state.studentId) optOther.selected = true;
      select.appendChild(optOther);
      select.onchange = (e) => {
        if (e.target.value === "__other__") {
          state.studentId = null;
          state.studentName = "";
        } else {
          const chosen = state.students.find((s) => s.id === e.target.value);
          state.studentId = chosen.id;
          state.studentName = chosen.name;
        }
        render();
      };
      lblName.appendChild(select);
      form.appendChild(lblName);

      if (!state.studentId) {
        const lblOther = el("label", "", "New Student Name");
        const inpOther = document.createElement("input");
        inpOther.type = "text";
        inpOther.value = state.studentName;
        inpOther.required = true;
        inpOther.placeholder = "Student's full name";
        inpOther.oninput = (e) => (state.studentName = e.target.value);
        lblOther.appendChild(inpOther);
        form.appendChild(lblOther);
      }
    } else {
      const inpName = document.createElement("input");
      inpName.type = "text";
      inpName.value = state.studentName;
      inpName.required = true;
      inpName.placeholder = "Student's full name";
      inpName.oninput = (e) => (state.studentName = e.target.value);
      lblName.appendChild(inpName);
      form.appendChild(lblName);
    }

    const lblPhone = el("label", "", "Phone Number");
    const inpPhone = document.createElement("input");
    inpPhone.type = "tel";
    inpPhone.value = state.studentPhone;
    inpPhone.placeholder = "(650) 555-0000";
    inpPhone.oninput = (e) => (state.studentPhone = e.target.value);
    lblPhone.appendChild(inpPhone);
    form.appendChild(lblPhone);

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "btn auth-btn";
    submit.disabled = state.enrolling;
    submit.textContent = state.enrolling
      ? "Processing…"
      : `Proceed to Payment — ${formatPrice(totalDue)}`;
    form.appendChild(submit);

    form.appendChild(el("p", "muted enroll-disclaimer",
      "This is your regular weekly slot. You can skip a class and book a make-up " +
      "in another time slot within the same program. You will be redirected to " +
      "Stripe to complete payment securely, then complete a registration form."));
    root.appendChild(form);
  }
}

async function handleEnroll(e) {
  e.preventDefault();
  state.error = "";
  const schedule = state.schedule;
  const maxSeats = schedule ? schedule.max_seats : 0;

  if (maxSeats - state.enrollmentCount <= 0) {
    state.error = "This class is full. Please try another schedule.";
    render();
    return;
  }

  if (!state.user && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.studentEmail.trim())) {
    state.error = "Please enter a valid email address.";
    render();
    return;
  }

  state.enrolling = true;
  render();
  try {
    const multiDay = state.siblingSchedules.length > 1;
    const scheduleParams = {
      ...(multiDay ? { schedule_ids: [...state.selectedScheduleIds] } : { schedule_id: scheduleId }),
      num_classes_enrolled: state.numClasses,
    };

    let result;
    if (state.user) {
      result = await callFunction(
        "enroll-guard",
        {
          ...scheduleParams,
          student_name: state.studentName,
          student_email: state.user.email || "",
          student_phone: state.studentPhone,
          parent_name: state.parentName,
          student_id: state.studentId,
        },
        getToken()
      );
    } else {
      const email = state.studentEmail.trim().toLowerCase();
      result = await callFunction("guest-enroll", {
        ...scheduleParams,
        student_name: state.studentName,
        student_email: email,
        student_phone: state.studentPhone,
        parent_name: state.parentName,
      });
      // Prefill the claim step on the post-payment page (never in the URL).
      try { sessionStorage.setItem("olivistart_pending_email", email); } catch { /* private mode */ }
    }
    window.location.href = result.checkout_url;
  } catch (err) {
    state.error = err.message;
    state.enrolling = false;
    render();
  }
}

async function init() {
  if (!scheduleId) {
    state.error = "No class schedule specified.";
    state.loading = false;
    render();
    return;
  }

  try {
    const [sched, availability] = await Promise.all([
      apiGet(`class_schedules?id=eq.${scheduleId}&active=eq.true`),
      callFunction("class-availability", { schedule_id: scheduleId }).catch(() => null),
    ]);
    if (sched.length === 0) {
      state.error = "Class schedule not found.";
      state.loading = false;
      render();
      return;
    }
    state.schedule = sched[0];

    const prog = await apiGet(`programs?id=eq.${sched[0].program_id}`);
    if (prog.length > 0) {
      state.program = prog[0];
      state.numClasses = 15;
    }

    if (state.program?.program_type === "camp") {
      state.isCamp = true;
      const siblings = await apiGet(campBundleQuery(state.schedule));
      state.campDays = siblings.map((s) => s.day_of_week).sort(compareDayOfWeek);
      state.numClasses = siblings.length || 1;
    } else {
      // Loose match: a multi-day class doesn't have to run at the same time
      // every day (e.g. Monday 4-5pm, Wednesday 5-6pm).
      const siblings = await apiGet(looseBundleQuery(state.schedule));
      if (siblings.length > 1) {
        state.siblingSchedules = [...siblings].sort((a, b) => compareDayOfWeek(a.day_of_week, b.day_of_week));
        state.selectedScheduleIds = new Set([scheduleId]);
      }
    }

    // Seat availability (confirmed + fresh pending holds). Anonymous REST
    // reads of enrollments are blocked by RLS, so ask the public function.
    state.enrollmentCount = availability?.spots_taken || 0;

    if (isLoggedIn()) {
      state.user = getUser();
      state.parentName = state.user.display_name || state.user.email || "";
      const token = getToken();
      try {
        const data = await callFunction("manage-students", { action: "list" }, token);
        state.students = data.students || [];
      } catch {
        state.students = [];
      }
    }
  } catch (err) {
    state.error = err.message;
  } finally {
    state.loading = false;
    render();
  }
}

init();
