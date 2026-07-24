#!/usr/bin/env bash
# /opt/sdr-scheduler/sdr-scheduler.sh
# Proxmox host — SDR dedicated to AIS (continuous).
# HD Radio time-share commented out — re-enable for Berkeley CA deployment.
# Runs as a systemd service.

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
HD_RADIO_DISABLED=true

LOG() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# ── AIS functions ─────────────────────────────────────────────────────────────
start_ais() {
  LOG "Starting AIS"
  # Evict DVB driver — it may re-bind after USB events.
  modprobe -r dvb_usb_rtl28xxu dvb_usb_v2 rtl2832_sdr rtl2832 2>/dev/null || true
  sleep 1
  # rtl_tcp exits with code 1 on SIGTERM; reset failed state before start.
  systemctl reset-failed rtl-tcp-ais 2>/dev/null || true
  if ! systemctl start rtl-tcp-ais; then
    LOG "WARNING: rtl-tcp-ais failed to start — retrying in 30s"
    sleep 30
    systemctl reset-failed rtl-tcp-ais 2>/dev/null || true
    systemctl start rtl-tcp-ais || LOG "ERROR: rtl-tcp-ais still failing"
  fi
  sleep 4
  # Always RESTART so ais-catcher reconnects to the fresh rtl-tcp-ais instance.
  pct exec 106 -- systemctl restart ais-catcher 2>/dev/null || true
  LOG "AIS active"
}

stop_ais() {
  LOG "Stopping AIS"
  systemctl stop rtl-tcp-ais || true
  sleep 2
  modprobe -r dvb_usb_rtl28xxu dvb_usb_v2 rtl2832_sdr rtl2832 2>/dev/null || true
  pct exec 106 -- systemctl stop ais-catcher 2>/dev/null || true
  sleep 1
  LOG "AIS stopped"
}

# ── Source config overrides ───────────────────────────────────────────────────
[[ -f /opt/sdr-scheduler/config.env ]] && source /opt/sdr-scheduler/config.env

# ── Main loop ─────────────────────────────────────────────────────────────────
LOG "SDR Scheduler starting — AIS continuous mode (HD Radio disabled)"
mkdir -p /opt/sdr-data/lots

start_ais

# AIS runs continuously. Watchdog checks every 5 minutes:
#   1. Is rtl-tcp-ais process alive?
#   2. Is ais-catcher actually receiving messages?
# If either fails, full restart with USB driver reset.
while true; do
  sleep 300

  restart_needed=false
  reason=""

  # Check 1: is rtl-tcp-ais running?
  if ! systemctl is-active --quiet rtl-tcp-ais; then
    restart_needed=true
    reason="rtl-tcp-ais not running"
  fi

  # Check 2: is ais-catcher actually receiving data?
  if ! $restart_needed; then
    # Count how many of the last 5 log lines show "received: 0"
    zero_count=$(pct exec 106 -- journalctl -u ais-catcher --no-pager -n 5 2>/dev/null | grep -c 'received: 0' || echo "0")
    if [ "$zero_count" -ge 5 ] 2>/dev/null; then
      restart_needed=true
      reason="ais-catcher: 0 msgs for 5+ consecutive minutes"
    fi
  fi

  if $restart_needed; then
    LOG "WATCHDOG: $reason — full restart with USB reset"
    pct exec 106 -- systemctl stop ais-catcher 2>/dev/null || true
    systemctl stop rtl-tcp-ais || true
    sleep 2
    # USB driver reset to clear any dongle lockup
    modprobe -r dvb_usb_rtl28xxu dvb_usb_v2 rtl2832_sdr rtl2832 2>/dev/null || true
    sleep 2
    start_ais
  fi
done
