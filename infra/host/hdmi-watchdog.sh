#!/bin/bash
# HDMI Watchdog — detects signal drops and recovers
# Runs every 60 seconds, checks if HDMI-3 (main TV) is still active

MAIN_OUTPUT="HDMI-3"
CORNER_OUTPUT="HDMI-1"
LOG="/var/log/hdmi-watchdog.log"

while true; do
    sleep 60

    # Check if HDMI-3 is connected but has no active mode (signal dropped)
    STATUS=$(DISPLAY=:0 xrandr 2>/dev/null | grep "$MAIN_OUTPUT")

    if echo "$STATUS" | grep -q 'connected'; then
        # Check if it has an active resolution (marked with *)
        ACTIVE=$(DISPLAY=:0 xrandr 2>/dev/null | grep -A1 "^$MAIN_OUTPUT connected" | grep '\*')
        if [ -z "$ACTIVE" ]; then
            echo "$(date): HDMI-3 lost active mode — recovering" >> $LOG
            DISPLAY=:0 xrandr --output $MAIN_OUTPUT --mode 3840x2160 --pos 0x0 2>/dev/null
            sleep 2
            # Re-apply corner position
            DISPLAY=:0 xrandr --output $CORNER_OUTPUT --auto --right-of $MAIN_OUTPUT 2>/dev/null
            echo "$(date): Recovery applied" >> $LOG
        fi
    else
        echo "$(date): HDMI-3 disconnected — cannot recover" >> $LOG
    fi
done
