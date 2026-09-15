import { describe, expect, it } from "vitest";

import { createHealthHandler } from "../index.js";
import { STATUS_HEALTHY, STATUS_UNHEALTHY } from "../src/health-checker.js";

const resSpy = () => {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
};

describe("createHealthHandler", () => {
  const namespaceConfig = (endpoints = []) => ({ endpoints, timeoutMs: null });

  it("returns 200 with the storefront result for /storefront", async () => {
    const handler = createHealthHandler({
      config: () => ({ storefront: namespaceConfig(), search: namespaceConfig() }),
      checker: async () => ({
        status: STATUS_HEALTHY,
        upPercentage: 100,
        timestamp: "2026-01-01T00:00:00.000Z",
        services: [],
      }),
    });

    const res = resSpy();
    const returned = await handler(
      { method: "GET", path: "/storefront" },
      res,
    );

    expect(returned.statusCode).toBe(200);
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe(STATUS_HEALTHY);
    expect(res.body.upPercentage).toBe(100);
  });

  it("returns 200 with the search result for /search", async () => {
    const handler = createHealthHandler({
      config: () => ({ storefront: namespaceConfig(), search: namespaceConfig() }),
      checker: async () => ({
        status: STATUS_HEALTHY,
        upPercentage: 100,
        timestamp: "2026-01-01T00:00:00.000Z",
        services: [],
      }),
    });

    const res = resSpy();
    const returned = await handler({ method: "GET", path: "/search" }, res);

    expect(returned.statusCode).toBe(200);
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe(STATUS_HEALTHY);
  });

  it("returns 503 when the namespace is unhealthy", async () => {
    const handler = createHealthHandler({
      config: () => ({ storefront: namespaceConfig(), search: namespaceConfig() }),
      checker: async () => ({
        status: STATUS_UNHEALTHY,
        upPercentage: 50,
        timestamp: "2026-01-01T00:00:00.000Z",
        services: [],
      }),
    });

    const res = resSpy();
    await handler({ method: "GET", path: "/search" }, res);

    expect(res.statusCode).toBe(503);
    expect(res.body.status).toBe(STATUS_UNHEALTHY);
  });

  it("rejects unknown paths with 404", async () => {
    let checkerCalled = false;
    const handler = createHealthHandler({
      config: () => ({}),
      checker: async () => {
        checkerCalled = true;
        return {};
      },
    });

    const res = resSpy();
    const returned = await handler({ method: "GET", path: "/admin" }, res);

    expect(returned.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
    expect(checkerCalled).toBe(false);
  });

  it("rejects non-GET methods with 405", async () => {
    let checkerCalled = false;
    const handler = createHealthHandler({
      config: () => ({}),
      checker: async () => {
        checkerCalled = true;
        return {};
      },
    });

    const res = resSpy();
    const returned = await handler({ method: "POST" }, res);

    expect(returned.statusCode).toBe(405);
    expect(res.body).toEqual({ error: "Method not allowed" });
    expect(checkerCalled).toBe(false);
  });

  it("passes the matching namespace config into the checker", async () => {
    const config = () => ({
      storefront: namespaceConfig(["http://a"]),
      search: namespaceConfig(),
    });
    let received;
    const handler = createHealthHandler({
      config,
      checker: async (namespace) => {
        received = namespace;
        return {
          status: STATUS_HEALTHY,
          upPercentage: 100,
          timestamp: "2026-01-01T00:00:00.000Z",
          services: [],
        };
      },
    });

    const res = resSpy();
    await handler({ method: "GET", path: "/storefront" }, res);

    expect(received).toEqual(config().storefront);
  });
});
