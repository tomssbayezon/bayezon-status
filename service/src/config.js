/**
 * Health check service configuration.
 * Handles reading and parsing environment variables.
 */

/**
 * @typedef {Object<string, string | undefined>} Env
 */

/**
 * Parses a comma-separated string of URLs into a clean array.
 * Drops whitespace and empty entries.
 * @param {string | undefined} raw - Raw comma-separated endpoint URLs
 * @returns {string[]} Validated list of endpoint URLs
 */
export const parseEndpoints = (raw) =>
  (raw ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);

/**
 * Reads health check configuration from the environment.
 * @param {Env} [env] - Environment map (defaults to process.env)
 * @returns {{ endpoints: string[], timeoutMs: number | null }} Parsed config
 */
export const getConfig = (env = process.env) => ({
  endpoints: parseEndpoints(env.HEALTH_CHECK_ENDPOINTS),
  timeoutMs: env.HEALTH_CHECK_TIMEOUT_MS
    ? Number.parseInt(env.HEALTH_CHECK_TIMEOUT_MS, 10)
    : null,
});