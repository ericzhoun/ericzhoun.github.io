import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("saving contact information captures edited values before rendering the saving state", async () => {
  const script = await readFile(new URL("../js/account.js", import.meta.url), "utf8");
  const saveHandler = script.slice(
    script.indexOf("async function handleSaveContact()"),
    script.indexOf("async function handlePwInit()")
  );

  const captureIndex = saveHandler.indexOf("const form = root.querySelector(\".profile-form\")");
  const renderIndex = saveHandler.indexOf("render();");

  assert.ok(captureIndex >= 0, "save handler should read the existing contact form");
  assert.ok(renderIndex >= 0, "save handler should render a saving state");
  assert.ok(
    captureIndex < renderIndex,
    "save handler must capture typed contact values before re-rendering replaces the form"
  );
});
