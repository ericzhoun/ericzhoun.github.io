// Post-payment page for guest checkout. Enrollment was already fulfilled by
// the payment webhook; this page only claims it into an account via a
// magic-link email code (proof of email ownership). Closing the browser here
// loses nothing - the same claim runs on any later login.
import { getQueryParam, callFunction } from "./api.js";
import { isLoggedIn, getToken, sendMagicLink, verifyMagicLink, claimEnrollments } from "./auth.js";

const enrollmentId = getQueryParam("enrollment");

const state = {
  email: "",
  codeSent: false,
  code: "",
  busy: false,
  error: "",
  info: "",
};

try {
  state.email = sessionStorage.getItem("olivistart_pending_email") || "";
} catch { /* private mode */ }

const root = document.getElementById("success-root");

function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html != null) e.innerHTML = html;
  return e;
}

function registrationHref() {
  return enrollmentId ? `registration.html?enrollment=${enrollmentId}` : "account.html";
}

// Poll the billing API for this enrollment's order status and confirm it if
// paid. Billing has no webhook forward, so the page must trigger the sync.
// Best-effort: never blocks the claim flow.
async function syncPayment() {
  if (!enrollmentId) return;
  try {
    await callFunction("sync-enrollment-payment", { enrollment_id: enrollmentId }, getToken());
  } catch { /* best-effort */ }
}

function renderBanner() {
  const banner = el("div", "payment-success-banner");
  banner.appendChild(el("p", "", "✓ Payment received - you're enrolled!"));
  return banner;
}

function renderLoggedIn() {
  root.innerHTML = "";
  root.appendChild(renderBanner());
  root.appendChild(el("h2", "", "You're all set"));
  root.appendChild(el("p", "auth-subtitle",
    "Your enrollment is linked to your account. Next, complete the registration form."));
  const actions = el("div", "success-actions");
  const reg = el("a", "btn auth-btn", "Complete Registration");
  reg.href = registrationHref();
  actions.appendChild(reg);
  const acct = el("a", "btn btn-secondary", "Go to My Account");
  acct.href = "account.html";
  actions.appendChild(acct);
  root.appendChild(actions);
}

function renderClaim() {
  root.innerHTML = "";
  root.appendChild(renderBanner());
  root.appendChild(el("h2", "", "Create your account to manage this class"));
  root.appendChild(el("p", "auth-subtitle",
    "We'll email you a 6-digit code - no password needed. " +
    "Use the same email you entered at checkout."));

  if (state.error) root.appendChild(el("p", "auth-error", state.error));
  if (state.info) root.appendChild(el("p", "auth-info", state.info));

  const form = el("form", "auth-form");
  form.onsubmit = state.codeSent ? handleVerify : handleSend;

  const lblEmail = el("label", "", "Email");
  const inpEmail = document.createElement("input");
  inpEmail.type = "email";
  inpEmail.required = true;
  inpEmail.placeholder = "you@example.com";
  inpEmail.value = state.email;
  inpEmail.disabled = state.codeSent;
  inpEmail.oninput = (e) => (state.email = e.target.value);
  lblEmail.appendChild(inpEmail);
  form.appendChild(lblEmail);

  if (state.codeSent) {
    const lblCode = el("label", "", "6-digit code");
    const inpCode = document.createElement("input");
    inpCode.type = "text";
    inpCode.inputMode = "numeric";
    inpCode.autocomplete = "one-time-code";
    inpCode.maxLength = 6;
    inpCode.required = true;
    inpCode.placeholder = "123456";
    inpCode.className = "code-input";
    inpCode.value = state.code;
    inpCode.oninput = (e) => (state.code = e.target.value);
    lblCode.appendChild(inpCode);
    form.appendChild(lblCode);
  }

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "btn auth-btn";
  submit.disabled = state.busy;
  submit.textContent = state.busy
    ? "Please wait…"
    : state.codeSent ? "Verify & Create Account" : "Email Me a Code";
  form.appendChild(submit);
  root.appendChild(form);

  if (state.codeSent) {
    const resend = el("p", "auth-switch");
    const link = el("a", "", "Send a new code");
    link.href = "#";
    link.onclick = (e) => { e.preventDefault(); state.codeSent = false; state.code = ""; state.info = ""; render(); };
    resend.appendChild(document.createTextNode("Didn't get it? Check spam, or "));
    resend.appendChild(link);
    resend.appendChild(document.createTextNode("."));
    root.appendChild(resend);
  }

  const alt = el("p", "auth-switch");
  alt.innerHTML = `Prefer a password? <a href="login.html?next=${encodeURIComponent(registrationHref())}">Log in</a> - your enrollment attaches automatically.`;
  root.appendChild(alt);
}

function render() {
  renderClaim();
}

async function handleSend(e) {
  e.preventDefault();
  state.error = "";
  state.info = "";
  state.busy = true;
  render();
  try {
    await sendMagicLink(state.email.trim().toLowerCase());
    state.codeSent = true;
    state.info = "Code sent! It expires in 15 minutes.";
  } catch (err) {
    state.error = err.message;
  } finally {
    state.busy = false;
    render();
  }
}

async function handleVerify(e) {
  e.preventDefault();
  state.error = "";
  state.info = "";
  state.busy = true;
  render();
  try {
    await verifyMagicLink(state.email.trim().toLowerCase(), state.code.trim());
    await claimEnrollments();
    await syncPayment();
    try { sessionStorage.removeItem("olivistart_pending_email"); } catch { /* ignore */ }
    window.location.href = registrationHref();
  } catch (err) {
    state.error = err.message;
    state.busy = false;
    render();
  }
}

async function init() {
  if (isLoggedIn()) {
    await claimEnrollments();
    await syncPayment();
    renderLoggedIn();
  } else {
    renderClaim();
  }
}

init();
