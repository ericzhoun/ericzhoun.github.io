// Signup page logic — passwordless two-step flow:
// 1. Collect name + email → send a 6-digit verification code via email
// 2. User enters the code → verify + create/login account
import { isLoggedIn, sendMagicLink, verifyMagicLink, claimEnrollments } from "./auth.js";
import { getQueryParam } from "./api.js";

const errEl = document.getElementById("auth-error");
const infoEl = document.getElementById("auth-info");
const form = document.getElementById("signup-form");
const submitBtn = document.getElementById("signup-submit");

const nameField = document.getElementById("name-field");
const emailField = document.getElementById("email-field");
const codeField = document.getElementById("code-field");
const codeInput = document.getElementById("code");
const resendRow = document.getElementById("resend-row");
const resendLink = document.getElementById("resend-link");

// "collect" = gathering name + email, "verify" = waiting for 6-digit code
let step = "collect";
let savedEmail = "";
let savedName = "";

// Already logged in? Bounce to the return target (or account).
if (isLoggedIn()) {
  const next = getQueryParam("next");
  window.location.href = next || "account.html";
}

function showError(msg) {
  errEl.textContent = msg;
  errEl.hidden = false;
}

function showInfo(msg) {
  infoEl.textContent = msg;
  infoEl.hidden = false;
}

function switchToVerify() {
  step = "verify";
  nameField.hidden = true;
  emailField.hidden = true;
  document.getElementById("name").required = false;
  document.getElementById("email").required = false;
  codeField.hidden = false;
  codeInput.required = true;
  codeInput.focus();
  resendRow.hidden = false;
  submitBtn.textContent = "Verify & Create Account";
}

async function finishSignup() {
  await claimEnrollments();
  const next = getQueryParam("next");
  window.location.href = next || "account.html";
}

// Resend the code
resendLink.addEventListener("click", async (e) => {
  e.preventDefault();
  errEl.hidden = true;
  resendLink.textContent = "Sending…";
  try {
    await sendMagicLink(savedEmail, savedName);
    showInfo("New code sent! Check your email.");
  } catch (err) {
    showError(err.message);
  } finally {
    resendLink.textContent = "Resend code";
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errEl.hidden = true;
  infoEl.hidden = true;

  const label = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = "Please wait…";

  try {
    if (step === "collect") {
      const email = document.getElementById("email").value.trim().toLowerCase();
      const name = document.getElementById("name").value.trim();
      savedEmail = email;
      savedName = name;

      // Send verification code to the email
      await sendMagicLink(email, name);

      // Move to verification step
      switchToVerify();
      showInfo("A verification code has been sent to " + email + ". Please check your email.");
    } else {
      // Verify the code — this creates the account if new, or logs in if existing
      const code = codeInput.value.trim();
      if (code.length !== 6) {
        showError("Please enter the 6-digit code from your email.");
        return;
      }
      await verifyMagicLink(savedEmail, code, savedName);
      await finishSignup();
      return;
    }
  } catch (err) {
    showError(err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = step === "verify" ? "Verify & Create Account" : label;
  }
});
