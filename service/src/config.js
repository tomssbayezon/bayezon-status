/**
 * Health check service configuration.
 * Handles reading and parsing environment variables.
 */

/**
 * @typedef {Object<string, string | undefined>} Env
 */

/**
 * Prepend http:// to scheme-less URLs so native fetch accepts them.
 * @param {string} url - Endpoint URL
 * @returns {string} Normalized absolute URL
 */
export const normalizeUrl = (url) =>
  /^https?:\/\//i.test(url) ? url : `http://${url}`;

/**
 * Parses a comma-separated string of URLs into a clean array.
 * Drops whitespace, empty entries, and normalizes the scheme.
 * @param {string | undefined} raw - Raw comma-separated endpoint URLs
 * @returns {string[]} Validated list of endpoint URLs
 */
export const parseEndpoints = (raw) =>
  (raw ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean)
    .map(normalizeUrl);

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