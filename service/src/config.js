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
 * Trims surrounding whitespace first.
 * @param {string} url - Endpoint URL
 * @returns {string} Normalized absolute URL
 */
export const normalizeUrl = (url) => {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
};

/**
 * Parses a comma-separated string of URLs into a clean array.
 * Drops whitespace, empty entries, and normalizes the scheme.
 * @param {string | undefined} raw - Raw comma-separated endpoint URLs
 * @returns {string[]} Normalized list of endpoint URLs
 */
export const parseEndpoints = (raw) =>
  (raw ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean)
    .map(normalizeUrl);

/**
 * Parses a timeout in milliseconds, returning null for missing or invalid
 * values instead of NaN.
 * @param {string | undefined} raw - Raw timeout value from the environment
 * @returns {number | null} Validated timeout in milliseconds, or null
 */
export const parseTimeout = (raw) => {
  if (!raw) return null;
  const ms = Number(raw);
  return Number.isInteger(ms) && ms > 0 ? ms : null;
};

/**
 * Reads the namespace endpoints and shared timeout from the environment.
 * Logs a warning when a namespace has no configured endpoints.
 * @param {Env} [env] - Environment map (defaults to process.env)
 * @returns {NamespaceConfig} Endpoints per namespace and shared timeout
 */
export const getConfig = (env = process.env) => {
  const config = Object.fromEntries(
    NAMESPACES.map((name) => [
      name,
      {
        endpoints: parseEndpoints(env[`${name.toUpperCase()}_HEALTH_CHECK_ENDPOINTS`]),
        timeoutMs: parseTimeout(env.HEALTH_CHECK_TIMEOUT_MS),
      },
    ]),
  );

  for (const [name, { endpoints }] of Object.entries(config)) {
    if (endpoints.length === 0) {
      console.warn(
        `[config] No endpoints configured for namespace "${name}". ` +
        `Set ${name.toUpperCase()}_HEALTH_CHECK_ENDPOINTS to monitor services.`,
      );
    }
  }

  return config;
};
