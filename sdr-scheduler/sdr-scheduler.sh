#!/usr/bin/env bash
# /opt/sdr-scheduler/sdr-scheduler.sh
# Proxmox host — SDR dedicated to AIS (continuous).
# HD Radio time-share commented out — re-enable for Berkeley CA deployment.
# Runs as a systemd service.

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
# HD_RADIO_DISABLED: Hawaii stations carry no useful data services.
# Uncomment the HD Radio block below and set HD_RADIO_DISABLED=false to
# re-enable time-sharing for a market that carries traffic/weather/gas (e.g. Berkeley CA).
HD_RADIO_DISABLED=true

# HD Radio config (kept for future use — uncomment to activate)
# AIS_DURATION=${AIS_DURATION:-900}      # 15 min AIS window
# HD_DURATION=${HD_DURATION:-1800}       # 30 min HD Radio window
# DWELL=${DWELL:-90}                     # seconds per station
# STATIONS=(88.1 89.3 93.9 95.5 98.5 101.9 103.7 104.3 105.1)
# PARSER=/opt/sdr-scheduler/nrsc5-parser.py
# API_URL=http://192.168.1.114:3011

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
  # Use pct exec (not SSH) — CT 106 key auth is not configured on Proxmox host.
  # Always RESTART (not start) so ais-catcher reconnects to the fresh rtl-tcp-ais instance.
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

# ── HD Radio functions (DISABLED for Hawaii — enable for Berkeley CA) ─────────
#
# push_status() {
#   local mode="$1" detail="${2:-}"
#   curl -sf -X POST "$API_URL/ingest" \
#     -H 'Content-Type: application/json' \
#     -d "{\"type\":\"scheduler_mode\",\"mode\":\"$mode\",\"detail\":\"$detail\",\"ts\":\"$(date -u +%FT%TZ)\"}" \
#     >/dev/null 2>&1 || true
# }
#
# run_hd_session() {
#   local duration="$1"
#   LOG "HD Radio session starting — ${duration}s total, ${#STATIONS[@]} stations @ ${DWELL}s each"
#   push_status "HD" "starting"
#   local elapsed=0
#   while (( elapsed < duration )); do
#     for freq in "${STATIONS[@]}"; do
#       (( elapsed >= duration )) && break
#       local this_dwell=$DWELL
#       local remaining=$(( duration - elapsed ))
#       (( this_dwell > remaining )) && this_dwell=$remaining
#       LOG "Tuning $freq MHz for ${this_dwell}s"
#       push_status "HD" "$freq MHz"
#       NRSC5_API_URL="$API_URL/ingest" \
#       LOT_DIR=/opt/sdr-data/lots \
#         python3 "$PARSER" "$freq" "$this_dwell" 2>&1 | \
#         sed "s/^/[$freq MHz] /" || true
#       elapsed=$(( elapsed + this_dwell ))
#     done
#   done
#   LOG "HD Radio session complete (${elapsed}s)"
# }

# ── Source config overrides ───────────────────────────────────────────────────
[[ -f /opt/sdr-scheduler/config.env ]] && source /opt/sdr-scheduler/config.env

# ── Main loop ─────────────────────────────────────────────────────────────────
LOG "SDR Scheduler starting — AIS continuous mode (HD Radio disabled)"
mkdir -p /opt/sdr-data/lots

start_ais

# AIS runs continuously. SDR is fully dedicated to vessel tracking.
# To re-enable HD Radio time-sharing, uncomment the HD Radio block above
# and replace this loop with the AIS→HD→AIS cycle:
#   while true; do
#     LOG "AIS window — ${AIS_DURATION}s"
#     sleep "$AIS_DURATION"
#     stop_ais
#     run_hd_session "$HD_DURATION"
#     start_ais
#   done
while true; do
  sleep 300
  # Watchdog: ensure ais-catcher is still receiving data.
  # If rtl-tcp-ais died (exit code 1 on a glitch), restart both.
  if ! systemctl is-active --quiet rtl-tcp-ais; then
    LOG "WATCHDOG: rtl-tcp-ais not running — restarting AIS stack"
    start_ais
  fi
done
