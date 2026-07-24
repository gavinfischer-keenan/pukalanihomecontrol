# Maintenance & Monitoring

## Automated Health Monitoring

### Unified Health Check (every 5 minutes)
- **Script**: `/opt/hawaii-tracker/scripts/health-check.sh`
- **Cron**: `*/5 * * * * /opt/hawaii-tracker/scripts/health-check.sh`
- **Log**: `/var/log/health-check.log`
- **Failure tracking**: `/var/run/health-failures/` (consecutive failure counts)

**Checks performed:**

| Check | Method | Auto-Fix |
|-------|--------|----------|
| Container running | `pct status` | `pct start` |
| VM100 running | `qm status` | `qm start` |
| Dashboard API | HTTP GET :3001/api/health | `pm2 restart hawaii-api` |
| Dashboard Client | HTTP GET :8080/ | `pm2 restart hawaii-client` |
| Alerts API | HTTP GET :3009/health | `pm2 restart all` on CT109 |
| Display Server | HTTP GET :3000/ | `systemctl restart display-server` |
| Frigate NVR | HTTP GET :5000/ | `docker restart frigate` |
| tar1090 (ADS-B) | HTTP GET CT102:80/ | `systemctl restart dump1090-fa` |
| Home Assistant | HTTP GET :8123/ | Alert only (no auto-fix) |
| PostgreSQL | `pg_isready` | `systemctl restart postgresql@17-main` |
| AIS data freshness | SQL: max(recorded_at) < 5 min | `systemctl restart ais-collector` |
| ADS-B data freshness | SQL: max(recorded_at) < 2 min | `systemctl restart adsb-collector` |
| Host disk space | `df` < 85% | Alert only |
| USB SSD present | `lsusb \| grep JMicron` | Alert only |
| SDR dongles | `lsusb \| grep RTL` | Alert only |
| NIC health | dmesg: no "Hardware Unit Hang" | Reset NIC interface |

After 3 consecutive failures, issues are escalated in the log.

### Database Maintenance (daily at 4:00 AM HST)
- **Script**: `/opt/db-maintenance.sh` on CT104
- **Cron**: `0 4 * * *`
- **Actions**:
  - Delete orphaned rows (NULL source_type) from `live_tracks`
  - Delete AIS data older than 48 hours
  - Delete ADS-B data older than 1 hour
  - Run `VACUUM ANALYZE` on `live_tracks`

### Frigate Storage Pruner (daily at 3:00 AM HST)
- **Script**: `/opt/frigate-prune.sh` on CT113
- **Cron**: `0 3 * * *`
- **Log**: `/var/log/frigate-prune.log`
- **Actions**: Delete recordings >1 day, clips >14 days, audio >1 day
- **Note**: Recording is currently DISABLED in Frigate config. Will be re-enabled when camera triggers are set up.

### BirdNet Clip Pruner (daily at 3:30 AM HST)
- **Script**: `/opt/birdnet-prune.sh` on CT112
- **Cron**: `30 3 * * *`
- **Log**: `/var/log/birdnet-prune.log`
- **Actions**: Delete .wav/.mp3/.ogg clips older than 14 days

### Enphase Watchdog (every 5 minutes)
- **Script**: `enphase_watchdog.sh` on host
- **Monitors**: Solar inverter connectivity

## Power Recovery

### Automatic Recovery
All containers are configured with `onboot: 1` and ordered startup:

| Order | Container | Reason |
|-------|-----------|--------|
| 1 | CT104 (trackerDB) | Database must start first |
| 2 | CT102, CT106 | Data sources (ADS-B, AIS) |
| 3 | CT105, CT109 | Collectors and alerts (need DB) |
| 4 | CT108 | Dashboard (needs everything) |
| 5 | CT112, CT113 | BirdNet, Frigate (heavy, independent) |
| 6 | CT114, CT110 | Utilities, Project Manager |

### BIOS Setting (CRITICAL)
The Intel NUC BIOS must be set to **"Power On"** after AC power loss:
1. Press **F2** during POST to enter BIOS
2. Navigate: **Power** → **Secondary Power Settings** → **After Power Failure**
3. Set to **"Power On"**
4. **F10** → Save & Exit

### PM2 Process Recovery
- CT108: PM2 startup hook enabled (`pm2-root.service`), dump saved
- CT109: PM2 startup hook enabled, dump saved
- CT110: PM2 startup hook enabled, dump saved
- All PM2 instances auto-resurrect saved processes on container boot

### Systemd Service Recovery
All critical services have `Restart=always`:
- CT105: ais-collector, adsb-collector, avia-collector, env-collector
- CT108: envoy-pusher
- CT114: display-server, nrsc5-engine, photo-chrono, utilities
- CT106: ais-catcher

## Hardware Watchdog
- **Config**: `/etc/systemd/system.conf`
- `RuntimeWatchdogSec=30` — kernel hang >30s triggers hardware reboot
- `RebootWatchdogSec=10min` — reboot timeout limit

## NIC Stability
- **Issue**: Intel I225 NIC can experience "Hardware Unit Hang" under load
- **Mitigation**: TSO and GSO disabled: `ethtool -K nic0 tso off gso off`
- **Persisted**: In `/etc/network/interfaces` as `post-up` command
- **Monitored**: Health check watches dmesg for hang events

## Journal Management
- **Max size**: 500MB
- **Max retention**: 7 days
- **Config**: `/etc/systemd/journald.conf`

## Manual Health Check
Run on demand: `bash /opt/hawaii-tracker/scripts/health-check.sh && tail -30 /var/log/health-check.log`

## AISHub Integration (v1.3.0)

### Architecture: Enrich-Only Pattern
AISHub data is stored **in memory only** — it never writes to `live_tracks`:

```
AISHub API (30nm radius, every 120s)
    ├── Memory cache (_aishub_cache dict, ~30 vessels)
    ├── Enrich entities table (UPDATE only, never INSERT)
    ├── Serve /api/aishub-nearby on :3105 for dashboard
    └── AIS Receiver Health Check (cross-reference)
```

- **API Key**: `AH_2828_A392C354`
- **Bounding Box**: 30nm around Pukalani (20.785-21.786°N, 158.334-157.260°W)
- **Poll Interval**: 120 seconds
- **Cache Expiry**: 10 minutes
- **Cache HTTP**: `http://192.168.1.105:3105/api/aishub-nearby`

### Data Flow Rules
1. AISHub vessels → memory cache only (never to `live_tracks`)
2. Dashboard shows AISHub-only vessels as normal boats without trails
3. When local AIS receives a vessel → enriches `entities` with AISHub metadata
4. Vessels never seen locally → no DB records, no frequent visitor tracking

### AIS Receiver Health Check
Cross-references AISHub with local antenna:
- If 3+ vessels within 15nm on AISHub but NONE heard locally → flag hardware issue
- Writes `/tmp/ais-receiver-health` on CT105
- Picked up by health-check.sh every 5 minutes
- Checks: SDR dongle, rtl-tcp-ais, ais-forwarder, UDP:10110

### AISStream.io
**Disabled** (v1.3.0) — was duplicating AISHub's role and bloating the database.
