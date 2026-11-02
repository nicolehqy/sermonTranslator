import { test } from "node:test";
import assert from "node:assert/strict";
import { accessRequired, accessToken, cookieHasValidAccess, cookieValue, passwordIsValid } from "../src/lib/site-access.ts";

const originalPassword = process.env.SITE_PASSWORD;
const originalVercel = process.env.VERCEL;
function restore() {
  if (originalPassword === undefined) delete process.env.SITE_PASSWORD; else process.env.SITE_PASSWORD = originalPassword;
  if (originalVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = originalVercel;
}

test("local development remains open without a configured access code", async () => {
  try { delete process.env.SITE_PASSWORD; delete process.env.VERCEL; assert.equal(accessRequired(), false); assert.equal(await cookieHasValidAccess(undefined), true); }
  finally { restore(); }
});

test("hosted access fails closed until a code is configured", async () => {
  try { delete process.env.SITE_PASSWORD; process.env.VERCEL = "1"; assert.equal(accessRequired(), true); assert.equal(await cookieHasValidAccess(undefined), false); }
  finally { restore(); }
});

test("only the derived session token grants access", async () => {
  try {
    process.env.SITE_PASSWORD = "shared-secret";
    assert.equal(await passwordIsValid("wrong"), false); assert.equal(await passwordIsValid("shared-secret"), true);
    assert.equal(await cookieHasValidAccess("wrong"), false); assert.equal(await cookieHasValidAccess(await accessToken() ?? undefined), true);
  } finally { restore(); }
});

test("reads the exact access cookie name", () => {
  assert.equal(cookieValue("other=x; sermon-translator-access=token", "sermon-translator-access"), "token");
  assert.equal(cookieValue("sermon-translator-access-copy=wrong", "sermon-translator-access"), undefined);
});
