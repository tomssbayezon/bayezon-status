import functions from "@google-cloud/functions-framework";

import { getConfig } from "./src/config.js";
import { checkNamespaces } from "./src/health-checker.js";

/**
 * Health Check Cloud Function.
 *
 * Aggregates health status from the namespace-specific endpoints defined
 * in STOREFRONT_HEALTH_CHECK_ENDPOINTS and SEARCH_HEALTH_CHECK_ENDPOINTS
 * (comma-separated URLs each).
 *
 * Returns:
 * - 200 OK when all namespaces are healthy
 * - 503 Service Unavailable when any namespace has a down service
 */

/**
 * Builds the HTTP handler with injectable dependencies for testability.
 * @param {{ config?: () => object, checker?: (namespaces: object) => Promise<object> }} [deps]
 * @returns {(req: object, res: object) => Promise<object>} Express-style handler
 */
export const createHealthHandler = ({
  config = getConfig,
  checker = checkNamespaces,
} = {}) => async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const result = await checker(config());

  return res
    .status(result.status === "healthy" ? 200 : 503)
    .json(result);
};

functions.http("healthCheck", createHealthHandler());