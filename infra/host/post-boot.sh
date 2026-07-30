#!/usr/bin/env bash
# /opt/hawaii-nanny/post-boot.sh
# Post-boot sequencing script — ensures all services start in dependency order
# after a full system power cycle. Runs via @reboot crontab with 60s delay.

set -uo pipefail

LOG="/var/log/post-boot.log"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

# ── Helper: wait for condition with timeout ──
wait_for() {
  local desc="$1" cmd="$2" max="$3"
  local elapsed=0
  log "Waiting for $desc (max ${max}s)..."
  while ! eval "$cmd" >/dev/null 2>&1; do
    sleep 5
    elapsed=$((elapsed + 5))
    if [ $elapsed -ge $max ]; then
      log "TIMEOUT: $desc not ready after ${max}s"
      return 1
    fi
  done
  log "OK: $desc ready (${elapsed}s)"
  return 0
}

log "=========================================="
log "POST-BOOT SEQUENCE STARTING"
log "=========================================="

# ── 1. Wait for network ──
GATEWAY=$(ip route 2>/dev/null | awk '/default/ {print $3; exit}')
GATEWAY="${GATEWAY:-192.168.1.1}"
log "Detected gateway: $GATEWAY"
wait_for "network (gateway $GATEWAY)" "ping -c1 -W2 $GATEWAY" 120

# ── 2. Wait for PostgreSQL (CT104) ──
wait_for "PostgreSQL (CT104)" "pct exec 104 -- pg_isready -U postgres" 60

# ── 3. Start/verify CT105 services (depend on DB) ──
log "Starting CT105 services..."
for svc in tracker-engine ais-collector adsb-collector; do
  if ! pct exec 105 -- systemctl is-active --quiet "$svc" 2>/dev/null; then
    pct exec 105 -- systemctl start "$svc" 2>/dev/null || true
    log "Started $svc"
  else
    log "OK: $svc already running"
  fi
done

# ── 4. Wait for Dashboard API (CT108) ──
wait_for "Dashboard API (CT108)" "curl -s -m5 http://192.168.1.108:3001/api/health" 60
# Also ensure client is up
pct exec 108 -- pm2 restart hawaii-client 2>/dev/null || true

# ── 5. Start/verify CT114 display-server ──
if ! pct exec 114 -- systemctl is-active --quiet display-server 2>/dev/null; then
  pct exec 114 -- systemctl start display-server 2>/dev/null || true
  log "Started display-server"
else
  log "OK: display-server already running"
fi
wait_for "Display Server (CT114)" "curl -s -m5 http://192.168.1.114:3000/api/health" 30

# ── 6. Start/verify CT115 expense-tracker ──
if pct status 115 2>/dev/null | grep -q 'running'; then
  pct exec 115 -- pm2 resurrect 2>/dev/null || pct exec 115 -- pm2 start /opt/expense-tracker/server.js --name expense-api 2>/dev/null || true
  log "OK: CT115 expense-tracker checked"
else
  log "WARN: CT115 not running — attempting start"
  pct start 115 2>/dev/null || true
  sleep 10
  pct exec 115 -- pm2 resurrect 2>/dev/null || true
fi

# ── 7. Start kiosk displays (depend on display-server) ──
if ! systemctl is-active --quiet corner-kiosk 2>/dev/null; then
  systemctl start corner-kiosk 2>/dev/null || true
  log "Started corner-kiosk"
else
  log "OK: corner-kiosk already running"
fi

# Wait for kiosk browsers to connect
sleep 10

# ── 8. Reload kiosk browsers to pick up fresh content ──
curl -s -X POST http://192.168.1.114:3000/api/reload >/dev/null 2>&1 || true
log "Sent reload to kiosk browsers"

# ── 9. Start HDMI watchdog ──
if ! systemctl is-active --quiet hdmi-watchdog 2>/dev/null; then
  systemctl start hdmi-watchdog 2>/dev/null || true
  log "Started hdmi-watchdog"
fi

# ── 10. USB device audit ──
log "USB audit:"
local_blog_v4=false local_adsb=false
for serial_file in /sys/bus/usb/devices/*/serial; do
  ser=$(cat "$serial_file" 2>/dev/null)
  [ "$ser" = "00000001" ] && local_blog_v4=true
  [ "$ser" = "00000010" ] && local_adsb=true
done
log "  RTL-SDR Blog V4 (AIS): $local_blog_v4"
log "  AIRNAV ADS-B: $local_adsb"

# ── 11. SDR scheduler ──
if ! systemctl is-active --quiet sdr-scheduler 2>/dev/null; then
  systemctl start sdr-scheduler 2>/dev/null || true
  log "Started sdr-scheduler"
fi

# ── 12. Summary ──
log "=========================================="
log "POST-BOOT SEQUENCE COMPLETE"
log "  Gateway: $GATEWAY"
log "  Containers: $(pct list 2>/dev/null | grep -c running) running"
log "  Dashboard: $(curl -s -m3 http://192.168.1.108:3001/api/health 2>/dev/null | head -c 50)"
log "  Display:   $(curl -s -m3 http://192.168.1.114:3000/api/health 2>/dev/null | head -c 50)"
log "  Expense:   $(curl -s -m3 http://192.168.1.115:3001/api/health 2>/dev/null || echo 'no health endpoint')"
log "  USB AIS:   $local_blog_v4"
log "  USB ADSB:  $local_adsb"
log "=========================================="
