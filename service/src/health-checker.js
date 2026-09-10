/**
 * Reusable health checking service.
 * Checks multiple endpoints concurrently and aggregates their status.
 * Framework-agnostic and usable outside the Cloud Function context.
 */

const DEFAULT_OPTIONS = Object.freeze({ timeoutMs: null });

/**
 * Calculates the percentage of up services, rounded to two decimals.
 * Returns null when there are no services to measure.
 * @param {number} upCount - Number of services currently up
 * @param {number} totalCount - Total number of services
 * @returns {number | null} Percentage in the 0-100 range, or null
 */
export const computeUpPercentage = (upCount, totalCount) => {
  if (totalCount === 0) return null;
  return Math.round((upCount / totalCount) * 10_000) / 100;
};

export class HealthChecker {
  #endpoints;
  #timeoutMs;

  /**
   * @param {Iterable<string>} endpoints - Endpoint URLs to monitor
   * @param {{ timeoutMs?: number | null }} [options] - Optional settings
   */
  constructor(endpoints, options = DEFAULT_OPTIONS) {
    this.#endpoints = [...endpoints];
    this.#timeoutMs = options.timeoutMs ?? null;
  }

  /**
   * Checks a single endpoint and returns its health status.
   * Never throws; failures are captured in the result.
   * @param {string} url - Endpoint URL to check
   * @returns {Promise<ServiceResult>} Health result for one service
   */
  async #checkEndpoint(url) {
    const start = performance.now();

    try {
      const controller = this.#timeoutMs
        ? new AbortController()
        : null;
      const timeoutId = controller
        ? setTimeout(() => controller.abort(), this.#timeoutMs)
        : null;

      try {
        const response = await fetch(url, {
          method: "GET",
          signal: controller?.signal,
        });

        // TODO: Add custom headers or auth tokens if required by endpoints.

        const rawBody = await response.text();
        let bodyStatus;
        try {
          bodyStatus = JSON.parse(rawBody)?.status ?? undefined;
        } catch {
          // Non-JSON body: fall back to the HTTP status below.
        }

        const bodyOk = bodyStatus?.toString().trim().toLowerCase() === "ok";
        const isUp = bodyStatus === undefined ? response.ok : bodyOk;

        return {
          url,
          status: isUp ? "up" : "down",
          statusCode: response.status,
          bodyStatus: bodyStatus ?? null,
          responseTime: Math.round(performance.now() - start),
        };
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    } catch (error) {
      return {
        url,
        status: "down",
        statusCode: null,
        bodyStatus: null,
        error:
          error?.name === "AbortError"
            ? "Request timed out"
            : (error?.message ?? "Unknown error"),
        responseTime: Math.round(performance.now() - start),
      };
    }
  }

  /**
   * Checks all endpoints concurrently and aggregates the results.
   * @returns {Promise<AggregateResult>} Overall health and per-service status
   */
  async checkAll() {
    const services = await Promise.all(
      this.#endpoints.map((url) => this.#checkEndpoint(url)),
    );

    const allHealthy = services.every(({ status }) => status === "up");
    const upCount = services.filter(({ status }) => status === "up").length;

    return {
      status: allHealthy ? "healthy" : "unhealthy",
      upPercentage: computeUpPercentage(upCount, services.length),
      timestamp: new Date().toISOString(),
      services,
    };
  }
}

/**
 * Checks every namespace concurrently and aggregates the results.
 * An empty namespace is reported as healthy with no services and is
 * excluded from the overall up percentage.
 * @param {Object<string, { endpoints: string[], timeoutMs: number | null }>} namespaces
 * @returns {Promise<{ status: string, upPercentage: number | null, timestamp: string, namespaces: Object<string, { status: string, upPercentage: number | null, services: unknown[] }> }>}
 */
export const checkNamespaces = async (namespaces) => {
  const entries = await Promise.all(
    Object.entries(namespaces).map(async ([name, { endpoints, timeoutMs }]) => {
      const result =
        endpoints.length === 0
          ? { status: "healthy", upPercentage: null, services: [] }
          : await new HealthChecker(endpoints, { timeoutMs }).checkAll();
      return [
        name,
        {
          status: result.status,
          upPercentage: result.upPercentage,
          services: result.services,
        },
      ];
    }),
  );

  const namespaced = Object.fromEntries(entries);
  const allHealthy = Object.values(namespaced).every(({ status }) => status === "healthy");

  const totals = Object.values(namespaced).reduce(
    ({ upCount, totalCount }, { services }) => {
      if (services.length === 0) return { upCount, totalCount };
      const up = services.filter(({ status }) => status === "up").length;
      return {
        upCount: upCount + up,
        totalCount: totalCount + services.length,
      };
    },
    { upCount: 0, totalCount: 0 },
  );

  return {
    status: allHealthy ? "healthy" : "unhealthy",
    upPercentage: computeUpPercentage(totals.upCount, totals.totalCount),
    timestamp: new Date().toISOString(),
    namespaces: namespaced,
  };
};