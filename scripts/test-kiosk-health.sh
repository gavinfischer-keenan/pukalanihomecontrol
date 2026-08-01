#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
# test-kiosk-health.sh — Kiosk & Display-Server Health Test Suite
# ══════════════════════════════════════════════════════════════════════════════
# Run from Proxmox host: bash /opt/hawaii-tracker/scripts/test-kiosk-health.sh
#
# Tests:
#   T1  display-server HTTP reachable
#   T2  display-server /api/health returns valid JSON
#   T3  At least 1 WebSocket client connected (kiosk WS live)
#   T4  /api/state returns non-null state
#   T5  /api/cameras returns non-empty camera list
#   T6  /api/config returns non-empty config
#   T7  Chromium process running on host
#   T8  corner-kiosk systemd service active
#   T9  No WS code=1002 errors in last 5 minutes of journal
#   T10 kiosk-watchdog cron is installed
# ══════════════════════════════════════════════════════════════════════════════

DISPLAY_URL="http://192.168.1.114:3000"
PASS=0
FAIL=0
WARN=0

ok()   { echo "  ✅ PASS: $*"; ((PASS++)); }
fail() { echo "  ❌ FAIL: $*"; ((FAIL++)); }
warn() { echo "  ⚠️  WARN: $*"; ((WARN++)); }

echo "════════════════════════════════════════════"
echo " Kiosk Health Test Suite — $(date)"
echo "════════════════════════════════════════════"

# T1: HTTP reachability
echo ""
echo "T1: Display-server HTTP reachability"
CODE=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 "${DISPLAY_URL}/" 2>/dev/null)
[ "$CODE" == "200" ] && ok "HTTP 200 from ${DISPLAY_URL}/" || fail "Expected 200, got ${CODE}"

# T2: /api/health valid JSON with status=ok
echo ""
echo "T2: /api/health valid JSON"
HEALTH=$(curl -s --connect-timeout 5 "${DISPLAY_URL}/api/health" 2>/dev/null)
STATUS=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
[ "$STATUS" == "ok" ] && ok "/api/health returned status=ok" || fail "/api/health did not return status=ok (got: ${STATUS})"

# T3: WebSocket client count >= 1
echo ""
echo "T3: WebSocket client connectivity"
WS_CLIENTS=$(echo "$HEALTH" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('displays', {})))" 2>/dev/null || echo "0")
if [ "$WS_CLIENTS" -ge 1 ]; then
    ok "${WS_CLIENTS} WebSocket client(s) connected to display-server"
elif [ "$WS_CLIENTS" -eq 0 ]; then
    fail "0 WebSocket clients connected — kiosk WS is BROKEN (TV is showing blank/frozen screen)"
else
    fail "Could not determine WS client count"
fi

# T4: /api/state returns non-null
echo ""
echo "T4: /api/state non-null"
STATE=$(curl -s --connect-timeout 5 "${DISPLAY_URL}/api/state" 2>/dev/null)
[ "$STATE" != "null" ] && [ -n "$STATE" ] && ok "/api/state returned non-null state" || fail "/api/state returned null or empty"

# T5: /api/cameras non-empty
echo ""
echo "T5: /api/cameras non-empty"
CAMS=$(curl -s --connect-timeout 5 "${DISPLAY_URL}/api/cameras" 2>/dev/null)
CAM_COUNT=$(echo "$CAMS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else len(d.get('cameras',[])))" 2>/dev/null || echo "0")
[ "$CAM_COUNT" -ge 1 ] && ok "${CAM_COUNT} cameras in config" || warn "No cameras found in /api/cameras"

# T6: /api/config non-empty
echo ""
echo "T6: /api/config non-empty"
CONFIG=$(curl -s --connect-timeout 5 "${DISPLAY_URL}/api/config" 2>/dev/null)
[ -n "$CONFIG" ] && [ "$CONFIG" != "null" ] && ok "/api/config returned data" || warn "/api/config returned empty"

# T7: Chromium process running on host
echo ""
echo "T7: Chromium process alive on host"
CHROM_COUNT=$(ps -C chromium --no-headers 2>/dev/null | wc -l)
[ "$CHROM_COUNT" -ge 1 ] && ok "Chromium running (${CHROM_COUNT} processes)" || fail "Chromium not running on host"

# T8: corner-kiosk systemd active
echo ""
echo "T8: corner-kiosk systemd service active"
KIOSK_STATE=$(systemctl is-active corner-kiosk 2>/dev/null)
[ "$KIOSK_STATE" == "active" ] && ok "corner-kiosk.service is active" || fail "corner-kiosk.service is not active (state: ${KIOSK_STATE})"

# T9: No WS protocol errors in last 5 minutes
echo ""
echo "T9: No WS code=1002 errors in recent journal"
RECENT_ERRORS=$(pct exec 114 -- journalctl -u display-server --since "5 minutes ago" --no-pager 2>/dev/null | grep -c 'code=1002' || echo "0")
if [ "$RECENT_ERRORS" -eq 0 ]; then
    ok "No WebSocket protocol errors (code=1002) in last 5 minutes"
elif [ "$RECENT_ERRORS" -lt 10 ]; then
    warn "${RECENT_ERRORS} WS code=1002 errors in last 5 min (kiosk may be reconnecting)"
else
    fail "${RECENT_ERRORS} WS code=1002 errors in last 5 min — kiosk WS is stuck in reconnect loop"
fi

# T10: kiosk-watchdog cron installed
echo ""
echo "T10: kiosk-watchdog cron installed"
CRON_CHECK=$(crontab -l 2>/dev/null | grep -c 'kiosk-watchdog')
[ "$CRON_CHECK" -ge 1 ] && ok "kiosk-watchdog found in crontab" || fail "kiosk-watchdog NOT in crontab — nanny script not running!"

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════"
echo " Results: ${PASS} passed, ${FAIL} failed, ${WARN} warnings"
echo "════════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
    echo " ❌ UNHEALTHY — kiosk has failures, run:"
    echo "    systemctl restart corner-kiosk"
    exit 1
elif [ "$WARN" -gt 0 ]; then
    echo " ⚠️  DEGRADED — warnings present, monitor"
    exit 2
else
    echo " ✅ HEALTHY — all checks passed"
    exit 0
fi
