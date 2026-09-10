/**
 * Health check service configuration.
 * Handles reading and parsing environment variables.
 */

/**
 * @typedef {Object<string, string | undefined>} Env
 */

/**
 * @typedef {Object<string, { endpoints: string[], timeoutMs: number | null }>} NamespaceConfig
 */

/**
 * Namespaces polled by the health check service.
 * Each maps to a ${NAME}_HEALTH_CHECK_ENDPOINTS environment variable.
 */
const NAMESPACES = Object.freeze(["storefront", "search"]);

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
 * Reads the namespace endpoints and shared timeout from the environment.
 * @param {Env} [env] - Environment map (defaults to process.env)
 * @returns {NamespaceConfig} Endpoints per namespace and shared timeout
 */
export const getConfig = (env = process.env) =>
  Object.fromEntries(
    NAMESPACES.map((name) => [
      name,
      {
        endpoints: parseEndpoints(env[`${name.toUpperCase()}_HEALTH_CHECK_ENDPOINTS`]),
        timeoutMs: env.HEALTH_CHECK_TIMEOUT_MS
          ? Number.parseInt(env.HEALTH_CHECK_TIMEOUT_MS, 10)
          : null,
      },
    ]),
  );