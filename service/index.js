import functions from "@google-cloud/functions-framework";

import { getConfig } from "./src/config.js";
import { HealthChecker } from "./src/health-checker.js";

/**
 * Health Check Cloud Function.
 *
 * Aggregates health status from services defined in the
 * HEALTH_CHECK_ENDPOINTS environment variable (comma-separated URLs).
 *
 * Returns:
 * - 200 OK when all services are healthy
 * - 503 Service Unavailable when any service is down
 */

functions.http("healthCheck", async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { endpoints, timeoutMs } = getConfig();

  if (endpoints.length === 0) {
    return res.status(200).json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      services: [],
    });
  }

  const checker = new HealthChecker(endpoints, { timeoutMs });
  const result = await checker.checkAll();

  return res
    .status(result.status === "healthy" ? 200 : 503)
    .json(result);
});
