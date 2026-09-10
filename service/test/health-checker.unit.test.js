import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkNamespaces,
  computeUpPercentage,
  HealthChecker,
  STATUS_DOWN,
  STATUS_HEALTHY,
  STATUS_UNHEALTHY,
  STATUS_UP,
} from "../src/health-checker.js";

const JSON_BODY = (body) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(body),
});
const PLAIN_BODY = (body) => ({
  ok: true,
  status: 200,
  text: async () => body,
});
const HTTP_ERROR = (status) => ({
  ok: false,
  status,
  text: async () => "",
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("computeUpPercentage", () => {
  it("rounds to two decimals", () => {
    expect(computeUpPercentage(1, 2)).toBe(50);
    expect(computeUpPercentage(2, 3)).toBe(66.67);
    expect(computeUpPercentage(0, 4)).toBe(0);
    expect(computeUpPercentage(3, 0)).toBe(null);
  });
});

describe("HealthChecker.checkAll", () => {
  it("returns healthy with 100 when every endpoint is up", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      JSON_BODY({ status: "Ok" }),
    );

    const result = await new HealthChecker([
      "http://a/x",
      "http://b/x",
    ]).checkAll();

    expect(result.status).toBe(STATUS_HEALTHY);
    expect(result.upPercentage).toBe(100);
    expect(result.services.every((s) => s.status === STATUS_UP)).toBeTruthy();
    expect(
      result.services.every((s) => s.bodyStatus === "Ok"),
    ).toBeTruthy();
  });

  it("marks mixed results unhealthy with the correct percentage", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (url === "http://a/x") return JSON_BODY({ status: "ok" });
      if (url === "http://b/x") return JSON_BODY({ status: "error" });
      throw new Error("Connection refused");
    });

    const result = await new HealthChecker([
      "http://a/x",
      "http://b/x",
      "http://c/x",
    ]).checkAll();

    expect(result.status).toBe(STATUS_UNHEALTHY);
    expect(result.upPercentage).toBe(33.33);
    expect(result.services[0].status).toBe(STATUS_UP);
    expect(result.services[1].status).toBe(STATUS_DOWN);
    expect(result.services[2].status).toBe(STATUS_DOWN);
  });

  it("returns a uniform service shape on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("Connection refused");
    });

    const result = await new HealthChecker(["http://a/x"]).checkAll();
    const service = result.services[0];

    expect(service.status).toBe(STATUS_DOWN);
    expect(service.statusCode).toBe(null);
    expect(service.bodyStatus).toBe(null);
    expect(service.error).toBe("Connection refused");
    expect(typeof service.responseTime).toBe("number");
    expect(service.responseTime).toBeGreaterThanOrEqual(0);
  });

  it("falls back to the HTTP status for non-JSON bodies", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      PLAIN_BODY("OK"),
    );

    const result = await new HealthChecker(["http://a/x"]).checkAll();

    expect(result.status).toBe(STATUS_HEALTHY);
    expect(result.services[0].status).toBe(STATUS_UP);
    expect(result.services[0].bodyStatus).toBe(null);
  });

  it("falls back to the HTTP status when the body lacks a status field", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      JSON_BODY({ foo: "bar" }),
    );

    const result = await new HealthChecker(["http://a/x"]).checkAll();

    expect(result.status).toBe(STATUS_HEALTHY);
    expect(result.services[0].status).toBe(STATUS_UP);
    expect(result.services[0].bodyStatus).toBe(null);
  });

  it("marks down a 500 response without a body", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      HTTP_ERROR(500),
    );

    const result = await new HealthChecker(["http://a/x"]).checkAll();

    expect(result.status).toBe(STATUS_UNHEALTHY);
    expect(result.services[0].status).toBe(STATUS_DOWN);
    expect(result.services[0].statusCode).toBe(500);
  });

  it("reports Request timed out when the signal aborts", async () => {
    vi.spyOn(
      globalThis,
      "fetch",
    ).mockImplementation(
      (url, { signal }) =>
        new Promise((resolve, reject) => {
          signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );

    const result = await new HealthChecker(["http://a/x"], {
      timeoutMs: 50,
    }).checkAll();

    expect(result.status).toBe(STATUS_UNHEALTHY);
    expect(result.services[0].status).toBe(STATUS_DOWN);
    expect(result.services[0].error).toBe("Request timed out");
  });

  it("passes no signal when no timeout is configured", async () => {
    let receivedSignal;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, { signal }) => {
      receivedSignal = signal;
      return JSON_BODY({ status: "ok" });
    });

    await new HealthChecker(["http://a/x"]).checkAll();

    expect(receivedSignal).toBe(undefined);
  });
});

describe("checkNamespaces", () => {
  it("groups results per namespace without empty ones", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      JSON_BODY({ status: "ok" }),
    );

    const result = await checkNamespaces({
      storefront: {
        endpoints: ["http://sf/x", "http://sf/y"],
        timeoutMs: null,
      },
      search: { endpoints: ["http://se/x"], timeoutMs: null },
    });

    expect(Object.keys(result.namespaces).sort()).toEqual([
      "search",
      "storefront",
    ]);
    expect(result.namespaces.storefront.upPercentage).toBe(100);
    expect(result.namespaces.search.upPercentage).toBe(100);
    expect(result.upPercentage).toBe(100);
    expect(result.status).toBe(STATUS_HEALTHY);
  });

  it("computes the combined overall percentage", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      url.endsWith("/up")
        ? JSON_BODY({ status: "ok" })
        : JSON_BODY({ status: "error" }),
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

    expect(result.namespaces.storefront.upPercentage).toBe(66.67);
    expect(result.namespaces.search.upPercentage).toBe(100);
    expect(result.upPercentage).toBe(75);
  });

  it("excludes empty namespaces from the overall percentage", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      url.endsWith("/up")
        ? JSON_BODY({ status: "ok" })
        : JSON_BODY({ status: "error" }),
    );

    const result = await checkNamespaces({
      storefront: { endpoints: [], timeoutMs: null },
      search: {
        endpoints: ["http://se/up", "http://se/down"],
        timeoutMs: null,
      },
    });

    expect(result.namespaces.storefront.upPercentage).toBe(null);
    expect(result.namespaces.search.upPercentage).toBe(50);
    expect(result.upPercentage).toBe(50);
  });

  it("reports a null overall percentage when all namespaces are empty", async () => {
    const result = await checkNamespaces({
      storefront: { endpoints: [], timeoutMs: null },
      search: { endpoints: [], timeoutMs: null },
    });

    expect(result.status).toBe(STATUS_HEALTHY);
    expect(result.upPercentage).toBe(null);
  });
});
