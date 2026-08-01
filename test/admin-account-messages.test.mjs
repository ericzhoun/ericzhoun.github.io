import assert from "node:assert/strict";
import { test } from "node:test";
import { getOnboardingDeliveryMessage } from "../js/admin-account-messages.js";

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
