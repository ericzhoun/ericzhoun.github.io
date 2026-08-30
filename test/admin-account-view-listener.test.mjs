import assert from "node:assert/strict";
import { test } from "node:test";
import { createLatestEventListener } from "../js/admin-account-view-listener.js";

test("replacing an account view listener leaves only the current account active", () => {
  const app = new EventTarget();
  const accountViewClick = createLatestEventListener();
  const requests = [];
  const renderAccount = (userId) => {
    accountViewClick.listen(app, "click", () => {
      requests.push({ action: "resend-invitation", user_id: userId });
    });
  };

  renderAccount("previous-parent");
  renderAccount("current-parent");
  app.dispatchEvent(new Event("click"));

  assert.deepEqual(requests, [
    { action: "resend-invitation", user_id: "current-parent" },
  ]);
});

test("clearing the account view listener prevents actions after navigation", () => {
  const app = new EventTarget();
  const accountViewClick = createLatestEventListener();
  const requests = [];
  accountViewClick.listen(app, "click", () => requests.push("previous-parent"));

  accountViewClick.clear();
  app.dispatchEvent(new Event("click"));

  assert.deepEqual(requests, []);
});
