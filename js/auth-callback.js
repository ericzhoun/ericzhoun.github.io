// Google OAuth landing page. Butterbase redirects here with the session
// tokens appended to the URL; this page stores them, claims any unclaimed
// enrollments matching the verified email (same recovery path as every other
// login), and moves on to the destination saved before the redirect.
// Opening the page directly - no OAuth parameters - bounces to login.
import { applyOAuthRedirect, claimEnrollments, consumeOAuthNext } from "./auth.js";
import { oauthCallbackParams } from "./oauth-flow.js";
import { canonicalSiteUrl } from "./login-flow.js";
import { SITE_URL } from "./api.js";

const statusEl = document.getElementById("oauth-status");
const errorEl = document.getElementById("oauth-error");

function showError(message) {
  statusEl.hidden = true;
  errorEl.textContent = message;
  errorEl.hidden = false;
}

async function run() {
  if (!oauthCallbackParams(window.location.search)) {
    window.location.replace("login.html");
    return;
  }
  try {
    await applyOAuthRedirect(window.location.search);
    await claimEnrollments();
    // replace() keeps the token-bearing URL out of the back/forward flow.
    window.location.replace(canonicalSiteUrl(consumeOAuthNext(), SITE_URL));
  } catch (err) {
    showError(err.message);
  }
}

run();
