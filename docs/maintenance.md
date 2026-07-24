<!-- doc: maintenance.md | topic: Maintenance & Health Checks | last-updated: 2026-07-23 -->

# Maintenance & Health Checks

## Daily Database Cleanup

A cron job on **CT104 (trackerDB)** runs daily at **4:00 AM HST**.

* **Script:** `/opt/db-maintenance.sh`
* **What it cleans:**
  - Orphaned rows (tracks with no matching vessel/aircraft info)
  - AIS data older than 48 hours
  - ADS-B data older than 1 hour
* **Manual run:** `pct exec 104 -- bash /opt/db-maintenance.sh`

## PM2 Process Management

### CT108 (hawaii-tracker)
* **Processes:** hawaii-api, hawaii-client
* **Check:** `pct exec 108 -- pm2 list`
* **Restart:** `pct exec 108 -- pm2 restart all`
* **Logs:** `pct exec 108 -- pm2 logs`

### CT110 (project-mgr)
* **Processes:** hawaii-pm
* **Check:** `pct exec 110 -- pm2 list`
* **Restart:** `pct exec 110 -- pm2 restart hawaii-pm`
* **Logs:** `pct exec 110 -- pm2 logs hawaii-pm`

## Log Locations

| Container | Service | Log Path |
|-----------|---------|----------|
| CT104 | PostgreSQL | `/var/log/postgresql/` |
| CT105 | Collectors | `journalctl -u ais-collector` (etc.) |
| CT108 | PM2 apps | `~/.pm2/logs/` |
| CT110 | PM2 apps | `~/.pm2/logs/` |
| CT112 | BirdNET-Go | `docker logs birdnet` |
| CT113 | Frigate | `docker logs frigate` |
| CT114 | Display | `journalctl -u corner-kiosk` |

## Health Checks

### Vessel API
```bash
curl -s http://192.168.1.108:3001/api/vessels | head -c 200
```

### Ecowitt Data Flow
Verify recent weather observations in the database:
```bash
pct exec 104 -- psql -U tracker -d tracking_db -c "SELECT MAX(timestamp) FROM pws_obs;"
```

### Satellite Imagery
Verify satellite_collector.py is running on schedule:
```bash
pct exec 105 -- crontab -l | grep satellite
pct exec 105 -- ls -lt /opt/satellite-data/ | head -5
```
