# Hawaii Tracker — System Architecture

## Overview
The Hawaii Tracker is a distributed edge computing system running on a Proxmox VE host (192.168.1.100). It collects, processes, and visualizes marine (AIS), aviation (ADS-B), weather (Ecowitt), video surveillance (Frigate NVR + Coral TPU), environmental audio (BirdNET), and dual-monitor projection UI (Dell HDMI outputs).

## Proxmox Host
- **IP**: 192.168.1.100
- **Roles**: Hypervisor, hardware passthrough, cron health checks, USB handling, dual HDMI output display driver.
- **Physical HDMI Kiosk**: `corner-kiosk.service` (systemd) runs X11 + Chromium kiosk on tty1 loading `http://192.168.1.8:3000/#corner`.

## Virtual Machines & Containers
- **CT101 (brain)**: Internal processing logic.
- **CT102 (Airspace)**: `dump1090`/`tar1090` at 192.168.1.102 (ADS-B receiver).
- **CT103 (Marine-ais)**: USB serial bridge (deprecated in favor of ais-host-forwarder).
- **CT104 (trackerDB)**: PostgreSQL tracking_db (192.168.1.104). Uses `tracker` / `pukalani`. Cron: `track-history-sampler.sh` (every minute, downsamples `live_tracks` → `track_history`), `db-maintenance.sh` (daily 4am, prunes old data + VACUUM).
- **CT105 (tracker-engine)**: Two Python services:
  - `tracker-engine.service`: ADS-B polling from tar1090 (CT102) every 5s → `live_tracks`. AISHub polling **disabled** (ais-collector owns it).
  - `ais-collector.service`: Local AIS NMEA decoder (UDP :10110), AISHub API integration (120s interval → in-memory cache → HTTP :3105/api/aishub-nearby), AIS receiver health monitoring, destination prediction.
- **CT106 (sdr-engine)**: Software Defined Radio orchestration.
- **CT108 (dashboard)**: Node.js API (port 3001) & React/Vite Client (port 8080). (192.168.1.108)
- **CT109 (alerts-engine)**: Webhooks and alerting rules (port 3009) receiving system events strictly from Home Assistant (VM100).
- **CT110 (project-mgr)**: Git/project administration.
- **CT111 (nrsc5-engine)**: HD Radio / TMC pipeline.
- **CT112 (birdnet)**: Docker `birdnet_go` (port 8080) acoustic analysis with RTSP audio stream ingestion.
- **CT113 (frigate)**: Docker Frigate NVR v0.17 with Google Coral USB Edge TPU acceleration. Object detection: person, car, cat, dog, bird, package.
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
- **Dell Host Dual HDMI Outputs**:
  - **HDMI 1 (Small Monitor in Corner)**: Chromium kiosk (`corner-kiosk.service`) loading `http://192.168.1.8:3000/#corner`. Virtual Box Layout Engine with per-widget configuration.
  - **HDMI 2 (Main TV in Room)**: Virtual Box Layout Engine. Awaiting HDMI cable connection.

## Data & Media Pipelines
1. **Camera Audio Pipeline**: Aqara RTSP streams (`rtsp://...192.168.1.32:8554/1080p` and `rtsp://...192.168.1.33:8554/1080p`) → FFmpeg audio decode → BirdNET Go (CT112) → Acoustic species detection → SQLite DB & SSE real-time stream.
2. **Camera Video & NVR Pipeline**: Aqara RTSP 1080p detect stream → Frigate (CT113) → Google Coral Edge TPU inference (person, car, dog, cat, bird, package) → MQTT (192.168.1.19:1883) & RTSP 1520p high-res recording. Snapshots retained 14 days, motion recordings 7 days, alert/detection recordings 14 days.
3. **Alert Ingestion Pipeline**: System alerts are emitted **strictly by Home Assistant (VM100 / CT109 webhooks & MQTT topics)**. No alerts are generated by client UIs.
4. **AIS Local (Marine)**: Qudinip Serial → `/dev/ttyAIS` → `ais-host-forwarder.sh` (UDP :10110) → `ais-collector` (CT105) → `live_tracks` (source_type='ais') → `track_history` (1pt/min sampler cron) → Dashboard Trails API.
5. **AIS Remote (AISHub)**: `ais-collector` (CT105) polls AISHub API every 120s → in-memory cache (NOT stored in DB) → HTTP :3105/api/aishub-nearby → Dashboard `/api/vessels/nearby` proxy → VesselLayer renders with dashed ring, 70% opacity, labeled as remote. AISHub also enriches local vessel metadata (name/type/destination). AIS receiver health: if AISHub shows ≥3 vessels within 15nm that local antenna hasn't heard, logs hardware warning.
6. **ADS-B (Aviation)**: RTL-SDR → `dump1090` (CT102) → JSON → `tracker-engine` (CT105) polls every 5s → `live_tracks` (source_type='adsb') → `track_history` → Dashboard.
7. **Weather (PWS)**: Ecowitt Device → POST `/api/ecowitt` (CT108) → `tracking_db` AND HA Webhook.
8. **Vessel Trail Pipeline**: `live_tracks` → `track-history-sampler.sh` (cron */1 on CT104, UPSERT 1pt/entity/min, 5-min lookback) → `track_history` → `/api/trails/:id?today=true` → TrailLayer.jsx (client). DB cache refreshes every 5 min, live ring buffer bridges 90s gap. Trail retention: 7 days (pruned by `db-maintenance.sh`).
9. **Dual HDMI Projection System**: React/Vite Projection Controller web application (`display-projection-app`) serving HDMI 1 (`/#corner`), HDMI 2 (`/#maintv`), and Remote Virtual Screen Builder (`/#remote`). Per-widget configuration: vessel filter (All/Aircraft/Boats), camera grid size & camera picker (up to 9 cams), weather loop selection & dwell duration, BirdNET detection count.

## Dashboard & Projection Applications
- **Hawaii Dashboard (CT108)**: Express.js proxying APIs, querying PostGIS. Handles vessel dead-reckoning, aviation, tides, and weather layers.
- **Dual Projection Controller (`display-projection-app`)**: Multi-display React web application supporting Virtual Box Layout selection (1-Up, 2-Up, 3-Up, 4-Up), per-widget configuration panels, box content assignment, live screen mirrors, and Home Assistant alert rendering.
- **CT114 Services**: `display-server` (port 3000, camera grid kiosk), `utilities` (port 3114, PDF Maker/Shrinker), `photo-chrono` (port 7777, Photo Chronologizer), `nrsc5-engine` (HD Radio).

## Auto-Recovery & Health Monitoring
- **Service Watchdog** (`/opt/service-watchdog.sh` on Proxmox host, cron */5): Monitors critical services on CT105 (tracker-engine, ais-collector), CT108 (port 3001 API), and CT114 (display-server, utilities, photo-chrono, nrsc5-engine). Auto-restarts dead services and logs to `/var/log/service-watchdog.log`. Refreshes kiosk browser on display-server recovery.
- **DB Auto-Reconnect**: `tracker-engine` and `ais-collector` catch `psycopg2.InterfaceError`/`OperationalError` in polling loops, safely close dead connections, and re-establish via `get_db_connection()` with exponential backoff.
- **DB Maintenance** (`/opt/db-maintenance.sh` on CT104, cron 0 4 daily): Prunes `live_tracks` (AIS >48h, ADS-B >1h, NULL source_type), `track_history` (>7 days), VACUUM ANALYZE.
