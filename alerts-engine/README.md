# alerts-engine

> Hawaii Home Dashboard — Alert Aggregation Microservice  
> Proxmox LXC **CT 109** · `192.168.1.109:3009`

Aggregates real-time safety alerts from NOAA, FAA, Hawaii Ocean Safety, and Home Assistant into a single normalised REST API consumed by the home dashboard.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — set HA_TOKEN at minimum

# 3. Start
npm start
```

---

## Environment Variables

| Variable          | Default                    | Required | Description                          |
|-------------------|----------------------------|----------|--------------------------------------|
| `PORT`            | `3009`                     | No       | HTTP port                            |
| `HA_URL`          | `http://192.168.1.19:8123` | No       | Home Assistant base URL              |
| `HA_TOKEN`        | —                          | **Yes**  | HA long-lived access token           |
| `FAA_CLIENT_ID`   | —                          | No       | FAA NOTAM API credential             |
| `FAA_CLIENT_SECRET` | —                        | No       | FAA NOTAM API credential             |

FAA and Ocean Safety credentials are optional — those pollers degrade gracefully when credentials are missing or endpoints are unreachable.

---

## API Endpoints

### `GET /api/alerts`
Returns all active (non-expired) alerts sorted by severity (EXTREME → SEVERE → MODERATE → MINOR → UNKNOWN), then newest-first within the same severity.

**Response:** `Alert[]`

---

### `GET /api/alerts/:category`
Filters by category. Valid values: `marine`, `aviation`, `beach`, `house`, `tsunami`

**Response:** `Alert[]`

---

### `GET /api/health`
Service health check.

**Response:**
```json
{
  "ok": true,
  "counts": {
    "marine": 0,
    "aviation": 1,
    "beach": 0,
    "house": 0,
    "tsunami": 0
  },
  "lastUpdate": "2025-01-15T14:32:00.000Z"
}
```

---

## Alert Object Schema

```js
{
  id:       string,           // stable unique ID (deduped in store)
  category: 'marine' | 'aviation' | 'beach' | 'house' | 'tsunami',
  severity: 'EXTREME' | 'SEVERE' | 'MODERATE' | 'MINOR' | 'UNKNOWN',
  title:    string,
  body:     string,
  source:   string,           // 'NOAA', 'FAA', 'NOAA AWC', 'Hawaii Ocean Safety', 'HomeAssistant'
  issued:   string,           // ISO 8601
  expires:  string | null,    // ISO 8601 or null (no expiry)
  action:   string | null,    // "What to do" guidance text
  raw:      object            // original API response for debugging
}
```

---

## Pollers

| Poller             | Source                        | Interval | Categories              |
|--------------------|-------------------------------|----------|-------------------------|
| `marine.js`        | NOAA Weather API              | 5 min    | marine, beach, tsunami  |
| `aviation.js`      | NOAA AWC + FAA NOTAM API      | 10 min   | aviation                |
| `beach.js`         | Hawaii Ocean Safety (SOEST)   | 1 hour   | beach                   |
| `homeassistant.js` | Home Assistant REST API       | 10 sec   | house                   |

### Resilience
- Each poller runs independently on its own `setTimeout` loop.
- An exception in one poller is caught and logged; all others continue unaffected.
- If an external API is down, the poller returns `[]` and the previous alerts remain in the store until the next successful poll evicts them.

---

## Deploying on CT 109 (Proxmox LXC)

```bash
# On the container
git clone <repo> /opt/alerts-engine
cd /opt/alerts-engine
npm install --omit=dev
cp .env.example .env && nano .env   # set HA_TOKEN

# Run with systemd
cat > /etc/systemd/system/alerts-engine.service <<'EOF'
[Unit]
Description=Hawaii Alerts Engine
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/alerts-engine
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
EnvironmentFile=/opt/alerts-engine/.env

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now alerts-engine
systemctl status alerts-engine
```

---

## Home Assistant Long-Lived Token

1. Open HA → Profile (bottom-left avatar)
2. Scroll to **Long-Lived Access Tokens** → **Create Token**
3. Name it `alerts-engine` and copy the token into `.env`

---

## FAA NOTAM API

Register at <https://api.faa.gov/> to obtain a `client_id` / `client_secret`.  
The service functions without these credentials — NOTAM alerts are simply omitted.
