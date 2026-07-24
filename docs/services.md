<!-- doc: services.md | topic: Service Map | last-updated: 2026-07-23 -->

# Service Map

## Host & VM
* **Host**: tl-tcp-ais.service (:1234 rtl_tcp for AIS SDR), sdr-scheduler.service
* **VM100**: Home Assistant (:8123) with Enphase Envoy, Ecowitt GW2000, ZHA, ESPHome.

## Data & Engine Containers
* **CT102 (airspace)**: dump1090-fa (ADS-B decoder), tar1090 (web :80, data at /tar1090/data/aircraft.json)
* **CT104 (trackerDB)**: PostgreSQL 17 (:5432) -> tracking_db
* **CT105 (tracker-engine)**: ais-collector (UDP :10110), adsb-collector, avia-collector, env-collector, tracker-engine, satellite_collector.py via cron (GOES-18 + NEXRAD every 10 min)
* **CT106 (sdr-engine)**: AIS-Catcher (connects host:1234, UDP to CT105:10110)
* **CT109 (alerts-api)**: Alerts REST API (:3009)

## UI & Application Containers
* **CT108 (hawaii-tracker)**: envoy-pusher, PM2 (hawaii-api :3001, hawaii-client), Nginx (:8080 serves React app + proxies API)
* **CT110 (project-mgr)**: hawaii-pm (Vite+Node.js, PM2, :3001)
* **CT112 (birdnet)**: BirdNET-Go Docker (:8080). Audio: lav mic + Cam1 + Cam2
* **CT113 (nvr)**: Frigate NVR Docker (:5000). Cameras: Cam1, Cam2. Uses Coral TPU.
* **CT114 (utilities)**: display-server (Node.js :3000), corner-kiosk (Chromium), photo-chrono (:7777), nrsc5-engine (:3011), PDF tools (:3114)
