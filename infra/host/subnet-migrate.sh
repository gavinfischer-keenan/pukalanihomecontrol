#!/usr/bin/env bash
# /opt/hawaii-nanny/subnet-migrate.sh
# Reconfigures all container static IPs when the network subnet changes.
# Usage: subnet-migrate.sh <old-prefix> <new-prefix>
# Example: subnet-migrate.sh 192.168.1 192.168.0
#
# This script is designed for the "new router" scenario — a future owner
# connects a different router with a different subnet, and all container
# static IPs need to shift to match.
#
# What it does:
# 1. Updates Proxmox LXC network config for each static-IP container
# 2. Updates service config files that reference old IPs
# 3. Restarts affected containers
# 4. Logs everything
#
# What it does NOT do:
# - Change DHCP containers (CT112, CT115) — they auto-adapt
# - Change the Proxmox host IP — do that manually first

set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Usage: $0 <old-subnet-prefix> <new-subnet-prefix>"
  echo "Example: $0 192.168.1 192.168.0"
  exit 1
fi

OLD="$1"
NEW="$2"
LOG="/var/log/subnet-migrate.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

log "=========================================="
log "SUBNET MIGRATION: $OLD → $NEW"
log "=========================================="

# Safety check
read -p "This will reconfigure all container IPs from $OLD.x to $NEW.x. Continue? [y/N] " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
  echo "Aborted."
  exit 0
fi

# ── Static IP containers and their host portions ──
declare -A CONTAINERS=(
  [102]=102   # tar1090
  [104]=104   # PostgreSQL
  [105]=105   # tracker-engine, collectors
  [106]=106   # ais-catcher
  [108]=108   # Dashboard
  [109]=109   # (misc)
  [110]=110   # (misc)
  [114]=114   # Display server
)

# ── 1. Update Proxmox LXC configs ──
log "--- Updating LXC configs ---"
for ct in "${!CONTAINERS[@]}"; do
  host="${CONTAINERS[$ct]}"
  conf="/etc/pve/lxc/$ct.conf"
  if [ -f "$conf" ] && grep -q "$OLD" "$conf"; then
    log "CT$ct: Updating $OLD.$host → $NEW.$host"
    sed -i "s|$OLD\.|$NEW.|g" "$conf"
  else
    log "CT$ct: No changes needed (or config not found)"
  fi
done

# ── 2. Update service configs inside containers ──
log "--- Updating service configs ---"

# CT105: tracker-engine, ais-collector, adsb-collector configs
for f in /opt/hawaii-tracker/config.json /opt/hawaii-tracker/.env /etc/systemd/system/ais-collector.service /etc/systemd/system/adsb-collector.service /etc/systemd/system/tracker-engine.service; do
  pct exec 105 -- bash -c "[ -f '$f' ] && sed -i 's|$OLD\.|$NEW.|g' '$f' && echo 'Updated $f'" 2>/dev/null || true
done

# CT106: ais-catcher service
pct exec 106 -- bash -c "sed -i 's|$OLD\.|$NEW.|g' /etc/systemd/system/ais-catcher.service 2>/dev/null" || true

# CT108: Dashboard .env and config
pct exec 108 -- bash -c "for f in /opt/dashboard/.env /opt/dashboard/server/.env /opt/dashboard/server/config.js; do [ -f \"\$f\" ] && sed -i 's|$OLD\.|$NEW.|g' \"\$f\" && echo 'Updated \$f'; done" 2>/dev/null || true

# CT114: Display server config
pct exec 114 -- bash -c "for f in /opt/display-server/cameras.json /opt/display-server/server.js /opt/display-server/src/displayConfig.js; do [ -f \"\$f\" ] && sed -i 's|$OLD\.|$NEW.|g' \"\$f\" && echo 'Updated \$f'; done" 2>/dev/null || true

# Host: recovery scripts, watchdog, kiosk
for f in /opt/hawaii-nanny/network-recovery.sh /opt/service-watchdog.sh /opt/corner-kiosk/start-kiosk.sh /opt/corner-kiosk/hdmi-watchdog.sh /opt/sdr-scheduler/sdr-scheduler.sh; do
  if [ -f "$f" ] && grep -q "$OLD" "$f"; then
    sed -i "s|$OLD\.|$NEW.|g" "$f"
    log "Host: Updated $f"
  fi
done

# Host: rtl-tcp service
if [ -f /etc/systemd/system/rtl-tcp-ais.service ] && grep -q "$OLD" /etc/systemd/system/rtl-tcp-ais.service; then
  sed -i "s|$OLD\.|$NEW.|g" /etc/systemd/system/rtl-tcp-ais.service
  log "Host: Updated rtl-tcp-ais.service"
fi

# ── 3. Rebuild display server (has hardcoded URLs) ──
log "--- Rebuilding display server ---"
pct exec 114 -- bash -c 'cd /opt/display-server && npx vite build 2>&1 | tail -3' || true

# ── 4. Restart everything ──
log "--- Restarting containers ---"
for ct in "${!CONTAINERS[@]}"; do
  log "Restarting CT$ct..."
  pct reboot "$ct" 2>/dev/null || true
  sleep 3
done

# Reload systemd on host
systemctl daemon-reload

# Restart host services
systemctl restart sdr-scheduler corner-kiosk hdmi-watchdog 2>/dev/null || true

log "=========================================="
log "SUBNET MIGRATION COMPLETE: $OLD → $NEW"
log "Verify: ping $NEW.108 (dashboard), curl http://$NEW.114:3000/api/health (display)"
log "=========================================="
