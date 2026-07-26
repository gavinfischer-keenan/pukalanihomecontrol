#!/usr/bin/env python3
"""Push PM and BirdNET sensor data to Home Assistant.
Entity IDs match the Command Center dashboard config."""
import json, urllib.request, datetime, sys

HA_URL = "http://192.168.1.19:8123"
TOKEN = open("/root/.ha_token").read().strip()
PM_URL = "http://192.168.1.108:3001/api/pm/summary"
PM_VENDORS_URL = "http://192.168.1.110:3001/api/vendors"
PM_ASSETS_URL = "http://192.168.1.110:3001/api/assets"
BIRDNET_URL = "http://192.168.1.25:8080/api/v2"

def ha_post(entity_id, state, attributes):
    url = f"{HA_URL}/api/states/{entity_id}"
    data = json.dumps({"state": str(state), "attributes": attributes}).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Authorization", f"Bearer {TOKEN}")
    req.add_header("Content-Type", "application/json")
    try:
        urllib.request.urlopen(req, timeout=10)
        return True
    except Exception as e:
        print(f"  HA POST {entity_id} failed: {e}", file=sys.stderr)
        return False

def fetch_json(url, timeout=10):
    try:
        req = urllib.request.Request(url)
        return json.loads(urllib.request.urlopen(req, timeout=timeout).read())
    except Exception as e:
        print(f"  Fetch {url} failed: {e}", file=sys.stderr)
        return None

now = datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
today = datetime.date.today().isoformat()
print(f"[{now}] ha-sensor-pusher running...")

# === PM Sensors ===
pm = fetch_json(PM_URL)
if pm and "error" not in pm:
    ha_post("sensor.pm_total_tasks", pm.get("total_tasks", 0),
            {"friendly_name": "PM Total Tasks", "icon": "mdi:clipboard-list",
             "unit_of_measurement": "tasks", "state_class": "measurement"})
    # Dashboard uses "active_tasks" but we call them "open_tasks" — push both
    ha_post("sensor.pm_open_tasks", pm.get("open_tasks", 0),
            {"friendly_name": "PM Open Tasks", "icon": "mdi:clipboard-text",
             "unit_of_measurement": "tasks", "state_class": "measurement"})
    ha_post("sensor.pm_active_tasks", pm.get("open_tasks", 0),
            {"friendly_name": "PM Active Tasks", "icon": "mdi:clipboard-text",
             "unit_of_measurement": "tasks", "state_class": "measurement"})
    ha_post("sensor.pm_overdue_tasks", pm.get("overdue_tasks", 0),
            {"friendly_name": "PM Overdue Tasks", "icon": "mdi:clipboard-alert",
             "unit_of_measurement": "tasks", "state_class": "measurement"})
    ha_post("sensor.pm_warranties", pm.get("warranties", 0),
            {"friendly_name": "PM Warranties", "icon": "mdi:shield-check",
             "unit_of_measurement": "warranties", "state_class": "measurement"})
    ha_post("sensor.pm_warranty_expiring", pm.get("warranty_expiring_soon", 0),
            {"friendly_name": "PM Warranties Expiring Soon", "icon": "mdi:shield-alert",
             "unit_of_measurement": "warranties", "state_class": "measurement"})
    ha_post("sensor.pm_warranties_expiring", pm.get("warranty_expiring_soon", 0),
            {"friendly_name": "PM Warranties Expiring", "icon": "mdi:shield-alert",
             "unit_of_measurement": "warranties", "state_class": "measurement"})
    ha_post("sensor.pm_maintenance_due", pm.get("maintenance_due", 0),
            {"friendly_name": "PM Maintenance Due", "icon": "mdi:wrench-clock",
             "unit_of_measurement": "items", "state_class": "measurement"})
    ha_post("binary_sensor.pm_api_online", "on",
            {"friendly_name": "PM API Online", "icon": "mdi:api", "device_class": "connectivity"})
    print("  PM core sensors pushed OK")
else:
    ha_post("binary_sensor.pm_api_online", "off",
            {"friendly_name": "PM API Online", "icon": "mdi:api", "device_class": "connectivity"})
    print(f"  PM API failed: {pm}")

# PM Vendors count
vendors = fetch_json(PM_VENDORS_URL)
if vendors is not None:
    count = len(vendors) if isinstance(vendors, list) else vendors.get("total", 0)
    ha_post("sensor.pm_total_vendors", count,
            {"friendly_name": "PM Total Vendors", "icon": "mdi:account-group",
             "unit_of_measurement": "vendors", "state_class": "measurement"})
    print(f"  PM vendors: {count}")

# PM Assets count
assets = fetch_json(PM_ASSETS_URL)
if assets is not None:
    count = len(assets) if isinstance(assets, list) else assets.get("total", 0)
    ha_post("sensor.pm_total_assets", count,
            {"friendly_name": "PM Total Assets", "icon": "mdi:home-city",
             "unit_of_measurement": "assets", "state_class": "measurement"})
    print(f"  PM assets: {count}")

# === BirdNET Sensors ===
# Total detections + last detection
bn_all = fetch_json(f"{BIRDNET_URL}/detections?limit=1")
if bn_all and "data" in bn_all:
    total = bn_all.get("total", len(bn_all.get("data", [])))
    ha_post("sensor.birdnet_detections_total", total,
            {"friendly_name": "BirdNET Total Detections", "icon": "mdi:bird",
             "unit_of_measurement": "detections", "state_class": "total_increasing"})

    last = bn_all["data"][0] if bn_all["data"] else None
    if last:
        common = last.get("commonName", last.get("speciesCode", "Unknown"))
        confidence = last.get("confidence", 0)
        conf_pct = round(confidence * 100) if confidence <= 1 else confidence
        det_time = last.get("time", "")

        ha_post("sensor.birdnet_last_detection", common,
                {"friendly_name": "BirdNET Last Detection", "icon": "mdi:bird",
                 "confidence": conf_pct, "time": det_time,
                 "species_code": last.get("speciesCode", "")})
        # Dashboard also uses birdnet_last_species
        ha_post("sensor.birdnet_last_species", common,
                {"friendly_name": "Last Species Heard", "icon": "mdi:bird",
                 "confidence": conf_pct, "time": det_time,
                 "species_code": last.get("speciesCode", "")})
        # Dashboard uses birdnet_last_confidence
        ha_post("sensor.birdnet_last_confidence", f"{conf_pct}%",
                {"friendly_name": "Last Confidence", "icon": "mdi:percent-circle",
                 "confidence_raw": confidence})
        print(f"  BirdNET last: {common} ({conf_pct}%)")

    print(f"  BirdNET total: {total}")

# Today's detections
bn_today = fetch_json(f"{BIRDNET_URL}/detections?date={today}&limit=1")
if bn_today:
    today_total = bn_today.get("total", 0)
    ha_post("sensor.birdnet_detections_today", today_total,
            {"friendly_name": "BirdNET Detections Today", "icon": "mdi:bird",
             "unit_of_measurement": "detections", "state_class": "measurement"})
    print(f"  BirdNET today: {today_total}")

# Species today + top species
bn_species = fetch_json(f"{BIRDNET_URL}/analytics/species/summary")
if bn_species:
    species_list = bn_species if isinstance(bn_species, list) else bn_species.get("data", bn_species.get("species", []))
    
    # Count species heard today
    species_today = 0
    top_species = "Unknown"
    top_count = 0
    for sp in species_list:
        last_heard = sp.get("lastHeard", sp.get("last_heard", ""))
        if today in str(last_heard):
            species_today += 1
        # Track top species by count
        sp_count = sp.get("count", sp.get("detections", 0))
        if sp_count > top_count:
            top_count = sp_count
            top_species = sp.get("commonName", sp.get("species", "Unknown"))

    ha_post("sensor.birdnet_species_today", species_today,
            {"friendly_name": "BirdNET Species Today", "icon": "mdi:owl",
             "unit_of_measurement": "species", "state_class": "measurement"})
    ha_post("sensor.birdnet_top_species", top_species,
            {"friendly_name": "Top Species (All Time)", "icon": "mdi:trophy-award",
             "total_detections": top_count})
    print(f"  BirdNET species today: {species_today}, top: {top_species} ({top_count})")

print("Done.")
