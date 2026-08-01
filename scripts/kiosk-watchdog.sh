#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
# kiosk-watchdog.sh — Enhanced Kiosk Health Monitor
# ══════════════════════════════════════════════════════════════════════════════
# Cron (host): */5 * * * * /opt/hawaii-tracker/scripts/kiosk-watchdog.sh
#
# Checks:
#   1. Chromium process is alive (existing check)
#   2. WebSocket connectivity — verifies kiosk IS connected to display-server
#      (new check — catches the "Chromium alive but WS broken" failure mode)
#   3. Memory guard — restart if Chromium uses >1200MB
#   4. HTTP health of display-server backend (CT114:3000)
#
# Escalation levels:
#   - WS disconnect → restart corner-kiosk (Chromium only, soft restart)
#   - Backend unhealthy → restart display-server on CT114
#   - Chromium dead → restart corner-kiosk
#   - Memory >1200MB → restart corner-kiosk
# ══════════════════════════════════════════════════════════════════════════════

LOG=/var/log/kiosk-watchdog.log
DISPLAY_URL="http://192.168.1.114:3000"
WS_CLIENTS_MIN=2           # Expect: main TV (192.168.1.100) + corner (192.168.1.100 second instance)
MEMORY_LIMIT_MB=1200       # Restart if Chromium heap exceeds this

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG"; }

# ── 1. Check display-server HTTP health ──────────────────────────────────────
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 "${DISPLAY_URL}/api/health" 2>/dev/null)
if [ "$HTTP_CODE" != "200" ]; then
    log "WARN: Display-server HTTP health check failed (HTTP $HTTP_CODE) — restarting service on CT114"
    pct exec 114 -- systemctl restart display-server
    sleep 5
    # After restarting backend, always restart Chromium too so WS reconnects cleanly
    log "INFO: Restarting corner-kiosk after display-server restart"
    systemctl restart corner-kiosk
    exit 0
fi

# ── 2. Check WebSocket connectivity ─────────────────────────────────────────
# Query /api/health to see how many kiosk clients are connected
HEALTH_JSON=$(curl -s --connect-timeout 5 "${DISPLAY_URL}/api/health" 2>/dev/null)
WS_CLIENTS=$(echo "$HEALTH_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('displays', {})))" 2>/dev/null || echo "0")

if [ "$WS_CLIENTS" -lt 1 ]; then
    log "WARN: No WebSocket clients connected to display-server (expected >= 1) — restarting corner-kiosk"
    systemctl restart corner-kiosk
    exit 0
fi

# ── 3. Check Chromium process ────────────────────────────────────────────────
KIOSK_MEM=$(ps -C chromium -o rss= 2>/dev/null | awk '{sum+=$1} END {print int(sum/1024)}')

if [ -z "$KIOSK_MEM" ] || [ "$KIOSK_MEM" -eq 0 ]; then
    log "WARN: Chromium not running — restarting corner-kiosk"
    systemctl restart corner-kiosk
    exit 0
fi

if [ "$KIOSK_MEM" -gt "$MEMORY_LIMIT_MB" ]; then
    log "WARN: Chromium using ${KIOSK_MEM}MB (>${MEMORY_LIMIT_MB}MB limit) — restarting corner-kiosk"
    systemctl restart corner-kiosk
    exit 0
fi

# ── All OK ───────────────────────────────────────────────────────────────────
# Only log if something was previously wrong (avoid log spam on healthy runs)
# log "OK: kiosk healthy — Chromium ${KIOSK_MEM}MB, WS clients: ${WS_CLIENTS}"
