#!/bin/bash
# Service Health Watchdog
# Ensures critical services remain running across all containers.
# Runs every 5 minutes via cron on the Proxmox host.

LOG="/var/log/service-watchdog.log"

# ── CT114 Services ──
SERVICES_114="display-server utilities photo-chrono nrsc5-engine"
for svc in $SERVICES_114; do
    status=$(pct exec 114 -- systemctl is-active "$svc" 2>/dev/null)
    if [ "$status" != "active" ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') [WATCHDOG] $svc is $status — restarting..." >> "$LOG"
        pct exec 114 -- systemctl start "$svc" 2>/dev/null
        sleep 2
        new_status=$(pct exec 114 -- systemctl is-active "$svc" 2>/dev/null)
        echo "$(date '+%Y-%m-%d %H:%M:%S') [WATCHDOG] $svc restart result: $new_status" >> "$LOG"

        # If display-server was restarted, reload kiosk browsers via WebSocket
        if [ "$svc" = "display-server" ] && [ "$new_status" = "active" ]; then
            sleep 3
            curl -s -X POST http://192.168.1.114:3000/api/reload >/dev/null 2>&1 || true
            echo "$(date '+%Y-%m-%d %H:%M:%S') [WATCHDOG] Sent reload to kiosk browsers after display-server recovery" >> "$LOG"
        fi
    fi
done

# ── CT105 Services ──
SERVICES_105="tracker-engine ais-collector adsb-collector"
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

# ── CT108 Dashboard API ──
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

# ── CT115 Expense Tracker (DHCP — check via pct exec) ──
if pct status 115 2>/dev/null | grep -q 'running'; then
    expense_running=$(pct exec 115 -- pm2 jlist 2>/dev/null | python3 -c 'import sys,json; procs=json.load(sys.stdin); print("yes" if any(p["pm2_env"]["status"]=="online" for p in procs) else "no")' 2>/dev/null || echo "no")
    if [ "$expense_running" != "yes" ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') [WATCHDOG] CT115 expense-api not running — restarting..." >> "$LOG"
        pct exec 115 -- pm2 resurrect 2>/dev/null || pct exec 115 -- bash -c 'cd /opt/expense-tracker && pm2 start server.js --name expense-api' 2>/dev/null || true
        sleep 2
        echo "$(date '+%Y-%m-%d %H:%M:%S') [WATCHDOG] CT115 expense-api restart attempted" >> "$LOG"
    fi
else
    # CT115 not running at all — start it
    echo "$(date '+%Y-%m-%d %H:%M:%S') [WATCHDOG] CT115 not running — starting container..." >> "$LOG"
    pct start 115 2>/dev/null || true
    sleep 10
    pct exec 115 -- pm2 resurrect 2>/dev/null || true
    echo "$(date '+%Y-%m-%d %H:%M:%S') [WATCHDOG] CT115 started" >> "$LOG"
fi

# ── Dual HDMI Kiosk Health ──
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
        DISPLAY=:0 xrandr --output HDMI-3 --mode 3840x2160 --pos 0x0 \
          --output HDMI-1 --auto --right-of HDMI-3 2>/dev/null
        if DISPLAY=:0 xrandr 2>/dev/null | grep -q '^HDMI-1 connected [0-9]'; then
            echo "$(date '+%Y-%m-%d %H:%M:%S') [WATCHDOG] Re-enabled HDMI-1 corner monitor" >> "$LOG"
            systemctl restart corner-kiosk 2>/dev/null
        fi
    fi
fi

# ── HDMI Watchdog ──
if ! systemctl is-active --quiet hdmi-watchdog 2>/dev/null; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') [WATCHDOG] hdmi-watchdog not running — restarting..." >> "$LOG"
    systemctl start hdmi-watchdog 2>/dev/null || true
fi
