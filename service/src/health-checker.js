/**
 * Reusable health checking service.
 * Checks multiple endpoints concurrently and aggregates their status.
 * Framework-agnostic and usable outside the Cloud Function context.
 */

export const STATUS_UP = "up";
export const STATUS_DOWN = "down";
export const STATUS_HEALTHY = "healthy";
export const STATUS_UNHEALTHY = "unhealthy";

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

/**
 * Builds an aggregate result from an array of service results.
 * @param {Array<{ status: string, bodyStatus: string | null, statusCode: number | null, error?: string, responseTime: number, url: string }>} services
 * @returns {{ status: string, upPercentage: number | null, timestamp: string, services: typeof services }}
 */
const aggregateServices = (services) => {
  const allHealthy = services.every(({ status }) => status === STATUS_UP);
  const upCount = services.filter(({ status }) => status === STATUS_UP).length;

  return {
    status: allHealthy ? STATUS_HEALTHY : STATUS_UNHEALTHY,
    upPercentage: computeUpPercentage(upCount, services.length),
    timestamp: new Date().toISOString(),
    services,
  };
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
   * @returns {Promise<{ status: string, bodyStatus: string | null, statusCode: number | null, error?: string, responseTime: number, url: string }>}
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
          status: isUp ? STATUS_UP : STATUS_DOWN,
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
        status: STATUS_DOWN,
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
   * @returns {Promise<{ status: string, upPercentage: number | null, timestamp: string, services: Array<{ status: string, url: string, statusCode: number | null, bodyStatus: string | null, error?: string, responseTime: number }> }>}
   */
  async checkAll() {
    const services = await Promise.all(
      this.#endpoints.map((url) => this.#checkEndpoint(url)),
    );

    return aggregateServices(services);
  }
}

/**
 * Checks a single namespace's endpoints and aggregates the results.
 * An empty namespace is reported as healthy with no services and a null
 * up percentage.
 * @param {{ endpoints: string[], timeoutMs: number | null }} namespace
 * @returns {Promise<{ status: string, upPercentage: number | null, timestamp: string, services: Array<{ status: string, url: string, statusCode: number | null, bodyStatus: string | null, error?: string, responseTime: number }> }>}
 */
export const checkNamespace = async ({ endpoints, timeoutMs }) => {
  return endpoints.length === 0
    ? { status: STATUS_HEALTHY, upPercentage: null, services: [] }
    : await new HealthChecker(endpoints, { timeoutMs }).checkAll();
};
