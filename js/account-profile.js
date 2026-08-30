export function getContactValue({ draft, profile, enrollment }, key) {
  if (draft && Object.hasOwn(draft, key)) return draft[key] ?? "";
  if (profile?.[key] != null) return profile[key];
  if (enrollment?.[key] != null) return enrollment[key];
  return "";
}
