#!/bin/bash
# Corner Monitor Kiosk — HDMI-3, 3840x2160
# Switch to VT1 and disable screensaver/DPMS
chvt 1
xset s off
xset -dpms
xset s noblank

# Hide cursor
unclutter -idle 0.5 -root &

# Wait for X to be fully ready
sleep 1

# Kill any existing Chromium
pkill -f chromium 2>/dev/null
sleep 0.5

# Clear old cache/data
rm -rf /tmp/chromium-kiosk-user-data

# Launch Chromium with explicit window size
chromium \
  --no-first-run \
  --kiosk \
  --start-fullscreen \
  --start-maximized \
  --window-size=3840,2160 \
  --window-position=0,0 \
  --noerrdialogs \
  --disable-infobars \
  --disable-translate \
  --disable-features=TranslateUI \
  --no-sandbox \
  --disable-session-crashed-bubble \
  --disable-component-update \
  --disable-application-cache \
  --disable-cache \
  --disk-cache-size=1 \
  --media-cache-size=1 \
  --aggressive-cache-discard \
  --autoplay-policy=no-user-gesture-required \
  --user-data-dir=/tmp/chromium-kiosk-user-data \
  'http://192.168.1.114:3000/#corner' &

CHROME_PID=$!

# Wait for window to appear, then force fullscreen
sleep 3
DISPLAY=:0 xdotool search --onlyvisible --name '' windowactivate --sync windowfocus --sync key F11 2>/dev/null || true

# Also try to resize/move the window directly
WID=$(DISPLAY=:0 xdotool search --name 'Hawaii' 2>/dev/null | head -1)
if [ -n "$WID" ]; then
  DISPLAY=:0 xdotool windowmove --sync $WID 0 0
  DISPLAY=:0 xdotool windowsize --sync $WID 3840 2160
  DISPLAY=:0 xdotool windowactivate --sync $WID
fi

wait $CHROME_PID
