# Hawaii Tracker — System Architecture

## Overview
The Hawaii Tracker is a distributed edge computing system running on a Proxmox VE host (192.168.1.100). It collects, processes, and visualizes marine (AIS), aviation (ADS-B), weather (Ecowitt), video surveillance (Frigate NVR + Coral TPU), environmental audio (BirdNET), and dual-monitor projection UI (Dell HDMI outputs).

## Proxmox Host
- **IP**: 192.168.1.100
- **Roles**: Hypervisor, hardware passthrough, cron health checks, USB handling, dual HDMI output display driver.
- **Physical HDMI Kiosk**: `corner-kiosk.service` (systemd) runs X11 + Chromium kiosk on tty1 loading `http://192.168.1.114:3000/#corner`.

## Virtual Machines & Containers
- **CT101 (brain)**: Internal processing logic.
- **CT102 (Airspace)**: `dump1090`/`tar1090` at 192.168.1.102 (ADS-B receiver).
- **CT103 (Marine-ais)**: USB serial bridge (deprecated in favor of ais-host-forwarder).
- **CT104 (trackerDB)**: PostgreSQL host (192.168.1.104). Databases: `tracking_db` (vessel/aircraft tracking), `expense_db` (expense & tax tracking). Uses `tracker` / `pukalani`. Cron: `track-history-sampler.sh` (every minute, downsamples `live_tracks` → `track_history`), `db-maintenance.sh` (daily 4am, prunes old data + VACUUM).
- **CT105 (tracker-engine)**: Two Python services:
  - `tracker-engine.service`: ADS-B polling from tar1090 (CT102) every 5s → `live_tracks`. AISHub polling **disabled** (ais-collector owns it).
  - `ais-collector.service`: Local AIS NMEA decoder (UDP :10110), AISHub API integration (120s interval → in-memory cache → HTTP :3105/api/aishub-nearby), AIS receiver health monitoring, destination prediction, hourly destination tracker thread (tracks `vessel_info.track_dest_return=true` vessels via AISHub → `track_history` with `source_type='aishub_tracked'`).
- **CT106 (sdr-engine)**: Software Defined Radio orchestration.
- **CT108 (dashboard)**: Node.js API (port 3001) & React/Vite Client (port 8080). (192.168.1.108)
- **CT109 (alerts-engine)**: Webhooks and alerting rules (port 3009) receiving system events strictly from Home Assistant (VM100).
- **CT110 (project-mgr)**: Hawaii Project Manager — Node.js API (port 3001) & React/Vite Client (192.168.1.110). Vendor/Owner CRM, task tracking, Gantt timeline, daily tasks, maintenance log, event log, shopping list. GitHub: `gavinfischer-keenan/ProjectManagement`.
- **CT111 (nrsc5-engine)**: HD Radio / TMC pipeline.
- **CT112 (birdnet)**: Docker `birdnet_go` (port 8080) acoustic analysis with RTSP audio stream ingestion.
- **CT113 (frigate)**: Docker Frigate NVR v0.17 with Google Coral USB Edge TPU acceleration. Object detection: person, car, cat, dog, bird, package.
- **CT115 (expense-tracker)**: Expense & Tax Tracking — Node.js API (port 3001) & React/Vite Client (DHCP IP, will be staticized). Tracks house improvement and travel expenses for reimbursement with tax categorization. No HA integration. PostgreSQL `expense_db` on CT104. GitHub: `gavinfischer-keenan/ExpenseTaxTracking`.
- **VM100 (haos-18.1)**: Home Assistant OS at 192.168.1.19. Primary event & alert emitter.

## Network Topology & IPs

### Infrastructure
| Device | IP | Notes |
|---|---|---|
| Proxmox Host | 192.168.1.100 | Dell server, dual HDMI, Coral TPU host |
| CT102 (tar1090) | 192.168.1.102 | ADS-B receiver |
| CT104 (PostgreSQL) | 192.168.1.104 | tracking_db |
| CT105 (tracker-engine) | 192.168.1.105 | AIS/ADS-B collector |
| CT108 (dashboard) | 192.168.1.108 | API + Web client |
| CT109 (alerts-engine) | 192.168.1.109 | HA webhook alerts |
| CT112 (BirdNET Go) | 192.168.1.112 | Acoustic analysis |
| CT113 (Frigate NVR) | 192.168.1.113 | NVR + Coral TPU (port 5000) |
| VM100 (Home Assistant) | 192.168.1.19 | HAOS + MQTT broker (1883) |

### Aqara Camera Fleet
| Camera | Frigate Name | IP | RTSP Port | Detect Stream | Record Stream | Status |
|---|---|---|---|---|---|---|
| Aqara Cam 1 (Front Garden from Roof) | `aqara_cam_1` | 192.168.1.32 | 8554 | `rtsp://772:885@192.168.1.32:8554/1080p` | `rtsp://772:885@192.168.1.32:8554/1520p` | ✅ Active |
| Aqara Cam 2 (Back Deck) | `aqara_cam_2` | 192.168.1.33 | 8554 | `rtsp://772:885@192.168.1.33:8554/1080p` | `rtsp://772:885@192.168.1.33:8554/1520p` | ✅ Active |
| Aqara Cam 3 (Future) | `aqara_cam_3` | TBD | 8554 | — | — | ⏳ Pending |
| Aqara Cam 4 (Future) | `aqara_cam_4` | TBD | 8554 | — | — | ⏳ Pending |
| Aqara Cam 5 (Future) | `aqara_cam_5` | TBD | 8554 | — | — | ⏳ Pending |
| Aqara Cam 6 (Future) | `aqara_cam_6` | TBD | 8554 | — | — | ⏳ Pending |
| Aqara Cam 7 (Future) | `aqara_cam_7` | TBD | 8554 | — | — | ⏳ Pending |
| Aqara Cam 8 (Future) | `aqara_cam_8` | TBD | 8554 | — | — | ⏳ Pending |
| Aqara Cam 9 (Future) | `aqara_cam_9` | TBD | 8554 | — | — | ⏳ Pending |

### Frigate NVR API Endpoints (CT113 — 192.168.1.113:5000)
- **Live Snapshot**: `http://192.168.1.113:5000/api/<camera_name>/latest.jpg`
- **MJPEG Stream**: `http://192.168.1.113:5000/api/<camera_name>` (Content-Type: multipart/x-mixed-replace)
- **Stats**: `http://192.168.1.113:5000/api/stats`
- **Config**: `http://192.168.1.113:5000/api/config`

## Hardware & USB/HDMI Passthrough
- **Aqara Cameras**: IP-based RTSP streaming (192.168.1.32:8554, 192.168.1.33:8554). Audio split to BirdNET, Video split to Frigate NVR.
- **Google Coral Edge TPU**: USB accelerator (`Bus 002, Device 005, ID 18d1:9302`) passed through to CT113 via LXC cgroup (`c 189:* rwm`). Real-time inference at 320×320 for person, car, cat, dog, bird, package detection.
- **Zigbee Dongle (Sonoff 3.0 Plus V2)**: Passed to VM100 (HAOS). Fixed at physical USB path `1-6.3`.
- **AIS Receiver (Qudinip CP210x)**: Host bound via udev symlink `/dev/ttyAIS`. `ais-host-forwarder` reads serial and sends UDP.
- **Dell Host Dual HDMI Outputs** (both managed by `corner-kiosk.service` via `/opt/corner-kiosk/start-kiosk.sh`):
  - **HDMI-1 (Corner Monitor, 1920x1080)**: Chromium kiosk loading `http://192.168.1.114:3000/#corner`. User data: `/tmp/chromium-corner-data`. Window position: 3840,0.
  - **HDMI-3 (Main TV, 3840x2160)**: Chromium kiosk loading `http://192.168.1.114:3000/#maintv`. User data: `/tmp/chromium-kiosk-user-data`. Window position: 0,0.
  - **Virtual framebuffer**: 5760x2160 (HDMI-3 left + HDMI-1 right).
  - **Recovery**: `service-watchdog.sh` (cron */5) monitors both Chromium processes and HDMI-1 xrandr status. `network-recovery.sh` (systemd timer, every 2min) restarts kiosk on full recovery. Both detect and re-enable HDMI-1 if reconnected.

## Data & Media Pipelines
1. **Camera Audio Pipeline**: Aqara RTSP streams (`rtsp://...192.168.1.32:8554/1080p` and `rtsp://...192.168.1.33:8554/1080p`) → FFmpeg audio decode → BirdNET Go (CT112) → Acoustic species detection → SQLite DB & SSE real-time stream.
2. **Camera Video & NVR Pipeline**: Aqara RTSP 1080p detect stream → Frigate (CT113) → Google Coral Edge TPU inference (person, car, dog, cat, bird, package) → MQTT (192.168.1.19:1883) & RTSP 1520p high-res recording. Snapshots retained 14 days, motion recordings 7 days, alert/detection recordings 14 days.
3. **Alert Ingestion Pipeline**: System alerts are emitted **strictly by Home Assistant (VM100 / CT109 webhooks & MQTT topics)**. No alerts are generated by client UIs.
4. **AIS Local (Marine)**: Qudinip Serial → `/dev/ttyAIS` → `ais-host-forwarder.sh` (UDP :10110) → `ais-collector` (CT105) → `live_tracks` (source_type='ais') → `track_history` (1pt/min sampler cron) → Dashboard Trails API.
5. **AIS Remote (AISHub)**: `ais-collector` (CT105) polls AISHub API every 120s → in-memory cache (NOT stored in DB) → HTTP :3105/api/aishub-nearby → Dashboard `/api/vessels/nearby` proxy → VesselLayer renders with dashed ring, 70% opacity, labeled as remote. AISHub also enriches local vessel metadata (name/type/destination). AIS receiver health: if AISHub shows ≥3 vessels within 15nm that local antenna hasn't heard, logs hardware warning.
6. **ADS-B (Aviation)**: RTL-SDR → `dump1090` (CT102) → JSON → `tracker-engine` (CT105) polls every 5s → `live_tracks` (source_type='adsb') → `track_history` → Dashboard.
7. **Weather (PWS)**: Ecowitt Device → POST `/api/ecowitt` (CT108) → `tracking_db` AND HA Webhook.
8. **Vessel Trail Pipeline**: `live_tracks` → `track-history-sampler.sh` (cron */1 on CT104, UPSERT 1pt/entity/min, 5-min lookback) → `track_history` → `/api/trails/:id?today=true` → TrailLayer.jsx (client). DB cache refreshes every 5 min, live ring buffer bridges 90s gap. Trail retention: 7 days (pruned by `db-maintenance.sh`). `track_history.source_type` distinguishes local (`ais`) vs remote AISHub (`aishub_tracked`) segments; TrailLayer renders local as solid black, AISHub as dotted light blue with 2.5nm course vector.
9. **Track to Destination & Return**: Frequent visitor vessels (`vessel_info.track_dest_return=true`) are tracked via AISHub after leaving local AIS range. `ais-collector` hourly thread checks AISHub cache for tracked MMSIs not heard locally → inserts 1pt/hour into `track_history` (source_type='aishub_tracked', minute_bucket=hour). Auto-stops when vessel returns to local range (`local_is_fresh()` returns true). UI: checkbox in VesselEditForm (DetailPanel.jsx) → `PUT /api/vessel-info/:mmsi/track-dest`. Edit Vessel Info form saves via `POST /api/vessel-info/:mmsi` supporting both `multipart/form-data` (FormData) and `application/json`, with optional photo upload and sanitized numeric inputs.
10. **Dual HDMI Projection System**: React/Vite Projection Controller web application (`display-projection-app`) serving HDMI 1 (`/#corner`), HDMI 2 (`/#maintv`), and Remote Virtual Screen Builder (`/#remote`). Per-widget configuration: vessel filter (All/Aircraft/Boats), camera grid size & camera picker (up to 9 cams), weather loop selection & dwell duration, BirdNET detection count.

## Dashboard & Projection Applications
- **Hawaii Dashboard (CT108)**: Express.js proxying APIs, querying PostGIS. Handles vessel dead-reckoning, aviation, tides, and weather layers.
- **Dual Projection Controller (`display-projection-app`)**: Multi-display React web application supporting Virtual Box Layout selection (1-Up, 2-Up, 3-Up, 4-Up), per-widget configuration panels, box content assignment, live screen mirrors, and Home Assistant alert rendering.
- **CT114 Services**: `display-server` (port 3000, camera grid kiosk), `utilities` (port 3114, PDF Maker/Shrinker), `photo-chrono` (port 7777, Photo Chronologizer), `nrsc5-engine` (HD Radio).


### Display Remote Overhaul (v2)

The display server remote (`http://192.168.1.114:3000/#remote`) supports the following features:

**Views Available** (defined in `viewRegistry.jsx` + `displayConfig.js`):

| ID | Label | Description |
|----|-------|-------------|
| `black` | ⬛ Black (Off) | Pure black screen — **default for all new/unset slots** |
| `cams` | 📹 Camera Grid | Frigate feeds via go2rtc MJPEG with snapshot fallback |
| `vessels` | 🚢 Vessel Tracker | Live Hawaii Dashboard map. Zoom (7-17) + center presets per-slot. Default center: 2.5mi South of Pukalani (21.2500). URL params: `?zoom=N&center=lat,lon` |
| `weather` | 🌤️ Weather Loops | Full-screen NOAA satellite imagery cycler. Dwell 10-120s, default 30s. Source: `/api/nws/loops` |
| `current_weather` | 🌡️ Current Weather | Live weather dashboard — see below |
| `house_status` | 🏠 House Status | Coming Soon placeholder |

**Current Weather View** (`CurrentWeatherView.jsx`):
High-density glassmorphism weather dashboard designed after Hawaii Dashboard theme:
- **EcowittPanel** (`data-section="ecowitt"`) — Local HP2564BU Pro station readings with custom graphics:
  - **Wind Compass Rose**: SVG circular dial with rotating needle pointing to wind bearing (`wind_dir`), centered speed readout, unit, cardinal direction, and peak gusts.
  - **Virtual Rain Cup**: SVG beaker gauge displaying daily rainfall (`rain_daily_in`) with fluid fill height and graduation ticks.
  - **Humidity Comfort Scales**: Dual indoor/outdoor comfort bars categorized by standard humidity scale (Dry, Ideal, Pleasant, Humid, Muggy).
  - Secondary stats for barometric pressure, UV index, and solar radiation.
- **ForecastPanel** (`data-section="forecast"`) — 7-Day NWS forecast cards with NWS condition icons and High/Low temperature pills.
- **TidePanel** (`data-section="tides"`) — Honolulu tide curve (NOAA station 1612340) with SVG area fill, glowing current-time position marker, high/low peak labels, and next 4 tide event cards.
- **FishingPanel** (`data-section="fishing"`) — Solunar Fishing Index (matching `ForecastPanel.jsx` on main dashboard): 4-star rating system, moon age, major periods (moon overhead/underfoot), and minor periods (moonrise/moonset).
- **SunMoonPanel** (`data-section="sunmoon"`) — Sunrise/sunset times and moon phase & illumination percentage.

**Architecture — Adding a new view** (one file, two lines):
1. Create `src/components/MyView.jsx`
2. In `viewRegistry.jsx`: add `import MyView from './components/MyView'` + `my_view: MyView` to the map
3. In `displayConfig.js`: add `{ id: 'my_view', label: '🔲 My View' }` to `VIEW_REGISTRY`
That's it — the Remote UI dropdown, DisplayView, and CycleView all pick it up automatically.

**CSS Architecture**: `src/weather.css` holds bare-bones structural styles for CurrentWeatherView. Intentionally unstyled — UI agents should add visual polish in `index.css` or a dedicated theme file, targeting `[data-section]` attributes.

**Removed Views**: BirdNET Detections, Aircraft Radar

**Layout Modes**: Full Screen, 2-Up Side by Side, 2-Up Stacked, 3-Up (Top Big), 3-Up (Left Big), 4-Up Grid, **Cycle Mode**

**Per-Slot Camera Selection**: Each layout slot with cameras assigned gets its own independent camera picker (bug fix — previously all slots shared one camera list).

**Cycle Mode**: Full-screen auto-cycling through a configurable list of views. Each cycle step has:
- Independent view type selection
- Per-view configuration (camera selection, weather dwell time, etc.)
- Configurable dwell time per step (5-600 seconds)
- Reorderable via up/down arrows
- Smooth crossfade transitions between steps

**State Structure**: Cycle steps stored as `${displayId}CycleSteps` array in the shared state JSON. Per-slot configs stored as `${displayId}SlotConfigs.${slotId}`.

**Tests**: `/opt/display-server/tests/display-server.test.js` — 14 tests covering views, per-slot config, cycle mode, weather dwell, state structure. Run: `cd /opt/display-server && npx vitest run`

**Source**: Version-controlled at `infra/ct114-display-server/` in the dashboard repo.

**Dashboard API — Weather Aggregator** (`/api/weather/conditions` on CT108):
Single endpoint returning all data needed by `CurrentWeatherView` in one call:
```json
{ "ecowitt": {...}, "forecast": [...14 periods], "tides": [...48hr H/L], "fads": {GeoJSON}, "generatedAt": "ISO" }
```
- Ecowitt: direct DB query (shared pool, `ecowitt_obs` table)
- NWS forecast: fetched from `api.weather.gov`, cached 1hr in memory (good-citizen policy — NWS updates 2×/day)
- NOAA tides: fetched from `tidesandcurrents.noaa.gov` station 1612340 (Honolulu), H/L detected via local extrema
- FADs: from existing `nwsService` cache

## Auto-Recovery & Health Monitoring

### Service Watchdog (`/opt/service-watchdog.sh`, cron */5)
Monitors all critical services across all containers:
- **CT105**: tracker-engine, ais-collector, adsb-collector
- **CT108**: Dashboard API (port 3001)
- **CT114**: display-server, utilities, photo-chrono, nrsc5-engine
- **CT115**: expense-tracker (pm2 expense-api, DHCP at .28)
- **Host**: corner-kiosk (dual HDMI), hdmi-watchdog, Chromium processes
- Uses `/api/reload` WebSocket endpoint (not xdotool) for reliable kiosk browser refresh after display-server recovery

### HDMI Watchdog (`/opt/corner-kiosk/hdmi-watchdog.sh`, systemd)
Every 60 seconds, checks if HDMI-3 (main TV) has an active resolution. If the i915 GPU drops the PHY reference clock, the watchdog re-applies `xrandr` to recover signal. Kernel params `i915.enable_dc=0 i915.enable_psr=0` in GRUB prevent most drops.

### Post-Boot Sequencing (`/opt/hawaii-nanny/post-boot.sh`, @reboot)
After a full power cycle, brings up the entire stack in dependency order:
1. Wait for network (gateway pingable, 120s timeout)
2. Wait for PostgreSQL (CT104, pg_isready, 60s)
3. Start CT105 services (tracker, ais-collector, adsb-collector)
4. Wait for Dashboard API (CT108, 60s)
5. Start display-server (CT114), expense-tracker (CT115)
6. Start corner-kiosk + send /api/reload
7. Start HDMI watchdog + SDR scheduler
8. USB device audit + full status summary

### Subnet Migration (`/opt/hawaii-nanny/subnet-migrate.sh`)
For new router scenarios. Usage: `subnet-migrate.sh 192.168.1 192.168.0`. Reconfigures all container static IPs in Proxmox LXC configs, updates service config files containing IP references, rebuilds the display-server frontend, and restarts all containers. The network-recovery nanny auto-detects subnet changes and alerts via HA notification.

### Network Recovery Nanny (`/opt/hawaii-nanny/network-recovery.sh`, timer */2min)
Auto-detects gateway via `ip route`. Monitors gateway, DNS, container connectivity (via pct exec, not IP ping), service health, and USB devices. On gateway state change, runs full recovery sequence. Detects subnet changes and alerts.

- **DB Auto-Reconnect**: `tracker-engine` and `ais-collector` catch `psycopg2.InterfaceError`/`OperationalError` in polling loops, safely close dead connections, and re-establish via `get_db_connection()` with exponential backoff.
- **DB Maintenance** (`/opt/db-maintenance.sh` on CT104, cron 0 4 daily): Prunes `live_tracks` (AIS >48h, ADS-B >1h, NULL source_type), `track_history` (>7 days), VACUUM ANALYZE.

### AIS SDR Pipeline — Sample Rate Fix (2026-07-29)

**Root Cause**: After USB hub/switch disruption, `rtl_tcp` started at 2400000 S/s but
`ais-catcher` requests 288000 S/s on connect. The runtime sample rate change crashes
the RTL-SDR Blog V4 USB bulk transfer (`worker cond timeout`).

**Fix**: Both services now use matched sample rate of **1536000** S/s (standard dual-channel AIS):
- Host: `/etc/systemd/system/rtl-tcp-ais.service` → `-s 1536000`
- CT106: `/etc/systemd/system/ais-catcher.service` → `-s 1536000`

**Lesson**: Never allow runtime sample rate renegotiation between rtl_tcp and its clients.
The initial rate must match what the client will request.

### Resilience System (2026-07-29)

Three-layer resilience system for automated recovery from network/USB disruptions:

#### 1. Health Banner (`client/src/components/HealthBanner.jsx`)
- Polls `/api/health` every 60 seconds
- Displays amber/red degradation banners when AIS, ADS-B, or database are offline
- Dismissible but returns on next poll if still degraded
- Glassmorphism styling with slide-down animation

#### 2. SDR Scheduler USB Escalation (`/opt/sdr-scheduler/sdr-scheduler.sh`)
- Failure counter tracking in `/tmp/sdr-watchdog-failures`
- Escalation: Failures 1-2 → service restart; Failure 3 → USB IOCTL hard reset + HA notification; Failure 5+ → critical alert (physical replug needed)
- `USBDEVFS_RESET` ioctl via python3 + sysfs unbind/rebind
- Auto-resets failure counter when messages start flowing

#### 3. Network Recovery Nanny (`/opt/hawaii-nanny/network-recovery.sh`)
- Systemd timer runs every 2 minutes on Proxmox host
- Checks: gateway ping, DNS resolution, container connectivity, service health, USB device audit
- Auto-recovery: restarts networking/services, full recovery on gateway state change
- HA notifications for USB device loss and network disruptions
- State tracking in `/tmp/hawaii-nanny/` (gateway, usb_blog_v4, usb_adsb)

### Trail Display Fix — AISHub Vessels (2026-07-29)

**Problem**: AISHub-sourced vessels (like TORM THOR) had track_history data but trails didn't render when selected.

**Root cause**: `TrailLayer` only received local DB-tracked vessels, not the merged list including AISHub nearby vessels. When an AISHub vessel was selected, TrailLayer never fetched its trail from `/api/trails/:id`.

**Fix**: Created `allVessels` via `useMemo()` — a single merged+deduped list of local vessels and AISHub nearby vessels — and passed it to both `TrailLayer` and `VesselLayer`. This also DRYed up the inline IIFE dedup that was previously in VesselLayer.

### Infrastructure Scripts — Version Control (2026-07-29)

Host-level infrastructure scripts are now version-controlled in the dashboard repo under `infra/`:
- `infra/host/sdr-scheduler.sh` — SDR time-share scheduler with USB escalation
- `infra/host/sdr-scheduler.service` — systemd unit
- `infra/host/network-recovery.sh` — Network topology change recovery nanny
- `infra/host/network-recovery.service` — systemd unit
- `infra/host/network-recovery.timer` — 2-minute timer
- `infra/host/rtl-tcp-ais.service` — RTL-SDR TCP server for AIS
- `infra/ct106/ais-catcher.service` — AIS-catcher decoder service

### Current Weather View Dashboard Overhaul (CT114 / CT108)

The `CurrentWeatherView` dashboard is a container-aware, dynamic web application designed for high-density multi-display monitoring.

#### Dynamic Grid Layout & Container Responsiveness
- **Aspect-Ratio Grid Decision**: A `ResizeObserver` monitors container dimensions.
  - **`aspect < 1.25`** (Tall slot, e.g. 2-Up Side-by-Side ~960x1080): Locks to **2 Columns × 3 Rows** (`2col` layout with left & right flex columns).
  - **`aspect >= 1.25`** (Wide slot, e.g. 2-Up Stacked ~1920x540): Locks to **3 Columns × 2 Rows** (`3col` layout).
- **Proportional Scaling**: Automatically calculates `--wx-scale` CSS variable set on the root element, maintaining perfect typography and element proportions without scrollbars or clipping.

#### 6 Panel Architecture & Features
1. **Box 1: Current Temp & Atmosphere + Integrated Humidity**
   - Outdoor Temperature (F) with big display, Indoor Temp, and Dew Point.
   - Barometric Pressure (inHg), UV Index, Solar Radiation (W/m²).
   - Integrated compact Outdoor & Indoor Humidity meters featuring a 5-stage comfort scale (`Dry`, `Ideal`, `Pleasant`, `Humid`, `Muggy`) with color-coded fill bars.
2. **Box 2: Wind & Rain Station**
   - Wind Compass Rose Gauge: Vector needle with live direction (°), speed (MPH), cardinal text, and gust tracking.
   - Virtual 2.0" Rain Cup Gauge: Transparent glass tick marks, dynamic water level animation, daily total, and rain rate.
3. **Box 3: Wave & Sea State Animation**
   - Multi-layer SVG animated ocean waves (`waveMoveBack`, `waveMoveMid`, `waveMoveFront`) simulating live ocean swells.
   - Overlay metrics chips displaying Swell Height (`4.2 FT @ 12s`), Swell Direction (`SSW 200°`), and Sea Temperature (`78.5°F`).
4. **Box 4: 7-Day NWS NOAA Forecast (Horizontal Row Layout)**
   - 7 stacked horizontal rows (`TONIGHT` highlighted with bright cyan border and glow + 6 daily rows).
   - **Large High-Contrast Vector SVG Drawings**: `IconSun`, `IconCloudRain`, `IconCloudSun`, `IconThunder`, `IconCloud` (28px height, bold 2.2px stroke weight).
   - **Live NWS High/Low Parsing**: `p.temp ?? p.temperature` parsing for exact NOAA High/Low temps (`HI 86° / LO 77°`).
   - Rain chance percentage badges (`% Rain`) and right-shifted wind readouts.
5. **Box 5: Marine Box**
   - Live NOAA Marine advisories: Small Craft Advisory and High Surf Advisory status cards (`OK` / `ALERT`), plus special notifications banner.
   - 36-Hour High/Low NOAA Tide Chart with SVG path fill, current time indicator line, and upcoming High/Low tide cards.
6. **Box 6: Sky Panel (Renamed from Sky and Fish)**
   - **Live Clock & Spelled-Out Date Card**: Prominently features local time (`7:51 AM`) and spelled-out date (`July 31, 2026`) along with Moon Phase pill (`Waxing Gibbous`).
   - **Enlarged 24-Hour Solar & Lunar Traverse Animation**: Scaled-up SVG graphic (`360px` max-width, `115px` height) with smooth parabolic arcs for Sun and Moon traverse.
   - **Single-Moon Trajectory Math (No "Two Moons")**: Fixed dual-arc overlap by calculating a single, continuous Moon trajectory across the 24-hour horizon with solid (travelled) and dashed (remaining) paths.
   - **Moon Phase Slider**: Full to Dark scale (`FULL 🌕 100%` <-> `DARK 0%`), dynamic thumb marker with exact illumination %, and **increased font size** for the trend arrow (`GETTING DARKER WANING ➔` or `➔ GETTING BRIGHTER WAXING`).


### AIS Receiver Self-Healing Watchdog & JOSEPH SAUSE Recovery (2026-07-31)

**Issue**: The user observed *JOSEPH SAUSE* (MMSI ) visible to the naked eye in Hawaii waters but displayed on  with label **"AIS (Network / AISHub)"** and missing real-time SDR trails.

**Root Cause**: The  TCP connection on host  dropped connection to  on CT106. With zero local SDR packets arriving at  (CT105), the collector fell back to AISHub network API, marking vessels as network-sourced without high-resolution local trails.

**Fix & Self-Healing Architecture**:
1. Restarted  and . Local SDR packet decoding resumed immediately ( MMSI  tracked live at 21.1832N, -157.7101W, speed 7.1kt, heading 287°).
2. Added self-healing watchdog to  (host timer, every 2min). If  writes  (AISHub sees ≥3 vessels within 15nm while local antenna sees 0),  automatically restarts  and , clearing the flag and restoring local SDR packet streaming seamlessly.


### Photo Chronologizer Session Recovery & Image Serving Resilience (2026-07-31)

**Issue**: Opening previously ordered photo session  ("Subject 1967") at  stuck on loading spinners. Photo serving requests () returned .

**Root Cause**: The background retention loop  automatically purged import directory  after 48 hours without checking if the session was active in DB. When the user opened the session to validate/review it, image rendering failed because the source files were missing from the import directory.

**Fix & Resilience Enhancements**:
1. Restored 759 photos for session  into  and updated  paths in .
2. Implemented  fallback resolution in : automatically checks , , and fuzzy filename matches if  is missing.
3. Added SVG placeholder fallback: if an image file cannot be read,  returns a valid SVG placeholder image instead of throwing , preventing UI freezes.
4. Updated retention policy: extended retention to 168 hours (7 days) and added active DB session checks so active sessions are never purged automatically.
