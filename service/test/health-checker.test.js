import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  checkNamespace,
  computeUpPercentage,
  HealthChecker,
  STATUS_DOWN,
  STATUS_HEALTHY,
  STATUS_UNHEALTHY,
  STATUS_UP,
} from "../src/health-checker.js";

let server;
let baseUrl;

beforeEach(async () => {
  server = createServer((req, res) => {
    if (req.url === "/ok") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } else if (req.url === "/ok-capital") {
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

describe("computeUpPercentage", () => {
  it("rounds to two decimals and handles zero", () => {
    expect(computeUpPercentage(1, 2)).toBe(50);
    expect(computeUpPercentage(2, 3)).toBe(66.67);
    expect(computeUpPercentage(0, 4)).toBe(0);
    expect(computeUpPercentage(3, 0)).toBe(null);
  });
});

describe("HealthChecker.checkAll", () => {
  it("reports healthy when all endpoints respond 2xx", async () => {
    const checker = new HealthChecker([`${baseUrl}/ok`, `${baseUrl}/ok`]);
    const result = await checker.checkAll();

    expect(result.status).toBe(STATUS_HEALTHY);
    expect(result.upPercentage).toBe(100);
    expect(result.services.length).toBe(2);
    expect(result.services.every((s) => s.status === STATUS_UP)).toBeTruthy();
    expect(
      result.services.every((s) => s.statusCode === 200),
    ).toBeTruthy();
  });

  it("computes the up percentage for partially down services", async () => {
    const checker = new HealthChecker([
      `${baseUrl}/ok`,
      `${baseUrl}/ok`,
      `${baseUrl}/degraded`,
    ]);
    const result = await checker.checkAll();

    expect(result.status).toBe(STATUS_UNHEALTHY);
    expect(result.upPercentage).toBe(66.67);
    expect(result.services.length).toBe(3);
  });

  it("reports unhealthy when any endpoint fails", async () => {
    const checker = new HealthChecker([`${baseUrl}/ok`, `${baseUrl}/error`]);
    const result = await checker.checkAll();

    expect(result.status).toBe(STATUS_UNHEALTHY);
    expect(result.services[1].status).toBe(STATUS_DOWN);
    expect(result.services[1].statusCode).toBe(500);
  });

  it("treats a capitalized {status:Ok} body as up", async () => {
    const checker = new HealthChecker([`${baseUrl}/ok-capital`]);
    const result = await checker.checkAll();

    expect(result.status).toBe(STATUS_HEALTHY);
    expect(result.services[0].status).toBe(STATUS_UP);
    expect(result.services[0].bodyStatus).toBe("Ok");
  });

  it("marks an endpoint down when the body status is not ok", async () => {
    const checker = new HealthChecker([`${baseUrl}/degraded`]);
    const result = await checker.checkAll();

    expect(result.status).toBe(STATUS_UNHEALTHY);
    expect(result.services[0].status).toBe(STATUS_DOWN);
    expect(result.services[0].statusCode).toBe(200);
    expect(result.services[0].bodyStatus).toBe("error");
  });

  it("falls back to HTTP status when the body has no status field", async () => {
    const checker = new HealthChecker([`${baseUrl}/missing-status`]);
    const result = await checker.checkAll();

    expect(result.status).toBe(STATUS_HEALTHY);
    expect(result.services[0].status).toBe(STATUS_UP);
    expect(result.services[0].bodyStatus).toBe(null);
  });

  it("falls back to HTTP status for non-JSON bodies", async () => {
    const checker = new HealthChecker([`${baseUrl}/plain`]);
    const result = await checker.checkAll();

    expect(result.status).toBe(STATUS_HEALTHY);
    expect(result.services[0].status).toBe(STATUS_UP);
    expect(result.services[0].bodyStatus).toBe(null);
  });

  it("marks unreachable endpoints as down with error", async () => {
    const checker = new HealthChecker(["http://127.0.0.1:1/unreachable"]);
    const result = await checker.checkAll();

    expect(result.status).toBe(STATUS_UNHEALTHY);
    expect(result.services[0].status).toBe(STATUS_DOWN);
    expect(result.services[0].statusCode).toBe(null);
    expect(result.services[0].error.length).toBeGreaterThan(0);
  });

  it("aborts slow requests when a timeout is configured", async () => {
    const checker = new HealthChecker([`${baseUrl}/slow`], {
      timeoutMs: 100,
    });
    const result = await checker.checkAll();

    expect(result.status).toBe(STATUS_UNHEALTHY);
    expect(result.services[0].status).toBe(STATUS_DOWN);
    expect(result.services[0].error).toBe("Request timed out");
  });
});

describe("checkNamespace", () => {
  it("reports a namespace with all healthy endpoints as healthy", async () => {
    const result = await checkNamespace({
      endpoints: [`${baseUrl}/ok`, `${baseUrl}/ok-capital`],
      timeoutMs: null,
    });

    expect(result.status).toBe(STATUS_HEALTHY);
    expect(result.upPercentage).toBe(100);
    expect(result.services[0].status).toBe(STATUS_UP);
    expect(result.services[1].bodyStatus).toBe("Ok");
  });

  it("reports unhealthy when any endpoint in the namespace is down", async () => {
    const result = await checkNamespace({
      endpoints: [`${baseUrl}/ok`, `${baseUrl}/degraded`],
      timeoutMs: null,
    });

    expect(result.status).toBe(STATUS_UNHEALTHY);
    expect(result.upPercentage).toBe(50);
    expect(result.services[1].status).toBe(STATUS_DOWN);
  });

  it("reports an empty namespace as healthy with no services", async () => {
    const result = await checkNamespace({
      endpoints: [],
      timeoutMs: null,
    });

    expect(result.status).toBe(STATUS_HEALTHY);
    expect(result.upPercentage).toBe(null);
    expect(result.services).toEqual([]);
  });
});
