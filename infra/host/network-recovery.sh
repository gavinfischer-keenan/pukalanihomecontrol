#!/usr/bin/env bash
# /opt/hawaii-nanny/network-recovery.sh
# Network topology change detection and auto-recovery.
# Runs via systemd timer every 2 minutes on Proxmox host.

set -uo pipefail

LOGFILE="/var/log/network-recovery.log"
STATE_DIR="/tmp/hawaii-nanny"
mkdir -p "$STATE_DIR"

LOG() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOGFILE"; }

# ── HA Notification ──────────────────────────────────────────────────────────
notify_ha() {
  local title="$1" msg="$2" level="${3:-warning}"
  local HA_TOKEN_FILE="/opt/hawaii-tracker/secrets/ha_token"
  if [ -f "$HA_TOKEN_FILE" ]; then
    local token=$(cat "$HA_TOKEN_FILE")
    curl -s -o /dev/null -X POST "http://192.168.1.19:8123/api/services/persistent_notification/create" \
      -H "Authorization: Bearer $token" \
      -H "Content-Type: application/json" \
      -d "{\"title\":\"Network Nanny [$level]\",\"message\":\"$msg\",\"notification_id\":\"nanny_${level}_$(date +%s)\"}" 2>/dev/null || true
  fi
  LOG "NOTIFY [$level]: $title — $msg"
}

# ── Check 1: Gateway ─────────────────────────────────────────────────────────
check_gateway() {
  if ! ping -c1 -W3 192.168.1.1 &>/dev/null; then
    LOG "FAIL: Gateway 192.168.1.1 unreachable"
    # Network is down — no point checking anything else
    local prev_state=$(cat "$STATE_DIR/gateway" 2>/dev/null || echo "up")
    echo "down" > "$STATE_DIR/gateway"
    if [ "$prev_state" = "up" ]; then
      LOG "ALERT: Gateway just went down — network disruption detected"
    fi
    return 1
  else
    local prev_state=$(cat "$STATE_DIR/gateway" 2>/dev/null || echo "up")
    echo "up" > "$STATE_DIR/gateway"
    if [ "$prev_state" = "down" ]; then
      LOG "RECOVERED: Gateway back online — running full recovery"
      run_full_recovery
    fi
    return 0
  fi
}

# ── Check 2: DNS ─────────────────────────────────────────────────────────────
check_dns() {
  if ! host github.com &>/dev/null && ! host google.com &>/dev/null; then
    LOG "FAIL: DNS resolution failing"
    # Try restarting systemd-resolved on host
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
check_containers() {
  local failed=0
  # Note: CT112 and CT115 use DHCP — check via pct exec instead of ping
  for ct_ip in "102:192.168.1.102" "104:192.168.1.104" "105:192.168.1.105" \
               "106:192.168.1.106" "108:192.168.1.108" "109:192.168.1.109" \
               "110:192.168.1.110" "114:192.168.1.114"; do
    local ct="${ct_ip%%:*}" ip="${ct_ip##*:}"
    if ! ping -c1 -W2 "$ip" &>/dev/null; then
      LOG "FAIL: CT$ct ($ip) unreachable"
      # Try restarting networking inside the container
      pct exec "$ct" -- systemctl restart systemd-networkd 2>/dev/null || true
      sleep 2
      if ping -c1 -W2 "$ip" &>/dev/null; then
        LOG "FIXED: CT$ct networking restored"
      else
        LOG "WARN: CT$ct still unreachable after networkd restart"
        failed=$((failed + 1))
      fi
    fi
  done
  # DHCP containers — check via pct exec ping to gateway
  for ct in 112 115; do
    if ! pct exec "$ct" -- ping -c1 -W2 192.168.1.1 &>/dev/null; then
      LOG "FAIL: CT$ct (DHCP) cannot reach gateway"
      pct exec "$ct" -- systemctl restart systemd-networkd 2>/dev/null || true
      failed=$((failed + 1))
    fi
  done
  return $failed
}

# ── Check 4: Critical Service Health ─────────────────────────────────────────
check_services() {
  # Dashboard API
  local dash_health=$(curl -s -m5 http://192.168.1.108:3001/api/health 2>/dev/null)
  if [ -z "$dash_health" ]; then
    LOG "FAIL: Dashboard API unresponsive — restarting"
    pct exec 108 -- pm2 restart all 2>/dev/null || true
  fi

  # AIS collector
  if ! pct exec 105 -- systemctl is-active --quiet ais-collector 2>/dev/null; then
    LOG "FAIL: ais-collector not running — restarting"
    pct exec 105 -- systemctl restart ais-collector 2>/dev/null || true
  fi

  # ADS-B collector
  if ! pct exec 105 -- systemctl is-active --quiet adsb-collector 2>/dev/null; then
    LOG "FAIL: adsb-collector not running — restarting"
    pct exec 105 -- systemctl restart adsb-collector 2>/dev/null || true
  fi

  # Tracker engine
  if ! pct exec 105 -- systemctl is-active --quiet tracker-engine 2>/dev/null; then
    LOG "FAIL: tracker-engine not running — restarting"
    pct exec 105 -- systemctl restart tracker-engine 2>/dev/null || true
  fi
}

# ── Check 5: USB Device Audit ────────────────────────────────────────────────
check_usb() {
  # Verify RTL-SDR dongles present (both show as 0bda:2838 — need at least 2)
  local rtl_count=$(lsusb 2>/dev/null | grep -c '0bda:2838')
  
  # Check via sysfs serial numbers for precise identification
  local blog_v4_found=false adsb_found=false
  for serial_file in /sys/bus/usb/devices/*/serial; do
    local ser=$(cat "$serial_file" 2>/dev/null)
    [ "$ser" = "00000001" ] && blog_v4_found=true
    [ "$ser" = "00000010" ] && adsb_found=true
  done

  if ! $blog_v4_found; then
    local prev=$(cat "$STATE_DIR/usb_blog_v4" 2>/dev/null || echo "present")
    echo "missing" > "$STATE_DIR/usb_blog_v4"
    if [ "$prev" = "present" ]; then
      LOG "ALERT: RTL-SDR Blog V4 (AIS) dongle MISSING from USB bus"
      notify_ha "USB Device Missing" "RTL-SDR Blog V4 (AIS) dongle not detected on USB bus. Check physical connection." "critical"
    fi
  else
    local prev=$(cat "$STATE_DIR/usb_blog_v4" 2>/dev/null || echo "present")
    echo "present" > "$STATE_DIR/usb_blog_v4"
    if [ "$prev" = "missing" ]; then
      LOG "RECOVERED: RTL-SDR Blog V4 reappeared on USB bus"
    fi
  fi

  if ! $adsb_found; then
    local prev=$(cat "$STATE_DIR/usb_adsb" 2>/dev/null || echo "present")
    echo "missing" > "$STATE_DIR/usb_adsb"
    if [ "$prev" = "present" ]; then
      LOG "ALERT: AIRNAV ADS-B dongle MISSING from USB bus"
      notify_ha "USB Device Missing" "AIRNAV ADS-B dongle not detected on USB bus. Check physical connection." "critical"
    fi
  else
    local prev=$(cat "$STATE_DIR/usb_adsb" 2>/dev/null || echo "present")
    echo "present" > "$STATE_DIR/usb_adsb"
    if [ "$prev" = "missing" ]; then
      LOG "RECOVERED: AIRNAV ADS-B dongle reappeared on USB bus"
    fi
  fi
}

# ── Full Recovery (after gateway comes back) ─────────────────────────────────
run_full_recovery() {
  LOG "=== FULL RECOVERY: Network topology change detected ==="
  notify_ha "Network Recovery" "Gateway came back online. Running full system recovery..." "warning"

  # 1. Check all container networking
  check_containers

  # 2. Restart services that depend on network
  LOG "Restarting network-dependent services..."

  # AIS collector (needs AISHub API)
  pct exec 105 -- systemctl restart ais-collector 2>/dev/null || true

  # ADS-B collector (needs tar1090)
  pct exec 105 -- systemctl restart adsb-collector 2>/dev/null || true

  # SDR pipeline
  systemctl restart sdr-scheduler 2>/dev/null || true

  # Dashboard (needs DB)
  pct exec 108 -- pm2 restart all 2>/dev/null || true

  # 3. USB audit
  check_usb

  # 4. Wait and verify
  sleep 10
  local health=$(curl -s -m5 http://192.168.1.108:3001/api/health 2>/dev/null)
  LOG "Post-recovery health: $health"

  notify_ha "Network Recovery Complete" "System recovery finished. Health: $health" "info"
  LOG "=== FULL RECOVERY COMPLETE ==="
}

# ── Main ─────────────────────────────────────────────────────────────────────
check_gateway || exit 0  # If gateway is down, nothing else we can do
check_dns
check_containers
check_services
check_usb
