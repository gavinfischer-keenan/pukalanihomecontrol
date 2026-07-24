# Pukalani Home Control

**Location**: Pukalani, Maui, Hawaii — 21.2855°N, 157.7969°W

A comprehensive home monitoring and environmental tracking system built on Proxmox VE, integrating AIS vessel tracking, ADS-B aircraft surveillance, weather monitoring, camera/NVR, bird identification, and display projection.

## Architecture

| Container | Role | Port |
|-----------|------|------|
| VM100 | Home Assistant OS | :8123 |
| CT102 | ADS-B Receiver (dump1090-fa) | :80 |
| CT104 | PostgreSQL 17 (tracking_db) | :5432 |
| CT105 | Python Data Collectors (AIS, ADS-B, Weather, Satellite) | — |
| CT106 | AIS-Catcher (SDR decoder) | — |
| CT108 | Dashboard (React+Express, nginx) | :8080 |
| CT109 | Alerts Engine | :3009 |
| CT110 | Project Manager | :3001 |
| CT112 | BirdNET-Go (Docker) | :8080 |
| CT113 | Frigate NVR (Docker, Coral TPU) | :5000 |
| CT114 | Display Server + Utilities + Photo-Chrono | :3000, :3114, :7777 |

## Repository Structure

```
docs/              — Architecture documentation (14 modular files)
dashboard/         — CT108: React+Express maritime/aviation dashboard
tracker-engine/    — CT105: Python AIS/ADS-B/weather collectors
alerts-engine/     — CT109: Environmental alerts aggregator
display-server/    — CT114: Display projection + kiosk WebSocket server
photo-chrono/      — CT114: Photo chronologizer (FastAPI + React)
utilities/         — CT114: PDF tools + Apple Health converter
nrsc5-engine/      — CT114: HD Radio data engine (future)
ecowitt-forwarder/ — CT108: Ecowitt weather station forwarder (archived)
envoy-pusher/      — CT108: Enphase solar → Home Assistant bridge
corner-kiosk/      — Host: Chromium kiosk launcher
sdr-scheduler/     — Host: SDR device scheduling
db-maintenance/    — CT104: Daily database cleanup cron
```

## Quick Start

See [docs/reconstruction.md](docs/reconstruction.md) for full rebuild instructions.

## Documentation

See [docs/README.md](docs/README.md) for the complete documentation index.

## License

Private — © 2024-2026 Gavin Fischer-Keenan
