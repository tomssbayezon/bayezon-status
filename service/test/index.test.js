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
  it("returns 200 when all namespaces are healthy", async () => {
    const handler = createHealthHandler({
      config: () => ({
        storefront: { endpoints: [] },
        search: { endpoints: [] },
      }),
      checker: async (namespaces) => ({
        status: STATUS_HEALTHY,
        upPercentage: 100,
        timestamp: "2026-01-01T00:00:00.000Z",
        namespaces,
      }),
    });

    const res = resSpy();
    const returned = await handler({ method: "GET" }, res);

    expect(returned.statusCode).toBe(200);
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe(STATUS_HEALTHY);
    expect(res.body.upPercentage).toBe(100);
  });

  it("returns 503 when any namespace is unhealthy", async () => {
    const handler = createHealthHandler({
      config: () => ({
        storefront: { endpoints: [] },
        search: { endpoints: [] },
      }),
      checker: async () => ({
        status: STATUS_UNHEALTHY,
        upPercentage: 50,
        timestamp: "2026-01-01T00:00:00.000Z",
        namespaces: {},
      }),
    });

    const res = resSpy();
    await handler({ method: "GET" }, res);

    expect(res.statusCode).toBe(503);
    expect(res.body.status).toBe(STATUS_UNHEALTHY);
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

  it("passes the config into the checker", async () => {
    const config = () => ({
      storefront: { endpoints: ["http://a"] },
      search: { endpoints: [] },
    });
    let received;
    const handler = createHealthHandler({
      config,
      checker: async (namespaces) => {
        received = namespaces;
        return {
          status: STATUS_HEALTHY,
          upPercentage: 100,
          timestamp: "2026-01-01T00:00:00.000Z",
          namespaces,
        };
      },
    });

    const res = resSpy();
    await handler({ method: "GET" }, res);

    expect(received).toEqual(config());
  });
});
