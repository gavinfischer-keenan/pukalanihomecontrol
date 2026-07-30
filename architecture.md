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
9. **Track to Destination & Return**: Frequent visitor vessels (`vessel_info.track_dest_return=true`) are tracked via AISHub after leaving local AIS range. `ais-collector` hourly thread checks AISHub cache for tracked MMSIs not heard locally → inserts 1pt/hour into `track_history` (source_type='aishub_tracked', minute_bucket=hour). Auto-stops when vessel returns to local range (`local_is_fresh()` returns true). UI: checkbox in VesselEditForm (DetailPanel.jsx) → `PUT /api/vessel-info/:mmsi/track-dest`.
10. **Dual HDMI Projection System**: React/Vite Projection Controller web application (`display-projection-app`) serving HDMI 1 (`/#corner`), HDMI 2 (`/#maintv`), and Remote Virtual Screen Builder (`/#remote`). Per-widget configuration: vessel filter (All/Aircraft/Boats), camera grid size & camera picker (up to 9 cams), weather loop selection & dwell duration, BirdNET detection count.

## Dashboard & Projection Applications
- **Hawaii Dashboard (CT108)**: Express.js proxying APIs, querying PostGIS. Handles vessel dead-reckoning, aviation, tides, and weather layers.
- **Dual Projection Controller (`display-projection-app`)**: Multi-display React web application supporting Virtual Box Layout selection (1-Up, 2-Up, 3-Up, 4-Up), per-widget configuration panels, box content assignment, live screen mirrors, and Home Assistant alert rendering.
- **CT114 Services**: `display-server` (port 3000, camera grid kiosk), `utilities` (port 3114, PDF Maker/Shrinker), `photo-chrono` (port 7777, Photo Chronologizer), `nrsc5-engine` (HD Radio).


### Display Remote Overhaul (v2)

The display server remote (`http://192.168.1.114:3000/#remote`) supports the following features:

**Views Available**:
- **📹 Camera Grid** — Frigate camera feeds via go2rtc MJPEG with snapshot fallback
- **🚢 Vessel Tracker** — Live Hawaii Dashboard map centered on Pukalani (21.2855, -157.7969), 25nm ring at screen bottom
- **🌤️ Weather Loops** — Full-screen NOAA satellite imagery cycler with configurable per-loop dwell time (10-120s, default 30s). Sources from dashboard API `/api/nws/loops`.
- **🏠 House Status** — Coming Soon placeholder

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

## Auto-Recovery & Health Monitoring
- **Service Watchdog** (`/opt/service-watchdog.sh` on Proxmox host, cron */5): Monitors critical services on CT105 (tracker-engine, ais-collector), CT108 (port 3001 API), CT114 (display-server, utilities, photo-chrono, nrsc5-engine), and host (corner-kiosk dual HDMI). Checks both Chromium processes (main TV + corner) and HDMI-1 xrandr status. Auto-restarts dead services, re-enables disconnected displays, and refreshes kiosk browsers on display-server recovery.
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
