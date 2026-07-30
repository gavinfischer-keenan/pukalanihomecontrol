#!/usr/bin/env bash
set -euo pipefail

HD_RADIO_DISABLED=true
FAIL_COUNTER_FILE="/tmp/sdr-watchdog-failures"
HA_TOKEN_FILE="/opt/hawaii-tracker/secrets/ha_token"

LOG() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

get_failures() {
  if [ -f "$FAIL_COUNTER_FILE" ]; then
    cat "$FAIL_COUNTER_FILE"
  else
    echo "0"
  fi
}

set_failures() {
  echo "$1" > "$FAIL_COUNTER_FILE"
}

notify_ha() {
  local title="$1" msg="$2" severity="${3:-warning}"
  if [ -f "$HA_TOKEN_FILE" ]; then
    local token=$(cat "$HA_TOKEN_FILE")
    curl -s -X POST "http://192.168.1.19:8123/api/services/persistent_notification/create" \
      -H "Authorization: Bearer $token" \
      -H "Content-Type: application/json" \
      -d "{\"title\":\"SDR Scheduler [$severity]\",\"message\":\"$msg\",\"notification_id\":\"sdr_scheduler\"}" \
      >/dev/null 2>&1
  fi
}

start_ais() {
  LOG "Starting AIS"
  modprobe -r dvb_usb_rtl28xxu dvb_usb_v2 rtl2832_sdr rtl2832 2>/dev/null || true
  sleep 1
  systemctl reset-failed rtl-tcp-ais 2>/dev/null || true
  if ! systemctl start rtl-tcp-ais; then
    LOG "WARNING: rtl-tcp-ais failed to start — retrying in 30s"
    sleep 30
    systemctl reset-failed rtl-tcp-ais 2>/dev/null || true
    systemctl start rtl-tcp-ais || LOG "ERROR: rtl-tcp-ais still failing"
  fi
  sleep 4
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

usb_hard_reset() {
  LOG "Performing USB hard reset..."
  stop_ais
  killall -9 rtl_tcp 2>/dev/null || true
  
  for dev in /sys/bus/usb/devices/*; do
    if [ -f "$dev/serial" ] && grep -q '00000001' "$dev/serial"; then
      bus_id=$(basename "$dev")
      LOG "Unbinding/binding $bus_id"
      echo "$bus_id" > /sys/bus/usb/drivers/usb/unbind 2>/dev/null || true
      sleep 2
      echo "$bus_id" > /sys/bus/usb/drivers/usb/bind 2>/dev/null || true
      break
    fi
  done
  
  python3 -c "import fcntl, os, subprocess; [fcntl.ioctl(os.open(f'/dev/bus/usb/{l.split()[1]}/{l.split()[3].rstrip(chr(58))}', os.O_WRONLY), 0x5514) or os.close(os.open(f'/dev/bus/usb/{l.split()[1]}/{l.split()[3].rstrip(chr(58))}', os.O_WRONLY)) for l in subprocess.run(['lsusb'], capture_output=True, text=True).stdout.splitlines() if '0bda:2838' in l]" || true
  
  sleep 5
  start_ais
}

verify_success() {
  LOG "Waiting 60s to verify success..."
  sleep 60
  if systemctl is-active --quiet rtl-tcp-ais; then
    zero_count=$(pct exec 106 -- journalctl -u ais-catcher --no-pager -n 1 2>/dev/null | grep -c 'received: 0' || echo "0")
    if [ "$zero_count" -eq 0 ]; then
      LOG "Success verified, resetting failure counter"
      set_failures 0
      return 0
    fi
  fi
  LOG "Verification failed, messages not flowing"
  return 1
}

[[ -f /opt/sdr-scheduler/config.env ]] && source /opt/sdr-scheduler/config.env

LOG "SDR Scheduler starting — AIS continuous mode (HD Radio disabled)"
mkdir -p /opt/sdr-data/lots

start_ais
set_failures 0

while true; do
  sleep 300

  restart_needed=false
  reason=""

  if ! systemctl is-active --quiet rtl-tcp-ais; then
    restart_needed=true
    reason="rtl-tcp-ais not running"
  fi

  if ! $restart_needed; then
    zero_count=$(pct exec 106 -- journalctl -u ais-catcher --no-pager -n 5 2>/dev/null | grep -c 'received: 0' || echo "0")
    if [ "$zero_count" -ge 5 ] 2>/dev/null; then
      restart_needed=true
      reason="ais-catcher: 0 msgs for 5+ consecutive minutes"
    fi
  fi

  if $restart_needed; then
    failures=$(get_failures)
    failures=$((failures + 1))
    set_failures "$failures"
    LOG "WATCHDOG: $reason — Failure count: $failures"
    
    if [ "$failures" -lt 3 ]; then
      LOG "Escalation L1: Normal restart"
      pct exec 106 -- systemctl stop ais-catcher 2>/dev/null || true
      systemctl stop rtl-tcp-ais || true
      sleep 2
      modprobe -r dvb_usb_rtl28xxu dvb_usb_v2 rtl2832_sdr rtl2832 2>/dev/null || true
      sleep 2
      start_ais
    elif [ "$failures" -lt 5 ]; then
      LOG "Escalation L2: USB hard reset"
      notify_ha "USB Reset" "SDR Watchdog triggered USB hard reset for reason: $reason" "warning"
      usb_hard_reset
    else
      LOG "Escalation L3: Critical"
      notify_ha "Critical Failure" "5+ consecutive failures. Physical replug may be needed." "critical"
      set_failures 3
      usb_hard_reset
    fi
    verify_success || true
  else
    set_failures 0
  fi
done
