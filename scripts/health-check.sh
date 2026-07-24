#!/bin/bash
# /opt/hawaii-tracker/scripts/health-check.sh
# Unified health monitor — runs every 5 minutes via cron
# Checks all services, auto-restarts on failure, logs results

LOG=/var/log/health-check.log
FAIL_DIR=/var/run/health-failures
TS=$(date '+%Y-%m-%d %H:%M:%S')
mkdir -p $FAIL_DIR

log() { echo "[$TS] $1" >> $LOG; }
ok()  { log "OK: $1"; rm -f $FAIL_DIR/$2 2>/dev/null; }

fail() {
  local name=$1 msg=$2 fix=$3
  local count=0
  [ -f $FAIL_DIR/$name ] && count=$(cat $FAIL_DIR/$name)
  count=$((count + 1))
  echo $count > $FAIL_DIR/$name
  log "FAIL($count): $msg"
  if [ -n "$fix" ] && [ $count -le 3 ]; then
    log "AUTO-FIX: $fix"
    eval $fix >> $LOG 2>&1
  elif [ $count -gt 3 ]; then
    log "ESCALATE: $msg — $count consecutive failures, manual intervention needed"
  fi
}

log "--- Health check starting ---"

# 1. Check containers are running
for ct in 102 104 105 106 108 109 110 112 113 114; do
  status=$(pct status $ct 2>/dev/null | awk '{print $2}')
  if [ "$status" = "running" ]; then
    ok "CT$ct running" "ct$ct"
  else
    fail "ct$ct" "CT$ct is $status" "pct start $ct"
  fi
done

# Check VM100
vm_status=$(qm status 100 2>/dev/null | awk '{print $2}')
if [ "$vm_status" = "running" ]; then ok "VM100 running" "vm100"
else fail "vm100" "VM100 is $vm_status" "qm start 100"; fi

# 2. Check HTTP services
check_http() {
  local name=$1 url=$2 fix=$3
  local code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 "$url" 2>/dev/null)
  if [ "$code" -ge 200 ] && [ "$code" -lt 400 ]; then
    ok "$name HTTP $code" "http_$name"
  else
    fail "http_$name" "$name returned HTTP $code" "$fix"
  fi
}

check_http "dashboard-api" "http://192.168.1.108:3001/api/health" \
  "pct exec 108 -- pm2 restart hawaii-api"
check_http "dashboard-client" "http://192.168.1.108:8080/" \
  "pct exec 108 -- pm2 restart hawaii-client"
check_http "alerts" "http://192.168.1.109:3009/health" \
  "pct exec 109 -- systemctl restart alerts 2>/dev/null || pct exec 109 -- pm2 restart all"
check_http "display-server" "http://192.168.1.114:3000/" \
  "pct exec 114 -- systemctl restart display-server"
check_http "frigate" "http://192.168.1.113:5000/" \
  "pct exec 113 -- docker restart frigate"
check_http "tar1090" "http://192.168.1.102:80/" \
  "pct exec 102 -- systemctl restart dump1090-fa"
check_http "home-assistant" "http://192.168.1.19:8123/" ""

# 3. Check database
pg_ok=$(pct exec 104 -- pg_isready -h 127.0.0.1 -U tracker 2>/dev/null | grep -c accepting)
if [ "$pg_ok" -ge 1 ]; then ok "PostgreSQL accepting connections" "postgres"
else fail "postgres" "PostgreSQL not accepting connections" "pct exec 104 -- systemctl restart postgresql@17-main"; fi

# 4. Check data freshness
ais_age=$(pct exec 104 -- bash -c "PGPASSWORD=pukalani psql -h 127.0.0.1 -U tracker -d tracking_db -t -c \"SELECT EXTRACT(EPOCH FROM (now() - max(recorded_at)))::int FROM live_tracks WHERE source_type='ais';\"" 2>/dev/null | tr -d ' ')
if [ -n "$ais_age" ] && [ "$ais_age" -lt 300 ] 2>/dev/null; then
  ok "AIS data fresh (${ais_age}s)" "ais_fresh"
else
  fail "ais_fresh" "AIS data stale (${ais_age}s)" "pct exec 105 -- systemctl restart ais-collector"
fi

adsb_age=$(pct exec 104 -- bash -c "PGPASSWORD=pukalani psql -h 127.0.0.1 -U tracker -d tracking_db -t -c \"SELECT EXTRACT(EPOCH FROM (now() - max(recorded_at)))::int FROM live_tracks WHERE source_type='adsb';\"" 2>/dev/null | tr -d ' ')
if [ -n "$adsb_age" ] && [ "$adsb_age" -lt 120 ] 2>/dev/null; then
  ok "ADSB data fresh (${adsb_age}s)" "adsb_fresh"
else
  fail "adsb_fresh" "ADSB data stale (${adsb_age}s)" "pct exec 105 -- systemctl restart adsb-collector"
fi

# 5. Check disk space (host)
host_pct=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
if [ "$host_pct" -lt 85 ]; then ok "Host disk ${host_pct}%" "disk_host"
else fail "disk_host" "Host disk at ${host_pct}%" ""; fi

# 6. Check USB SSD
if lsusb | grep -qi 'JMicron\|YOTUO\|152d'; then ok "USB SSD present" "usb_ssd"
else fail "usb_ssd" "USB SSD not detected!" ""; fi

# 7. Check SDR dongles
rtl_count=$(lsusb | grep -c '0bda:2838')
if [ "$rtl_count" -ge 1 ]; then ok "SDR dongle(s) present ($rtl_count)" "sdr"
else fail "sdr" "No RTL-SDR dongles detected" ""; fi

# 8. Check for NIC hang
nic_hang=$(dmesg | grep -c 'Hardware Unit Hang')
if [ "$nic_hang" -eq 0 ]; then ok "NIC healthy" "nic_hang"
else
  fail "nic_hang" "NIC Hardware Hang detected ($nic_hang occurrences)" \
    "ip link set nic0 down; sleep 2; ip link set nic0 up"
fi


# 9. AIS receiver health (cross-check with AISHub)
ais_health=$(pct exec 105 -- cat /tmp/ais-receiver-health 2>/dev/null)
if [ -z "$ais_health" ]; then
  ok "AIS receiver healthy (cross-check)" "ais_hw"
else
  fail "ais_hw" "AIS receiver issue: $ais_health" ""
fi

log "--- Health check complete ---"

# 9. AIS receiver health (cross-check with AISHub)
ais_health=$(pct exec 105 -- cat /tmp/ais-receiver-health 2>/dev/null)
if [ -z "$ais_health" ]; then
  ok "AIS receiver cross-check OK" "ais_hw"
else
  fail "ais_hw" "AIS receiver: $ais_health" ""
fi

# 10. AIS radio pipeline — check rtl_tcp + AIS-catcher producing data
ais_msgs=$(pct exec 106 -- journalctl -u ais-catcher --no-pager -n 1 2>/dev/null | grep -oP 'received: \K[0-9]+')
if [ -n "$ais_msgs" ] && [ "$ais_msgs" -gt 0 ] 2>/dev/null; then
  ok "AIS radio receiving ($ais_msgs msgs/min)" "ais_radio"
else
  # Check how many consecutive zero-message minutes
  fail "ais_radio" "AIS radio: 0 messages received" \
    "systemctl restart rtl-tcp-ais && sleep 3 && pct exec 106 -- systemctl restart ais-catcher"
fi
