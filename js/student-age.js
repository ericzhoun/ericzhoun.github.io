// Student age is always derived from the date of birth. Use calendar dates
// rather than elapsed milliseconds so birthdays and leap years are correct.
export function calculateAge(dob, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob || "")) return null;

  const [year, month, day] = dob.split("-").map(Number);
  const birthDate = new Date(Date.UTC(year, month - 1, day));
  if (
    birthDate.getUTCFullYear() !== year ||
    birthDate.getUTCMonth() !== month - 1 ||
    birthDate.getUTCDate() !== day
  ) return null;

  const age = today.getUTCFullYear() - year;
  const birthdayHasPassed =
    today.getUTCMonth() > month - 1 ||
    (today.getUTCMonth() === month - 1 && today.getUTCDate() >= day);
  return age - (birthdayHasPassed ? 0 : 1);
}

// Student profiles require an actual date of birth, so dates after the
// current UTC calendar date are invalid. Checkout retains its established
// calculateAge behavior independently.
export function calculateStudentAge(dob, today = new Date()) {
  const age = calculateAge(dob, today);
  return age == null || age < 0 ? null : age;
}
