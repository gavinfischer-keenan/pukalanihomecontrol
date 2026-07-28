#!/bin/bash
# /opt/hawaii-tracker/scripts/ais-watchdog.sh
# AIS Health Watchdog — runs every 5 minutes via cron
#
# Honolulu is a major port. We should ALWAYS have AIS vessel traffic.
# This watchdog detects AIS pipeline failures and takes corrective action:
#   Level 1: AIS data stale > 5 min  → restart ais-collector
#   Level 2: Still stale after restart → check for DB bloat, REINDEX
#   Level 3: Still stale after REINDEX → alert via Home Assistant
#
# Traffic expectations (Honolulu):
#   - Daytime (06:00–22:00): typically 5–40 vessels within 15nm
#   - Nighttime (22:00–06:00): typically 2–15 vessels
#   - NEVER 0 vessels for more than 10 minutes unless antenna is down

LOG=/var/log/ais-watchdog.log
STATE_DIR=/var/run/ais-watchdog
HA_URL="http://192.168.1.19:8123"
HA_TOKEN_FILE="/opt/hawaii-tracker/secrets/ha_token"
TS=$(date '+%Y-%m-%d %H:%M:%S')

mkdir -p $STATE_DIR

log() { echo "[$TS] $1" >> $LOG; }

notify_ha() {
  local msg="$1"
  local severity="${2:-warning}"  # warning or critical
  if [ -f "$HA_TOKEN_FILE" ]; then
    local token=$(cat "$HA_TOKEN_FILE")
    curl -s -X POST "$HA_URL/api/services/persistent_notification/create" \
      -H "Authorization: Bearer $token" \
      -H "Content-Type: application/json" \
      -d "{\"title\":\"AIS Watchdog [$severity]\",\"message\":\"$msg\",\"notification_id\":\"ais_watchdog\"}" \
      >/dev/null 2>&1
  fi
  log "NOTIFY [$severity]: $msg"
}

# ── Step 1: Check AIS data freshness ──
AIS_AGE=$(pct exec 104 -- bash -c "PGPASSWORD=pukalani psql -h 127.0.0.1 -U tracker -d tracking_db -t -c \
  \"SELECT COALESCE(EXTRACT(EPOCH FROM (now() - max(recorded_at)))::int, 99999) FROM live_tracks WHERE source_type='ais';\"" \
  2>/dev/null | tr -d ' ')

AIS_COUNT=$(pct exec 104 -- bash -c "PGPASSWORD=pukalani psql -h 127.0.0.1 -U tracker -d tracking_db -t -c \
  \"SELECT COUNT(DISTINCT entity_id) FROM live_tracks WHERE source_type='ais' AND recorded_at > NOW() - INTERVAL '10 minutes';\"" \
  2>/dev/null | tr -d ' ')

log "AIS age: ${AIS_AGE}s | Vessels in last 10min: ${AIS_COUNT}"

# If AIS is fresh, all good
if [ -n "$AIS_AGE" ] && [ "$AIS_AGE" -lt 300 ] 2>/dev/null; then
  # Check if we're recovering from a previous failure
  if [ -f "$STATE_DIR/failure_count" ]; then
    prev_count=$(cat "$STATE_DIR/failure_count")
    log "RECOVERED after $prev_count consecutive failures"
    notify_ha "AIS pipeline recovered. Data flowing again (${AIS_AGE}s old, ${AIS_COUNT} vessels)." "info"
    rm -f "$STATE_DIR/failure_count" "$STATE_DIR/last_action"
  fi
  exit 0
fi

# ── AIS data is stale — escalation ladder ──
FAIL_COUNT=0
[ -f "$STATE_DIR/failure_count" ] && FAIL_COUNT=$(cat "$STATE_DIR/failure_count")
FAIL_COUNT=$((FAIL_COUNT + 1))
echo $FAIL_COUNT > "$STATE_DIR/failure_count"

LAST_ACTION=""
[ -f "$STATE_DIR/last_action" ] && LAST_ACTION=$(cat "$STATE_DIR/last_action")

log "STALE AIS! Age=${AIS_AGE}s, Vessels=${AIS_COUNT}, Failure #${FAIL_COUNT}"

# ── Level 1 (failures 1-2): Check DB for statement timeouts, restart collector ──
if [ "$FAIL_COUNT" -le 2 ] && [ "$LAST_ACTION" != "restart_collector" ]; then
  log "Level 1: Checking for DB write timeouts..."

  # Check if ais-collector is logging statement timeouts
  TIMEOUT_COUNT=$(pct exec 105 -- journalctl -u ais-collector --no-pager --since "5 minutes ago" 2>/dev/null | grep -c "statement timeout")

  if [ "$TIMEOUT_COUNT" -gt 0 ]; then
    log "Found $TIMEOUT_COUNT statement timeouts in ais-collector — DB index may be bloated"
    # Skip straight to Level 2 (REINDEX)
    echo "reindex" > "$STATE_DIR/last_action"
    FAIL_COUNT=3
    echo $FAIL_COUNT > "$STATE_DIR/failure_count"
  else
    log "Level 1: Restarting ais-collector..."
    pct exec 105 -- systemctl restart ais-collector >> $LOG 2>&1
    echo "restart_collector" > "$STATE_DIR/last_action"
  fi

# ── Level 2 (failures 3-4): REINDEX + VACUUM the DB ──
elif [ "$FAIL_COUNT" -le 4 ] && [ "$LAST_ACTION" != "reindex" ]; then
  log "Level 2: REINDEX + VACUUM on tracking DB..."
  notify_ha "AIS stale for ${FAIL_COUNT} checks. Running DB maintenance (REINDEX + VACUUM)." "warning"

  # Run REINDEX on the hot tables
  pct exec 104 -- su - postgres -c "psql -d tracking_db -c 'REINDEX TABLE entities;'" >> $LOG 2>&1
  pct exec 104 -- su - postgres -c "psql -d tracking_db -c 'REINDEX TABLE live_tracks;'" >> $LOG 2>&1
  pct exec 104 -- su - postgres -c "psql -d tracking_db -c 'VACUUM ANALYZE entities; VACUUM ANALYZE live_tracks;'" >> $LOG 2>&1

  # Also prune old live_tracks (keep last 48 hours)
  PRUNED=$(pct exec 104 -- su - postgres -c "psql -d tracking_db -t -c \"DELETE FROM live_tracks WHERE recorded_at < NOW() - INTERVAL '48 hours'; SELECT COUNT(*) FROM live_tracks;\"" 2>/dev/null | tail -1 | tr -d ' ')
  log "After prune: $PRUNED rows remain in live_tracks"

  # Restart collector after DB maintenance
  pct exec 105 -- systemctl restart ais-collector >> $LOG 2>&1
  echo "reindex" > "$STATE_DIR/last_action"

# ── Level 3 (failures 5+): Check hardware, full pipeline restart, alert ──
elif [ "$FAIL_COUNT" -ge 5 ]; then
  log "Level 3: Full pipeline check..."

  # Check SDR dongle
  SDR_OK=$(lsusb | grep -c '0bda:2838')
  # Check rtl_tcp-ais service
  RTL_OK=$(pct exec 106 -- systemctl is-active rtl-tcp-ais 2>/dev/null)
  # Check AIS-catcher
  CATCHER_OK=$(pct exec 106 -- systemctl is-active ais-catcher 2>/dev/null)

  log "SDR dongles: $SDR_OK, rtl-tcp: $RTL_OK, ais-catcher: $CATCHER_OK"

  if [ "$SDR_OK" -eq 0 ]; then
    notify_ha "CRITICAL: AIS antenna SDR dongle NOT DETECTED. Physical check needed." "critical"
  elif [ "$RTL_OK" != "active" ] || [ "$CATCHER_OK" != "active" ]; then
    log "Restarting AIS radio pipeline..."
    systemctl restart rtl-tcp-ais 2>/dev/null
    sleep 3
    pct exec 106 -- systemctl restart ais-catcher >> $LOG 2>&1
    sleep 5
    pct exec 105 -- systemctl restart ais-collector >> $LOG 2>&1
    notify_ha "AIS radio pipeline restarted (rtl-tcp=$RTL_OK, catcher=$CATCHER_OK). Monitoring..." "warning"
  else
    notify_ha "CRITICAL: AIS stale for $((FAIL_COUNT * 5)) minutes. All services running but no data flowing. Manual investigation needed.\nSDR: $SDR_OK dongles, rtl-tcp: $RTL_OK, catcher: $CATCHER_OK" "critical"
  fi

  echo "full_restart" > "$STATE_DIR/last_action"

  # Cap the counter to prevent runaway
  if [ "$FAIL_COUNT" -ge 10 ]; then
    echo 5 > "$STATE_DIR/failure_count"
  fi
fi

log "--- AIS watchdog check complete ---"
