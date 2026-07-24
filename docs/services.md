<!-- doc: services.md | topic: Service Map | last-updated: 2026-07-23 -->

# Service Map

## Host & VM
* **Host**: `rtl-tcp-ais.service` (:1234 rtl_tcp for AIS SDR), `sdr-scheduler.service`
* **VM100**: Home Assistant (:8123) with Enphase Envoy, Ecowitt GW2000, ZHA, ESPHome.

## Data & Engine Containers
* **CT102 (airspace)**: dump1090-fa (ADS-B decoder), tar1090 (web :80, data at `/tar1090/data/aircraft.json`)
* **CT104 (trackerDB)**: PostgreSQL 15 (:5432) -> `tracking_db`
* **CT105 (tracker-engine)**: ais-collector (UDP :10110), adsb-collector, avia-collector, env-collector, tracker-engine
* **CT106 (sdr-engine)**: AIS-Catcher (connects host:1234, UDP to CT105:10110)
* **CT107 (alerts-engine)**: Alerts engine (:3009)
* **CT109 (alerts-api)**: Alerts REST API (:3009)

## UI & Application Containers
* **CT108 (hawaii-tracker)**: Express API (:3001 via PM2), Nginx (:8080 serves React app + proxies API)
* **CT112 (birdnet)**: BirdNET-Go Docker (:8080). Audio: lav mic + Cam1 + Cam2
* **CT113 (nvr)**: Frigate NVR Docker (:5000). Cameras: Cam1, Cam2. Uses Coral TPU.
* **CT114 (display-hub)**: display-server (Node.js :3000), corner-kiosk (Chromium), photo-chrono, nrsc5-engine (:3011)
