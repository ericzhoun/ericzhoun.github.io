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
  if (typeof candidate !== "string" || candidate.startsWith("//")) return fallback;

  try {
    const destination = new URL(candidate, `${LOCAL_ORIGIN}/`);
    return destination.origin === LOCAL_ORIGIN ? candidate : fallback;
  } catch {
    return fallback;
  }
}
