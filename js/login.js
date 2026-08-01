// Login page logic - password or magic-link code. After any successful
// login, unclaimed enrollments matching the verified email attach to the
// account (guest-checkout recovery path).
import { login, isLoggedIn, sendMagicLink, verifyMagicLink, claimEnrollments } from "./auth.js";
import { getQueryParam } from "./api.js";
import { getInitialLoginState, safeNextPath } from "./login-flow.js";

const errEl = document.getElementById("auth-error");
const infoEl = document.getElementById("auth-info");
const form = document.getElementById("login-form");
const passwordField = document.getElementById("password-field");
const passwordInput = document.getElementById("password");
const codeField = document.getElementById("code-field");
const codeInput = document.getElementById("code");
const submitBtn = document.getElementById("login-submit");
const modeToggle = document.getElementById("mode-toggle");
const resendCode = document.getElementById("resend-code");
const emailInput = document.getElementById("email");

// mode: "password" | "magic-send" | "magic-verify"
let mode = "password";

function setMode(next) {
  mode = next;
  errEl.hidden = true;
  infoEl.hidden = true;
  passwordField.hidden = mode !== "password";
  passwordInput.required = mode === "password";
  codeField.hidden = mode !== "magic-verify";
  codeInput.required = mode === "magic-verify";
  resendCode.hidden = mode !== "magic-verify";
  submitBtn.textContent =
    mode === "password" ? "Log In" :
    mode === "magic-send" ? "Email Me a Code" : "Verify & Log In";
  modeToggle.textContent =
    mode === "password" ? "Email me a sign-in code instead" : "Use a password instead";
}

function currentEmail() {
  return emailInput.value.trim().toLowerCase();
}

modeToggle.addEventListener("click", (e) => {
  e.preventDefault();
  setMode(mode === "password" ? "magic-send" : "password");
});

function showError(msg) {
  errEl.textContent = msg;
  errEl.hidden = false;
}

function showInfo(msg) {
  infoEl.textContent = msg;
  infoEl.hidden = false;
}

async function finishLogin() {
  await claimEnrollments();
  window.location.href = safeNextPath(getQueryParam("next"), "account.html");
}

resendCode.addEventListener("click", async () => {
  errEl.hidden = true;
  infoEl.hidden = true;
  resendCode.disabled = true;
  try {
    await sendMagicLink(currentEmail());
    showInfo("Code sent! Check your email - it expires in 15 minutes.");
  } catch (err) {
    showError(err.message);
  } finally {
    resendCode.disabled = false;
  }
});

const initial = getInitialLoginState(window.location.search);
emailInput.value = initial.email;
setMode(initial.mode);
if (initial.mode === "magic-verify") {
  showInfo("Enter the code from the separate security email. Codes expire after 15 minutes.");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errEl.hidden = true;
  infoEl.hidden = true;
  const email = currentEmail();
  const label = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = "Please wait…";
  try {
    if (mode === "password") {
      await login(email, passwordInput.value);
      await finishLogin();
      return;
    }
    if (mode === "magic-send") {
      await sendMagicLink(email);
      setMode("magic-verify");
      showInfo("Code sent! Check your email - it expires in 15 minutes.");
      return;
    }
    await verifyMagicLink(email, codeInput.value.trim());
    await finishLogin();
  } catch (err) {
    showError(err.message);
  } finally {
    if (!isLoggedIn()) {
      submitBtn.disabled = false;
      submitBtn.textContent = mode === "magic-verify" ? "Verify & Log In" : label;
    }
  }
});
