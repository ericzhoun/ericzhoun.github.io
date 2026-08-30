# Password Reset Code Boxes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the password-reset code field with six accessible digit boxes that support typing, paste, and keyboard editing.

**Architecture:** Keep the account page’s existing vanilla-JavaScript rendering model. Add a focused helper that owns the six-input behavior and returns the joined code to the existing password-reset submit handler; add CSS only for the visual layout.

**Tech Stack:** Vanilla JavaScript modules, HTML inputs created at render time, CSS, Node’s built-in test runner.

## Global Constraints

- Render exactly six digit inputs with numeric mobile keyboard hints.
- Do not change the password-reset API contract: submit one six-character `code` string.
- Pasting ignores non-digits and fills no more than six boxes.
- Keep the existing loading, validation, and error states.

---

### Task 1: Exercise code-entry behavior

**Files:**
- Create: `test/password-reset-code.test.mjs`
- Modify: `js/account.js`

**Interfaces:**
- Consumes: `createPasswordCodeInputs()` from `js/account.js`.
- Produces: Tests for typing, paste distribution, backspace navigation, and the joined code.

- [ ] **Step 1: Write the failing test**

```js
test("password code inputs distribute a pasted six-digit code", () => {
  const { inputs, readCode } = createPasswordCodeInputs();
  inputs[0].dispatchEvent(new ClipboardEvent("paste", {
    clipboardData: new DataTransfer(), bubbles: true,
  }));
  expect(readCode()).toBe("123456");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/password-reset-code.test.mjs`

Expected: FAIL because `createPasswordCodeInputs` does not exist.

- [ ] **Step 3: Expand the test with the remaining required interactions**

```js
test("password code inputs advance after a digit and move back on backspace", () => {
  const { inputs } = createPasswordCodeInputs();
  inputs[0].value = "1";
  inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
  expect(document.activeElement).toBe(inputs[1]);
  inputs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
  expect(document.activeElement).toBe(inputs[0]);
});
```

### Task 2: Implement the six-box control

**Files:**
- Modify: `js/account.js:397-429`
- Modify: `css/style.css`

**Interfaces:**
- Consumes: `createPasswordCodeInputs()` local to `js/account.js`.
- Produces: A `codeInputGroup` element and `readCode()` closure passed to `handlePwConfirm`.

- [ ] **Step 1: Add `createPasswordCodeInputs()`**

```js
function createPasswordCodeInputs() {
  const group = el("div", "password-code-inputs");
  const inputs = Array.from({ length: 6 }, (_, index) => {
    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "numeric";
    input.autocomplete = index === 0 ? "one-time-code" : "off";
    input.maxLength = 1;
    input.className = "code-input";
    input.setAttribute("aria-label", `Digit ${index + 1} of 6`);
    group.appendChild(input);
    return input;
  });
  return { group, inputs, readCode: () => inputs.map((input) => input.value).join("") };
}
```

- [ ] **Step 2: Add input, paste, and backspace handlers**

```js
function fillCodeInputs(inputs, startIndex, value) {
  const digits = String(value).replace(/\D/g, "").slice(0, inputs.length - startIndex);
  digits.split("").forEach((digit, offset) => { inputs[startIndex + offset].value = digit; });
  inputs[Math.min(startIndex + digits.length, inputs.length - 1)].focus();
}
```

Attach handlers so a typed digit advances one box, paste calls `fillCodeInputs`, and Backspace on an empty box focuses and clears the preceding box.

- [ ] **Step 3: Replace the single code field in `renderProfileTab()`**

```js
const { group: codeInputGroup, inputs: codeInputs, readCode } = createPasswordCodeInputs();
codeLabel.appendChild(codeInputGroup);
pwSection.appendChild(codeLabel);
confirmBtn.onclick = () => handlePwConfirm(readCode(), pwInput.value, pwInput2.value);
requestAnimationFrame(() => codeInputs[0].focus());
```

- [ ] **Step 4: Add compact visual styling**

```css
.password-code-inputs { display: flex; gap: 0.5rem; }
.password-code-inputs .code-input { width: 2.75rem; text-align: center; font-size: 1.25rem; }
```

- [ ] **Step 5: Run the focused test**

Run: `node --test test/password-reset-code.test.mjs`

Expected: PASS.

### Task 3: Verify the account-page UI

**Files:**
- Modify: `js/account.js`
- Modify: `css/style.css`

**Interfaces:**
- Consumes: the deployed static account page and the six-box control from Task 2.
- Produces: Visual confirmation of six code fields and working paste behavior.

- [ ] **Step 1: Run syntax and existing regression tests**

Run: `node --check js/account.js && node --test test/*.test.mjs`

Expected: all commands exit 0.

- [ ] **Step 2: Inspect the logged-in account page in Chrome**

Verify that the reset-code state presents six visible digit fields, focus starts in the first field, and a pasted six-digit value fills all fields.

- [ ] **Step 3: Inspect the final diff**

Run: `git diff --check && git diff -- js/account.js css/style.css test/password-reset-code.test.mjs`

Expected: no whitespace errors; only the code-entry control, styles, and tests change.
