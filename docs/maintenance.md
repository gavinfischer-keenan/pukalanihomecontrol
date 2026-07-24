<!-- doc: maintenance.md | topic: Maintenance, Monitoring & Auto-Healing | last-updated: 2026-07-24 -->

# Maintenance, Monitoring & Auto-Healing Architecture

## AIS Pipeline Architecture

```
SDR Blog V4 USB Dongle
  → rtl_tcp (host, port 1234, serial 00000001)
    → AIS-catcher (CT106, systemd service)
      → UDP 192.168.1.105:10110
        → ais-collector.py (CT105, systemd service)
          → PostgreSQL live_tracks (CT104)
          → AISHub TX (UDP to data.aishub.net:2828)
          → AISHub RX (HTTP poll every 120s → memory cache)
            → HTTP :3105 /api/aishub-nearby → dashboard /api/vessels/nearby
            → Enriches entities table for locally-seen vessels
            → AIS receiver health cross-check (15nm radius)
```
*(For complete detailed breakdown, see [ais-pipeline.md](file:///opt/hawaii-tracker/docs/ais-pipeline.md)).*

## Auto-Heal Capabilities Inventory

The Pukalani Home Control system includes comprehensive automated recovery mechanisms spanning kernel hardware watchdogs, network interfaces, container boot ordering, supervisor process managers, database maintenance, and data stream health monitors.

### 1. SDR Watchdog (`sdr-scheduler.sh`)
- **Location / Schedule**: Host script executed every 5 minutes (`*/5 * * * *`).
- **Monitors**: AIS (`rtl-tcp-ais.service`) and ADS-B data streams.
- **Auto-Fix**: If message flow drops to 0 or `rtl_tcp` loses USB communication, triggers USB bus reset to dongle `00000001` and restarts `rtl-tcp-ais.service` and CT106 `AIS-catcher`.

### 2. Unified Health Check (`health-check.sh`)
- **Location / Schedule**: `/opt/hawaii-tracker/scripts/health-check.sh` on host running every 5 minutes.
- **Log / Failure Tracking**: `/var/log/health-check.log` (stores consecutive failure counters in `/var/run/health-failures/`).
- **Auto-Fix Table (17+ System Checks)**:

| Check | Target / Method | Auto-Fix Action |
|-------|-----------------|-----------------|
| LXC Containers | `pct status <ctid>` | `pct start <ctid>` |
| HAOS VM | `qm status 100` | `qm start 100` |
| Dashboard API | HTTP GET `:3001/api/health` | `pm2 restart hawaii-api` (CT108) |
| Dashboard Client | HTTP GET `:8080/` | `pm2 restart hawaii-client` (CT108) |
| Alerts API | HTTP GET `:3009/health` | `pm2 restart all` (CT109) |
| Display Server | HTTP GET `:3000/` | `systemctl restart display-server` (CT114) |
| Frigate NVR | HTTP GET `:5000/` | `docker restart frigate` (CT113) |
| tar1090 (ADS-B) | HTTP GET `CT102:80/` | `systemctl restart dump1090-fa` (CT102) |
| Home Assistant | HTTP GET `:8123/` | Alert log escalation (no direct auto-fix) |
| PostgreSQL | `pg_isready -h 192.168.1.104` | `systemctl restart postgresql@17-main` (CT104) |
| AIS Data Freshness | SQL: `max(recorded_at) < 5 min` | `systemctl restart ais-collector` (CT105) |
| ADS-B Data Freshness | SQL: `max(recorded_at) < 2 min` | `systemctl restart adsb-collector` (CT105) |
| Host Disk Space | `df -h /` (< 85%) | Alert log escalation |
| USB SSD | `lsusb \| grep JMicron` | Alert log escalation |
| SDR Dongles | `lsusb \| grep RTL` | Alert log escalation |
| NIC Health | `dmesg \| grep "Hardware Unit Hang"` | Reset host NIC interface (`nic0`) |
| AIS Receiver Health | Check `/tmp/ais-receiver-health` | Restart `rtl-tcp-ais` + CT106 `AIS-catcher` |

*Note: After 3 consecutive check failures, issues escalate to critical log status.*

### 3. Automated Database Maintenance (`db-maintenance.sh`)
- **Location**: Container CT104 (`trackerDB`).
- **Schedule**: Daily at 4:00 AM HST (`0 4 * * *` cron).
- **Actions**:
  - Purges orphaned records (`NULL source_type`) from `live_tracks`.
  - Deletes historical AIS telemetry older than 48 hours.
  - Deletes historical ADS-B flight records older than 1 hour.
  - Runs `VACUUM ANALYZE` on `live_tracks` to maintain query performance and reclaim space.

### 4. Container Startup Order & Dependency Recovery
All LXC containers and QEMU VMs have `onboot: 1` enabled with explicit startup ordering to guarantee dependency availability:

| Order | ID | Container / VM | Rationale / Dependencies |
|-------|----|----------------|--------------------------|
| 1 | CT104 | trackerDB | PostgreSQL 17 database must start first |
| 2 | CT102 | Airspace | ADS-B data feed source |
| 2 | CT106 | sdr-engine | AIS decoder feed source |
| 3 | CT105 | tracker-engine | Ingests data from CT102/106 into DB CT104 |
| 3 | CT109 | alerts-api | Evaluates alert rules against DB CT104 |
| 4 | CT108 | hawaii-tracker | Dashboard web application (requires APIs and DB) |
| 5 | CT112 | birdnet | Independent audio classification container |
| 5 | CT113 | frigate | Independent NVR container (Coral TPU) |
| 6 | CT101 | brain | Agent / brain host container |
| 6 | CT114 | utilities | Display server, kiosk, photo-chrono, PDF tools |
| 6 | CT110 | project-mgr | Project manager Node.js application |

### 5. Hardware Watchdog (Kernel-Level)
- **Configuration**: `/etc/systemd/system.conf` on Proxmox host.
- **Parameters**:
  - `RuntimeWatchdogSec=30`: Triggers hardware reboot if Linux kernel hangs for >30 seconds.
  - `RebootWatchdogSec=10min`: Enforces timeout limit during system reboots.

### 6. NIC Stability & Auto-Reset
- **Hardware**: Intel I225 2.5GbE NIC on NUC host.
- **Mitigation**: TCP Segmentation Offload (TSO) and Generic Segmentation Offload (GSO) disabled to prevent hardware unit hangs under load:
  ```bash
  ethtool -K nic0 tso off gso off
  ```
- **Persistence**: Configured as `post-up` script in `/etc/network/interfaces`.
- **Auto-Reset**: `health-check.sh` monitors `dmesg` for `"Hardware Unit Hang"` and resets `nic0` if triggered.

### 7. AIS Receiver Health Cross-Check
- **Mechanism**: `ais-collector.py` in CT105 cross-references local AIS receiver output against AISHub API feed (15nm radius).
- **Condition**: If AISHub detects 3+ vessels within 15nm of Pukalani, but local receiver records 0 packets in 5 minutes, writes `/tmp/ais-receiver-health`.
- **Auto-Fix**: `health-check.sh` reads flag and executes full restart of host `rtl-tcp-ais` service and CT106 `AIS-catcher`.

### 8. PM2 Process Recovery
- **Containers**: CT108 (`hawaii-tracker`), CT109 (`alerts-api`), CT110 (`project-mgr`).
- **Mechanism**: Systemd integration (`pm2-root.service`) with saved state dumps (`pm2 save`).
- **Auto-Recovery**: Automatically resurrects Node.js / Express / Vite processes (`hawaii-api`, `hawaii-client`, `alerts-api`, `hawaii-pm`) on container boot and restarts processes on failure/crash.

---

## Storage & Pruning Maintenance

### Frigate Storage Pruner (CT113)
- **Script**: `/opt/frigate-prune.sh` (Cron `0 3 * * *` daily at 3:00 AM HST).
- **Log**: `/var/log/frigate-prune.log`.
- **Retention**: Recordings >1 day, clips >14 days, audio >1 day.

### BirdNet Audio Clip Pruner (CT112)
- **Script**: `/opt/birdnet-prune.sh` (Cron `30 3 * * *` daily at 3:30 AM HST).
- **Log**: `/var/log/birdnet-prune.log`.
- **Retention**: Deletes `.wav`, `.mp3`, `.ogg` audio clips older than 14 days.

### Host Journald Limits
- **Max size**: 500MB
- **Max retention**: 7 days
- **Config**: `/etc/systemd/journald.conf`
