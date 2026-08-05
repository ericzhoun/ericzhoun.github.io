// Auth helpers - email/password and magic-link auth against the Butterbase
// backend, tokens cached in localStorage. Ported from herfield app/lib/auth.js.
import { AUTH_BASE, API_BASE, SITE_URL, fetchWithTimeout } from "./api.js";

const TOKEN_KEY = "olivistart_access_token";
const REFRESH_KEY = "olivistart_refresh_token";
const USER_KEY = "olivistart_user";

function clearStoredAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}

/** Get stored access token */
export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

/** Get stored refresh token */
export function getRefreshToken() {
  return localStorage.getItem(REFRESH_KEY);
}

/** Get cached user profile */
export function getUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Check if user is logged in */
export function isLoggedIn() {
  return !!getToken();
}

/** Check if current user is admin (Olivia's email) */
export function isAdmin() {
  const user = getUser();
  return user?.email === "herfield8@gmail.com" ||
    user?.email === "lightbyolivia@gmail.com" ||
    user?.email === "olivistastudio@gmail.com";
}

/** Login with email + password */
export async function login(email, password) {
  const res = await fetchWithTimeout(`${AUTH_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || "Login failed");
  localStorage.setItem(TOKEN_KEY, data.access_token);
  localStorage.setItem(REFRESH_KEY, data.refresh_token);
  localStorage.setItem(USER_KEY, JSON.stringify(data.user));
  return data.user;
}

/** Signup with email + password + display name */
export async function signup(email, password, displayName) {
  const res = await fetchWithTimeout(`${AUTH_BASE}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, display_name: displayName }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || "Signup failed");
  // After signup, login to get tokens (verification email is sent automatically)
  await login(email, password);
  return getUser();
}

/** Email a 6-digit sign-in code (works for new and existing accounts).
 *  `displayName`, when given, is forwarded so a brand-new account gets a
 *  name on creation instead of defaulting to the email address. */
export async function sendMagicLink(email, displayName) {
  const body = { email };
  if (displayName) body.display_name = displayName;
  const res = await fetchWithTimeout(`${AUTH_BASE}/magic-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || "Could not send code");
  return data;
}

/**
 * Exchange a 6-digit code for tokens. Creates the account on first use,
 * signs into the existing account otherwise. Stores tokens like login().
 * `fallbackDisplayName`, when given, fills in `display_name` locally if the
 * server's response doesn't have one (e.g. left unset or equal to the
 * email) — the typed name the parent already gave us during signup should
 * never be lost just because the server didn't persist it.
 */
export async function verifyMagicLink(email, code, fallbackDisplayName) {
  const res = await fetchWithTimeout(`${AUTH_BASE}/magic-link/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || "Invalid code");
  if (fallbackDisplayName && (!data.user.display_name || data.user.display_name === data.user.email)) {
    data.user.display_name = fallbackDisplayName;
  }
  localStorage.setItem(TOKEN_KEY, data.access_token);
  localStorage.setItem(REFRESH_KEY, data.refresh_token);
  localStorage.setItem(USER_KEY, JSON.stringify(data.user));
  return data.user;
}

/**
 * Attach any unclaimed enrollments matching the logged-in user's verified
 * email. Best-effort: returns claimed ids, or [] on any failure.
 */
export async function claimEnrollments() {
  const token = getToken();
  if (!token) return [];
  try {
    const res = await fetchWithTimeout(`${API_BASE}/fn/claim-enrollments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    const data = await res.json();
    if (!res.ok) return [];
    return data.claimed || [];
  } catch {
    return [];
  }
}

/** Logout — revokes tokens and clears localStorage */
export async function logout() {
  const token = getToken();
  if (token) {
    try {
      await fetchWithTimeout(`${AUTH_BASE}/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // ignore — clear local state regardless
    }
  }
  clearStoredAuth();
}

/** Refresh the access token using the refresh token */
export async function refreshToken() {
  const refresh = getRefreshToken();
  if (!refresh) {
    clearStoredAuth();
    return null;
  }
  const res = await fetchWithTimeout(`${AUTH_BASE}/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  const data = await res.json();
  if (!res.ok) {
    clearStoredAuth();
    return null;
  }
  localStorage.setItem(TOKEN_KEY, data.access_token);
  localStorage.setItem(REFRESH_KEY, data.refresh_token);
  if (data.user) localStorage.setItem(USER_KEY, JSON.stringify(data.user));
  return data.access_token;
}

/**
 * Require a logged-in user. If not logged in, redirect to login with a
 * return-to pointer back to the current page. Returns the user or null.
 */
export function requireAuth() {
  const user = getUser();
  if (!isLoggedIn() || !user) {
    const loginUrl = new URL("login.html", `${SITE_URL}/`);
    loginUrl.searchParams.set("next", window.location.pathname + window.location.search);
    window.location.href = loginUrl.toString();
    return null;
  }
  return user;
}
