const LOGIN_MODES = new Set(["password", "magic-send", "magic-verify"]);
const LOCAL_ORIGIN = "https://olivistart.local";

export function getInitialLoginState(search) {
  const params = new URLSearchParams(search);
  const requestedMode = params.get("mode");

  return {
    mode: LOGIN_MODES.has(requestedMode) ? requestedMode : "password",
    email: (params.get("email") || "").trim().toLowerCase(),
  };
}

export function getLoginFocusTarget(mode) {
  return mode === "magic-verify" ? "code" : null;
}

export function safeNextPath(candidate, fallback) {
  if (typeof candidate !== "string") return fallback;
  const value = candidate.trim();
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) return fallback;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.includes("\\")) return fallback;

  const delimiter = value.search(/[?#]/);
  const rawPath = delimiter === -1 ? value : value.slice(0, delimiter);
  if (rawPath.includes("//")) return fallback;

  let decodedPath = rawPath;
  for (let depth = 0; depth < 4; depth += 1) {
    if (/%(?:2f|5c)/i.test(decodedPath)) return fallback;
    try {
      const decoded = decodeURIComponent(decodedPath);
      if (decoded === decodedPath) break;
      decodedPath = decoded;
    } catch {
      return fallback;
    }
  }
  if (decodedPath.includes("\\") || decodedPath.includes("//")) return fallback;

  try {
    const destination = new URL(value, `${LOCAL_ORIGIN}/`);
    if (destination.origin !== LOCAL_ORIGIN) return fallback;
    const pathname = rawPath.startsWith("/")
      ? destination.pathname
      : destination.pathname.replace(/^\//, "");
    return `${pathname}${destination.search}${destination.hash}`;
  } catch {
    return fallback;
  }
}

export function canonicalSiteUrl(candidate, siteUrl = "https://olivistart.com") {
  const path = safeNextPath(candidate, "account.html");
  try {
    const origin = new URL(siteUrl).origin;
    return new URL(path, `${origin}/`).toString();
  } catch {
    return "https://olivistart.com/account.html";
  }
}
