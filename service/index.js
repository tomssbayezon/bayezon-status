const functions = require("@google-cloud/functions-framework");

/**
 * Health Check Endpoint
 *
 * Aggregates health status from multiple services defined in
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

  const endpointsRaw = process.env.HEALTH_CHECK_ENDPOINTS;
  if (!endpointsRaw) {
    return res.status(200).json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      services: [],
    });
  }

  const endpoints = endpointsRaw
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);

  const results = await Promise.allSettled(
    endpoints.map(async (url) => {
      const startTime = Date.now();
      try {
        // TODO: Add custom headers or auth tokens if required by endpoints
        const response = await fetch(url, {
          method: "GET",
          // TODO: Add timeout once requirements are finalized
        });

        const responseTime = Date.now() - startTime;

        // TODO: Parse response body based on each endpoint's response format
        // Expected formats may vary (JSON, plain text, etc.)

        const isUp = response.ok;
        return {
          url,
          status: isUp ? "up" : "down",
          statusCode: response.status,
          responseTime,
        };
      } catch (error) {
        const responseTime = Date.now() - startTime;
        return {
          url,
          status: "down",
          statusCode: null,
          error: error.message,
          responseTime,
        };
      }
    })
  );

  const services = results.map((result) => {
    if (result.status === "fulfilled") {
      return result.value;
    }
    return {
      url: "unknown",
      status: "down",
      statusCode: null,
      error: result.reason?.message || "Unknown error",
      responseTime: 0,
    };
  });

  const allHealthy = services.every((s) => s.status === "up");

  return res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? "healthy" : "unhealthy",
    timestamp: new Date().toISOString(),
    services,
  });
});
