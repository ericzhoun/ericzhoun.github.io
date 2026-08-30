# Admin Schedule Copy Design

## Goal

Allow an Admin CRM user to create a new class schedule from an existing schedule while keeping the original unchanged. Move the Schedules table's Actions column to the second column.

## User flow

Each grouped schedule row will display Copy, Edit, and Delete actions. Selecting Copy opens the existing schedule form in create mode with the source schedule's values prefilled. The admin can change any copied value, including the selected day or days, before submitting. Submitting creates new `class_schedules` rows through the existing POST flow; it does not update or delete the source schedule.

## UI and data flow

- The schedule table header order will be `Program`, `Actions`, `Semester`, `Day`, `Session`, `Start`, `Age`, `Price`, `Seats`, `Active`.
- The Actions cell remains attached to its grouped row and contains Copy, Edit, and Delete.
- Copy will use the existing `scheduleForm` renderer with create semantics and the selected source group's values.
- The copied form must retain the source group's selected days. Because create mode supports one POST per selected day, copying a multi-day group can create multiple new rows as it does for a manually-created multi-day schedule.
- The existing session-type/time and price behavior remains unchanged, including recalculation when the admin changes session type or start time.
- Success and error notifications use the existing CRUD notification and form-error mechanisms.

## Boundaries and error handling

The feature is limited to the Admin CRM Schedules view. No backend schema or endpoint changes are needed. A failed POST follows the current form error path and leaves the source schedule intact. The Copy action should not pass an edit identifier to the form submit handler, ensuring the operation cannot accidentally PATCH the source.

## Verification

- Static/runtime checks confirm Copy is rendered in schedule rows, the Actions column is second, and copied values are passed to the create form.
- Browser smoke testing confirms Copy opens a prefilled form, changing values is possible, and submitting creates new rows without modifying the source.

