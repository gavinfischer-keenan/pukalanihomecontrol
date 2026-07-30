#!/bin/bash
# CT114 and CT105 Service Health Watchdog
# Ensures critical services remain running.
# Intended to run every 5 minutes via cron on the Proxmox host.
# If a service is found dead, it restarts it and logs the event.

LOG="/var/log/service-watchdog.log"
SERVICES="display-server utilities photo-chrono nrsc5-engine"

for svc in $SERVICES; do
    status=$(pct exec 114 -- systemctl is-active "$svc" 2>/dev/null)
    if [ "$status" != "active" ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') [WATCHDOG] $svc is $status — restarting..." >> "$LOG"
        pct exec 114 -- systemctl start "$svc" 2>/dev/null
        sleep 2
        new_status=$(pct exec 114 -- systemctl is-active "$svc" 2>/dev/null)
        echo "$(date '+%Y-%m-%d %H:%M:%S') [WATCHDOG] $svc restart result: $new_status" >> "$LOG"

        # If display-server was restarted, also refresh kiosk browsers
        if [ "$svc" = "display-server" ] && [ "$new_status" = "active" ]; then
            sleep 3
            # Refresh both kiosk browsers (main TV + corner monitor)
            DISPLAY=:0 xdotool key F5 2>/dev/null
            echo "$(date '+%Y-%m-%d %H:%M:%S') [WATCHDOG] Refreshed kiosk browsers after display-server recovery" >> "$LOG"
        fi
    fi
done

SERVICES_105="tracker-engine ais-collector"
for svc in $SERVICES_105; do
    status=$(pct exec 105 -- systemctl is-active "$svc" 2>/dev/null)
    if [ "$status" != "active" ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') [WATCHDOG] $svc is $status — restarting..." >> "$LOG"
        pct exec 105 -- systemctl start "$svc" 2>/dev/null
        sleep 2
        new_status=$(pct exec 105 -- systemctl is-active "$svc" 2>/dev/null)
        echo "$(date '+%Y-%m-%d %H:%M:%S') [WATCHDOG] $svc restart result: $new_status" >> "$LOG"
    fi
done

# CT108 Dashboard API
if ! pct exec 108 -- ss -tln | grep -q ":3001 "; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') [WATCHDOG] CT108 port 3001 not listening — restarting hawaii-api..." >> "$LOG"
    pct exec 108 -- pm2 restart hawaii-api 2>/dev/null
    sleep 3
    if pct exec 108 -- ss -tln | grep -q ":3001 "; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') [WATCHDOG] CT108 port 3001 is now listening" >> "$LOG"
    else
        echo "$(date '+%Y-%m-%d %H:%M:%S') [WATCHDOG] CT108 port 3001 still not listening after restart" >> "$LOG"
    fi
fi

# ── Dual HDMI Kiosk Health ────────────────────────────────────────────────────
# Ensures corner-kiosk.service is running and both Chromium instances are alive
if ! systemctl is-active --quiet corner-kiosk 2>/dev/null; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') [WATCHDOG] corner-kiosk service is dead — restarting..." >> "$LOG"
    systemctl restart corner-kiosk 2>/dev/null
    sleep 5
    new_status=$(systemctl is-active corner-kiosk 2>/dev/null)
    echo "$(date '+%Y-%m-%d %H:%M:%S') [WATCHDOG] corner-kiosk restart result: $new_status" >> "$LOG"
else
    # Service is running — verify both browsers are alive
    MAIN_ALIVE=$(pgrep -f 'chromium-kiosk-user-data' >/dev/null 2>&1 && echo "yes" || echo "no")
    CORNER_ALIVE=$(pgrep -f 'chromium-corner-data' >/dev/null 2>&1 && echo "yes" || echo "no")

    if [ "$MAIN_ALIVE" = "no" ] || [ "$CORNER_ALIVE" = "no" ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') [WATCHDOG] Kiosk browser check: main=$MAIN_ALIVE corner=$CORNER_ALIVE — restarting..." >> "$LOG"
        systemctl restart corner-kiosk 2>/dev/null
        sleep 5
        echo "$(date '+%Y-%m-%d %H:%M:%S') [WATCHDOG] Kiosk restarted after browser crash" >> "$LOG"
    fi

    # Verify HDMI-1 (corner) is still active via xrandr
    CORNER_ACTIVE=$(DISPLAY=:0 xrandr 2>/dev/null | grep '^HDMI-1 connected [0-9]' | wc -l)
    if [ "$CORNER_ACTIVE" -eq 0 ] 2>/dev/null; then
        # Corner monitor may have been reconnected — re-enable display
        DISPLAY=:0 xrandr --output HDMI-3 --mode 3840x2160 --pos 0x0 \
          --output HDMI-1 --auto --right-of HDMI-3 2>/dev/null
        if DISPLAY=:0 xrandr 2>/dev/null | grep -q '^HDMI-1 connected [0-9]'; then
            echo "$(date '+%Y-%m-%d %H:%M:%S') [WATCHDOG] Re-enabled HDMI-1 corner monitor" >> "$LOG"
            systemctl restart corner-kiosk 2>/dev/null
        fi
    fi
fi
