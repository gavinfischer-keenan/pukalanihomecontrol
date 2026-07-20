# Pukalani Home Control — Full System Architecture

> **Purpose:** Complete specification for reconstructing or porting this system to new hardware.
> An AI agent reading this alongside a hardware inventory should be able to provision containers,
> configure services, and bring the full system to operational status with minimal debugging.
>
> **Repository:** https://github.com/gavinfischer-keenan/pukalanihomecontrol
> **Location:** Pukalani, Maui, Hawaii — 21.2855°N, 157.7969°W
> **Last updated:** 2026-07-20 (generated from live system state)

---

## 1. Hardware Platform

### Proxmox Host

| Attribute | Value |
|-----------|-------|
| CPU | Intel Core Ultra 5 245T — 14 cores, 1 socket |
| RAM | 16 GB (15 GiB usable) |
| OS | Proxmox VE 8.x |
| Host IP | 192.168.1.100 |
| Gateway | 192.168.1.1 |
| Network bridge | vmbr0 (LAN: 192.168.1.0/24) |

### Storage Pools

| Pool | Type | Total | Used | Purpose |
|------|------|-------|------|---------|
| local | Directory | 68 GB | 6 GB | ISOs, CT templates, Proxmox config |
| local-lvm | LVM-thin | 148 GB | 31 GB | OS disks for most CTs/VMs |
| bigdata | LVM-thin | 927 GB | 96 GB | DB data, Docker images, recordings |

> bigdata lives on an external USB3 SSD (JMicron YOTUO, 152d:b583).

### USB Devices

All on a VIA Labs USB 2.0 hub (2109:2817), bus 1.

| Port | USB ID | Product | Role | Assigned to |
|------|--------|---------|------|-------------|
| 1-7.2 | 31b2:0022 | KTMicro LavMicro-U | Microphone (BirdNET) | CT112 via /dev/snd bind-mount |
| 1-7.4 | 10c4:ea60 | Sonoff Zigbee 3.0 Dongle Plus V2 | Zigbee coordinator | VM100 (HAOS) pinned by physical port |
| 1-1 | 0bda:2838 | RTL-SDR Blog V4 (serial 00000001) | AIS 162MHz SDR | Proxmox host — rtl-tcp-ais service |
| 1-? | 0bda:2838 | Generic RTL2838 DVB-T | ADS-B 1090MHz SDR | CT102 via /dev/bus/usb bind-mount |
| USB3 | 152d:b583 | JMicron YOTUO | External SSD | bigdata storage pool |

> CRITICAL — USB disambiguation: The Zigbee dongle and any CP210x AIS receiver share
> VID:PID 10c4:ea60. Udev rules disambiguate by hardware serial number.
> The HAOS VM is pinned to physical port 1-7.4 so Zigbee is never grabbed after a replug.
> Zigbee dongle serial: 22571d3d0d91f011ab54786236f0e4ad
> See: /etc/udev/rules.d/99-hawaii-usb.rules

---

## 2. Virtual Machines and Containers

### VM100 — haos-18.1 (Home Assistant OS)

| Setting | Value |
|---------|-------|
| Type | QEMU KVM, q35 + OVMF |
| OS | Home Assistant OS 18.1 |
| IP | 192.168.1.19 (set inside HA network config) |
| CPU | 2 cores |
| RAM | 4096 MB |
| Disk | local-lvm:vm-100-disk-0 — 32 GB SSD+discard |
| EFI | local-lvm:vm-100-disk-1 — 4 MB |
| USB passthrough | usb0: host=1-7.4 (Zigbee dongle by physical port) |
| Boot | onboot: 1 |
| Key integrations | Enphase Envoy (solar), Ecowitt GW2000, ZHA (Zigbee), ESPHome |
| Webhook URL | POST http://192.168.1.19:8123/api/webhook/5de76fbee15b641d309d042238b47326 |

---

### CT101 — brain (Docker/utility host)

| Setting | Value |
|---------|-------|
| IP | DHCP |
| OS | Debian (Docker LXC via community-scripts) |
| CPU | 2 cores |
| RAM | 2048 MB |
| Disk | bigdata:vm-101-disk-0 — 16 GB |
| Features | nesting=1 |
| GPU | /dev/dri/renderD128, /dev/dri/card1 passthrough (Intel iGPU) |
| Sound | /dev/snd bind-mount |
| Serial | /dev/serial/by-id, ttyUSB0/1, ttyACM0/1 bind-mounts |
| Role | General-purpose Docker host and internal tooling |

---

### CT102 — Airspace (ADS-B)

| Setting | Value |
|---------|-------|
| IP | 192.168.1.102 (static) |
| OS | Debian (unprivileged) |
| CPU | 1 core |
| RAM | 512 MB |
| Disk | local-lvm:vm-102-disk-0 — 2 GB |
| USB | /dev/bus/usb bind-mount for RTL-SDR ADS-B stick |
| Services | dump1090-fa, tar1090 |
| Port :80 | tar1090 web UI at http://192.168.1.102/tar1090 |
| Data endpoint | /tar1090/data/aircraft.json (polled every 5s by CT105) |

---

### CT103 — Marine-ais (legacy serial bridge, idle)

| Setting | Value |
|---------|-------|
| IP | 192.168.1.103 (static) |
| OS | Debian (unprivileged) |
| CPU | 1 core |
| RAM | 512 MB |
| Disk | local-lvm:vm-103-disk-0 — 2 GB |
| USB | /dev/ttyUSB0 bind-mount |
| Status | IDLE — AIS now handled by RTL-SDR pipeline (see section 4.1) |

---

### CT104 — trackerDB (PostgreSQL)

| Setting | Value |
|---------|-------|
| IP | 192.168.1.104 (static) |
| OS | Debian (unprivileged) |
| CPU | 1 core |
| RAM | 1024 MB |
| Disk | bigdata:vm-104-disk-0 — 200 GB |
| Engine | PostgreSQL 15 |
| Database | tracking_db |
| Port | 5432 (LAN-only) |
| App user | tracker / pukalani |

#### Database Schema

    live_tracks
      id SERIAL PK, entity_id TEXT, source_type TEXT ('ais'|'adsb'),
      latitude DOUBLE, longitude DOUBLE, altitude INT (ADS-B feet MSL),
      heading NUMERIC (COG/track degrees), speed NUMERIC (knots),
      callsign TEXT, name TEXT, vessel_type INT (AIS ITU-R M.1371),
      raw_data JSONB, recorded_at TIMESTAMPTZ DEFAULT NOW()
      INDEX: (entity_id, recorded_at DESC), (source_type, recorded_at DESC)

    vessel_info
      mmsi TEXT PK, vessel_name, imo, call_sign, flag (ISO 3166-1),
      vessel_type TEXT, gross_tonnage INT, year_built INT,
      length_m NUMERIC, beam_m NUMERIC, owner, operator, notes,
      photo_url TEXT, seen_days INT, threshold_met BOOLEAN

    aircraft_info
      icao_hex TEXT PK, registration, aircraft_type, operator,
      notes, photo_url, seen_days INT, threshold_met BOOLEAN

    pws_obs
      id SERIAL PK, obs_time TIMESTAMPTZ, temp_f, humidity, pressure_inhg,
      wind_dir INT, wind_speed_mph, wind_gust_mph, rain_in,
      solar_w_m2, uv_index, lux, raw JSONB

    buoy_obs
      id SERIAL PK, station_id TEXT, obs_time TIMESTAMPTZ,
      wave_height_m, wave_period_s, water_temp_c,
      wind_speed_kt, wind_dir INT, raw JSONB

    tide_predictions
      id SERIAL PK, station_id TEXT, prediction_time TIMESTAMPTZ,
      height_ft NUMERIC, tide_type TEXT ('H'|'L'), fetched_at TIMESTAMPTZ

    aviation_weather
      id SERIAL PK, station TEXT (PHNL/PHOG/PHKO/PHLI), obs_time TIMESTAMPTZ,
      raw_metar TEXT, temp_c, dewpoint_c, wind_dir INT, wind_speed_kt,
      visibility_sm, altimeter_inhg, sky_condition JSONB, fetched_at TIMESTAMPTZ


---

### CT105 — tracker-engine (Python collectors)

| Setting | Value |
|---------|-------|
| IP | 192.168.1.105 (static, firewall=1) |
| OS | Debian (unprivileged) |
| CPU | 1 core |
| RAM | 512 MB |
| Disk | local-lvm:vm-105-disk-0 — 4 GB |
| Listens | UDP :10110 (NMEA sentences from AIS-Catcher on CT106) |

Running services:

| Service | Source | Function |
|---------|--------|----------|
| ais-collector.service | /opt/ais-collector.py | UDP :10110 listener, decodes NMEA types 1/2/3/5/18/21/24, writes live_tracks, relays to AISHub |
| adsb-collector.service | /opt/adsb-collector.py | Polls http://192.168.1.102/tar1090/data/aircraft.json every 5s, writes live_tracks |
| avia-collector.service | /opt/ | METAR + winds aloft from aviationweather.gov every 5min -> aviation_weather |
| env-collector.service | /opt/ | NDBC buoy every 30min + NOAA tides every 8h -> DB |
| tracker-engine.service | /opt/tracker_engine.py | Enriches records, updates seen_days counters, destination prediction |
| cron | — | Prunes live_tracks older than retention window |

Environment (/opt/.env):

    DB_HOST=192.168.1.104
    DB_PORT=5432
    DB_NAME=tracking_db
    DB_USER=tracker
    DB_PASS=pukalani
    TAR1090_URL=http://192.168.1.102/tar1090/data/aircraft.json
    AIS_LISTEN_PORT=10110

---

### CT106 — sdr-engine (AIS-Catcher)

| Setting | Value |
|---------|-------|
| IP | 192.168.1.106 (static) |
| OS | Debian (unprivileged) |
| CPU | 2 cores |
| RAM | 512 MB |
| Disk | local-lvm:vm-106-disk-0 — 4 GB |

ais-catcher.service ExecStart:

    /bin/AIS-catcher
      -t 192.168.1.100 1234     # RTLTCP from Proxmox host
      -v 60                      # log stats every 60s
      -u 192.168.1.105 10110     # NMEA UDP -> CT105 tracker-engine
      -u 144.76.105.244 2828     # NMEA UDP -> AISHub aggregator
      -q -X off

---

### CT108 — dashboard (Node.js API + React/Vite UI)

| Setting | Value |
|---------|-------|
| IP | 192.168.1.108 (static) |
| OS | Debian (unprivileged) |
| RAM | 512 MB |
| Disk | local-lvm:vm-108-disk-0 — 8 GB |
| API | Express/Node.js port 3001, managed by PM2 |
| Web | nginx port 80 -> serves /opt/dashboard/client/dist/ + proxies /api/ -> :3001 |
| Code | /opt/dashboard/server/ (API), /opt/dashboard/client/ (React/Vite) |

Server environment (/opt/dashboard/server/.env):

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

All API routes (GET unless noted):

| Method | Route | Description |
|--------|-------|-------------|
| GET | /api/health | Live health: DB, AIS, ADS-B, weather, tar1090 |
| GET | /api/health-report | Latest nightly audit JSON |
| GET | /api/status | Simple ok/degraded |
| GET | /api/vessels | AIS vessels last 30min, deduped by MMSI |
| GET | /api/trails/:id | Position trail (MMSI or ICAO hex) |
| GET | /api/history/:id | Full position history |
| GET | /api/vessel-info/:mmsi | Curated vessel metadata |
| GET | /api/vessel-info/:mmsi/seen-days | Distinct observation days |
| POST | /api/vessel-info/:mmsi | Update vessel metadata |
| POST | /api/vessel-photo/:mmsi | Upload vessel photo (multipart) |
| GET | /api/vessel-predictions | Route prediction stubs |
| GET | /api/vessel-routes/:mmsi | Historical route polyline |
| GET | /api/hawaii-ports | GeoJSON of Hawaii port polygons |
| GET | /api/aircraft | Live ADS-B (tar1090 + DB enrichment merged) |
| GET | /api/aircraft-info/:icao | Curated aircraft metadata |
| GET | /api/aircraft-info/:icao/seen-days | Distinct observation days |
| POST | /api/aircraft-info/:icao | Update aircraft metadata |
| GET | /api/alerts | NWS CAP alerts (proxied from CT109:3009) |
| GET | /api/alerts/health | CT109 connectivity |
| GET | /api/buoys | Latest NDBC buoy observations |
| GET | /api/buoys/:id/history | Buoy observation history |
| GET | /api/tides | Tide predictions for configured stations |
| GET | /api/tides/:station/chart | Chart-ready tide JSON |
| GET | /api/noaa-tides/:station | Live NOAA CO-OPS passthrough |
| GET | /api/metar | METAR for PHNL, PHOG, PHKO, PHLI |
| GET | /api/winds-aloft | Formatted winds aloft |
| GET | /api/winds-aloft-raw | Raw winds aloft |
| GET | /api/airport-status | FAA ATIS status |
| POST | /api/ecowitt | Ecowitt GW2000 push receiver |
| GET | /api/ecowitt/current | Latest station reading |
| GET | /api/ecowitt/history | History for charting |
| GET | /api/birdnet | BirdNET detections (proxy -> CT112:8080) |
| GET | /api/nws/* | NWS/NOAA data suite via nws-service.js |

React client components (/opt/dashboard/client/src/components/):

Map layers:
  VesselLayer.jsx     — AIS vessels, dead-reckoning animation (great-circle, rAF)
  AircraftLayer.jsx   — ADS-B aircraft with type icons and altitude colouring
  TrailLayer.jsx      — Position trail polyline for selected entity
  BuoyLayer.jsx       — NDBC buoy markers
  MetarLayer.jsx      — METAR station circles
  EcowittLayer.jsx    — Home weather station marker
  SurfLayer.jsx       — Surf spots
  TideLayer.jsx       — Tide gauge markers
  RadarLayer.jsx      — RainViewer radar tile overlay
  HDRadarLayer.jsx    — HD Radio radar (future)
  HDTrafficLayer.jsx  — HD Radio traffic (future)
  HDGasLayer.jsx      — HD Radio gas prices (future)
  HomeBase.jsx        — Home location pin
  RangeRings.jsx      — Configurable distance rings
  ReferenceObjects.jsx — Static reference markers

Panels and UI:
  App.jsx              — Root: layer state, polling timers, map init
  LayerControl.jsx     — Layer toggle sidebar (Airspace / Integrated Vessel / Weather / Map / NWS/NOAA)
  DetailPanel.jsx      — Entity detail, seen-days badge, edit form, photo upload
  StatusBar.jsx        — Top status strip
  ATISBar.jsx          — Airport ATIS bar
  AirportStatusBar.jsx — Airport status
  ForecastPanel.jsx    — Marine/aviation forecast
  WindsAloftPanel.jsx  — Winds aloft visualisation
  SunMoonPanel.jsx     — Sun/moon rise/set
  AlertsPage.jsx       — Full-screen NWS active alerts overlay
  TideChartModal.jsx   — Tide chart popup
  HDRadioStatusPanel.jsx — HD Radio status
  AltLegend.jsx        — Altitude colour legend
  Legend.jsx           — General map legend
  MapEventTracker.jsx  — Map click/hover handler
  ErrorBoundary.jsx    — React error boundary (silent fail for map layers)

NWS/NOAA panel suite:
  NWSPanel.jsx + .css    — Full-screen overlay, tab router (Loops / Maps / Forecasts)
  NWSLoopsGrid.jsx       — Animated GIF grid from /api/nws/loops, 5min auto-refresh
  NWSForecastPanel.jsx   — Collapsible NWS text products + ENSO tracker + CPC outlook images
  NWSMap.jsx + .css      — Leaflet map with air/water sub-tabs, FADs, harbor approaches,
                           trade routes, fishing zones, ETOPO depth, SST, PacIOOS WMS
  NWSApp.jsx + .css      — Standalone NWS app entry point

Hooks and utilities:
  useDraggable.js        — Drag behaviour for floating panels

Test suites:
  dashboard/server/tests/api.test.js        — Jest/axios: all GET endpoints
  dashboard/client/src/__tests__/
    vessel.test.js                          — Vitest: classifyVessel(), VESSEL_CLASS_COLOR
    deadReckon.test.js                      — Vitest: great-circle dead-reckoning (5 cases)


---

### CT109 — alerts-engine

| Setting | Value |
|---------|-------|
| IP | 192.168.1.109 (static) |
| OS | Debian (unprivileged) |
| CPU | 1 core, RAM 512 MB |
| Disk | local-lvm:vm-109-disk-0 — 4 GB |
| Port | 3009 |
| App | /opt/alerts/ |
| Role | NWS CAP alert poller; CT108 proxies /api/alerts through it |

### CT110 — project-mgr

| Setting | Value |
|---------|-------|
| IP | 192.168.1.110 (static) |
| OS | Debian (unprivileged) |
| CPU | 1 core, RAM 512 MB |
| Disk | bigdata:vm-110-disk-0 — 50 GB |
| Role | Internal project management tooling |

### CT111 — nrsc5-engine (HD Radio, standby)

| Setting | Value |
|---------|-------|
| IP | 192.168.1.111 (static) |
| OS | Debian (unprivileged) |
| CPU | 2 cores, RAM 512 MB |
| Port | 3011 |
| Status | STANDBY — Hawaii FM has no HD Radio data services. Built for Berkeley CA |
|        | deployment. HD_RADIO_DISABLED=true in sdr-scheduler.sh |

### CT112 — birdnet (BirdNET-Go)

| Setting | Value |
|---------|-------|
| IP | DHCP |
| OS | Debian (Docker LXC, nesting=1) |
| CPU | 2 cores, RAM 2048 MB |
| Disk | bigdata:vm-112-disk-0 — 16 GB |
| Sound | /dev/snd bind-mount (KTMicro LavMicro-U, USB port 1-7.2) |
| Port | 8080 |

    docker-compose.yml:
      image: ghcr.io/tphakala/birdnet-go:nightly
      container_name: birdnet_go
      restart: unless-stopped
      ports: ["8080:8080"]
      environment: [TZ=Pacific/Honolulu]
      volumes: [./config:/config, ./data:/data]
      devices: [/dev/snd:/dev/snd]

    Config: /opt/birdnet/config/config.yaml
      latitude: 21.2855, longitude: -157.7969
      locale: en, sensitivity: 1.0
    Detections: SQLite at /opt/birdnet/data/birdnet.db
    Dashboard proxy: GET /api/birdnet -> CT112:8080/api/v2/detections

### CT113 — frigate (Camera NVR)

| Setting | Value |
|---------|-------|
| IP | 192.168.1.113 (static) |
| OS | Debian (Docker LXC, nesting=1, keyctl=1, AppArmor=unconfined) |
| CPU | 4 cores, RAM 4096 MB |
| Disk | bigdata:vm-113-disk-0 — 60 GB |
| USB | /dev/bus/usb bind-mount |
| Role | Frigate NVR — camera recording and object detection |

---

## 3. Proxmox Host Services

### Udev Rules (/etc/udev/rules.d/99-hawaii-usb.rules)

    SUBSYSTEM=="tty", ATTRS{idVendor}=="10c4", ATTRS{idProduct}=="ea60",
      ATTRS{serial}=="22571d3d0d91f011ab54786236f0e4ad",
      SYMLINK+="ttyZigbee", MODE="0666"

    SUBSYSTEM=="tty", ATTRS{idVendor}=="10c4", ATTRS{idProduct}=="ea60",
      ATTRS{serial}!="22571d3d0d91f011ab54786236f0e4ad",
      SYMLINK+="ttyAIS", MODE="0666"

    Apply: udevadm control --reload-rules && udevadm trigger

### rtl-tcp-ais.service

    ExecStart=/usr/bin/rtl_tcp -d 00000001 -a 0.0.0.0 -p 1234 -s 2400000 -g 0
    # -d 00000001 targets Blog V4 by serial (never grabs ADS-B stick)
    # -s 2400000 = 2.4MHz for dual-channel AIS
    Restart=no  SuccessExitStatus=1

### sdr-scheduler.service

    ExecStart=/opt/sdr-scheduler/sdr-scheduler.sh
    Restart=always  RestartSec=30
    
    On start: 1) modprobe -r dvb_usb_rtl28xxu dvb_usb_v2 rtl2832_sdr rtl2832
               2) start rtl-tcp-ais
               3) restart ais-catcher on CT106

    Currently AIS-continuous mode (HD_RADIO_DISABLED=true).

### nightly-health-check.sh

    Location: /usr/local/bin/nightly-health-check.sh
    Cron: 0 12 * * * root ... (02:00 HST)
    JSON: /tmp/health-report.json -> GET /api/health-report
    Log:  /var/log/health-check.log

    Checks: all 12 CTs + HAOS VM + host services + AIS USB +
            data freshness (AIS/ADS-B/weather) + BirdNET + dashboard API + disk
    Auto-repairs: pct start, systemctl restart, docker compose up -d

---

## 4. Data Flows

### 4.1 AIS — Marine Vessel Tracking

    RTL-SDR Blog V4 (serial 00000001, 162.000 MHz, 2.4MHz SR)
      -> rtl-tcp-ais.service [host, TCP :1234]
      -> AIS-Catcher [CT106] — IQ to NMEA
      -> UDP :10110 -> ais-collector.service [CT105]
                    -> UDP :2828 -> AISHub (144.76.105.244)
      -> live_tracks [CT104] source_type='ais'
      -> tracker_engine enriches vessel_info + seen_days
      -> GET /api/vessels [CT108] — SQL last 30min, deduped by MMSI
      -> VesselLayer.jsx [browser] — poll every 15s

    Dead-reckoning (great-circle, requestAnimationFrame):
      EARTH_R_NM = 3440.065
      distNm = (sogKt * elapsedSec) / 3600
      angDist = distNm / EARTH_R_NM
      lat1 = asin(sin(lat0)*cos(d) + cos(lat0)*sin(d)*cos(bearing))
      lon1 = lon0 + atan2(sin(bearing)*sin(d)*cos(lat0), cos(d)-sin(lat0)*sin(lat1))
      Hard cap: maxAge = 600s

    Vessel classification (AIS type int or MMSI prefix):
      military(35)  fishing(30,32)  tug(21,22,31,52)  sailing(36,37)
      hsc(40-49)    pilot(50)       sar(51, MMSI 303x) passenger(60-69)
      cargo(70-79)  tanker(80-89)   aton(MMSI 99x)

### 4.2 ADS-B

    RTL-SDR ADS-B (1090 MHz) -> /dev/bus/usb -> CT102
    dump1090-fa -> tar1090 -> aircraft.json (http://192.168.1.102/tar1090/data/aircraft.json)
    adsb-collector [CT105] polls every 5s -> live_tracks source_type='adsb'
    GET /api/aircraft [CT108] — merges tar1090 live + DB enrichment
    AircraftLayer.jsx — poll every 5s

### 4.3 Weather — Ecowitt GW2000

    Station pushes every ~60s -> POST /api/ecowitt [CT108]
    -> pws_obs [CT104]
    GET /api/ecowitt/current -> EcowittLayer.jsx
    GET /api/ecowitt/history -> charts

### 4.4 Tides — NOAA CO-OPS (cached 8h)

    env-collector [CT105] every 8h -> tidesandcurrents.noaa.gov
    -> tide_predictions [CT104] station 1617760 (Honolulu Harbor)
    GET /api/tides -> TideLayer.jsx
    GET /api/tides/:s/chart -> TideChartModal.jsx
    GET /api/noaa-tides/:s -> live NOAA passthrough (fallback)

### 4.5 Buoys — NDBC (cached 30min)

    env-collector [CT105] every 30min -> ndbc.noaa.gov
    -> buoy_obs [CT104]
    GET /api/buoys -> BuoyLayer.jsx
    GET /api/buoys/:id/history -> detail panel charts

### 4.6 Aviation Weather (cached 5min)

    avia-collector [CT105] every 5min -> aviationweather.gov
    -> aviation_weather [CT104] stations PHNL, PHOG, PHKO, PHLI
    GET /api/metar -> MetarLayer.jsx
    GET /api/winds-aloft -> WindsAloftPanel.jsx
    GET /api/airport-status -> ATISBar.jsx

### 4.7 NWS Alerts

    api.weather.gov/alerts/active?area=HI
    -> alerts-engine [CT109 :3009]
    GET /api/alerts [CT108 proxies CT109]
    -> AlertsPage.jsx (full-screen overlay with polygon map)

### 4.8 NWS/NOAA Products (nws-service.js, CT108)

    weather.gov/hfo + NOAA image servers + CPC -> disk cache
    /api/nws/loops -> NWSLoopsGrid.jsx (animated GIFs, 5min refresh)
    /api/nws/text/SRF|AFD|RWR|CWF|HSF -> NWSForecastPanel.jsx
    /api/nws/enso -> ENSO phase + history
    /api/nws/obs|alerts|fads|harbor-approaches|trade-routes|fishing-areas -> NWSMap.jsx

    External WMS/tile overlays:
      ETOPO depth:    gis.ngdc.noaa.gov arcgis tiles
      SST:            MODIS/CoastWatch ERDDAP PNG (bounds 17-23N, 165-152W)
      Wave height:    pae-paha.pacioos.hawaii.edu/erddap/wms/ww3_hi

### 4.9 BirdNET

    KTMicro USB mic (port 1-7.2) -> /dev/snd -> CT112 Docker
    -> birdnet_go real-time classification -> SQLite detections
    GET /api/birdnet [CT108] -> CT112:8080/api/v2/detections -> dashboard panel

### 4.10 Solar / Enphase

    Enphase Envoy (serial 121122779332) -> HA enphase_envoy integration -> VM100
    Entities: solar_power (W), lifetime_energy (kWh), per-panel data
    Currently HA Energy Dashboard only (native HA).
    Future: GET /api/solar -> Enphase proxy; efficiency = enphase_W / pws_obs.solar_w_m2

---

## 5. Network Topology

    Internet (outbound only)
      |
    Router (192.168.1.1)
      |
    LAN 192.168.1.0/24 -- vmbr0 (Proxmox bridge)
      |
      +-- 192.168.1.100  Proxmox host
      +-- 192.168.1.19   VM100  Home Assistant OS 18.1
      +-- DHCP           CT101  brain (Docker host)
      +-- 192.168.1.102  CT102  Airspace (ADS-B / tar1090 :80)
      +-- 192.168.1.103  CT103  Marine-ais (legacy, idle)
      +-- 192.168.1.104  CT104  trackerDB (PostgreSQL :5432)
      +-- 192.168.1.105  CT105  tracker-engine (UDP :10110 in)
      +-- 192.168.1.106  CT106  sdr-engine (AIS-Catcher)
      +-- 192.168.1.108  CT108  dashboard (API :3001, nginx :80)
      +-- 192.168.1.109  CT109  alerts-engine (:3009)
      +-- 192.168.1.110  CT110  project-mgr
      +-- 192.168.1.111  CT111  nrsc5-engine (:3011, standby)
      +-- DHCP           CT112  birdnet (:8080)
      +-- 192.168.1.113  CT113  frigate

    Outbound endpoints:
      api.weather.gov                NWS alerts, observations
      tidesandcurrents.noaa.gov      Tide predictions
      www.ndbc.noaa.gov              Buoy data
      aviationweather.gov            METAR, TAF, winds aloft
      144.76.105.244:2828            AISHub UDP ingest
      weather.gov/hfo                NWS Hawaii text products
      cpc.ncep.noaa.gov              CPC seasonal outlook
      pae-paha.pacioos.hawaii.edu    PacIOOS wave/SST WMS
      gis.ngdc.noaa.gov              ETOPO depth tiles
      ghcr.io                        BirdNET-Go Docker image
      github.com/gavinfischer-keenan Source code repository

---

## 6. Health Monitoring

### Real-time: GET http://192.168.1.108:3001/api/health

    Response: { status: "ok|degraded", timestamp: "...", checks: {
      database: {ok:true},
      ais:      {ok:true, vessels_10min:4},
      adsb:     {ok:true, aircraft_5min:89},
      weather:  {ok:true},
      tar1090:  {ok:true, aircraft:6}
    }}
    HTTP 200=ok, HTTP 207=degraded

### Nightly Audit

    Script:  /usr/local/bin/nightly-health-check.sh
    Cron:    0 12 * * * root ... (02:00 HST)
    JSON:    /tmp/health-report.json -> GET /api/health-report
    Log:     /var/log/health-check.log

---

## 7. Git Repository Structure

    https://github.com/gavinfischer-keenan/pukalanihomecontrol  (branch: main)

    pukalanihomecontrol/
    ├── dashboard/
    │   ├── server/
    │   │   ├── server.js           Express API (all routes documented in s2 CT108)
    │   │   ├── nws-service.js      NWS/NOAA fetcher + disk cache module
    │   │   ├── package.json
    │   │   └── tests/api.test.js   Jest integration tests
    │   └── client/
    │       ├── src/
    │       │   ├── App.jsx         Root component
    │       │   ├── components/     45 React components (all listed in s2 CT108)
    │       │   └── __tests__/      Vitest unit tests (vessel + deadReckon)
    │       ├── vite.config.js      Vite + Vitest config
    │       ├── index.html
    │       └── package.json
    ├── tracker-engine/
    │   ├── tracker_engine.py
    │   ├── ais-collector.py
    │   └── adsb-collector.py
    ├── scripts/
    │   ├── nightly-health-check.sh
    │   ├── sdr-scheduler.sh
    │   ├── systemd/
    │   │   ├── rtl-tcp-ais.service
    │   │   ├── sdr-scheduler.service
    │   │   └── ais-catcher.service
    │   └── udev/99-hawaii-usb.rules
    ├── archive/          Old flat scripts (reference only)
    ├── .gitignore
    └── README.md

---

## 8. Reconstruction Playbook

For an AI agent rebuilding on new hardware. Follow in order, verify each step.

### Step 0 — Assess Hardware
    lsusb                           # identify SDR dongles, Zigbee, mic
    udevadm info /dev/ttyUSB0       # get Zigbee serial (ATTRS{serial})
    udevadm info /dev/ttyUSB0 | grep DEVPATH  # get physical USB port
    rtl_test -t                     # verify RTL-SDR Blog V4 visible

    Two RTL-SDR devices: Blog V4 (serial 00000001) = AIS 162 MHz;
    generic RTL2838 = ADS-B 1090 MHz.

### Step 1 — Storage
    pvcreate /dev/sdX
    vgcreate bigdata /dev/sdX
    lvcreate -l 100%FREE --thinpool bigdata-pool bigdata
    # Register pool in Proxmox storage.cfg

### Step 2 — Create Containers
    For each CT (104, 105, 106, 102, 108, 109, 112, 113):
    pct create <VMID> local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
      --hostname <name> --memory <MB> --cores <n> \
      --net0 name=eth0,bridge=vmbr0,ip=192.168.1.xxx/24,gw=192.168.1.1 \
      --rootfs <pool>:<GB> --unprivileged 1 --onboot 1
    Create 104 first (DB needed before collectors)

### Step 3 — HAOS VM
    bash -c "$(curl -fsSL https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/vm/haos-vm.sh)"
    qm set 100 --usb0 host=<physical-zigbee-port>   # e.g. 1-7.4
    qm start 100   # wait 3min then access http://192.168.1.19:8123
    Install integrations: Enphase Envoy, Ecowitt, ZHA, ESPHome

### Step 4 — PostgreSQL (CT104)
    apt-get install -y postgresql
    systemctl enable --now postgresql
    su - postgres -c "createdb tracking_db"
    su - postgres -c "createuser tracker"
    # Set password: ALTER USER tracker PASSWORD 'pukalani';
    # Grant: GRANT ALL PRIVILEGES ON DATABASE tracking_db TO tracker;
    # Apply schema from repo (all table DDL in section 2 CT104 above)

### Step 5 — ADS-B (CT102)
    apt-get install -y dump1090-fa tar1090
    systemctl enable --now dump1090-fa tar1090
    # Verify: curl http://192.168.1.102/tar1090/data/aircraft.json | head

### Step 6 — SDR Pipeline (host + CT106)
    # Host:
    apt-get install -y rtl-sdr
    cp scripts/udev/99-hawaii-usb.rules /etc/udev/rules.d/
    udevadm control --reload-rules && udevadm trigger
    cp scripts/systemd/rtl-tcp-ais.service /etc/systemd/system/
    mkdir -p /opt/sdr-scheduler
    cp scripts/sdr-scheduler.sh /opt/sdr-scheduler/
    chmod +x /opt/sdr-scheduler/sdr-scheduler.sh
    cp scripts/systemd/sdr-scheduler.service /etc/systemd/system/
    systemctl daemon-reload && systemctl enable --now sdr-scheduler

    # CT106 (install AIS-Catcher from github.com/jvde-github/AIS-catcher):
    cp scripts/systemd/ais-catcher.service /etc/systemd/system/
    # Edit: -t <host-ip> 1234 -u <ct105-ip> 10110
    systemctl enable --now ais-catcher
    # Verify: journalctl -u ais-catcher -f (shows NMEA vessel messages)

### Step 7 — Tracker Engine (CT105)
    apt-get install -y python3 python3-pip
    pip3 install asyncpg aiohttp requests
    # Deploy Python files to /opt/, service files to /etc/systemd/system/
    # Create /opt/.env with DB credentials
    systemctl daemon-reload
    systemctl enable --now ais-collector adsb-collector avia-collector env-collector tracker-engine
    # Verify: rows increasing in live_tracks

### Step 8 — Dashboard (CT108)
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash
    apt-get install -y nodejs nginx
    npm install -g pm2
    # Deploy server/ and client/ from repo to /opt/dashboard/
    # Write /opt/dashboard/server/.env (see section 2 CT108 above)
    cd /opt/dashboard/client && npm install && npm run build
    cd /opt/dashboard/server && npm install
    pm2 start server.js --name server && pm2 save && pm2 startup

    nginx config (/etc/nginx/sites-enabled/dashboard):
      server {
        listen 80;
        root /opt/dashboard/client/dist;
        index index.html;
        location /api/ { proxy_pass http://localhost:3001; }
        location / { try_files $uri $uri/ /index.html; }
      }

    nginx -t && systemctl restart nginx
    # Verify: http://192.168.1.108 loads map dashboard

### Step 9 — BirdNET (CT112)
    apt-get install -y docker.io && systemctl enable --now docker
    mkdir -p /opt/birdnet/config /opt/birdnet/data
    # Copy docker-compose.yml and config.yaml to /opt/birdnet/
    # config.yaml: latitude 21.2855, longitude -157.7969, locale en
    cd /opt/birdnet && docker compose up -d
    # Verify: docker ps shows birdnet_go; http://<ct112-ip>:8080 loads

### Step 10 — Health Monitoring
    cp scripts/nightly-health-check.sh /usr/local/bin/
    chmod +x /usr/local/bin/nightly-health-check.sh
    echo '0 12 * * * root /usr/local/bin/nightly-health-check.sh' > /etc/cron.d/hawaii-health-check
    # Edit script: adjust CT IDs and IPs to match new environment
    # Test: bash /usr/local/bin/nightly-health-check.sh
    # Verify: GET /api/health-report returns JSON

---

## 9. Known Issues and Quirks

| Symptom | Root Cause | Fix |
|---------|-----------|-----|
| Zigbee drops after USB replug | CP210x VID:PID collision | udev serial rule + HAOS pinned to physical port 1-7.4 |
| RTL-SDR missing after replug | DVB kernel driver reattaches | modprobe -r dvb_usb_rtl28xxu; restart rtl-tcp-ais |
| AIS-Catcher timeout loop | rtl-tcp-ais crashed | systemctl reset-failed rtl-tcp-ais; start; restart ais-catcher on CT106 |
| /api/health ais ok=false | No vessels in 10min | Normal at night. Check: ais-catcher logs, USB present? |
| Weather ok=false | Ecowitt station gap | Wait 2min; power-cycle station if persistent |
| BirdNET zero detections | Normal 10pm-5am | WARN in nightly log — expected |
| Enphase setup_in_progress | Auth timeout | HA -> Settings -> Integrations -> Enphase -> Re-authenticate |
| Build fails | Missing import or CSS | Check npm run build output; most common: forgotten CSS import |

---

## 10. Credentials and Secrets

ROTATE BEFORE SHARING THIS DOCUMENT PUBLICLY.

| Secret | Value | Where used |
|--------|-------|-----------|
| DB password | pukalani | CT105 collectors + CT108 .env |
| DB user | tracker | All CT DB connections |
| HA webhook token | 5de76fbee15b641d309d042238b47326 | Ecowitt -> CT108 /api/ecowitt |
| GitHub PAT | stored in ~/.git-credentials on host | Git push to repo |

---

*End of architecture document.*
*Generated: 2026-07-20 from live Proxmox at 192.168.1.100*
*Location: Pukalani, Maui, Hawaii — 21.2855N, 157.7969W*
