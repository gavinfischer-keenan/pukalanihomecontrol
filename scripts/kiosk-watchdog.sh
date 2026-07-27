#!/bin/bash
# Kiosk health check — restart if memory > 1GB or Chromium frozen
# Cron: */30 * * * * /opt/hawaii-tracker/scripts/kiosk-watchdog.sh

KIOSK_MEM=$(ps -C chromium -o rss= 2>/dev/null | awk '{sum+=$1} END {print int(sum/1024)}')

if [ -z "$KIOSK_MEM" ] || [ "$KIOSK_MEM" -eq 0 ]; then
    echo "$(date) Kiosk not running — restarting" >> /var/log/kiosk-watchdog.log
    systemctl restart corner-kiosk
    exit 0
fi

if [ "$KIOSK_MEM" -gt 1024 ]; then
    echo "$(date) Kiosk using ${KIOSK_MEM}MB — restarting" >> /var/log/kiosk-watchdog.log
    systemctl restart corner-kiosk
    exit 0
fi
