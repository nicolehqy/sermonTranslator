import { test } from "node:test";
import assert from "node:assert/strict";
import { isRequestOriginAllowed } from "../src/lib/request-origin.ts";

function request(origin, options = {}) {
  const headers = new Headers({ host: options.host ?? "127.0.0.1:3000" });
  if (origin !== undefined) headers.set("origin", origin);
  if (options.forwardedProtocol) {
    headers.set("x-forwarded-proto", options.forwardedProtocol);
  }
  return new Request(options.url ?? "http://localhost:3000/api/speech", {
    headers,
  });
}

test("accepts the browser-facing local origin when Next uses localhost internally", () => {
  assert.equal(
    isRequestOriginAllowed(request("http://127.0.0.1:3000")),
    true,
  );
});

test("rejects a cross-site browser origin", () => {
  assert.equal(isRequestOriginAllowed(request("https://example.com")), false);
});

test("rejects an invalid origin", () => {
  assert.equal(isRequestOriginAllowed(request("not a URL")), false);
});

test("rejects a protocol mismatch", () => {
  assert.equal(
    isRequestOriginAllowed(
      request("http://sermon.example", {
        host: "sermon.example",
        url: "http://localhost:3000/api/speech",
        forwardedProtocol: "https",
      }),
    ),
    false,
  );
});

test("continues to allow clients that do not send an origin", () => {
  assert.equal(isRequestOriginAllowed(request(undefined)), true);
});
