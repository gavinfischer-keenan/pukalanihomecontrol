#!/usr/bin/env bash
# /opt/hawaii-nanny/network-recovery.sh
# Network topology change detection and auto-recovery.
# Runs via systemd timer every 2 minutes on Proxmox host.
#
# RESILIENCE: Auto-detects gateway from routing table. If a new router is
# connected with a different gateway IP or subnet, this script adapts
# automatically. Container checks use pct exec (not IP ping) as fallback
# when IPs may have shifted.

set -uo pipefail

LOGFILE="/var/log/network-recovery.log"
STATE_DIR="/tmp/hawaii-nanny"
mkdir -p "$STATE_DIR"

LOG() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOGFILE"; }

# ── Gateway & Subnet Auto-Detection ─────────────────────────────────────────
detect_gateway() {
  local gw
  gw=$(ip route 2>/dev/null | awk '/default/ {print $3; exit}')
  echo "${gw:-}"
}

detect_subnet() {
  # Returns subnet prefix like "192.168.1" from the host's IP on vmbr0
  ip -4 addr show vmbr0 2>/dev/null | awk '/inet / {print $2}' | cut -d'/' -f1 | awk -F. '{print $1"."$2"."$3}'
}

GATEWAY=$(detect_gateway)
SUBNET=$(detect_subnet)

# Check for subnet change (new router scenario)
PREV_SUBNET=$(cat "$STATE_DIR/subnet" 2>/dev/null || echo "")
if [ -n "$SUBNET" ] && [ -n "$PREV_SUBNET" ] && [ "$SUBNET" != "$PREV_SUBNET" ]; then
  LOG "!!! SUBNET CHANGED: $PREV_SUBNET -> $SUBNET (new router detected?)"
  LOG "!!! Container static IPs may need reconfiguration!"
  LOG "!!! Run: /opt/hawaii-nanny/subnet-migrate.sh $PREV_SUBNET $SUBNET"
  notify_ha "Subnet Changed!" "Network subnet changed from $PREV_SUBNET to $SUBNET. Container IPs may need reconfiguration. Run subnet-migrate.sh" "critical"
fi
[ -n "$SUBNET" ] && echo "$SUBNET" > "$STATE_DIR/subnet"

# ── HA Notification ──────────────────────────────────────────────────────────
notify_ha() {
  local title="$1" msg="$2" level="${3:-warning}"
  local HA_TOKEN_FILE="/opt/hawaii-tracker/secrets/ha_token"
  if [ -f "$HA_TOKEN_FILE" ]; then
    local token=$(cat "$HA_TOKEN_FILE")
    curl -s -o /dev/null -X POST "http://192.168.1.19:8123/api/services/persistent_notification/create" \
      -H "Authorization: Bearer $token" \
      -H "Content-Type: application/json" \
      -d "{\"notification_id\":\"hawaii_nanny_$(date +%s)\",\"title\":\"[Hawaii] $title\",\"message\":\"$msg\"}" \
      2>/dev/null || true
  fi
}

# ── Check 1: Gateway ────────────────────────────────────────────────────────
check_gateway() {
  if [ -z "$GATEWAY" ]; then
    LOG "FAIL: No default gateway detected — network not configured"
    echo "down" > "$STATE_DIR/gateway"
    return 1
  fi

  if ! ping -c1 -W3 "$GATEWAY" &>/dev/null; then
    LOG "FAIL: Gateway $GATEWAY unreachable"
    local prev_state=$(cat "$STATE_DIR/gateway" 2>/dev/null || echo "up")
    echo "down" > "$STATE_DIR/gateway"
    if [ "$prev_state" = "up" ]; then
      LOG "ALERT: Gateway just went down — network disruption detected"
    fi
    return 1
  else
    local prev_state=$(cat "$STATE_DIR/gateway" 2>/dev/null || echo "up")
    echo "up" > "$STATE_DIR/gateway"
    echo "$GATEWAY" > "$STATE_DIR/gateway_ip"
    if [ "$prev_state" = "down" ]; then
      LOG "RECOVERED: Gateway $GATEWAY back online — running full recovery"
      run_full_recovery
    fi
    return 0
  fi
}

# ── Check 2: DNS ─────────────────────────────────────────────────────────────
check_dns() {
  if ! host github.com &>/dev/null && ! host google.com &>/dev/null; then
    LOG "FAIL: DNS resolution failing"
    systemctl restart systemd-resolved 2>/dev/null || true
    sleep 2
    if host google.com &>/dev/null; then
      LOG "FIXED: DNS restored after systemd-resolved restart"
    else
      LOG "WARN: DNS still failing after restart"
    fi
    return 1
  fi
  return 0
}

# ── Check 3: Container Connectivity ──────────────────────────────────────────
# Uses pct exec as primary check (works regardless of IP/subnet changes)
check_containers() {
  local failed=0
  for ct in 102 104 105 106 108 109 110 114 115; do
    # Check if container is running at all
    if ! pct status "$ct" 2>/dev/null | grep -q 'running'; then
      LOG "FAIL: CT$ct not running — attempting start"
      pct start "$ct" 2>/dev/null || true
      sleep 5
      if pct status "$ct" 2>/dev/null | grep -q 'running'; then
        LOG "FIXED: CT$ct started"
      else
        LOG "WARN: CT$ct failed to start"
        failed=$((failed + 1))
      fi
      continue
    fi

    # Check if container can reach gateway (proves networking works)
    if [ -n "$GATEWAY" ]; then
      if ! pct exec "$ct" -- ping -c1 -W2 "$GATEWAY" &>/dev/null 2>&1; then
        LOG "FAIL: CT$ct cannot reach gateway $GATEWAY"
        pct exec "$ct" -- systemctl restart systemd-networkd 2>/dev/null || true
        sleep 2
        if pct exec "$ct" -- ping -c1 -W2 "$GATEWAY" &>/dev/null 2>&1; then
          LOG "FIXED: CT$ct networking restored"
        else
          LOG "WARN: CT$ct still cannot reach gateway"
          failed=$((failed + 1))
        fi
      fi
    fi
  done
  return $failed
}

# ── Check 4: Critical Service Health ─────────────────────────────────────────
check_services() {
  # Dashboard API (CT108)
  local dash_health=$(curl -s -m5 http://192.168.1.108:3001/api/health 2>/dev/null)
  if [ -z "$dash_health" ]; then
    LOG "FAIL: Dashboard API unresponsive — restarting"
    pct exec 108 -- pm2 restart all 2>/dev/null || true
  fi

  # CT105 services
  for svc in ais-collector adsb-collector tracker-engine; do
    if ! pct exec 105 -- systemctl is-active --quiet "$svc" 2>/dev/null; then
      LOG "FAIL: $svc not running — restarting"
      pct exec 105 -- systemctl restart "$svc" 2>/dev/null || true
    fi
  done

  # CT115 Expense Tracker
  if pct status 115 2>/dev/null | grep -q 'running'; then
    if ! pct exec 115 -- pm2 pid expense-api >/dev/null 2>&1; then
      LOG "FAIL: CT115 expense-api not running — restarting"
      pct exec 115 -- pm2 resurrect 2>/dev/null || \
        pct exec 115 -- bash -c 'cd /opt/expense-tracker && pm2 start server.js --name expense-api' 2>/dev/null || true
    fi
  fi

  # Corner kiosk (dual HDMI display)
  if ! systemctl is-active --quiet corner-kiosk 2>/dev/null; then
    LOG "FAIL: corner-kiosk not running — restarting"
    systemctl restart corner-kiosk 2>/dev/null || true
  elif ! pgrep -f 'chromium-corner-data' >/dev/null 2>&1; then
    LOG "FAIL: Corner monitor browser missing — full kiosk restart"
    systemctl restart corner-kiosk 2>/dev/null || true
  fi

  # Display server (CT114) — use /api/reload for browser refresh
  if ! pct exec 114 -- systemctl is-active --quiet display-server 2>/dev/null; then
    LOG "FAIL: display-server not running — restarting"
    pct exec 114 -- systemctl restart display-server 2>/dev/null || true
    sleep 3
    curl -s -X POST http://192.168.1.114:3000/api/reload >/dev/null 2>&1 || true
    LOG "Sent reload to kiosk browsers after display-server recovery"
  fi
}

# ── Check 5: USB Device Audit ────────────────────────────────────────────────
check_usb() {
  local blog_v4_found=false adsb_found=false
  for serial_file in /sys/bus/usb/devices/*/serial; do
    local ser=$(cat "$serial_file" 2>/dev/null)
    [ "$ser" = "00000001" ] && blog_v4_found=true
    [ "$ser" = "00000010" ] && adsb_found=true
  done

  if ! $blog_v4_found; then
    local prev=$(cat "$STATE_DIR/usb_blog_v4" 2>/dev/null || echo "present")
    echo "missing" > "$STATE_DIR/usb_blog_v4"
    [ "$prev" = "present" ] && LOG "ALERT: RTL-SDR Blog V4 (AIS) dongle MISSING" && \
      notify_ha "USB Device Missing" "RTL-SDR Blog V4 (AIS) not detected. Check physical connection." "critical"
  else
    local prev=$(cat "$STATE_DIR/usb_blog_v4" 2>/dev/null || echo "present")
    echo "present" > "$STATE_DIR/usb_blog_v4"
    [ "$prev" = "missing" ] && LOG "RECOVERED: RTL-SDR Blog V4 reappeared"
  fi

  if ! $adsb_found; then
    local prev=$(cat "$STATE_DIR/usb_adsb" 2>/dev/null || echo "present")
    echo "missing" > "$STATE_DIR/usb_adsb"
    [ "$prev" = "present" ] && LOG "ALERT: AIRNAV ADS-B dongle MISSING" && \
      notify_ha "USB Device Missing" "AIRNAV ADS-B not detected. Check physical connection." "critical"
  else
    local prev=$(cat "$STATE_DIR/usb_adsb" 2>/dev/null || echo "present")
    echo "present" > "$STATE_DIR/usb_adsb"
    [ "$prev" = "missing" ] && LOG "RECOVERED: AIRNAV ADS-B reappeared"
  fi
}

# ── Full Recovery (after gateway comes back) ─────────────────────────────────
run_full_recovery() {
  LOG "=== FULL RECOVERY: Network topology change detected (gateway: $GATEWAY, subnet: $SUBNET) ==="
  notify_ha "Network Recovery" "Gateway $GATEWAY back online (subnet: $SUBNET). Running full system recovery..." "warning"

  check_containers
  LOG "Restarting network-dependent services..."

  pct exec 105 -- systemctl restart ais-collector 2>/dev/null || true
  pct exec 105 -- systemctl restart adsb-collector 2>/dev/null || true
  systemctl restart sdr-scheduler 2>/dev/null || true
  pct exec 108 -- pm2 restart all 2>/dev/null || true

  # Expense tracker
  pct exec 115 -- pm2 resurrect 2>/dev/null || true

  # Display system — server then kiosk with proper sequencing
  pct exec 114 -- systemctl restart display-server 2>/dev/null || true
  sleep 5
  systemctl restart corner-kiosk 2>/dev/null || true
  sleep 8
  curl -s -X POST http://192.168.1.114:3000/api/reload >/dev/null 2>&1 || true

  check_usb

  sleep 10
  local health=$(curl -s -m5 http://192.168.1.108:3001/api/health 2>/dev/null)
  LOG "Post-recovery health: $health"
  notify_ha "Network Recovery Complete" "System recovery finished. Gateway: $GATEWAY, Subnet: $SUBNET" "info"
  LOG "=== FULL RECOVERY COMPLETE ==="
}

# ── Main ─────────────────────────────────────────────────────────────────────
check_gateway || exit 0
check_dns
check_containers
check_services
check_usb
