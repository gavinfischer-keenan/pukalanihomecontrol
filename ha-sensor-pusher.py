#!/usr/bin/env python3
"""
ha-sensor-pusher.py — Push PM and BirdNET sensor data to HA every 60 seconds.
Runs as a systemd service on the Proxmox host.
Creates/updates HA entities via the REST API state endpoint.
"""
import json
import urllib.request
import time
import logging
from datetime import date

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger("ha-sensor-pusher")

HA_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiI5NTA1OTg3MjZkNGE0MzM1YjgwODA1ZGE3MzBlZmZmZCIsImlhdCI6MTc4MzY3MTEzMywiZXhwIjoyMDk5MDMxMTMzfQ.WNlKbZsQIhXN8z2AIHKbA8dDL1XkL7bR-TwTo0Tn9Fo"
HA_URL = "http://192.168.1.19:8123"
PM_URL = "http://192.168.1.110:3001"
BIRDNET_URL = "http://192.168.1.25:8080"
INTERVAL = 60

def http_get(url, timeout=5):
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except:
        return None

def ha_set_state(entity_id, state, attributes):
    try:
        req = urllib.request.Request(
            f"{HA_URL}/api/states/{entity_id}", method="POST"
        )
        req.add_header("Authorization", f"Bearer {HA_TOKEN}")
        req.add_header("Content-Type", "application/json")
        body = json.dumps({"state": str(state), "attributes": attributes}).encode()
        with urllib.request.urlopen(req, body, timeout=5):
            pass
    except Exception as e:
        log.warning(f"Failed to set {entity_id}: {e}")

def push_pm_sensors():
    tasks = http_get(f"{PM_URL}/api/tasks") or []
    warranties = http_get(f"{PM_URL}/api/warranties") or []
    health = http_get(f"{PM_URL}/api/health")
    
    if isinstance(tasks, list):
        total = len(tasks)
        open_t = len([t for t in tasks if isinstance(t, dict) and t.get("status") in ("open", "pending", "in_progress", "todo", "Open", "Pending", "In Progress")])
        overdue = len([t for t in tasks if isinstance(t, dict) and t.get("status") in ("overdue", "Overdue")])
    else:
        total, open_t, overdue = 0, 0, 0
    
    warranty_count = len(warranties) if isinstance(warranties, list) else 0
    api_online = health is not None or (isinstance(tasks, list) and len(tasks) > 0)

    ha_set_state("sensor.pm_total_tasks", total, {"friendly_name": "PM Total Tasks", "icon": "mdi:clipboard-list", "unit_of_measurement": "tasks"})
    ha_set_state("sensor.pm_open_tasks", open_t, {"friendly_name": "PM Open Tasks", "icon": "mdi:clipboard-alert", "unit_of_measurement": "tasks"})
    ha_set_state("sensor.pm_overdue_tasks", overdue, {"friendly_name": "PM Overdue Tasks", "icon": "mdi:clipboard-remove", "unit_of_measurement": "tasks"})
    ha_set_state("sensor.pm_warranties", warranty_count, {"friendly_name": "PM Warranties", "icon": "mdi:shield-check", "unit_of_measurement": "items"})
    ha_set_state("binary_sensor.pm_api_online", "on" if api_online else "off", {"friendly_name": "PM API Online", "icon": "mdi:server-network", "device_class": "connectivity"})

def push_birdnet_sensors():
    data = http_get(f"{BIRDNET_URL}/api/v2/detections?limit=500")
    
    if isinstance(data, dict):
        total = data.get("total", 0)
        detections = data.get("detections", [])
    elif isinstance(data, list):
        total = len(data)
        detections = data
    else:
        total = 0
        detections = []

    today_str = date.today().isoformat()
    today_dets = [d for d in detections if isinstance(d, dict) and d.get("date", "") == today_str]
    today_count = len(today_dets)
    species_today = len(set(d.get("commonName", "") for d in today_dets))
    
    if detections:
        last = detections[0]
        last_species = last.get("commonName", "Unknown")
        last_conf = last.get("confidence", 0)
        last_time = last.get("time", "")
    else:
        last_species, last_conf, last_time = "None", 0, ""

    ha_set_state("sensor.birdnet_detections_total", total, {"friendly_name": "BirdNET Total Detections", "icon": "mdi:bird", "unit_of_measurement": "detections"})
    ha_set_state("sensor.birdnet_detections_today", today_count, {"friendly_name": "BirdNET Detections Today", "icon": "mdi:counter", "unit_of_measurement": "detections"})
    ha_set_state("sensor.birdnet_species_today", species_today, {"friendly_name": "BirdNET Species Today", "icon": "mdi:owl", "unit_of_measurement": "species"})
    ha_set_state("sensor.birdnet_last_detection", last_species, {"friendly_name": "BirdNET Last Detection", "icon": "mdi:ear-hearing", "confidence": last_conf, "time": last_time})

if __name__ == "__main__":
    log.info("HA sensor pusher starting (60s interval)")
    while True:
        try:
            push_pm_sensors()
            push_birdnet_sensors()
            log.info("Sensors pushed OK")
        except Exception as e:
            log.error(f"Push cycle failed: {e}")
        time.sleep(INTERVAL)
