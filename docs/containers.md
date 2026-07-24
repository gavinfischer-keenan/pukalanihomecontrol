<!-- doc: containers.md | topic: Container & VM Inventory | last-updated: 2026-07-24 -->

# Container & VM Inventory

| CTID / VMID | Hostname | IP | Cores | RAM | Disk | Storage Pool | Role / Description | Status |
|-------------|----------|----|-------|-----|------|--------------|--------------------|--------|
| VM100 | haos-18.1 | 192.168.1.19 | 2 | 4096MB | 32GB | local-lvm | Home Assistant OS (QEMU KVM) | Active |
| CT101 | brain | 192.168.1.101 | 2 | 2048MB | 16GB | local-lvm | AI Agent / Brain Host | Active |
| CT102 | airspace | 192.168.1.102 | 1 | 512MB | 2GB | local-lvm | Airspace ADS-B Receiver (dump1090-fa, tar1090) | Active |
| CT104 | trackerDB | 192.168.1.104 | 1 | 1024MB | 200GB | bigdata | PostgreSQL 17 tracking_db | Active |
| CT105 | tracker-engine | 192.168.1.105 | 1 | 768MB | 4GB | local-lvm | AIS collector, Python collectors, AISHub cache (:3105) | Active |
| CT106 | sdr-engine | 192.168.1.106 | 1 | 256MB | 4GB | local-lvm | SDR Engine / AIS-Catcher (decodes AIS from host rtl-tcp) | Active |
| CT108 | hawaii-tracker | 192.168.1.108 | 2 | 768MB | 8GB | local-lvm | Dashboard (React+Express, Nginx :8080, PM2 :3001) | Active |
| CT109 | alerts-api | 192.168.1.109 | 1 | 256MB | 4GB | local-lvm | Alerts Engine / REST API (PM2 :3009) | Active |
| CT110 | project-mgr | 192.168.1.110 | 1 | 512MB | 4GB | local-lvm | Project Manager hawaii-pm app (PM2 :3001) | Active |
| CT112 | birdnet | 192.168.1.112 | 2 | 2048MB | 8GB | local-lvm | BirdNET-Go Audio Classifier (Docker :8080) | Active |
| CT113 | nvr | 192.168.1.113 | 2 | 2048MB | 32GB | bigdata | Frigate NVR (Docker, Coral TPU :5000) | Active |
| CT114 | utilities | 192.168.1.114 | 2 | 4096MB | 16GB | local-lvm | Photo-Chrono / Utilities (display-server, photo-chrono :7777, nrsc5 :3011) | Active |

## Destroyed Containers
- **CT103**: Legacy AIS bridge (Destroyed)
- **CT107**: Alerts engine legacy (Destroyed — consolidated into CT109)
- **CT111**: nrsc5-engine legacy (Destroyed — migrated to CT114)

## Startup Order & Dependencies

All containers have `onboot: 1` configured with ordered startup sequence:

| Order | VMID / CTID | Name | Rationale / Dependency |
|-------|-------------|------|------------------------|
| 1 | 104 | trackerDB | Database must start first |
| 2 | 102 | airspace | ADS-B data feed source |
| 2 | 106 | sdr-engine | AIS data feed source |
| 3 | 105 | tracker-engine | Ingests data from CT102/106 into DB CT104 |
| 3 | 109 | alerts-api | Evaluates alerts against DB CT104 |
| 4 | 108 | hawaii-tracker | Dashboard requires APIs and DB operational |
| 5 | 112 | birdnet | Independent heavy media container |
| 5 | 113 | nvr | Independent heavy NVR container |
| 6 | 101 | brain | AI Agent / Brain host |
| 6 | 114 | utilities | Display server, kiosk, photo-chrono, utilities |
| 6 | 110 | project-mgr | Non-critical project manager UI |
