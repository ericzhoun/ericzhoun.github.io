import assert from "node:assert/strict";
import { test } from "node:test";
import * as accountMessages from "../js/admin-account-messages.js";

const { getOnboardingDeliveryMessage } = accountMessages;

test("onboarding delivery copy distinguishes every partial result", () => {
  const cases = [
    [{ code_sent: true, welcome_sent: true }, "Security code and welcome email sent."],
    [{ code_sent: true, welcome_sent: false }, "Security code sent, but the welcome email failed. Try resending again."],
    [{ code_sent: false, welcome_sent: true }, "Welcome email sent, but the security code failed. Try resending again."],
    [{ code_sent: false, welcome_sent: false }, "Neither onboarding email could be sent. Try again."],
  ];

  for (const [result, expected] of cases) {
    assert.equal(getOnboardingDeliveryMessage(result), expected);
  }
});

test("rendering a new admin notice removes every prior notice", () => {
  assert.equal(typeof accountMessages.replaceAdminNotice, "function");
  const priorNotices = [
    { removed: false, remove() { this.removed = true; } },
    { removed: false, remove() { this.removed = true; } },
  ];
  const insertions = [];
  const root = {
    querySelectorAll(selector) {
      assert.equal(selector, ".admin-notice");
      return priorNotices;
    },
    insertAdjacentHTML(position, markup) {
      insertions.push({ position, markup });
    },
  };

  accountMessages.replaceAdminNotice(root, "<p class=\"admin-notice\">Latest</p>");

  assert.equal(priorNotices.every((notice) => notice.removed), true);
  assert.deepEqual(insertions, [
    { position: "afterbegin", markup: "<p class=\"admin-notice\">Latest</p>" },
  ]);
});
