import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("every page declares the shared favicon", async () => {
  const pages = [
    "about.html",
    "account.html",
    "admin.html",
    "checkout-success.html",
    "contact.html",
    "enroll.html",
    "index.html",
    "login.html",
    "portfolio.html",
    "qr-code.html",
    "registration.html",
    "schedule.html",
    "signup.html",
  ];

  for (const page of pages) {
    assert.match(
      await read(page),
      /<link rel="icon" type="image\/svg\+xml" href="assets\/favicon\.svg">/,
      `${page} should prevent the browser's missing /favicon.ico fallback`,
    );
  }

  assert.match(await read("assets/favicon.svg"), /^<svg[^>]*aria-hidden="true"/);
});

test("public pages expose a skip link and main-content target", async () => {
  const pages = ["index.html", "schedule.html", "about.html", "contact.html", "portfolio.html"];

  for (const page of pages) {
    const html = await read(page);
    assert.match(html, /class="skip-link" href="#main-content"/);
    assert.match(html, /<main id="main-content">/);
  }
});

test("public headers omit the Programs tab", async () => {
  const pages = [
    "index.html",
    "about.html",
    "account.html",
    "checkout-success.html",
    "contact.html",
    "enroll.html",
    "login.html",
    "portfolio.html",
    "registration.html",
    "schedule.html",
    "signup.html",
  ];

  for (const page of pages) {
    const html = await read(page);
    const navigation = html.match(/<nav class="site-nav"[\s\S]*?<\/nav>/)?.[0];
    assert.ok(navigation, `${page} should contain the site navigation`);
    assert.doesNotMatch(navigation, />Programs<\/a>/);
    assert.doesNotMatch(navigation, /index\.html#programs/);
  }

  assert.match(await read("index.html"), /<section id="programs" class="programs-overview">/);
});

test("standalone Programs page has been removed", async () => {
  await assert.rejects(read("programs.html"), { code: "ENOENT" });
});

test("shared styles preserve keyboard focus and reduce motion", async () => {
  const css = await read("css/style.css");

  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(css, /transition:\s*all/);
});

test("homepage presents the complete Programs flow in the revised order", async () => {
  const index = await read("index.html");
  assert.match(
    index,
    /<section id="programs" class="programs-overview">\s*<!-- Age-to-Program Mapping -->\s*<div class="container age-mapping">/,
  );

  const orderedMarkers = [
    'id="programs"',
    'class="container age-mapping"',
    'class="container philosophy-teaser"',
    'class="cta-banner"',
    'id="visual-discovery"',
    'id="young-photographer"',
    'id="creative-foundations"',
    'id="portfolio-studio"',
  ];

  let previousPosition = -1;
  for (const marker of orderedMarkers) {
    const position = index.indexOf(marker, previousPosition + 1);
    assert.ok(position > previousPosition, `${marker} should appear in the revised homepage order`);
    previousPosition = position;
  }

  assert.match(index, /assets\/art-class\/artPortfolio2\.bak\.jpg/);
  assert.match(
    index,
    /src="assets\/art-class\/artPortfolio2\.bak\.jpg"\s+alt="Student color painting from the Portfolio Studio" width="446" height="502"/,
  );
  assert.match(index, /<h2>Young Photographer Camp<\/h2>/);
  assert.doesNotMatch(index, /class="teaser-grid"/);
});

test("homepage anchors clear the sticky navigation", async () => {
  const css = await read("css/style.css");
  assert.match(css, /#programs,\s*\.program-section\s*\{[^}]*scroll-margin-top:\s*88px/s);

  const programPhotoRule = css.indexOf(".program-photo {");
  const mobileProgramLayout = css.indexOf("@media (max-width: 800px)");
  assert.ok(programPhotoRule !== -1 && programPhotoRule < mobileProgramLayout);
});

test("every call-to-action banner promotes the current Fall schedule", async () => {
  const pages = ["index.html", "about.html", "contact.html", "portfolio.html"];
  for (const page of pages) {
    const markup = await read(page);
    assert.match(
      markup,
      /<p>Book now for limited spots available this Fall<\/p>/,
      `${page} banner copy is stale`,
    );
    // The semester parameter is matched against the semester NAME in
    // pickDefaultSemester, so it has to stay in sync with the database.
    assert.match(
      markup,
      /<a class="btn" href="schedule\.html\?semester=Fall%202026">Fall Class Schedule<\/a>/,
      `${page} does not link to the Fall schedule`,
    );
    assert.doesNotMatch(markup, /Summer Class Schedule/, `${page} still offers Summer`);
    assert.doesNotMatch(markup, /available in July/, `${page} still names July`);
  }
  const index = await read("index.html");
  assert.doesNotMatch(index, /Reach out to learn more or ask about enrolling your child\./);
});

test("auth fields include meaningful names, autocomplete, and live status", async () => {
  const [login, signup] = await Promise.all([read("login.html"), read("signup.html")]);

  assert.match(login, /name="email"[^>]*autocomplete="email"[^>]*spellcheck="false"/);
  assert.match(login, /name="password"[^>]*autocomplete="current-password"/);
  assert.match(signup, /name="name"[^>]*autocomplete="name"/);
  assert.match(signup, /id="auth-error"[^>]*aria-live="polite"/);
  assert.match(signup, /id="auth-info"[^>]*aria-live="polite"/);
});

test("content images and controls have stable, meaningful semantics", async () => {
  const [about, contact, portfolio, index, qr] = await Promise.all([
    read("about.html"),
    read("contact.html"),
    read("portfolio.html"),
    read("index.html"),
    read("qr-code.html"),
  ]);

  assert.match(about, /<h2><img src="assets\/Olivia_teaching\.png" alt="Olivia Liu" width="306" hspace="10" height="240" align="left"><\/h2>/);
  assert.match(contact, /wechat-qr\.png"[^>]*width="344"[^>]*height="344"/);
  assert.match(qr, /alt="QR Code"[^>]*width="512"[^>]*height="512"/);
  assert.match(portfolio, /class="portfolio-thumb" type="button" aria-label="Open Visual Discovery artwork 1"/);
  assert.doesNotMatch(index, /alt="kids draw"|alt="color painting"/);
});

test("contact page provides an accessible, responsive studio location map", async () => {
  const [contact, css] = await Promise.all([read("contact.html"), read("css/style.css")]);

  assert.match(contact, /<section class="contact-location"/);
  assert.match(contact, />586 Military Way, Palo Alto, CA<\/a>/);
  assert.match(contact, /href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=586%20Military%20Way%2C%20Palo%20Alto%2C%20CA"/);
  assert.match(contact, /target="_blank" rel="noopener noreferrer"/);
  assert.match(contact, /<iframe[^>]*title="Map of OliVista Art Studio at 586 Military Way, Palo Alto, CA"[^>]*loading="lazy"[^>]*referrerpolicy="no-referrer-when-downgrade"/);
  assert.match(contact, /src="https:\/\/www\.google\.com\/maps\?q=586%20Military%20Way%2C%20Palo%20Alto%2C%20CA&amp;output=embed"/);
  assert.match(css, /\.contact-map\s*\{[\s\S]*?width:\s*100%[\s\S]*?min-height:\s*360px/);
  assert.match(css, /@media \(max-width: 600px\)\s*\{[\s\S]*?\.contact-map\s*\{[\s\S]*?min-height:\s*280px/s);
});

test("account source follows the plain-hyphen copy policy", async () => {
  assert.doesNotMatch(await read("js/account.js"), /\u2014/);
});
