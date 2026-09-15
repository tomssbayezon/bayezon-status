import functions from "@google-cloud/functions-framework";

import { getConfig } from "./src/config.js";
import { checkNamespace, STATUS_HEALTHY } from "./src/health-checker.js";

/**
 * Health Check Cloud Function.
 *
 * Serves a namespace-specific health status at /storefront and /search,
 * sourced from the endpoints defined in STOREFRONT_HEALTH_CHECK_ENDPOINTS
 * and SEARCH_HEALTH_CHECK_ENDPOINTS (comma-separated URLs each).
 *
 * Returns:
 * - 200 OK when the namespace is healthy
 * - 503 Service Unavailable when the namespace has a down service
 * - 404 Not Found for unknown paths
 * - 405 Method Not Allowed for non-GET requests
 */

/** Maps an endpoint path to its namespace config key. */
const NAMESPACES = new Map([
  ["/storefront", "storefront"],
  ["/search", "search"],
]);

/**
 * Builds the HTTP handler with injectable dependencies for testability.
 * @param {{ config?: () => object, checker?: (namespace: object) => Promise<object> }} [deps]
 * @returns {(req: object, res: object) => Promise<object>} Express-style handler
 */
export const createHealthHandler = ({
  config = getConfig,
  checker = checkNamespace,
} = {}) => async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const namespace = NAMESPACES.get(req.path);
  if (!namespace) {
    return res.status(404).json({ error: "Not found" });
  }

  const result = await checker(config()[namespace]);

  return res
    .status(result.status === STATUS_HEALTHY ? 200 : 503)
    .json(result);
};

functions.http("healthCheck", createHealthHandler());
