# Status API

The Status API exposes the process health, WhatsApp connection lifecycle, registration QR code, and non-sensitive operational metrics. It starts as part of the main application and listens on port `3002` by default.

## Base URL

Local default:

```text
http://127.0.0.1:3002
```

The service starts before WhatsApp initialization. This allows a deployment dashboard to receive the registration QR while the WhatsApp client is still connecting.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `STATUS_API_PORT` | `3002` | TCP port used by the status API. |
| `STATUS_API_HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` only when network access is required. |
| `STATUS_API_TOKEN` | unset | Optional bearer token. In production, set this whenever the API is reachable outside the host. |
| `STATUS_API_CORS_ORIGIN` | `*` | Value returned in `Access-Control-Allow-Origin`. Set it to the dashboard origin when browser access is used. |

Recommended production values:

```env
STATUS_API_PORT=3002
STATUS_API_HOST=127.0.0.1
STATUS_API_TOKEN=use_a_long_random_secret_here
STATUS_API_CORS_ORIGIN=https://operations.example.com
```

Generate a token, for example:

```bash
openssl rand -hex 32
```

All endpoints except `GET /health` require this header when `STATUS_API_TOKEN` is configured:

```http
Authorization: Bearer <STATUS_API_TOKEN>
```

The QR value can register a WhatsApp device. Treat the API token and every QR response as credentials. Do not expose the API directly to the public internet, store QR responses in logs, or cache them at a proxy.

## Endpoints

| Method | Path | Authentication | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | None | Process liveness check. |
| `GET` | `/ready` | Bearer token if configured | WhatsApp readiness check. |
| `GET` | `/status` | Bearer token if configured | Complete status snapshot. |
| `GET` | `/` | Bearer token if configured | Alias of `/status`. |
| `GET` | `/status/qr` | Bearer token if configured | Current QR as raw text, terminal text, SVG, and SVG data URL. |
| `GET` | `/status/qr.svg` | Bearer token if configured | Current QR as an SVG image. |
| `GET` | `/status/stream` | Bearer token if configured | Real-time Server-Sent Events stream. |

Every response is sent with `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. The SSE route additionally disables common proxy buffering.

## Liveness

`GET /health` reports whether the Node.js status server is responding. It does not imply that WhatsApp is authenticated or ready.

```bash
curl --fail http://127.0.0.1:3002/health
```

Example response (`200 OK`):

```json
{
  "ok": true,
  "timestamp": "2026-07-17T12:00:00.000Z",
  "uptimeSeconds": 42
}
```

Use this endpoint for container or process liveness probes.

## Readiness

`GET /ready` reports whether the WhatsApp client can currently send and receive messages.

```bash
curl -i \
  -H "Authorization: Bearer $STATUS_API_TOKEN" \
  http://127.0.0.1:3002/ready
```

Ready response (`200 OK`):

```json
{
  "ready": true,
  "state": "ready",
  "timestamp": "2026-07-17T12:00:00.000Z"
}
```

Not-ready response (`503 Service Unavailable`):

```json
{
  "ready": false,
  "state": "qr_required",
  "timestamp": "2026-07-17T12:00:00.000Z"
}
```

Use this endpoint for readiness probes and traffic decisions. A `503` during registration or reconnection is expected and does not mean the status server itself has failed.

## Complete Status

`GET /status` returns one consistent snapshot. It contains no customer phone numbers, message content, API keys, session files, or order contents.

```bash
curl --fail \
  -H "Authorization: Bearer $STATUS_API_TOKEN" \
  http://127.0.0.1:3002/status
```

Representative response:

```json
{
  "overall": "auth_required",
  "timestamp": "2026-07-17T12:00:00.000Z",
  "service": {
    "name": "soapy-whatsapp-agent",
    "version": "1.0.0",
    "environment": "production",
    "pid": 1234,
    "startedAt": "2026-07-17T11:59:18.000Z",
    "uptimeSeconds": 42,
    "statusApi": {
      "host": "127.0.0.1",
      "port": 3002,
      "authenticated": true,
      "streamClients": 1
    }
  },
  "whatsapp": {
    "state": "qr_required",
    "ready": false,
    "authenticated": false,
    "reconnecting": false,
    "reconnectAttempts": 0,
    "maxReconnectAttempts": 5,
    "lastEventAt": "2026-07-17T12:00:00.000Z",
    "qr": {
      "available": true,
      "value": "raw-whatsapp-registration-value",
      "terminal": "terminal-renderable QR text",
      "svg": "<svg ...></svg>",
      "dataUrl": "data:image/svg+xml;base64,...",
      "generatedAt": "2026-07-17T12:00:00.000Z",
      "ageSeconds": 0,
      "staleAfterSeconds": 60,
      "stale": false
    }
  },
  "runtime": {
    "nodeVersion": "v22.0.0",
    "platform": "linux",
    "architecture": "x64",
    "memory": {
      "rss": 150000000,
      "heapTotal": 30000000,
      "heapUsed": 20000000,
      "external": 2000000,
      "arrayBuffers": 1000000
    }
  },
  "components": {
    "database": {
      "open": true,
      "readonly": false,
      "inTransaction": false,
      "journalMode": "wal"
    },
    "whatsappRuntime": {
      "ready": false,
      "reconnecting": false,
      "reconnectAttempts": 0,
      "maxReconnectAttempts": 5,
      "healthCheckRunning": false,
      "healthCheckInProgress": false,
      "activeTypingSessions": 0
    },
    "messageProcessing": {
      "activeProcessingCount": 0,
      "queuedConversationCount": 0,
      "maxQueueSize": 100,
      "utilizationPercent": 0,
      "botInterfaceConfigured": true
    },
    "productCatalog": {
      "catalogLoaded": true,
      "productCount": 120,
      "lastUpdatedAt": "2026-07-17T11:59:50.000Z",
      "cacheAgeMs": 10000,
      "cacheDurationMs": 1800000,
      "cacheFresh": true
    },
    "gemini": {
      "model": "gemini-2.5-flash",
      "fallbackModel": "gemini-2.0-flash",
      "catalogLoaded": true,
      "catalogCharacterCount": 25000,
      "catalogUpdateInProgress": false,
      "catalogAutoUpdateRunning": true,
      "catalogUpdateIntervalMs": 1800000,
      "maxProductsInPrompt": 50,
      "pendingOrders": {
        "total": 0,
        "byStatus": {
          "creating": 0,
          "pending": 0,
          "failed": 0
        }
      }
    }
  }
}
```

### Overall states

| Value | Meaning |
| --- | --- |
| `healthy` | WhatsApp is authenticated and ready. |
| `auth_required` | WhatsApp emitted a registration QR that is available from the API. |
| `starting` | The process or WhatsApp client is initializing, or authentication completed and readiness is pending. |
| `degraded` | WhatsApp is disconnected, reconnecting, or in an error state. |
| `stopped` | The WhatsApp client was deliberately destroyed during shutdown. |

### WhatsApp states

The `whatsapp.state` field can be `starting`, `initializing`, `qr_required`, `authenticated`, `ready`, `disconnected`, `reconnecting`, `auth_failure`, `error`, or `destroyed`.

Diagnostic fields such as `lastReadyAt`, `lastAuthenticatedAt`, `lastDisconnectedAt`, `lastDisconnectedReason`, `lastError`, and `nextReconnectDelayMs` appear when relevant. Clients must tolerate absent optional fields and additional fields in future versions.

## WhatsApp Registration QR

The QR is available only after `whatsapp-web.js` requests registration and is removed as soon as authentication succeeds, the client becomes ready, authentication fails, or the client shuts down.

```bash
curl --fail \
  -H "Authorization: Bearer $STATUS_API_TOKEN" \
  http://127.0.0.1:3002/status/qr
```

When available, the response contains:

| Field | Description |
| --- | --- |
| `available` | `true` while the API holds a current registration QR. |
| `value` | Raw WhatsApp registration value for QR libraries. |
| `terminal` | QR formatted as terminal text. |
| `svg` | Complete SVG markup. |
| `dataUrl` | Base64 SVG data URL suitable for an HTML image `src`. |
| `generatedAt` | ISO 8601 generation time. |
| `ageSeconds` | Current QR age, calculated when the response is created. |
| `staleAfterSeconds` | Advisory freshness threshold, currently 60 seconds. |
| `stale` | Whether the advisory threshold has elapsed. Wait for the next SSE update when true. |

When registration is not required:

```json
{
  "available": false,
  "staleAfterSeconds": 60
}
```

To display the SVG directly:

```html
<img src="http://127.0.0.1:3002/status/qr.svg" alt="WhatsApp registration QR">
```

An `<img>` element cannot attach a bearer header. Use the endpoint directly only on an authenticated same-origin proxy, or fetch the SVG with authorization and create an object URL. `/status/qr.svg` returns `404` when no QR is available.

## Real-Time Updates

`GET /status/stream` uses Server-Sent Events (SSE). A complete `status` event is sent immediately after connection, whenever the WhatsApp lifecycle changes, when a new QR arrives, and when the current QR crosses its advisory stale threshold. A `heartbeat` event is sent every 15 seconds to keep the connection and intermediaries alive.

```bash
curl --no-buffer \
  -H "Accept: text/event-stream" \
  -H "Authorization: Bearer $STATUS_API_TOKEN" \
  http://127.0.0.1:3002/status/stream
```

Stream example:

```text
retry: 3000

id: 1
event: status
data: {"overall":"auth_required","timestamp":"2026-07-17T12:00:00.000Z",...}

id: 2
event: heartbeat
data: {"timestamp":"2026-07-17T12:00:15.000Z"}

id: 3
event: status
data: {"overall":"healthy","timestamp":"2026-07-17T12:00:20.000Z",...}
```

Each `status` event is a full snapshot, so clients do not need to merge patches. Event IDs are process-local and reset after an application restart. Historical events are not replayed; a reconnect always receives the latest snapshot immediately. The stream advises clients to reconnect after 3 seconds.

Native browser `EventSource` cannot set an `Authorization` header. For a protected deployment, consume SSE with a fetch-based SSE client or place the API behind a same-origin reverse proxy that applies authentication. Do not place the token in a URL query string.

Unauthenticated browser example for a trusted local network only:

```js
const stream = new EventSource('http://127.0.0.1:3002/status/stream');

stream.addEventListener('status', event => {
  const status = JSON.parse(event.data);
  console.log(status.overall, status.whatsapp.state);
});

stream.addEventListener('heartbeat', event => {
  console.debug('status heartbeat', JSON.parse(event.data).timestamp);
});
```

## Errors and Status Codes

| Status | Situation |
| --- | --- |
| `200` | Successful JSON response, ready state, or QR SVG. |
| `204` | CORS preflight request. |
| `401` | Missing or invalid bearer token. |
| `404` | Unknown route, or `/status/qr.svg` requested without an available QR. |
| `405` | Method other than `GET` or `OPTIONS`. |
| `503` | `/ready` requested while WhatsApp is not ready. |

Error responses use JSON:

```json
{
  "error": "unauthorized",
  "message": "A valid bearer token is required"
}
```

## Reverse Proxy Example

Keep the Node service bound to `127.0.0.1` and terminate TLS at the proxy. Disable buffering for SSE and caching for all routes.

```nginx
location /whatsapp-status/ {
    proxy_pass http://127.0.0.1:3002/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
    add_header Cache-Control 'no-store' always;
}
```

Protect the public proxy route with an identity-aware proxy, VPN, private network, or equivalent access control in addition to `STATUS_API_TOKEN`.

## Deployment and Verification

Build and start the same artifact that will run in production:

```bash
npm run build
npm start
```

The PM2 configuration uses one process, which is required because the WhatsApp browser session and in-memory SSE clients belong to that process. Do not switch this application to PM2 cluster mode without redesigning session ownership and event distribution.

Minimum deployment checks:

```bash
curl --fail http://127.0.0.1:3002/health
curl --fail -H "Authorization: Bearer $STATUS_API_TOKEN" http://127.0.0.1:3002/status
curl --no-buffer -H "Authorization: Bearer $STATUS_API_TOKEN" http://127.0.0.1:3002/status/stream
```

Before registration, confirm `overall` becomes `auth_required`, scan the QR, and confirm `/ready` changes from `503` to `200` and the stream emits a snapshot with `whatsapp.state` equal to `ready`.

The implementation is compiled under strict TypeScript settings and the HTTP surface can be smoke-tested without WhatsApp. No software can be guaranteed flawless in production without exercising the real browser, network, WhatsApp account, reverse proxy, and deployment environment. The checks above are the minimum evidence needed before routing production traffic.
