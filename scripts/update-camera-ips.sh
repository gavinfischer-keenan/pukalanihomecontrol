#!/bin/bash
# ══════════════════════════════════════════════════════════════
# Camera IP Update Script
# Updates camera IPs across all services:
#   - Central Registry (/opt/hawaii-tracker/camera-registry.json)
#   - BirdNET (CT112)
#   - Frigate NVR (CT113)
#   - Display Server / Kiosk (CT114)
#   - Roofcam / Diamond Head Timelapse (CT114)
#   - Architecture Docs (CT108)
# ══════════════════════════════════════════════════════════════

# Target Camera IPs:
FRONT_GARDEN=192.168.1.213
BACK_DECK=192.168.1.143
FRONT_DOORBELL=192.168.1.141
FRONT_STAIRS=192.168.1.187
GARAGE=192.168.1.80
ROOF_VIEW=192.168.1.222
SIDE_VIEW_HOUSE=192.168.1.126

# Previous IPs to replace:
OLD_FRONT_GARDEN_1=192.168.1.7
OLD_FRONT_GARDEN_2=192.168.1.32

OLD_BACK_DECK_1=192.168.1.9
OLD_BACK_DECK_2=192.168.1.33

OLD_FRONT_DOORBELL_1=192.168.1.4
OLD_FRONT_DOORBELL_2=192.168.1.35

OLD_FRONT_STAIRS_1=192.168.1.8
OLD_FRONT_STAIRS_2=192.168.1.34

OLD_GARAGE=192.168.1.22

OLD_ROOF_VIEW_1=192.168.1.30
OLD_ROOF_VIEW_2=192.168.1.122

echo "=== Camera IP Registry Update ==="
echo "  Front Garden:  → $FRONT_GARDEN"
echo "  Back Deck:     → $BACK_DECK"
echo "  Doorbell:      → $FRONT_DOORBELL"
echo "  Front Stairs:  → $FRONT_STAIRS"
echo "  Garage:        → $GARAGE"
echo "  Roof View:     → $ROOF_VIEW"

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
    },
    "garage_cam": {
      "ip": "$GARAGE",
      "mac": "18:C2:3C:6B:30:7F",
      "port": 8554,
      "rtsp_path_1520p": "/ch1",
      "rtsp_path_1080p": "/ch2",
      "rtsp_path_720p": "/ch3",
      "rtsp_path_360p": "/ch4",
      "creds": "737:796"
    },
    "roof_view_cam": {
      "ip": "$ROOF_VIEW",
      "mac": "18:C2:3C:7A:E9:DB",
      "port": 8554,
      "rtsp_path_1520p": "/ch1",
      "rtsp_path_1080p": "/ch2",
      "rtsp_path_720p": "/ch3",
      "rtsp_path_360p": "/ch4",
      "creds": "646:145"
    },
    "side_view_house": {
      "ip": "$SIDE_VIEW_HOUSE",
      "mac": "UNKNOWN",
      "port": 8554,
      "rtsp_path_1520p": "/ch1",
      "rtsp_path_1080p": "/ch2",
      "rtsp_path_720p": "/ch3",
      "rtsp_path_360p": "/ch4",
      "creds": "253:645"
    }
  }
}
REGISTRY
echo "  ✅ Registry saved to /opt/hawaii-tracker/camera-registry.json"

# ── 2. Update BirdNET config (CT112) ────────────────────────
echo ""
echo "--- BirdNET (CT112) ---"
pct exec 112 -- sed -i \
  -e "s|$OLD_FRONT_GARDEN_1|$FRONT_GARDEN|g" \
  -e "s|$OLD_FRONT_GARDEN_2|$FRONT_GARDEN|g" \
  -e "s|$OLD_BACK_DECK_1|$BACK_DECK|g" \
  -e "s|$OLD_BACK_DECK_2|$BACK_DECK|g" \
  -e "s|$OLD_FRONT_STAIRS_1|$FRONT_STAIRS|g" \
  -e "s|$OLD_FRONT_STAIRS_2|$FRONT_STAIRS|g" \
  -e "s|$OLD_FRONT_DOORBELL_1|$FRONT_DOORBELL|g" \
  -e "s|$OLD_FRONT_DOORBELL_2|$FRONT_DOORBELL|g" \
  -e "s|$OLD_GARAGE|$GARAGE|g" \
  -e "s|$OLD_ROOF_VIEW_1|$ROOF_VIEW|g" \
  -e "s|$OLD_ROOF_VIEW_2|$ROOF_VIEW|g" \
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
  -e "s|$OLD_FRONT_GARDEN_1|$FRONT_GARDEN|g" \
  -e "s|$OLD_FRONT_GARDEN_2|$FRONT_GARDEN|g" \
  -e "s|$OLD_BACK_DECK_1|$BACK_DECK|g" \
  -e "s|$OLD_BACK_DECK_2|$BACK_DECK|g" \
  -e "s|$OLD_FRONT_STAIRS_1|$FRONT_STAIRS|g" \
  -e "s|$OLD_FRONT_STAIRS_2|$FRONT_STAIRS|g" \
  -e "s|$OLD_FRONT_DOORBELL_1|$FRONT_DOORBELL|g" \
  -e "s|$OLD_FRONT_DOORBELL_2|$FRONT_DOORBELL|g" \
  -e "s|$OLD_GARAGE|$GARAGE|g" \
  -e "s|$OLD_ROOF_VIEW_1|$ROOF_VIEW|g" \
  -e "s|$OLD_ROOF_VIEW_2|$ROOF_VIEW|g" \
  /opt/frigate/config/config.yml

pct exec 113 -- sed -i \
  -e "s|$OLD_FRONT_GARDEN_1|$FRONT_GARDEN|g" \
  -e "s|$OLD_FRONT_GARDEN_2|$FRONT_GARDEN|g" \
  -e "s|$OLD_BACK_DECK_1|$BACK_DECK|g" \
  -e "s|$OLD_BACK_DECK_2|$BACK_DECK|g" \
  -e "s|$OLD_FRONT_STAIRS_1|$FRONT_STAIRS|g" \
  -e "s|$OLD_FRONT_STAIRS_2|$FRONT_STAIRS|g" \
  -e "s|$OLD_FRONT_DOORBELL_1|$FRONT_DOORBELL|g" \
  -e "s|$OLD_FRONT_DOORBELL_2|$FRONT_DOORBELL|g" \
  -e "s|$OLD_GARAGE|$GARAGE|g" \
  -e "s|$OLD_ROOF_VIEW_1|$ROOF_VIEW|g" \
  -e "s|$OLD_ROOF_VIEW_2|$ROOF_VIEW|g" \
  /opt/frigate/config/backup_config.yaml 2>/dev/null

echo "  ✅ config.yml updated"

# Verify
pct exec 113 -- grep 'path:.*rtsp' /opt/frigate/config/config.yml | head -12

# Restart Frigate docker container
pct exec 113 -- docker restart frigate 2>/dev/null
echo "  ✅ frigate restarted"

# ── 4. Update Display Server (CT114) ────────────────────────
echo ""
echo "--- Display Server / Kiosk (CT114) ---"
pct exec 114 -- python3 -c "
import json
path = '/opt/display-server/cameras.json'
with open(path, 'r') as f:
    data = json.load(f)

ip_map = {
    'aqara_cam_1': '$FRONT_GARDEN',
    'aqara_cam_2': '$BACK_DECK',
    'aqara_cam_3': '$FRONT_STAIRS',
    'front_doorbell': '$FRONT_DOORBELL',
    'aqara_cam_5': '$GARAGE',
    'aqara_cam_6': '$ROOF_VIEW'
}

for cam in data.get('cameras', []):
    cid = cam.get('id')
    if cid in ip_map:
        cam['ip'] = ip_map[cid]

with open(path, 'w') as f:
    json.dump(data, f, indent=2)
print('  ✅ cameras.json updated on CT114')
"

pct exec 114 -- systemctl restart display-server
echo "  ✅ display-server restarted"

# ── 5. Update Roofcam Timelapse Daemon (CT114) ─────────────
echo ""
echo "--- Roofcam Timelapse (CT114) ---"
pct exec 114 -- python3 -c "
import json
path = '/opt/roofcam/config.json'
with open(path, 'r') as f:
    data = json.load(f)

data['camera']['ip'] = '$ROOF_VIEW'

with open(path, 'w') as f:
    json.dump(data, f, indent=2)
print('  ✅ config.json updated for roofcam')
"

pct exec 114 -- systemctl restart roofcam 2>/dev/null || pct exec 114 -- systemctl restart roofcam-capture 2>/dev/null
echo "  ✅ roofcam service restarted"

# ── 6. Update Architecture Docs ──────────────────────────────
pct exec 108 -- sed -i -e "s|$OLD_ROOF_VIEW_1|$ROOF_VIEW|g" -e "s|$OLD_ROOF_VIEW_2|$ROOF_VIEW|g" /opt/dashboard/architecture.md 2>/dev/null

sed -i \
  -e "s|$OLD_FRONT_GARDEN_1|$FRONT_GARDEN|g" \
  -e "s|$OLD_FRONT_GARDEN_2|$FRONT_GARDEN|g" \
  -e "s|$OLD_BACK_DECK_1|$BACK_DECK|g" \
  -e "s|$OLD_BACK_DECK_2|$BACK_DECK|g" \
  -e "s|$OLD_FRONT_STAIRS_1|$FRONT_STAIRS|g" \
  -e "s|$OLD_FRONT_STAIRS_2|$FRONT_STAIRS|g" \
  -e "s|$OLD_FRONT_DOORBELL_1|$FRONT_DOORBELL|g" \
  -e "s|$OLD_FRONT_DOORBELL_2|$FRONT_DOORBELL|g" \
  -e "s|$OLD_GARAGE|$GARAGE|g" \
  -e "s|$OLD_ROOF_VIEW_1|$ROOF_VIEW|g" \
  -e "s|$OLD_ROOF_VIEW_2|$ROOF_VIEW|g" \
  /opt/hawaii-tracker/docs/cameras.md /opt/hawaii-tracker/docs/hardware.md 2>/dev/null

echo ""
echo "=== DONE — All camera IPs updated to 192.168.1.222 and services restarted ==="
