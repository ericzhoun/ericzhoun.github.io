import assert from "node:assert/strict";
import { test } from "node:test";

// Node's global localStorage needs --experimental-webstorage plus a backing
// file to actually work; stub a plain in-memory version instead so this
// suite runs under the repo's standard `node --test` invocation.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

import { sendMagicLink, verifyMagicLink } from "../js/auth.js";

function stubFetch(response) {
  return async (url, options) => {
    stubFetch.lastUrl = url;
    stubFetch.lastBody = JSON.parse(options.body);
    return { ok: true, json: async () => response };
  };
}

test("sendMagicLink forwards display_name when given, omits it when not", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });

  global.fetch = stubFetch({ message: "sent" });
  await sendMagicLink("parent@example.com", "Grace Hopper");
  assert.equal(stubFetch.lastBody.display_name, "Grace Hopper");

  global.fetch = stubFetch({ message: "sent" });
  await sendMagicLink("parent@example.com");
  assert.equal("display_name" in stubFetch.lastBody, false);
});

test("verifyMagicLink fills in display_name locally when the server left it unset", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });

  global.fetch = stubFetch({
    access_token: "tok",
    refresh_token: "ref",
    user: { id: "u1", email: "parent@example.com", display_name: null },
  });

  const user = await verifyMagicLink("parent@example.com", "123456", "Grace Hopper");

  assert.equal(user.display_name, "Grace Hopper");
  assert.equal(JSON.parse(localStorage.getItem("olivistart_user")).display_name, "Grace Hopper");
});

test("verifyMagicLink fills in display_name locally when the server defaulted it to the email", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });

  global.fetch = stubFetch({
    access_token: "tok",
    refresh_token: "ref",
    user: { id: "u1", email: "parent@example.com", display_name: "parent@example.com" },
  });

  const user = await verifyMagicLink("parent@example.com", "123456", "Grace Hopper");

  assert.equal(user.display_name, "Grace Hopper");
});

test("verifyMagicLink keeps the server's display_name when it already has one", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });

  global.fetch = stubFetch({
    access_token: "tok",
    refresh_token: "ref",
    user: { id: "u1", email: "parent@example.com", display_name: "Server Name" },
  });

  const user = await verifyMagicLink("parent@example.com", "123456", "Grace Hopper");

  assert.equal(user.display_name, "Server Name");
});
