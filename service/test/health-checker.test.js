import assert from "node:assert/strict";
import { createServer } from "node:http";
import { beforeEach, afterEach, test } from "node:test";

import { getConfig, normalizeUrl, parseEndpoints } from "../src/config.js";
import {
  checkNamespaces,
  computeUpPercentage,
  HealthChecker,
} from "../src/health-checker.js";

let server;
let baseUrl;

beforeEach(async () => {
  server = createServer((req, res) => {
    if (req.url === "/ok") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } else if (req.url === "/ok-capital") {
      // Mirrors the real {status:"Ok"} health endpoint format.
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "Ok" }));
    } else if (req.url === "/degraded") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "error" }));
    } else if (req.url === "/missing-status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ foo: "bar" }));
    } else if (req.url === "/plain") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("OK");
    } else if (req.url === "/slow") {
      // Responds after 300ms so timeouts can be tested.
      setTimeout(() => {
        res.writeHead(200);
        res.end();
      }, 300);
    } else {
      res.writeHead(500);
      res.end();
    }
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("parseEndpoints trims, drops empties, and normalizes schemes", () => {
  assert.deepEqual(
    parseEndpoints(" https://a.com ,,https://b.com , "),
    ["https://a.com", "https://b.com"],
  );
  assert.deepEqual(
    parseEndpoints("localhost:8080/health,127.0.0.1:9090/health"),
    ["http://localhost:8080/health", "http://127.0.0.1:9090/health"],
  );
  assert.deepEqual(parseEndpoints(undefined), []);
  assert.deepEqual(parseEndpoints(""), []);
});

test("normalizeUrl leaves http/https URLs untouched", () => {
  assert.equal(normalizeUrl("https://a.com/x"), "https://a.com/x");
  assert.equal(normalizeUrl("http://a.com/x"), "http://a.com/x");
  assert.equal(normalizeUrl("a.com/x"), "http://a.com/x");
  assert.equal(normalizeUrl("localhost:8080"), "http://localhost:8080");
});

test("getConfig maps env vars into storefront and search namespaces", () => {
  assert.deepEqual(getConfig({}), {
    storefront: { endpoints: [], timeoutMs: null },
    search: { endpoints: [], timeoutMs: null },
  });

  assert.deepEqual(
    getConfig({
      STOREFRONT_HEALTH_CHECK_ENDPOINTS: `${baseUrl}/ok`,
      SEARCH_HEALTH_CHECK_ENDPOINTS: `${baseUrl}/ok-capital`,
      HEALTH_CHECK_TIMEOUT_MS: "2500",
    }),
    {
      storefront: { endpoints: [`${baseUrl}/ok`], timeoutMs: 2500 },
      search: { endpoints: [`${baseUrl}/ok-capital`], timeoutMs: 2500 },
    },
  );
});

test("checkAll reports healthy when all endpoints respond 2xx", async () => {
  const checker = new HealthChecker([`${baseUrl}/ok`, `${baseUrl}/ok`]);
  const result = await checker.checkAll();

  assert.equal(result.status, "healthy");
  assert.equal(result.upPercentage, 100);
  assert.equal(result.services.length, 2);
  assert.ok(result.services.every((s) => s.status === "up"));
  assert.ok(result.services.every((s) => s.statusCode === 200));
});

test("checkAll computes the up percentage for partially down services", async () => {
  const checker = new HealthChecker([
    `${baseUrl}/ok`,
    `${baseUrl}/ok`,
    `${baseUrl}/degraded`,
  ]);
  const result = await checker.checkAll();

  assert.equal(result.status, "unhealthy");
  assert.equal(result.upPercentage, 66.67);
  assert.equal(result.services.length, 3);
});

test("computeUpPercentage rounds to two decimals and handles zero", () => {
  assert.equal(computeUpPercentage(1, 2), 50);
  assert.equal(computeUpPercentage(2, 3), 66.67);
  assert.equal(computeUpPercentage(0, 4), 0);
  assert.equal(computeUpPercentage(3, 0), null);
});

test("checkAll reports unhealthy when any endpoint fails", async () => {
  const checker = new HealthChecker([`${baseUrl}/ok`, `${baseUrl}/error`]);
  const result = await checker.checkAll();

  assert.equal(result.status, "unhealthy");
  assert.equal(result.services[1].status, "down");
  assert.equal(result.services[1].statusCode, 500);
});

test("checkAll treats a capitalized {status:Ok} body as up", async () => {
  const checker = new HealthChecker([`${baseUrl}/ok-capital`]);
  const result = await checker.checkAll();

  assert.equal(result.status, "healthy");
  assert.equal(result.services[0].status, "up");
  assert.equal(result.services[0].bodyStatus, "Ok");
});

test("checkAll marks an endpoint down when the body status is not ok", async () => {
  const checker = new HealthChecker([`${baseUrl}/degraded`]);
  const result = await checker.checkAll();

  assert.equal(result.status, "unhealthy");
  assert.equal(result.services[0].status, "down");
  assert.equal(result.services[0].statusCode, 200);
  assert.equal(result.services[0].bodyStatus, "error");
});

test("checkAll falls back to HTTP status when the body has no status field", async () => {
  const checker = new HealthChecker([`${baseUrl}/missing-status`]);
  const result = await checker.checkAll();

  assert.equal(result.status, "healthy");
  assert.equal(result.services[0].status, "up");
  assert.equal(result.services[0].bodyStatus, null);
});

test("checkAll falls back to HTTP status for non-JSON bodies", async () => {
  const checker = new HealthChecker([`${baseUrl}/plain`]);
  const result = await checker.checkAll();

  assert.equal(result.status, "healthy");
  assert.equal(result.services[0].status, "up");
  assert.equal(result.services[0].bodyStatus, null);
});

test("checkAll marks unreachable endpoints as down with error", async () => {
  const checker = new HealthChecker(["http://127.0.0.1:1/unreachable"]);
  const result = await checker.checkAll();

  assert.equal(result.status, "unhealthy");
  assert.equal(result.services[0].status, "down");
  assert.equal(result.services[0].statusCode, null);
  assert.ok(result.services[0].error.length > 0);
});

test("checkAll aborts slow requests when a timeout is configured", async () => {
  const checker = new HealthChecker([`${baseUrl}/slow`], { timeoutMs: 100 });
  const result = await checker.checkAll();

  assert.equal(result.status, "unhealthy");
  assert.equal(result.services[0].status, "down");
  assert.equal(result.services[0].error, "Request timed out");
});

test("checkNamespaces groups results per namespace when all are healthy", async () => {
  const namespaces = {
    storefront: { endpoints: [`${baseUrl}/ok`], timeoutMs: null },
    search: { endpoints: [`${baseUrl}/ok-capital`], timeoutMs: null },
  };

  const result = await checkNamespaces(namespaces);

  assert.equal(result.status, "healthy");
  assert.deepEqual(Object.keys(result.namespaces).sort(), ["search", "storefront"]);
  assert.equal(result.namespaces.storefront.status, "healthy");
  assert.equal(result.namespaces.storefront.upPercentage, 100);
  assert.equal(result.namespaces.storefront.services[0].status, "up");
  assert.equal(result.namespaces.search.status, "healthy");
  assert.equal(result.namespaces.search.upPercentage, 100);
  assert.equal(result.namespaces.search.services[0].bodyStatus, "Ok");
});

test("checkNamespaces reports unhealthy when any namespace is down", async () => {
  const namespaces = {
    storefront: { endpoints: [`${baseUrl}/ok`], timeoutMs: null },
    search: { endpoints: [`${baseUrl}/degraded`], timeoutMs: null },
  };

  const result = await checkNamespaces(namespaces);

  assert.equal(result.status, "unhealthy");
  assert.equal(result.namespaces.storefront.status, "healthy");
  assert.equal(result.namespaces.search.status, "unhealthy");
  assert.equal(result.namespaces.search.services[0].status, "down");
});

test("checkNamespaces reports an empty namespace as healthy", async () => {
  const namespaces = {
    storefront: { endpoints: [], timeoutMs: null },
    search: { endpoints: [`${baseUrl}/ok`], timeoutMs: null },
  };

  const result = await checkNamespaces(namespaces);

  assert.equal(result.status, "healthy");
  assert.equal(result.upPercentage, 100);
  assert.deepEqual(result.namespaces.storefront, {
    status: "healthy",
    upPercentage: null,
    services: [],
  });
});

test("checkNamespaces computes overall up percentage across namespaces", async () => {
  const namespaces = {
    storefront: {
      endpoints: [`${baseUrl}/ok`, `${baseUrl}/ok`, `${baseUrl}/degraded`],
      timeoutMs: null,
    },
    search: {
      endpoints: [`${baseUrl}/ok`],
      timeoutMs: null,
    },
  };

  const result = await checkNamespaces(namespaces);

  assert.equal(result.status, "unhealthy");
  assert.equal(result.namespaces.storefront.upPercentage, 66.67);
  assert.equal(result.namespaces.search.upPercentage, 100);
  assert.equal(result.upPercentage, 75);
});

test("checkNamespaces excludes empty namespaces from the overall percentage", async () => {
  const namespaces = {
    storefront: { endpoints: [], timeoutMs: null },
    search: {
      endpoints: [`${baseUrl}/ok`, `${baseUrl}/degraded`],
      timeoutMs: null,
    },
  };

  const result = await checkNamespaces(namespaces);

  assert.equal(result.status, "unhealthy");
  assert.equal(result.upPercentage, 50);
});

test("checkNamespaces reports null overall percentage when every namespace is empty", async () => {
  const result = await checkNamespaces({
    storefront: { endpoints: [], timeoutMs: null },
    search: { endpoints: [], timeoutMs: null },
  });

  assert.equal(result.status, "healthy");
  assert.equal(result.upPercentage, null);
});