#!/bin/bash
# Hawaii Tracker — Nightly Health Check
# Runs at 02:00 HST (12:00 UTC) daily
# Checks all containers, services, data freshness, disk usage
# Writes JSON report to /tmp/health-report.json (served by dashboard /api/health-report)
# Appends human-readable summary to /var/log/health-check.log

set -euo pipefail
LOG=/var/log/health-check.log
REPORT=/tmp/health-report.json
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
HST_TIME=$(TZ=Pacific/Honolulu date +"%Y-%m-%d %H:%M HST")

echo "" >> $LOG
echo "══════════════════════════════════════════════" >> $LOG
echo "Health Check: $HST_TIME" >> $LOG
echo "══════════════════════════════════════════════" >> $LOG

ISSUES=()
WARNINGS=()
PASSED=0
FAILED=0

check() {
  local name="$1" result="$2" detail="$3"
  if [ "$result" = "PASS" ]; then
    echo "  ✅ $name: $detail" >> $LOG
    PASSED=$((PASSED+1))
  elif [ "$result" = "WARN" ]; then
    echo "  ⚠️  $name: $detail" >> $LOG
    WARNINGS+=("$name: $detail")
  else
    echo "  ❌ $name: $detail" >> $LOG
    ISSUES+=("$name: $detail")
    FAILED=$((FAILED+1))
  fi
}

# ── 1. Container Status ─────────────────────────────────────────────────────
echo "" >> $LOG
echo "[Containers]" >> $LOG
for VMID in 101 102 103 104 105 106 108 109 110 111 112 113; do
  STATUS=$(pct status $VMID 2>/dev/null | awk '{print $2}' || echo 'unknown')
  NAME=$(pct config $VMID 2>/dev/null | grep ^hostname | awk '{print $2}' || echo "CT$VMID")
  if [ "$STATUS" = "running" ]; then
    check "CT$VMID ($NAME)" "PASS" "running"
  else
    check "CT$VMID ($NAME)" "FAIL" "status: $STATUS — attempting restart"
    pct start $VMID 2>/dev/null || true
  fi
done

# ── 2. HAOS VM ──────────────────────────────────────────────────────────────
echo "" >> $LOG
echo "[HAOS VM]" >> $LOG
HA_STATUS=$(qm status 100 2>/dev/null | awk '{print $2}' || echo 'unknown')
if [ "$HA_STATUS" = "running" ]; then
  check "VM100 (haos-18.1)" "PASS" "running"
else
  check "VM100 (haos-18.1)" "FAIL" "status: $HA_STATUS"
fi

# ── 3. Key Systemd Services on Host (Bypassed due to power issues) ──────────
# echo "" >> $LOG
# echo "[Host Services]" >> $LOG
# for SVC in ais-host-forwarder rtl-tcp-ais sdr-scheduler; do
#   STATE=$(systemctl is-active $SVC 2>/dev/null || echo 'inactive')
#   if [ "$STATE" = "active" ]; then
#     check "host/$SVC" "PASS" "active"
#   else
#     check "host/$SVC" "FAIL" "$STATE — attempting restart"
#     systemctl restart $SVC 2>/dev/null || true
#   fi
# done

# ── 4. AIS USB device (Bypassed due to power issues) ────────────────────────
# echo "" >> $LOG
# echo "[AIS Hardware]" >> $LOG
# if ls /dev/ttyAIS 2>/dev/null; then
#   check "AIS USB (/dev/ttyAIS)" "PASS" "device present"
# else
#   AIS_DEV=$(ls /dev/ttyUSB* 2>/dev/null | head -1 || echo '')
#   if [ -n "$AIS_DEV" ]; then
#     check "AIS USB" "WARN" "ttyAIS symlink missing, using $AIS_DEV"
#   else
#     check "AIS USB" "FAIL" "no serial device found — physically reseat USB"
#   fi
# fi

# AIS data flow — check data in last 5 min (Bypassed due to power issues)
# AIS_COUNT=$(pct exec 104 -- bash -c 'su - postgres -c "psql -d tracking_db -qtAc \"SELECT COUNT(*) FROM live_tracks WHERE source_type=\'ais\' AND recorded_at > NOW() - INTERVAL \'5 minutes\';\""' 2>/dev/null | tr -d '[:space:]' || echo '0')
# if [ "$AIS_COUNT" -gt 0 ] 2>/dev/null; then
#   check "AIS data flow" "PASS" "$AIS_COUNT positions in last 5min"
# else
#   check "AIS data flow" "FAIL" "no AIS data in last 5min"
#   # Try restart
#   systemctl restart ais-host-forwarder 2>/dev/null || true
#   pct exec 105 -- systemctl restart tracker-engine 2>/dev/null || true
# fi

# ── 5. ADS-B ────────────────────────────────────────────────────────────────
echo "" >> $LOG
echo "[ADS-B]" >> $LOG
ADSB_COUNT=$(pct exec 104 -- bash -c "PGPASSWORD=pukalani psql -h 127.0.0.1 -U tracker -d tracking_db -qtAc \"SELECT COUNT(*) FROM live_tracks WHERE source_type='adsb' AND recorded_at > NOW() - INTERVAL '5 minutes';\"" 2>/dev/null | tr -d '[:space:]' || echo '0')
if [ "$ADSB_COUNT" -gt 0 ] 2>/dev/null; then
  check "ADS-B data flow" "PASS" "$ADSB_COUNT positions in last 5min"
else
  # Midnight may be dead — check last hour
  ADSB_HOUR=$(pct exec 104 -- bash -c "PGPASSWORD=pukalani psql -h 127.0.0.1 -U tracker -d tracking_db -qtAc \"SELECT COUNT(*) FROM live_tracks WHERE source_type='adsb' AND recorded_at > NOW() - INTERVAL '1 hour';\"" 2>/dev/null | tr -d '[:space:]' || echo '0')
  if [ "$ADSB_HOUR" -gt 0 ] 2>/dev/null; then
    check "ADS-B data flow" "WARN" "no aircraft in 5min but $ADSB_HOUR in last hour (quiet period)"
  else
    check "ADS-B data flow" "FAIL" "no ADS-B data in last hour"
    pct exec 105 -- systemctl restart tracker-engine 2>/dev/null || true
  fi
fi

# ── 6. Weather Station ──────────────────────────────────────────────────────
echo "" >> $LOG
echo "[Weather]" >> $LOG
WX_COUNT=$(pct exec 104 -- bash -c "PGPASSWORD=pukalani psql -h 127.0.0.1 -U tracker -d tracking_db -qtAc \"SELECT COUNT(*) FROM pws_obs WHERE obs_time > NOW() - INTERVAL '5 minutes';\"" 2>/dev/null | tr -d '[:space:]' || echo '0')
if [ "$WX_COUNT" -gt 0 ] 2>/dev/null; then
  check "PWS weather" "PASS" "fresh data"
else
  check "PWS weather" "WARN" "no weather data in last 5min (station may be offline)"
fi

# ── 7. BirdNET ──────────────────────────────────────────────────────────────
echo "" >> $LOG
echo "[BirdNET]" >> $LOG
BN_STATUS=$(pct exec 112 -- docker inspect -f '{{.State.Status}}' birdnet_go 2>/dev/null || echo 'unknown')
if [ "$BN_STATUS" = "running" ]; then
  BN_HEALTH=$(pct exec 112 -- docker inspect -f '{{.State.Health.Status}}' birdnet_go 2>/dev/null || echo 'none')
  check "BirdNET container" "PASS" "running (health: $BN_HEALTH)"
else
  check "BirdNET container" "FAIL" "status: $BN_STATUS — restarting"
  pct exec 112 -- bash -c 'cd /opt/birdnet && docker compose up -d' 2>/dev/null || true
fi

# BirdNET DB detection count (last 24h)
BN_DETECTIONS=$(pct exec 112 -- sqlite3 /opt/birdnet/data/birdnet.db 'SELECT COUNT(*) FROM detections WHERE timestamp > strftime("%Y-%m-%d", datetime("now", "-1 day"));' 2>/dev/null || echo '0')
if [ "$BN_DETECTIONS" -gt 0 ] 2>/dev/null; then
  check "BirdNET detections" "PASS" "$BN_DETECTIONS detections in last 24h"
else
  check "BirdNET detections" "WARN" "0 detections in last 24h (normal at night)"
fi

# ── 8. Dashboard API ────────────────────────────────────────────────────────
echo "" >> $LOG
echo "[Dashboard API]" >> $LOG
API_RESP=$(curl -sf --max-time 5 http://192.168.1.108:3001/api/health 2>/dev/null || echo '')
if [ -n "$API_RESP" ]; then
  check "Dashboard API /api/health" "PASS" "responding"
else
  check "Dashboard API" "FAIL" "not responding — restarting"
  pct exec 108 -- systemctl restart dashboard 2>/dev/null || true
fi

# ── 9. Disk Usage ───────────────────────────────────────────────────────────
echo "" >> $LOG
echo "[Disk Usage]" >> $LOG
for VMID in 104 105 108 112 113; do
  USAGE=$(pct exec $VMID -- df -h / 2>/dev/null | tail -1 | awk '{print $5}' | tr -d '%' || echo '0')
  NAME=$(pct config $VMID 2>/dev/null | grep ^hostname | awk '{print $2}' || echo "CT$VMID")
  if [ "$USAGE" -lt 80 ] 2>/dev/null; then
    check "Disk CT$VMID ($NAME)" "PASS" "${USAGE}% used"
  elif [ "$USAGE" -lt 90 ] 2>/dev/null; then
    check "Disk CT$VMID ($NAME)" "WARN" "${USAGE}% used — getting full"
  else
    check "Disk CT$VMID ($NAME)" "FAIL" "${USAGE}% used — CRITICAL"
  fi
done

# Proxmox host disk
HOST_USAGE=$(df -h / | tail -1 | awk '{print $5}' | tr -d '%')
if [ "$HOST_USAGE" -lt 80 ]; then
  check "Disk host (/)" "PASS" "${HOST_USAGE}% used"
else
  check "Disk host (/)" "WARN" "${HOST_USAGE}% used"
fi

# ── 10. Frigate ─────────────────────────────────────────────────────────────
echo "" >> $LOG
echo "[Frigate]" >> $LOG
FRIGATE_STATUS=$(pct exec 113 -- docker inspect -f '{{.State.Status}}' frigate 2>/dev/null || echo 'unknown')
if [ "$FRIGATE_STATUS" = "running" ]; then
  check "Frigate container" "PASS" "running"
else
  check "Frigate container" "WARN" "status: $FRIGATE_STATUS"
fi

# ── Summary ─────────────────────────────────────────────────────────────────
echo "" >> $LOG
echo "[Summary]" >> $LOG
echo "  Passed: $PASSED | Failed: $FAILED | Warnings: ${#WARNINGS[@]}" >> $LOG

if [ ${#ISSUES[@]} -gt 0 ]; then
  echo "  Issues:" >> $LOG
  for ISSUE in "${ISSUES[@]}"; do echo "    - $ISSUE" >> $LOG; done
fi
if [ ${#WARNINGS[@]} -gt 0 ]; then
  echo "  Warnings:" >> $LOG
  for WARN in "${WARNINGS[@]}"; do echo "    - $WARN" >> $LOG; done
fi

# Write JSON report for dashboard
python3 -c "
import json, sys
report = {
  'timestamp': '$TIMESTAMP',
  'hst_time': '$HST_TIME',
  'passed': $PASSED,
  'failed': $FAILED,
  'warnings': ${#WARNINGS[@]},
  'issues': $(echo "${ISSUES[*]:-}" | python3 -c 'import sys,json; data=sys.stdin.read().strip(); items=[x for x in data.split("|SEP|") if x]; print(json.dumps(items))' 2>/dev/null || echo '[]'),
  'status': 'ok' if $FAILED == 0 else ('warning' if ${#WARNINGS[@]} > 0 else 'error')
}
print(json.dumps(report, indent=2))
" > $REPORT 2>/dev/null || echo '{"timestamp":"'$TIMESTAMP'","status":"error","message":"report generation failed"}' > $REPORT

echo "" >> $LOG
echo "Report written to $REPORT" >> $LOG
echo "Done: $HST_TIME" >> $LOG
