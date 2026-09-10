# Health Check Service

Google Cloud Function that aggregates health status from multiple service endpoints across `storefront` and `search` namespaces.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `STOREFRONT_HEALTH_CHECK_ENDPOINTS` | Yes | Comma-separated list of storefront endpoint URLs |
| `SEARCH_HEALTH_CHECK_ENDPOINTS` | Yes | Comma-separated list of search endpoint URLs |
| `HEALTH_CHECK_TIMEOUT_MS` | No | Per-request timeout in milliseconds (omit for no timeout) |
| `PORT` | No | Server port (handled by functions-framework, defaults to 8080) |

URLs without a scheme are automatically prefixed with `http://`.

## Response Shape

```json
{
  "status": "healthy" | "unhealthy",
  "upPercentage": 100.0,
  "timestamp": "2026-01-01T00:00:00.000Z",
  "namespaces": {
    "storefront": {
      "status": "healthy",
      "upPercentage": 100,
      "services": [{ "url": "...", "status": "up", "statusCode": 200, "bodyStatus": "ok", "responseTime": 42 }]
    },
    "search": { "..." }
  }
}
```

- A service is **up** if its JSON body contains `{ "status": "ok" }` (case-insensitive), or if the HTTP status is 2xx when no body status is present.
- `upPercentage` is the count of "up" services divided by total services, rounded to 2 decimals. Empty namespaces are excluded.

## HTTP Status Codes

| Code | Meaning |
|---|---|
| 200 | All namespaces healthy |
| 503 | At least one service is down |
| 405 | Non-GET request |

## Local Development

```bash
cp .env.example .env   # edit with your endpoints
npm install
npm start              # runs functions-framework on port 8080
```

## Testing

```bash
npm test               # runs unit + integration tests
```

## Deploy

Deploy as a Cloud Function with the `healthCheck` HTTP target.
