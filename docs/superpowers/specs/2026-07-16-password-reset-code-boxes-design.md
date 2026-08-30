# Password reset code boxes

## Goal

Replace the single six-digit password-reset code field in `account.html` with
six individual digit inputs that support typing, paste, and keyboard editing.

## Interaction

- Render six one-character numeric inputs with a shared `6-digit code` label.
- Typing a digit advances focus to the next box.
- Backspace on an empty box moves focus to the previous box and clears it.
- Pasting one or more digits fills the current and subsequent boxes, ignoring
  non-digit characters and limiting the result to six digits.
- The reset request joins the six values in order and retains the existing
  validation and submission flow.

## Accessibility and validation

- Each box has an individual accessible position label, such as `Digit 1 of 6`.
- The first box receives focus after the reset code is sent.
- Numeric mobile keyboards are requested with `inputmode="numeric"`.
- Reset remains disabled only by the existing loading state; submitting fewer
  than six digits continues to show the existing validation message.

## Testing

- Add a browser-level test for digit entry, paste distribution, backspace
  navigation, and joined-code submission.
- Verify the account page presents six visible code inputs in Chrome.
