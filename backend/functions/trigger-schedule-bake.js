// Lets admin.html refresh schedule.html's baked snapshot on demand instead of
// waiting for the 6-hour cron. Dispatches the existing "Bake schedule
// snapshot" GitHub Actions workflow (scripts/bake-schedule.mjs +
// .github/workflows/bake-schedule.yml), which fetches fresh data and pushes
// the update to main itself; this function only fires that trigger.
//
// Authorization mirrors the rest of admin.html: callers must present the same
// service key adminApi() already sends as the bearer token (SERVICE_KEY,
// injected by deploy.sh from BUTTERBASE_API_KEY). The http trigger is
// deployed with auth "none" because ctx.user is unrelated to who may call
// this — service-key calls always have ctx.user === null — so the check has
// to happen here instead of via ctx.user.
const OWNER_REPO = "ericzhoun/ericzhoun.github.io";
const WORKFLOW_FILE = "bake-schedule.yml";

export async function handler(req, ctx) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token || token !== ctx.env.SERVICE_KEY) {
    return json({ error: "Unauthorized" }, 401);
  }

  const res = await fetch(
    `https://api.github.com/repos/${OWNER_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "olivistart-admin",
      },
      body: JSON.stringify({ ref: "main" }),
    }
  );

  if (res.status !== 204) {
    const detail = await res.text().catch(() => "");
    return json({ error: `GitHub dispatch failed (${res.status})`, detail }, 502);
  }

  return json({ dispatched: true }, 200);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
