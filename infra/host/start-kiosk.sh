#!/bin/bash
# /opt/corner-kiosk/start-kiosk.sh
# Dual HDMI Kiosk — Main TV (HDMI-3) + Corner Monitor (HDMI-1)
# Runs under xinit as :0 on vt1

chvt 1
xset s off
xset -dpms
xset s noblank

# ── Detect and configure displays ─────────────────────────────────────────────
sleep 1

# Check which outputs are connected
MAIN_OUTPUT=""
CORNER_OUTPUT=""

for out in $(xrandr | grep ' connected' | awk '{print $1}'); do
  case "$out" in
    HDMI-3) MAIN_OUTPUT="$out" ;;
    HDMI-1) CORNER_OUTPUT="$out" ;;
    # Fallback: any HDMI/DP that isn't the main
    HDMI-*|DP-*) [ -z "$CORNER_OUTPUT" ] && [ "$out" != "$MAIN_OUTPUT" ] && CORNER_OUTPUT="$out" ;;
  esac
done

echo "Main TV: $MAIN_OUTPUT"
echo "Corner Monitor: $CORNER_OUTPUT"

# Configure main TV (always)
if [ -n "$MAIN_OUTPUT" ]; then
  xrandr --output "$MAIN_OUTPUT" --mode 3840x2160 --pos 0x0 2>/dev/null || \
  xrandr --output "$MAIN_OUTPUT" --auto --pos 0x0
  MAIN_W=3840
  MAIN_H=2160
  echo "Main TV enabled: ${MAIN_W}x${MAIN_H}"
fi

# Configure corner monitor (if connected)
if [ -n "$CORNER_OUTPUT" ]; then
  CORNER_RES=$(xrandr | grep -A1 "^${CORNER_OUTPUT} connected" | tail -1 | awk '{print $1}')
  CORNER_W=$(echo "$CORNER_RES" | cut -dx -f1)
  CORNER_H=$(echo "$CORNER_RES" | cut -dx -f2)
  [ -z "$CORNER_W" ] && CORNER_W=1920 && CORNER_H=1080

  # Expand framebuffer and place corner to the right of main
  TOTAL_W=$((${MAIN_W:-3840} + CORNER_W))
  TOTAL_H=$((MAIN_H > CORNER_H ? MAIN_H : CORNER_H))
  xrandr --fb ${TOTAL_W}x${TOTAL_H} \
    --output "${MAIN_OUTPUT}" --mode 3840x2160 --pos 0x0 \
    --output "${CORNER_OUTPUT}" --mode ${CORNER_W}x${CORNER_H} --pos ${MAIN_W:-3840}x0 \
    2>/dev/null || \
  xrandr --output "${CORNER_OUTPUT}" --auto --right-of "${MAIN_OUTPUT}"

  echo "Corner monitor enabled: ${CORNER_W}x${CORNER_H} at pos ${MAIN_W:-3840},0"
else
  echo "WARN: No corner monitor detected — single display mode"
fi

# ── Hide cursor ───────────────────────────────────────────────────────────────
unclutter -idle 0.5 -root &

sleep 1

# ── Kill any existing Chromium ────────────────────────────────────────────────
pkill -f chromium 2>/dev/null
sleep 0.5
rm -rf /tmp/chromium-kiosk-user-data /tmp/chromium-corner-data

# ── Launch Main TV kiosk ──────────────────────────────────────────────────────
chromium \
  --no-first-run --kiosk --start-fullscreen --start-maximized \
  --window-size=${MAIN_W:-3840},${MAIN_H:-2160} --window-position=0,0 \
  --noerrdialogs --disable-infobars --disable-translate \
  --disable-features=TranslateUI --no-sandbox \
  --disable-session-crashed-bubble --disable-component-update \
  --autoplay-policy=no-user-gesture-required \
  --user-data-dir=/tmp/chromium-kiosk-user-data \
  'http://192.168.1.114:3000/#maintv' &
MAIN_PID=$!
echo "Main TV kiosk launched: PID $MAIN_PID"

sleep 2

# ── Launch Corner kiosk (if display connected) ────────────────────────────────
CORNER_PID=""
if [ -n "$CORNER_OUTPUT" ]; then
  chromium \
    --no-first-run --kiosk --start-fullscreen \
    --window-size=${CORNER_W},${CORNER_H} --window-position=${MAIN_W:-3840},0 \
    --noerrdialogs --disable-infobars --disable-translate \
    --disable-features=TranslateUI --no-sandbox \
    --disable-session-crashed-bubble --disable-component-update \
    --autoplay-policy=no-user-gesture-required \
    --user-data-dir=/tmp/chromium-corner-data \
    'http://192.168.1.114:3000/#corner' &
  CORNER_PID=$!
  echo "Corner kiosk launched: PID $CORNER_PID"

  # Position the corner window precisely
  sleep 3
  WID=$(xdotool search --pid $CORNER_PID 2>/dev/null | head -1)
  if [ -n "$WID" ]; then
    xdotool windowmove --sync $WID ${MAIN_W:-3840} 0
    xdotool windowsize --sync $WID ${CORNER_W} ${CORNER_H}
    xdotool windowactivate --sync $WID
    echo "Corner window positioned on HDMI-1"
  fi
fi

# ── Wait for either to exit ───────────────────────────────────────────────────
wait $MAIN_PID
