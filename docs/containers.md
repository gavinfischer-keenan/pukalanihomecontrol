<!-- doc: containers.md | topic: Container & VM Inventory | last-updated: 2026-07-23 -->

# Container & VM Inventory

| CTID | Hostname | IP | Cores | RAM | Disk | Pool | Role | Status |
|------|----------|-----|-------|-----|------|------|------|--------|
| VM100 | haos-18.1 | 192.168.1.19 | 2 | 4096MB | 32GB | local-lvm | Home Assistant OS (QEMU KVM) | running |
| 101 | brain | DHCP | 1 | 512MB | 16GB | bigdata | Docker utility host (mostly idle now) | running |
| 102 | airspace | 192.168.1.102 | 1 | 512MB | 2GB | local-lvm | ADS-B receiver (dump1090-fa, tar1090) | running |
| 104 | trackerDB | 192.168.1.104 | 1 | 1024MB | 200GB | bigdata | PostgreSQL 15 (tracking_db) | running |
| 105 | tracker-engine | 192.168.1.105 | 1 | 768MB | 4GB | local-lvm | Python data collectors (AIS, ADS-B, weather, tides) | running |
| 106 | sdr-engine | 192.168.1.106 | 1 | 256MB | 4GB | local-lvm | AIS-Catcher (decodes AIS from host rtl-tcp) | running |
| 107 | alerts-engine | 192.168.1.107 | 1 | 256MB | 4GB | local-lvm | Alerts microservice (port 3009) | running |
| 108 | hawaii-tracker | 192.168.1.108 | 2 | 768MB | 8GB | local-lvm | Dashboard (React+Express, nginx, PM2, port 8080) | running |
| 109 | alerts-api | 192.168.1.109 | 1 | 256MB | 4GB | local-lvm | Alerts REST API (port 3009) | running |
| 112 | birdnet | 192.168.1.112 | 2 | 2048MB | 8GB | local-lvm | BirdNET-Go (Docker, port 8080) | running |
| 113 | nvr | 192.168.1.113 | 2 | 2048MB | 32GB | bigdata | Frigate NVR (Docker, Coral TPU, port 5000) | running |
| 114 | display-hub | 192.168.1.114 | 2 | 4096MB | 16GB | local-lvm | Display server + kiosk + photo-chrono + nrsc5 | running |

*Notes:*
* CT103 was destroyed (legacy AIS bridge).
* CT111 was reclaimed (nrsc5-engine migrated to CT114).
