#!/bin/bash
# ══════════════════════════════════════════════════════════════
# Camera IP Update Script
# Updates camera IPs in BirdNET (CT112) and Frigate (CT113)
# Also maintains a central registry at /opt/hawaii-tracker/camera-registry.json
# ══════════════════════════════════════════════════════════════

# Current mappings (update these when IPs change):
FRONT_GARDEN=192.168.1.7
BACK_DECK=192.168.1.9
FRONT_STAIRS=192.168.1.8
FRONT_DOORBELL=192.168.1.4

# Old IPs to replace
OLD_FRONT_GARDEN=192.168.1.32
OLD_BACK_DECK=192.168.1.33
OLD_FRONT_STAIRS=192.168.1.34
OLD_FRONT_DOORBELL=192.168.1.35

echo "=== Camera IP Registry Update ==="
echo "  front_garden:   $OLD_FRONT_GARDEN → $FRONT_GARDEN"
echo "  back_deck:      $OLD_BACK_DECK → $BACK_DECK"
echo "  front_stairs:   $OLD_FRONT_STAIRS → $FRONT_STAIRS"
echo "  front_doorbell: $OLD_FRONT_DOORBELL → $FRONT_DOORBELL"

# ── 1. Create central registry ──────────────────────────────
cat > /opt/hawaii-tracker/camera-registry.json << REGISTRY
{
  "updated": "$(date -Iseconds)",
  "note": "Central camera IP registry. Update IPs here then run: bash /opt/hawaii-tracker/scripts/update-camera-ips.sh",
  "cameras": {
    "front_garden_cam": {
      "ip": "$FRONT_GARDEN",
      "mac": "18:C2:3C:5A:A8:C2",
      "port": 8554,
      "rtsp_path_1080p": "/1080p",
      "rtsp_path_1520p": "/1520p",
      "creds": "772:885"
    },
    "back_deck_cam": {
      "ip": "$BACK_DECK",
      "mac": "18:C2:3C:5A:AA:E9",
      "port": 8554,
      "rtsp_path_1080p": "/1080p",
      "rtsp_path_1520p": "/1520p",
      "creds": "294:698"
    },
    "front_stairs_cam": {
      "ip": "$FRONT_STAIRS",
      "mac": "18:C2:3C:5A:BD:AE",
      "port": 8554,
      "rtsp_path_1080p": "/1080p",
      "rtsp_path_1520p": "/1520p",
      "creds": "741:574"
    },
    "front_doorbell_cam": {
      "ip": "$FRONT_DOORBELL",
      "mac": "18:C2:3C:7A:03:00",
      "port": 8554,
      "rtsp_path_main": "/ch2",
      "rtsp_path_sub": "/ch1",
      "creds": "549:322"
    }
  }
}
REGISTRY
echo "  ✅ Registry saved to /opt/hawaii-tracker/camera-registry.json"

# ── 2. Update BirdNET config (CT112) ────────────────────────
echo ""
echo "--- BirdNET (CT112) ---"
pct exec 112 -- sed -i \
  -e "s|$OLD_FRONT_GARDEN|$FRONT_GARDEN|g" \
  -e "s|$OLD_BACK_DECK|$BACK_DECK|g" \
  -e "s|$OLD_FRONT_STAIRS|$FRONT_STAIRS|g" \
  -e "s|$OLD_FRONT_DOORBELL|$FRONT_DOORBELL|g" \
  /opt/birdnet/config/config.yaml
echo "  ✅ config.yaml updated"

# Verify
pct exec 112 -- grep 'url:.*rtsp' /opt/birdnet/config/config.yaml

# Restart BirdNET docker container
pct exec 112 -- docker restart birdnet_go 2>/dev/null
echo "  ✅ birdnet_go restarted"

# ── 3. Update Frigate config (CT113) ────────────────────────
echo ""
echo "--- Frigate (CT113) ---"
pct exec 113 -- sed -i \
  -e "s|$OLD_FRONT_GARDEN|$FRONT_GARDEN|g" \
  -e "s|$OLD_BACK_DECK|$BACK_DECK|g" \
  -e "s|$OLD_FRONT_STAIRS|$FRONT_STAIRS|g" \
  -e "s|$OLD_FRONT_DOORBELL|$FRONT_DOORBELL|g" \
  /opt/frigate/config/config.yml
echo "  ✅ config.yml updated"

# Also update backup config
pct exec 113 -- sed -i \
  -e "s|$OLD_FRONT_GARDEN|$FRONT_GARDEN|g" \
  -e "s|$OLD_BACK_DECK|$BACK_DECK|g" \
  -e "s|$OLD_FRONT_STAIRS|$FRONT_STAIRS|g" \
  -e "s|$OLD_FRONT_DOORBELL|$FRONT_DOORBELL|g" \
  /opt/frigate/config/backup_config.yaml 2>/dev/null

# Verify
pct exec 113 -- grep 'path:.*rtsp' /opt/frigate/config/config.yml | head -8

# Restart Frigate docker container
pct exec 113 -- docker restart frigate 2>/dev/null
echo "  ✅ frigate restarted"

# ── 4. Update birdnet-audio-bridge on CT113 ──────────────────
echo ""
echo "--- Audio bridge (CT113) ---"
BRIDGE_CONF=$(pct exec 113 -- cat /etc/systemd/system/birdnet-audio-bridge.service 2>/dev/null | grep -c "$OLD_FRONT_GARDEN\|$OLD_BACK_DECK\|$OLD_FRONT_STAIRS\|$OLD_FRONT_DOORBELL")
if [ "$BRIDGE_CONF" -gt 0 ]; then
  pct exec 113 -- sed -i \
    -e "s|$OLD_FRONT_GARDEN|$FRONT_GARDEN|g" \
    -e "s|$OLD_BACK_DECK|$BACK_DECK|g" \
    -e "s|$OLD_FRONT_STAIRS|$FRONT_STAIRS|g" \
    -e "s|$OLD_FRONT_DOORBELL|$FRONT_DOORBELL|g" \
    /etc/systemd/system/birdnet-audio-bridge.service
  pct exec 113 -- systemctl daemon-reload
  pct exec 113 -- systemctl restart birdnet-audio-bridge
  echo "  ✅ audio bridge updated & restarted"
else
  echo "  ℹ️  No old camera IPs in audio bridge config"
fi

echo ""
echo "=== DONE — All camera IPs updated ==="
