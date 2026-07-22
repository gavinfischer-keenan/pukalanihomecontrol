# Pukalani Home Control â€” Credentials, Tokens, and Connection Methods

> **CONTROLLED DOCUMENT** â€” contains live credentials.
> Rotate ALL secrets before sharing publicly.
>
> **Part of the Pukalani Home Control Architecture Documentation Suite:**
> - [architecture.md](architecture.md) â€” System architecture (hardware, VMs, data flows, network)
> - **architecture-credentials.md** â€” This file (credentials, tokens, SSH access, API endpoints)
> - [architecture-changelog.md](architecture-changelog.md) â€” Change log (append-only history)
>
> **Repository:** https://github.com/gavinfischer-keenan/pukalanihomecontrol
> **Location:** Pukalani, Maui, Hawaii â€” 21.2855Â°N, 157.7969Â°W

---
### 10.1 Database Credentials (CT104 â€” PostgreSQL)

| Database | User | Password | Port | Used By |
|----------|------|----------|------|---------|
| `tracking_db` | `tracker` | `pukalani` | 5432 | CT105 (tracker_engine, collectors), CT108 (dashboard server) |
| `project_mgr` | `pm_user` | `pukalani_pm` | 5432 | CT110 (hawaii-pm Express API), HAOS (pukalani_pm HACS integration) |

**Connection string pattern:**
```
postgresql://tracker:pukalani@192.168.1.104:5432/tracking_db
postgresql://pm_user:pukalani_pm@192.168.1.104:5432/project_mgr
```

**PostgreSQL `pg_hba.conf` on CT104** allows connections from 192.168.1.0/24 via md5.

### 10.2 Home Assistant Access

#### HA Users

| User | Role | Purpose |
|------|------|---------|
| 3786Pukalani | Owner | Primary admin account |
| Gavin | User | Personal access |
| Trish | User | Personal access |

#### Long-Lived Access Tokens (HA API)

| Token Name | Token ID | User | Purpose |
|------------|----------|------|---------|
| Antigravity july21 ClaudeOpus | `9cfbabcc65ee4d45b2e537b7ff4b7352` | 3786Pukalani | **Active** AI agent API access (Antigravity). Created 2026-07-21. |
| Antigravity Laptop | `169aad44a6ee4b74b952fd4aab90a0b5` | 3786Pukalani | Legacy â€” returns 401 (invalidated). Keep for reference. |
| Alerts long lived token | `950598726d4a4335b80805da730efffd` | 3786Pukalani | Alert system webhooks |
| HA dashboards longlived | `c179e26b62e34d38a84ed0a809774987` | 3786Pukalani | Dashboard API access |
| GE smart stove | `e7bcc9451db949918709465b7378148e` | 3786Pukalani | GE Appliance integration |

> **Active API Token (Antigravity july21 ClaudeOpus):**
> ```
> eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiI5Y2ZiYWJjYzY1ZWU0ZDQ1YjJlNTM3YjdmZjRiNzM1MiIsImlhdCI6MTc4NDY3OTQ0MSwiZXhwIjoyMTAwMDM5NDQxfQ.--1D08UijvGCtN1FkFtxXk2JvwayuLvHbteB3lRSOH8
> ```
> Expires: ~2036. Created 2026-07-21.
>
> **If this token stops working (401):** HA Profile â†’ Security â†’ Delete token â†’ Create new one â†’ update this document.

#### Preferred HA Access Methods (in order of preference)

1. **HA REST API** (preferred for all programmatic access):
   ```bash
   # Pattern:
   curl -s -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     http://192.168.1.19:8123/api/<endpoint>

   # Examples:
   # Get config
   curl -s -H "Authorization: Bearer $HA_TOKEN" http://192.168.1.19:8123/api/config

   # Get entity state
   curl -s -H "Authorization: Bearer $HA_TOKEN" http://192.168.1.19:8123/api/states/sensor.pm_total_tasks

   # Call a service
   curl -s -X POST -H "Authorization: Bearer $HA_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"entity_id": "light.living_room"}' \
     http://192.168.1.19:8123/api/services/light/turn_on

   # Create/update config entries (integrations)
   # Use POST to /api/config/config_entries/flow to start a config flow
   curl -s -X POST -H "Authorization: Bearer $HA_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"handler": "pukalani_birdnet", "show_advanced_options": false}' \
     http://192.168.1.19:8123/api/config/config_entries/flow

   # Restart HA
   curl -s -X POST -H "Authorization: Bearer $HA_TOKEN" \
     http://192.168.1.19:8123/api/services/homeassistant/restart
   ```

2. **File-level access via `qm guest exec`** (fallback when API is unavailable):
   ```bash
   # From Proxmox host (192.168.1.100):
   qm guest exec 100 -- cat /mnt/data/supervisor/homeassistant/configuration.yaml
   qm guest exec 100 -- ha core restart

   # For binary files, use base64 encoding:
   B64=$(base64 -w0 /tmp/myfile.py)
   qm guest exec 100 -- sh -c "echo '${B64}' | base64 -d > /mnt/data/supervisor/homeassistant/custom_components/my_comp/myfile.py"
   ```
   > **WARNING:** Do NOT inject entries directly into `.storage/core.config_entries` â€” malformed entries
   > can prevent HA from starting. Use the REST API config flow endpoints instead.

3. **HA CLI** (from inside HAOS VM):
   ```bash
   qm guest exec 100 -- ha core restart
   qm guest exec 100 -- ha core info
   qm guest exec 100 -- ha core stats
   ```

#### HA Webhook Token

| Webhook | Token | Used By |
|---------|-------|---------|
| Ecowitt weather push | `5de76fbee15b641d309d042238b47326` | CT108 dashboard â†’ /api/ecowitt endpoint |

Full URL: `http://192.168.1.19:8123/api/webhook/5de76fbee15b641d309d042238b47326`

### 10.3 InfluxDB (HA Add-on)

| Setting | Value |
|---------|-------|
| Host | `a0d7b954-influxdb` (internal add-on hostname) |
| Port | 8086 |
| Database | `homeassistant` |
| Username | `hauser` |
| Password | `hapassword123` |

Configured in `configuration.yaml` under `influxdb:`.

### 10.4 MQTT (Mosquitto on HA)

| Setting | Value | Status |
|---------|-------|--------|
| Broker IP | 192.168.1.19 | Installed as HA add-on |
| Port | 1883 | LAN-accessible |
| User (Frigate) | `frigate` | **PENDING** â€” create in Mosquitto config |
| User (HA internal) | `ha_internal` | **PENDING** â€” create in Mosquitto config |

### 10.5 Frigate / Camera Credentials

| Secret | Value | Where Used |
|--------|-------|------------|
| Frigate RTSP password | `frigate_internal` | CT113 docker-compose.yml (FRIGATE_RTSP_PASSWORD env var) |
| Aqara G4 camera RTSP | User: `772` / Pass: `885` | Frigate config.yml RTSP URLs |
| Additional cameras | **PENDING** | Add credentials here as cameras are installed |

RTSP URL pattern for Aqara cameras:
```
rtsp://772:885@<camera-ip>:8554/live
```

### 10.6 Service Environment Files

**CT105 â€” Tracker Engine** (`/opt/tracker_engine.py` hardcoded):
```
DB_HOST = "192.168.1.104"
DB_NAME = "tracking_db"
DB_USER = "tracker"
DB_PASS = "pukalani"
```

**CT108 â€” Dashboard Server** (`/opt/dashboard/server/.env`):
```
DB_USER=tracker
DB_HOST=192.168.1.104
DB_NAME=tracking_db
DB_PASS=pukalani
DB_PORT=5432
HOME_LAT=21.2855
HOME_LON=-157.7969
TAR1090_URL=http://192.168.1.102/tar1090/data/aircraft.json
ALERTS_ENGINE_URL=http://192.168.1.109:3009
HA_WEBHOOK_URL=http://192.168.1.19:8123/api/webhook/5de76fbee15b641d309d042238b47326
PORT=3001
```

**CT110 â€” Project Manager** (`/opt/hawaii-pm/.env`):
```
PORT=3001
DB_USER=pm_user
DB_HOST=192.168.1.104
DB_NAME=project_mgr
DB_PASSWORD=pukalani_pm
DB_PORT=5432
```
> PM2 must be started with `NODE_ENV=production` to serve the Vite build.
> Command: `NODE_ENV=production pm2 start server/index.js --name hawaii-pm`

### 10.7 SSH and Infrastructure Access

| Target | Method | Notes |
|--------|--------|-------|
| Proxmox host | `ssh root@192.168.1.100` | Key-based auth from dev laptop |
| Any CT | `pct exec <VMID> -- <command>` | From Proxmox host |
| HAOS VM | `qm guest exec 100 -- <command>` | From Proxmox host; no SSH inside HAOS |
| GitHub push | From CT108 | `~/.git-credentials` contains PAT |

**Preferred remote access pattern from a dev machine:**
```bash
# Run a command in a container:
ssh root@192.168.1.100 "pct exec 110 -- cat /opt/hawaii-pm/.env"

# Run a command in HAOS VM:
ssh root@192.168.1.100 "qm guest exec 100 -- ha core info"

# Deploy a file to HAOS (via base64 due to no stdin piping):
scp myfile.py root@192.168.1.100:/tmp/myfile.py
ssh root@192.168.1.100 'B64=$(base64 -w0 /tmp/myfile.py); qm guest exec 100 -- sh -c "echo ${B64} | base64 -d > /target/path/myfile.py"'

# Deploy a file to a container:
scp myfile.py root@192.168.1.100:/tmp/myfile.py
ssh root@192.168.1.100 "pct push <VMID> /tmp/myfile.py /opt/target/myfile.py"
```

### 10.8 API Endpoints Reference

| Service | URL | Auth | Purpose |
|---------|-----|------|---------|
| HA REST API | `http://192.168.1.19:8123/api/` | Bearer token | All HA operations |
| PM API | `http://192.168.1.110:3001/api/` | None (LAN-only) | Tasks, vendors, owners, assets, warranties |
| PM Web UI | `http://192.168.1.110:3001/` | None | Full React SPA |
| BirdNET-Go API | `http://192.168.1.25:8080/api/v2/` | None (LAN-only) | Detections, species, analytics |
| BirdNET-Go UI | `http://192.168.1.25:8080/` | None | BirdNET web interface |
| Dashboard | `http://192.168.1.108:8080/` | None | Vessel/weather dashboard |
| Dashboard API | `http://192.168.1.108:3001/api/` | None | Tracking data API |
| ADS-B (tar1090) | `http://192.168.1.102/tar1090/` | None | Aircraft tracking |
| Utilities (CT114) | `http://192.168.1.114:3114/` | None | PDF tools, games, health converter |
| Frigate NVR | `http://192.168.1.113:5000/` | None | Camera NVR |
| Alerts Engine | `http://192.168.1.109:3009/` | None | Maritime/weather alerts |

---

---

*Part of: Pukalani Home Control Architecture Documentation Suite*
*Repository: https://github.com/gavinfischer-keenan/pukalanihomecontrol*
*Last updated: 2026-07-21*
