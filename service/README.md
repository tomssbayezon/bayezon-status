# Health Check Service

Google Cloud Function that serves health status for the `storefront` and `search` namespaces at dedicated endpoints.

## Endpoints

| Endpoint | Description |
|---|---|
| `/storefront` | Health status for the `storefront` namespace |
| `/search` | Health status for the `search` namespace |

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `STOREFRONT_HEALTH_CHECK_ENDPOINTS` | Yes | Comma-separated list of storefront endpoint URLs |
| `SEARCH_HEALTH_CHECK_ENDPOINTS` | Yes | Comma-separated list of search endpoint URLs |
| `HEALTH_CHECK_TIMEOUT_MS` | No | Per-request timeout in milliseconds (omit for no timeout) |
| `PORT` | No | Server port (handled by functions-framework, defaults to 8080) |

URLs without a scheme are automatically prefixed with `http://`.

## Response Shape

Each endpoint returns the health status for its own namespace:

```json
{
  "status": "healthy" | "unhealthy",
  "upPercentage": 100.0,
  "timestamp": "2026-01-01T00:00:00.000Z",
  "services": [{ "url": "...", "status": "up", "statusCode": 200, "bodyStatus": "ok", "responseTime": 42 }]
}
```

- A service is **up** if its JSON body contains `{ "status": "ok" }` (case-insensitive), or if the HTTP status is 2xx when no body status is present.
- `upPercentage` is the count of "up" services divided by total services, rounded to 2 decimals. An empty namespace reports `null`.

## HTTP Status Codes

| Code | Meaning |
|---|---|
| 200 | Namespace healthy |
| 503 | At least one service is down |
| 404 | Unknown path |
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

Deploy as a single Cloud Function with the `healthCheck` HTTP target, routing the `/storefront` and `/search` paths to it.
