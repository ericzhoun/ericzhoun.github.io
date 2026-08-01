import assert from "node:assert/strict";
import { test } from "node:test";

import { getContactValue } from "../js/account-profile.js";

test("contact values prefer drafts, then profiles, then legacy enrollments", () => {
  const source = {
    draft: { parent_name: "Typed Name", student_phone: "" },
    profile: { parent_name: "Profile Name", student_phone: "555-0100", allergies: null },
    enrollment: { parent_name: "Legacy Name", student_phone: "555-9999", allergies: "None" },
  };

  assert.equal(getContactValue(source, "parent_name"), "Typed Name");
  assert.equal(getContactValue(source, "student_phone"), "");
  assert.equal(getContactValue(source, "allergies"), "None");
  assert.equal(getContactValue(source, "emergency_contact"), "");
});
