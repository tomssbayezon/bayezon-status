import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkNamespaces,
  computeUpPercentage,
  HealthChecker,
} from "../src/health-checker.js";

const JSON_BODY = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
const PLAIN_BODY = (body) => ({ ok: true, status: 200, text: async () => body });
const HTTP_ERROR = (status) => ({ ok: false, status, text: async () => "" });

test("computeUpPercentage rounds to two decimals", () => {
  assert.equal(computeUpPercentage(1, 2), 50);
  assert.equal(computeUpPercentage(2, 3), 66.67);
  assert.equal(computeUpPercentage(0, 4), 0);
  assert.equal(computeUpPercentage(3, 0), null);
});

test("checkAll returns healthy with 100 when every endpoint is up", async (t) => {
  t.mock.method(globalThis, "fetch", async () => JSON_BODY({ status: "Ok" }));

  const result = await new HealthChecker(["http://a/x", "http://b/x"]).checkAll();

  assert.equal(result.status, "healthy");
  assert.equal(result.upPercentage, 100);
  assert.ok(result.services.every((s) => s.status === "up"));
  assert.ok(result.services.every((s) => s.bodyStatus === "Ok"));
});

test("checkAll marks mixed results unhealthy with the correct percentage", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url === "http://a/x") return JSON_BODY({ status: "ok" });
    if (url === "http://b/x") return JSON_BODY({ status: "error" });
    throw new Error("Connection refused");
  });

  const result = await new HealthChecker([
    "http://a/x",
    "http://b/x",
    "http://c/x",
  ]).checkAll();

  assert.equal(result.status, "unhealthy");
  assert.equal(result.upPercentage, 33.33);
  assert.equal(result.services[0].status, "up");
  assert.equal(result.services[1].status, "down");
  assert.equal(result.services[2].status, "down");
});

test("checkAll returns a uniform service shape on network failure", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Connection refused");
  });

  const result = await new HealthChecker(["http://a/x"]).checkAll();
  const service = result.services[0];

  assert.equal(service.status, "down");
  assert.equal(service.statusCode, null);
  assert.equal(service.bodyStatus, null);
  assert.equal(service.error, "Connection refused");
  assert.equal(typeof service.responseTime, "number");
  assert.ok(service.responseTime >= 0);
});

test("checkAll falls back to the HTTP status for non-JSON bodies", async (t) => {
  t.mock.method(globalThis, "fetch", async () => PLAIN_BODY("OK"));

  const result = await new HealthChecker(["http://a/x"]).checkAll();

  assert.equal(result.status, "healthy");
  assert.equal(result.services[0].status, "up");
  assert.equal(result.services[0].bodyStatus, null);
});

test("checkAll falls back to the HTTP status when the body lacks a status field", async (t) => {
  t.mock.method(globalThis, "fetch", async () => JSON_BODY({ foo: "bar" }));

  const result = await new HealthChecker(["http://a/x"]).checkAll();

  assert.equal(result.status, "healthy");
  assert.equal(result.services[0].status, "up");
  assert.equal(result.services[0].bodyStatus, null);
});

test("checkAll marks down a 500 response without a body", async (t) => {
  t.mock.method(globalThis, "fetch", async () => HTTP_ERROR(500));

  const result = await new HealthChecker(["http://a/x"]).checkAll();

  assert.equal(result.status, "unhealthy");
  assert.equal(result.services[0].status, "down");
  assert.equal(result.services[0].statusCode, 500);
});

test("checkAll reports Request timed out when the signal aborts", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    (url, { signal }) =>
      new Promise((resolve, reject) => {
        signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      }),
  );

  const result = await new HealthChecker(["http://a/x"], { timeoutMs: 50 }).checkAll();

  assert.equal(result.status, "unhealthy");
  assert.equal(result.services[0].status, "down");
  assert.equal(result.services[0].error, "Request timed out");
});

test("checkAll passes no signal when no timeout is configured", async (t) => {
  let receivedSignal;
  t.mock.method(globalThis, "fetch", async (url, { signal }) => {
    receivedSignal = signal;
    return JSON_BODY({ status: "ok" });
  });

  await new HealthChecker(["http://a/x"]).checkAll();

  assert.equal(receivedSignal, undefined);
});

test("checkNamespaces groups results per namespace without empty ones", async (t) => {
  t.mock.method(globalThis, "fetch", async () => JSON_BODY({ status: "ok" }));

  const result = await checkNamespaces({
    storefront: { endpoints: ["http://sf/x", "http://sf/y"], timeoutMs: null },
    search: { endpoints: ["http://se/x"], timeoutMs: null },
  });

  assert.deepEqual(Object.keys(result.namespaces).sort(), ["search", "storefront"]);
  assert.equal(result.namespaces.storefront.upPercentage, 100);
  assert.equal(result.namespaces.search.upPercentage, 100);
  assert.equal(result.upPercentage, 100);
  assert.equal(result.status, "healthy");
});

test("checkNamespaces computes the combined overall percentage", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) =>
    url.endsWith("/up") ? JSON_BODY({ status: "ok" }) : JSON_BODY({ status: "error" }),
  );

  const result = await checkNamespaces({
    storefront: {
      endpoints: ["http://sf/up", "http://sf/up", "http://sf/down"],
      timeoutMs: null,
    },
    search: {
      endpoints: ["http://se/up"],
      timeoutMs: null,
    },
  });

  assert.equal(result.namespaces.storefront.upPercentage, 66.67);
  assert.equal(result.namespaces.search.upPercentage, 100);
  assert.equal(result.upPercentage, 75);
});

test("checkNamespaces excludes empty namespaces from the overall percentage", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) =>
    url.endsWith("/up") ? JSON_BODY({ status: "ok" }) : JSON_BODY({ status: "error" }),
  );

  const result = await checkNamespaces({
    storefront: { endpoints: [], timeoutMs: null },
    search: { endpoints: ["http://se/up", "http://se/down"], timeoutMs: null },
  });

  assert.equal(result.namespaces.storefront.upPercentage, null);
  assert.equal(result.namespaces.search.upPercentage, 50);
  assert.equal(result.upPercentage, 50);
});

test("checkNamespaces reports a null overall percentage when all namespaces are empty", async () => {
  const result = await checkNamespaces({
    storefront: { endpoints: [], timeoutMs: null },
    search: { endpoints: [], timeoutMs: null },
  });

  assert.equal(result.status, "healthy");
  assert.equal(result.upPercentage, null);
});