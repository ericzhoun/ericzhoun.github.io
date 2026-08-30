import assert from "node:assert/strict";
import { test } from "node:test";
import {
  WEEK_DAYS,
  compareDayOfWeek,
  scheduleBundleKey,
  groupCampBundles,
  campBundleQuery,
  looseScheduleBundleKey,
  looseBundleQuery,
} from "../js/api.js";

test("WEEK_DAYS lists Monday through Sunday in order", () => {
  assert.deepEqual(WEEK_DAYS, ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
});

test("compareDayOfWeek sorts day names into Monday..Sunday order", () => {
  const days = ["Friday", "Monday", "Wednesday"];
  assert.deepEqual([...days].sort(compareDayOfWeek), ["Monday", "Wednesday", "Friday"]);
});

test("scheduleBundleKey matches rows with identical bundle fields and differs when any field changes", () => {
  const base = {
    program_id: "p1", semester_id: "s1", session_type: "standard",
    start_time: "09:00", end_time: "12:00", age_group: "6-10",
    price_cents: 7000, max_seats: 12,
  };
  const sameBundleDifferentDay = { ...base, day_of_week: "Tuesday" };
  const differentPrice = { ...base, price_cents: 8000 };

  assert.equal(scheduleBundleKey(base), scheduleBundleKey(sameBundleDifferentDay));
  assert.notEqual(scheduleBundleKey(base), scheduleBundleKey(differentPrice));
});

test("groupCampBundles collapses a camp program's rows into one bundle and leaves class programs as singles", () => {
  const programs = [
    { id: "camp-1", program_type: "camp" },
    { id: "class-1", program_type: "class" },
  ];
  const campRow = (day) => ({
    id: `camp-${day}`, program_id: "camp-1", semester_id: "sem-1", session_type: "standard",
    start_time: "09:00", end_time: "12:00", age_group: "6-10", price_cents: 7000, max_seats: 12,
    day_of_week: day,
  });
  const schedules = [
    campRow("Wednesday"), campRow("Monday"), campRow("Friday"), campRow("Tuesday"), campRow("Thursday"),
    {
      id: "class-row", program_id: "class-1", semester_id: "sem-1", session_type: "standard",
      start_time: "16:00", end_time: "17:00", age_group: "7-12", price_cents: 3500, max_seats: 8,
      day_of_week: "Monday",
    },
  ];

  const { bundles, singles } = groupCampBundles(schedules, programs);

  assert.equal(bundles.length, 1);
  assert.deepEqual(bundles[0].days, ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
  assert.equal(bundles[0].totalCents, 35000);
  assert.equal(bundles[0].pricePerClassCents, 7000);
  assert.equal(bundles[0].startTime, "09:00");
  assert.equal(bundles[0].programId, "camp-1");
  assert.equal(singles.length, 1);
  assert.equal(singles[0].id, "class-row");
});

test("groupCampBundles treats a program with no program_type as a regular class", () => {
  const programs = [{ id: "legacy-1" }];
  const schedules = [{
    id: "row-1", program_id: "legacy-1", semester_id: "sem-1", session_type: "standard",
    start_time: "10:00", end_time: "11:00", age_group: "7-12", price_cents: 3000, max_seats: 6,
    day_of_week: "Saturday",
  }];

  const { bundles, singles } = groupCampBundles(schedules, programs);

  assert.equal(bundles.length, 0);
  assert.equal(singles.length, 1);
});

test("campBundleQuery builds a REST filter matching every bundle field", () => {
  const schedule = {
    program_id: "p1", semester_id: "s1", session_type: "standard",
    start_time: "09:00", end_time: "12:00", age_group: "6-10",
    price_cents: 7000, max_seats: 12,
  };
  assert.equal(
    campBundleQuery(schedule),
    "class_schedules?program_id=eq.p1&semester_id=eq.s1&session_type=eq.standard" +
      "&start_time=eq.09:00&end_time=eq.12:00&age_group=eq.6-10" +
      "&price_cents=eq.7000&max_seats=eq.12&active=eq.true&order=day_of_week.asc"
  );
});

test("looseScheduleBundleKey matches rows with different start/end times but differs when program/price/etc changes", () => {
  const base = {
    program_id: "p1", semester_id: "s1", session_type: "standard",
    start_time: "16:00", end_time: "17:00", age_group: "6-10",
    price_cents: 7000, max_seats: 12,
  };
  const differentTime = { ...base, start_time: "17:00", end_time: "18:00" };
  const differentPrice = { ...base, price_cents: 8000 };

  assert.equal(looseScheduleBundleKey(base), looseScheduleBundleKey(differentTime));
  assert.notEqual(looseScheduleBundleKey(base), looseScheduleBundleKey(differentPrice));
});

test("looseBundleQuery builds a REST filter matching every bundle field except time", () => {
  const schedule = {
    program_id: "p1", semester_id: "s1", session_type: "standard",
    start_time: "09:00", end_time: "12:00", age_group: "6-10",
    price_cents: 7000, max_seats: 12,
  };
  assert.equal(
    looseBundleQuery(schedule),
    "class_schedules?program_id=eq.p1&semester_id=eq.s1&session_type=eq.standard" +
      "&age_group=eq.6-10&price_cents=eq.7000&max_seats=eq.12&active=eq.true&order=day_of_week.asc"
  );
});
