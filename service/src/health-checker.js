/**
 * Reusable health checking service.
 * Checks multiple endpoints concurrently and aggregates their status.
 * Framework-agnostic and usable outside the Cloud Function context.
 */

const DEFAULT_OPTIONS = Object.freeze({ timeoutMs: null });

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

        // TODO: Parse response body based on each endpoint's response format.
        // Expected payloads may vary (JSON, plain text, etc.); decide the
        // up/down criteria once the actual response shapes are known.

        return {
          url,
          status: response.ok ? "up" : "down",
          statusCode: response.status,
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
    const settled = await Promise.allSettled(
      this.#endpoints.map((url) => this.#checkEndpoint(url)),
    );

    const services = settled.flatMap((result) =>
      result.status === "fulfilled"
        ? [result.value]
        : [
            {
              url: "unknown",
              status: "down",
              statusCode: null,
              error: result.reason?.message ?? "Unknown error",
              responseTime: 0,
            },
          ],
    );

    const allHealthy = services.every(({ status }) => status === "up");

    return {
      status: allHealthy ? "healthy" : "unhealthy",
      timestamp: new Date().toISOString(),
      services,
    };
  }
}