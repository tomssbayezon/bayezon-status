import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getConfig,
  normalizeUrl,
  parseEndpoints,
  parseTimeout,
} from "../src/config.js";

describe("normalizeUrl", () => {
  it("leaves http/https URLs untouched", () => {
    expect(normalizeUrl("https://a.com/x")).toBe("https://a.com/x");
    expect(normalizeUrl("http://a.com/x")).toBe("http://a.com/x");
    expect(normalizeUrl("HTTPS://a.com/x")).toBe("HTTPS://a.com/x");
  });

  it("prepends http:// to scheme-less URLs", () => {
    expect(normalizeUrl("a.com/x")).toBe("http://a.com/x");
    expect(normalizeUrl("localhost:8080")).toBe("http://localhost:8080");
    expect(normalizeUrl("127.0.0.1:9090/health")).toBe(
      "http://127.0.0.1:9090/health",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeUrl("  a.com/x  ")).toBe("http://a.com/x");
    expect(normalizeUrl(" https://a.com/x ")).toBe("https://a.com/x");
  });
});

describe("parseEndpoints", () => {
  it("returns an empty list for empty input", () => {
    expect(parseEndpoints(undefined)).toEqual([]);
    expect(parseEndpoints("")).toEqual([]);
    expect(parseEndpoints(" , , ")).toEqual([]);
  });

  it("splits, trims, and drops empty entries", () => {
    expect(
      parseEndpoints(" https://a.com ,,https://b.com , "),
    ).toEqual(["https://a.com", "https://b.com"]);
  });

  it("normalizes the scheme of each entry", () => {
    expect(
      parseEndpoints("localhost:8080/health,127.0.0.1:9090/health"),
    ).toEqual([
      "http://localhost:8080/health",
      "http://127.0.0.1:9090/health",
    ]);
  });
});

describe("parseTimeout", () => {
  it("returns null for missing values", () => {
    expect(parseTimeout(undefined)).toBe(null);
    expect(parseTimeout("")).toBe(null);
  });

  it("returns null for invalid values instead of NaN", () => {
    expect(parseTimeout("abc")).toBe(null);
    expect(parseTimeout("12ms")).toBe(null);
    expect(parseTimeout("0")).toBe(null);
    expect(parseTimeout("-5")).toBe(null);
  });

  it("parses positive integers", () => {
    expect(parseTimeout("5000")).toBe(5000);
    expect(parseTimeout("  3000 ")).toBe(3000);
  });
});

describe("getConfig", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty namespaces when no env vars are set", () => {
    expect(getConfig({})).toEqual({
      storefront: { endpoints: [], timeoutMs: null },
      search: { endpoints: [], timeoutMs: null },
    });
  });

  it("maps per-namespace endpoints and the shared timeout", () => {
    expect(
      getConfig({
        STOREFRONT_HEALTH_CHECK_ENDPOINTS: "localhost:8080/sf-health",
        SEARCH_HEALTH_CHECK_ENDPOINTS: "https://search.example.com/health",
        HEALTH_CHECK_TIMEOUT_MS: "2500",
      }),
    ).toEqual({
      storefront: {
        endpoints: ["http://localhost:8080/sf-health"],
        timeoutMs: 2500,
      },
      search: {
        endpoints: ["https://search.example.com/health"],
        timeoutMs: 2500,
      },
    });
  });

  it("ignores an invalid shared timeout", () => {
    const config = getConfig({
      STOREFRONT_HEALTH_CHECK_ENDPOINTS: "localhost:8080/sf-health",
      HEALTH_CHECK_TIMEOUT_MS: "abc",
    });

    expect(config.storefront.timeoutMs).toBe(null);
    expect(config.search.timeoutMs).toBe(null);
  });
});
