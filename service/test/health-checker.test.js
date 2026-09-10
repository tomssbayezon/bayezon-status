import assert from "node:assert/strict";
import { createServer } from "node:http";
import { beforeEach, afterEach, test } from "node:test";

import { getConfig, parseEndpoints } from "../src/config.js";
import { HealthChecker } from "../src/health-checker.js";

let server;
let baseUrl;

beforeEach(async () => {
  server = createServer((req, res) => {
    if (req.url === "/ok") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
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

test("parseEndpoints trims and drops empty entries", () => {
  assert.deepEqual(
    parseEndpoints(" https://a.com ,,https://b.com , "),
    ["https://a.com", "https://b.com"],
  );
  assert.deepEqual(parseEndpoints(undefined), []);
  assert.deepEqual(parseEndpoints(""), []);
});

test("getConfig reads endpoints and optional timeout", () => {
  assert.deepEqual(getConfig({}), {
    endpoints: [],
    timeoutMs: null,
  });

  assert.deepEqual(
    getConfig({
      HEALTH_CHECK_ENDPOINTS: `${baseUrl}/ok`,
      HEALTH_CHECK_TIMEOUT_MS: "2500",
    }),
    {
      endpoints: [`${baseUrl}/ok`],
      timeoutMs: 2500,
    },
  );
});

test("checkAll reports healthy when all endpoints respond 2xx", async () => {
  const checker = new HealthChecker([`${baseUrl}/ok`, `${baseUrl}/ok`]);
  const result = await checker.checkAll();

  assert.equal(result.status, "healthy");
  assert.equal(result.services.length, 2);
  assert.ok(result.services.every((s) => s.status === "up"));
  assert.ok(result.services.every((s) => s.statusCode === 200));
});

test("checkAll reports unhealthy when any endpoint fails", async () => {
  const checker = new HealthChecker([`${baseUrl}/ok`, `${baseUrl}/error`]);
  const result = await checker.checkAll();

  assert.equal(result.status, "unhealthy");
  assert.equal(result.services[1].status, "down");
  assert.equal(result.services[1].statusCode, 500);
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