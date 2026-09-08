import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

// The Google OAuth consent screen requires a hosted privacy policy URL;
// privacy.html is that page (https://olivistart.com/privacy.html).
test("privacy page exists and follows the shared page conventions", async () => {
  const html = await read("privacy.html");
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="assets\/favicon\.svg">/);
  assert.match(html, /class="skip-link" href="#main-content"/);
  assert.match(html, /<main id="main-content">/);
  assert.match(html, /<title>Privacy Policy \| OliVista Art Studio<\/title>/);
  // Google sign-in disclosure required by Google's OAuth policies.
  assert.match(html, /Sign in with Google/);
  assert.match(html, /myaccount\.google\.com\/permissions/);
  // Covers the data the system actually handles.
  assert.match(html, /Stripe/);
  assert.match(html, /Butterbase/);
  assert.match(html, /olivistastudio@gmail\.com/);
});

test("public pages link the privacy policy in the footer", async () => {
  const pages = [
    "about.html",
    "account.html",
    "auth-callback.html",
    "checkout-success.html",
    "contact.html",
    "enroll.html",
    "index.html",
    "login.html",
    "portfolio.html",
    "privacy.html",
    "registration.html",
    "schedule.html",
    "signup.html",
  ];

  for (const page of pages) {
    const html = await read(page);
    assert.match(html, /<a href="privacy\.html">Privacy Policy<\/a>/, `${page} should link the privacy policy`);
  }
});
