import assert from "node:assert/strict";
import { test } from "node:test";
import * as accountMessages from "../js/admin-account-messages.js";

const { getAccountCreationMessage, getOnboardingDeliveryMessage, getRecoveryMessage } = accountMessages;

test("account creation copy keeps a recoverable existing account visible", () => {
  const cases = [
    [{ profile_saved: true, welcome_sent: true }, "Account created and welcome email sent."],
    [{ profile_saved: true, welcome_sent: false }, "Account created, but the welcome email could not be sent. Resend onboarding emails."],
    [{ profile_saved: false, welcome_sent: true }, "Account created, but profile setup is incomplete. Complete setup without recreating the account."],
    [{ profile_saved: false, welcome_sent: false }, "Account created, but profile setup is incomplete. Complete setup without recreating the account."],
  ];
  for (const [result, expected] of cases) assert.equal(getAccountCreationMessage(result), expected);
});

test("recovery copy distinguishes profile failure from delivery failure", () => {
  assert.equal(
    getRecoveryMessage({ profile_saved: false, code_sent: true, welcome_sent: true }),
    "The account exists, but profile setup is still incomplete. Try recovery again.",
  );
  assert.equal(
    getRecoveryMessage({ profile_saved: true, code_sent: true, welcome_sent: false }),
    "Profile setup completed. Security code sent, but the welcome email failed. Try resending again.",
  );
});

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

test("rendering a new admin notice replaces only transient notices", () => {
  assert.equal(typeof accountMessages.replaceAdminNotice, "function");
  const priorNotices = [
    { removed: false, remove() { this.removed = true; } },
    { removed: false, remove() { this.removed = true; } },
  ];
  const persistentNotice = { removed: false, remove() { this.removed = true; } };
  const insertions = [];
  const root = {
    querySelectorAll(selector) {
      assert.equal(selector, ".admin-notice[data-transient-notice]");
      return priorNotices;
    },
    insertAdjacentHTML(position, markup) {
      insertions.push({ position, markup });
    },
  };

  accountMessages.replaceAdminNotice(root, "<p class=\"admin-notice\" data-transient-notice>Latest</p>");

  assert.equal(priorNotices.every((notice) => notice.removed), true);
  assert.equal(persistentNotice.removed, false);
  assert.deepEqual(insertions, [
    { position: "afterbegin", markup: "<p class=\"admin-notice\" data-transient-notice>Latest</p>" },
  ]);
});
