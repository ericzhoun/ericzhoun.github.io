// Groups enrollment rows created in the same checkout (sharing one
// stripe_order_id) so the account page can render them as one card. Rows
// without a stripe_order_id (not yet paid, or predating this grouping)
// each form their own single-row group.
export function groupEnrollmentsByOrder(enrollments) {
  const order = [];
  const byKey = new Map();
  enrollments.forEach((en) => {
    const key = en.stripe_order_id || en.id;
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key);
    }
    byKey.get(key).push(en);
  });
  return order.map((key) => byKey.get(key));
}
