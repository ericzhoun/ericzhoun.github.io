# Student age derived from date of birth

## Goal

Ensure a parent's student profile always has an accurate age by deriving it from the student's date of birth instead of accepting free-text age input.

## User experience

The account page's Add Student and Edit Student form will use a required native date picker for Date of Birth. Age remains visible as a read-only field and updates immediately whenever the date changes. The user cannot enter or alter age directly.

## Data integrity

The `manage-students` function will calculate age from the supplied date of birth for both add and update actions. It will reject missing or invalid date-of-birth values. Any client-supplied age value is ignored, preventing incorrect values from being persisted through direct API requests.

## Compatibility

The existing `students.age` and `students.dob` fields remain in use. Existing student records continue to display normally. Saving an existing student will refresh its stored age from its date of birth.

## Testing

Automated tests will verify that the account UI renders a date picker and read-only calculated age, and that the student API stores the derived age rather than a submitted age for add and update requests. Date-calculation behavior will reuse the established calendar-date rules, including birthday boundaries and invalid dates.

## Scope

This change is limited to student profile management in the account page and its API. The already-implemented registration age behavior is unchanged.
