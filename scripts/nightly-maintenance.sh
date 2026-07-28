#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Nightly Maintenance — runs at 2:00 AM HST
# Covers: log cleanup, journal vacuum, Docker prune, DB vacuum,
#         disk monitoring, service restarts, health verification
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"
ALERT_THRESHOLD=80  # Disk usage % to flag

log() { echo "$LOG_PREFIX $1"; }

log "════════ NIGHTLY MAINTENANCE START ════════"

# ── 1. Log cleanup — truncate app logs > 50MB across all CTs ──
log "[1/9] Log cleanup..."
# Host logs
for f in /var/log/db-growth-monitor.log /var/log/system-backup.log /var/log/ha-sensor-pusher.log /var/log/state-watchdog.log /var/log/kiosk-watchdog.log /var/log/nightly-maintenance.log; do
  if [ -f "$f" ] && [ "$(stat -c%s "$f" 2>/dev/null || echo 0)" -gt 52428800 ]; then
    log "  Truncating $f ($(du -h "$f" | cut -f1))"
    tail -1000 "$f" > "${f}.tmp" && mv "${f}.tmp" "$f"
  fi
done

# Container logs
for CT in 105 108 112 113 114; do
  pct exec $CT -- bash -c '
    for f in /var/log/*.log; do
      [ -f "$f" ] || continue
      SIZE=$(stat -c%s "$f" 2>/dev/null || echo 0)
      if [ "$SIZE" -gt 52428800 ]; then
        echo "  CT'$CT': Truncating $f ($(du -h "$f" | cut -f1))"
        tail -1000 "$f" > "${f}.tmp" && mv "${f}.tmp" "$f"
      fi
    done
  ' 2>/dev/null || true
done
log "  Done"

# ── 2. Journal vacuum — keep 7 days ──
log "[2/9] Journal vacuum..."
journalctl --vacuum-time=7d --quiet 2>/dev/null || true
for CT in 104 105 106 108 109 110 112 113 114; do
  pct exec $CT -- journalctl --vacuum-time=7d --quiet 2>/dev/null || true
done
log "  Done"

# ── 3. Docker prune — remove unused images ──
log "[3/9] Docker prune..."
for CT in 112 113; do
  RECLAIM=$(pct exec $CT -- docker system df 2>/dev/null | grep Images | awk '{print $NF}')
  if [ -n "$RECLAIM" ] && [ "$RECLAIM" != "0B" ]; then
    log "  CT${CT}: Pruning unused images (reclaimable: $RECLAIM)"
    pct exec $CT -- docker image prune -f 2>/dev/null || true
  else
    log "  CT${CT}: No images to prune"
  fi
done
log "  Done"


# ── 3b. Data Retention Policies ──
log "[3b/9] Data retention..."

# PWS: downsample to hourly for data > 24h, keep forever
PWS_DEL=$(pct exec 104 -- su - postgres -c "psql -d tracking_db -t -c \"
DELETE FROM pws_obs
WHERE id NOT IN (
  SELECT DISTINCT ON (station_id, date_trunc('hour', obs_time)) id
  FROM pws_obs ORDER BY station_id, date_trunc('hour', obs_time), obs_time ASC
) AND obs_time < NOW() - INTERVAL '24 hours';
SELECT COUNT(*) FROM pws_obs;\"" 2>/dev/null | tail -1 | tr -d ' ')
log "  PWS: downsampled, ${PWS_DEL} rows kept"

# Tide: keep only latest per station
pct exec 104 -- su - postgres -c "psql -d tracking_db -c \"
DELETE FROM tide_water_level WHERE id NOT IN (
  SELECT DISTINCT ON (station_id) id FROM tide_water_level ORDER BY station_id, obs_time DESC
);\"" 2>/dev/null
log "  Tide: latest only"

# Buoy: keep only latest per station
pct exec 104 -- su - postgres -c "psql -d tracking_db -c \"
DELETE FROM buoy_obs WHERE id NOT IN (
  SELECT DISTINCT ON (buoy_id) id FROM buoy_obs ORDER BY buoy_id, obs_time DESC
);\"" 2>/dev/null
log "  Buoy: latest only"

# METAR: keep only latest per ICAO
pct exec 104 -- su - postgres -c "psql -d tracking_db -c \"
DELETE FROM metar_obs WHERE id NOT IN (
  SELECT DISTINCT ON (icao) id FROM metar_obs ORDER BY icao, obs_time DESC
);\"" 2>/dev/null
log "  METAR: latest only"

# Vessel predictions: keep 7 days
pct exec 104 -- su - postgres -c "psql -d tracking_db -c \"
DELETE FROM vessel_predictions WHERE updated_at < NOW() - INTERVAL '7 days';\"" 2>/dev/null
log "  Vessel predictions: 7-day retention"

# Entities: prune unseen > 90 days (not in sightings)
ENT_DEL=$(pct exec 104 -- su - postgres -c "psql -d tracking_db -t -c \"
DELETE FROM entities WHERE last_seen < NOW() - INTERVAL '90 days'
  AND entity_id NOT IN (SELECT DISTINCT entity_id FROM vessel_sightings)
  AND entity_id NOT IN (SELECT DISTINCT entity_id FROM aircraft_sightings);
SELECT COUNT(*) FROM entities;\"" 2>/dev/null | tail -1 | tr -d ' ')
log "  Entities: pruned, ${ENT_DEL} remain"

# REINDEX hot tables (prevent bloat recurrence)
pct exec 104 -- su - postgres -c "psql -d tracking_db -c 'REINDEX TABLE live_tracks; REINDEX TABLE entities;'" 2>/dev/null
log "  REINDEX: live_tracks, entities"

log "  Done"

# ── 4. PostgreSQL VACUUM ANALYZE ──
log "[4/9] PostgreSQL VACUUM ANALYZE..."
pct exec 104 -- su - postgres -c 'psql -d tracking_db -c "VACUUM ANALYZE;"' 2>/dev/null && log "  tracking_db: OK" || log "  tracking_db: SKIP"
pct exec 104 -- su - postgres -c 'psql -d tracking_db -c "VACUUM ANALYZE vessel_positions; VACUUM ANALYZE buoy_readings; VACUUM ANALYZE weather_observations; VACUUM ANALYZE ais_data;"' 2>/dev/null || true
log "  Done"

# ── 5. Disk usage report ──
log "[5/9] Disk usage report..."
HOST_USAGE=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
log "  Host: ${HOST_USAGE}%"
if [ "$HOST_USAGE" -gt "$ALERT_THRESHOLD" ]; then
  log "  ⚠️  HOST DISK ABOVE ${ALERT_THRESHOLD}%!"
fi

for CT in 104 105 106 108 112 113 114; do
  USAGE=$(pct exec $CT -- df / 2>/dev/null | tail -1 | awk '{print $5}' | tr -d '%')
  USED=$(pct exec $CT -- df -h / 2>/dev/null | tail -1 | awk '{print $3"/"$2}')
  log "  CT${CT}: ${USAGE}% ($USED)"
  if [ -n "$USAGE" ] && [ "$USAGE" -gt "$ALERT_THRESHOLD" ]; then
    log "  ⚠️  CT${CT} DISK ABOVE ${ALERT_THRESHOLD}%!"
  fi
done

# ── 6. Restart heavy services to clear memory ──
log "[6/9] Service memory reset..."
# Restart BirdNET docker
pct exec 112 -- docker restart birdnet_go 2>/dev/null && log "  CT112 birdnet_go: restarted" || log "  CT112 birdnet_go: failed"

# Restart display server (lightweight, no downtime impact at 2am)
pct exec 114 -- systemctl restart display-server 2>/dev/null && log "  CT114 display-server: restarted" || log "  CT114 display-server: failed"

# Restart data collectors on CT105 (systemd services)
for SVC in adsb-collector ais-collector avia-collector env-collector; do
  pct exec 105 -- systemctl restart $SVC 2>/dev/null && log "  CT105 $SVC: restarted" || log "  CT105 $SVC: failed"
done

# Restart dashboard services on CT108
pct exec 108 -- bash -c 'pm2 restart all 2>/dev/null' && log "  CT108 PM2 processes: restarted" || log "  CT108 PM2: not found"
log "  Done"

# ── 7. SQLite WAL checkpoint — compact display-server state.db ──
log "[7/9] SQLite WAL checkpoint..."
pct exec 114 -- node -e "
  const Database = require('better-sqlite3');
  const db = new Database('/opt/display-server/state.db');
  db.pragma('wal_checkpoint(TRUNCATE)');
  console.log('  state.db: WAL checkpointed');
  db.close();
" 2>/dev/null || log "  state.db: SKIP"
log "  Done"

# ── 8. Wait for services to come back, then verify ──
log "[8/9] Waiting 15s for services..."
sleep 15

# ── 9. Health verification ──
log "[9/9] Health verification..."
FAILURES=0

# Check display server
HTTP=$(curl -s -o /dev/null -w '%{http_code}' http://192.168.1.114:3000/api/health 2>/dev/null)
if [ "$HTTP" = "200" ]; then
  log "  Display server: ✅"
else
  log "  Display server: ❌ (HTTP $HTTP)"
  FAILURES=$((FAILURES+1))
fi

# Check Frigate
HTTP=$(curl -s -o /dev/null -w '%{http_code}' http://192.168.1.113:5000/api/version 2>/dev/null)
if [ "$HTTP" = "200" ]; then
  log "  Frigate: ✅"
else
  log "  Frigate: ❌ (HTTP $HTTP)"
  FAILURES=$((FAILURES+1))
fi

# Check BirdNET
HTTP=$(curl -s -o /dev/null -w '%{http_code}' http://192.168.1.112:8080 2>/dev/null)
if [ "$HTTP" = "200" ] || [ "$HTTP" = "302" ]; then
  log "  BirdNET: ✅"
else
  log "  BirdNET: ❌ (HTTP $HTTP)"
  FAILURES=$((FAILURES+1))
fi

# Check Dashboard
HTTP=$(curl -s -o /dev/null -w '%{http_code}' http://192.168.1.108:8080 2>/dev/null)
if [ "$HTTP" = "200" ]; then
  log "  Dashboard: ✅"
else
  log "  Dashboard: ❌ (HTTP $HTTP)"
  FAILURES=$((FAILURES+1))
fi

# Check PostgreSQL
pct exec 104 -- sudo -u postgres pg_isready -q 2>/dev/null && log "  PostgreSQL: ✅" || { log "  PostgreSQL: ❌"; FAILURES=$((FAILURES+1)); }

# Check data collectors (CT105 PM2)
PM2_COUNT=$(pct exec 105 -- bash -c 'pm2 list 2>/dev/null | grep -c online' 2>/dev/null || echo 0)
if [ "$PM2_COUNT" -gt 0 ]; then
  log "  CT105 collectors ($PM2_COUNT online): ✅"
else
  log "  CT105 collectors: ❌"
  FAILURES=$((FAILURES+1))
fi

if [ "$FAILURES" -eq 0 ]; then
  log "════════ NIGHTLY MAINTENANCE COMPLETE — ALL HEALTHY ════════"
else
  log "════════ NIGHTLY MAINTENANCE COMPLETE — $FAILURES FAILURES ════════"
fi
