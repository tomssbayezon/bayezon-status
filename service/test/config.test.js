import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getConfig,
  normalizeUrl,
  parseEndpoints,
  parseTimeout,
} from "../src/config.js";

test("normalizeUrl leaves http/https URLs untouched", () => {
  assert.equal(normalizeUrl("https://a.com/x"), "https://a.com/x");
  assert.equal(normalizeUrl("http://a.com/x"), "http://a.com/x");
  assert.equal(normalizeUrl("HTTPS://a.com/x"), "HTTPS://a.com/x");
});

test("normalizeUrl prepends http:// to scheme-less URLs", () => {
  assert.equal(normalizeUrl("a.com/x"), "http://a.com/x");
  assert.equal(normalizeUrl("localhost:8080"), "http://localhost:8080");
  assert.equal(normalizeUrl("127.0.0.1:9090/health"), "http://127.0.0.1:9090/health");
});

test("normalizeUrl trims surrounding whitespace", () => {
  assert.equal(normalizeUrl("  a.com/x  "), "http://a.com/x");
  assert.equal(normalizeUrl(" https://a.com/x "), "https://a.com/x");
});

test("parseEndpoints returns an empty list for empty input", () => {
  assert.deepEqual(parseEndpoints(undefined), []);
  assert.deepEqual(parseEndpoints(""), []);
  assert.deepEqual(parseEndpoints(" , , "), []);
});

test("parseEndpoints splits, trims, and drops empty entries", () => {
  assert.deepEqual(
    parseEndpoints(" https://a.com ,,https://b.com , "),
    ["https://a.com", "https://b.com"],
  );
});

test("parseEndpoints normalizes the scheme of each entry", () => {
  assert.deepEqual(
    parseEndpoints("localhost:8080/health,127.0.0.1:9090/health"),
    ["http://localhost:8080/health", "http://127.0.0.1:9090/health"],
  );
});

test("parseTimeout returns null for missing values", () => {
  assert.equal(parseTimeout(undefined), null);
  assert.equal(parseTimeout(""), null);
});

test("parseTimeout returns null for invalid values instead of NaN", () => {
  assert.equal(parseTimeout("abc"), null);
  assert.equal(parseTimeout("12ms"), null);
  assert.equal(parseTimeout("0"), null);
  assert.equal(parseTimeout("-5"), null);
});

test("parseTimeout parses positive integers", () => {
  assert.equal(parseTimeout("5000"), 5000);
  assert.equal(parseTimeout("  3000 "), 3000);
});

test("getConfig returns empty namespaces when no env vars are set", () => {
  assert.deepEqual(getConfig({}), {
    storefront: { endpoints: [], timeoutMs: null },
    search: { endpoints: [], timeoutMs: null },
  });
});

test("getConfig maps per-namespace endpoints and the shared timeout", () => {
  assert.deepEqual(
    getConfig({
      STOREFRONT_HEALTH_CHECK_ENDPOINTS: "localhost:8080/sf-health",
      SEARCH_HEALTH_CHECK_ENDPOINTS: "https://search.example.com/health",
      HEALTH_CHECK_TIMEOUT_MS: "2500",
    }),
    {
      storefront: {
        endpoints: ["http://localhost:8080/sf-health"],
        timeoutMs: 2500,
      },
      search: {
        endpoints: ["https://search.example.com/health"],
        timeoutMs: 2500,
      },
    },
  );
});

test("getConfig ignores an invalid shared timeout", () => {
  const config = getConfig({
    STOREFRONT_HEALTH_CHECK_ENDPOINTS: "localhost:8080/sf-health",
    HEALTH_CHECK_TIMEOUT_MS: "abc",
  });

  assert.equal(config.storefront.timeoutMs, null);
  assert.equal(config.search.timeoutMs, null);
});