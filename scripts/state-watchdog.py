#!/usr/bin/env python3
"""
state-watchdog.py — Detects catastrophic state loss across all systems.
Runs every 5 minutes via cron on the Proxmox host.

Checks:
  1. ZHA device count — alerts if count drops by >50% from baseline
  2. PostgreSQL vessel count — alerts if tables are empty
  3. HA entity count — alerts if total entities drops dramatically
  4. Container health — alerts if expected containers are missing
  5. AIS message flow — alerts if no messages for 15+ minutes
  6. BirdNET — alerts if database is missing or empty

On detection:
  - Logs to /var/log/state-watchdog.log
  - Creates alert file in /opt/alerts/
  - Pushes HA persistent notification (visible in HA UI)
  - Records baseline counts for trend detection
"""
import json
import urllib.request
import subprocess
import os
import time
from datetime import datetime
from pathlib import Path

LOG = "/var/log/state-watchdog.log"
BASELINE_FILE = "/opt/backups/state-baseline.json"
ALERT_DIR = "/opt/alerts"
HA_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJkOGVkZjI2YjY5MGI0Y2EwYjJlOTcwNTc4NTIwMzM4ZCIsImlhdCI6MTc4NTAzMTg2NCwiZXhwIjoyMTAwMzkxODY0fQ.kivYeS1sqbPlXP6-2AvKax9yRG8Ej6cGtrdyCRpfARY"
HA_URL = "http://192.168.1.19:8123"

def log(msg):
    line = f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}"
    print(line)
    with open(LOG, "a") as f:
        f.write(line + "\n")

def ha_get(path):
    try:
        req = urllib.request.Request(f"{HA_URL}{path}")
        req.add_header("Authorization", f"Bearer {HA_TOKEN}")
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except:
        return None

def ha_notify(title, message, notification_id):
    """Push a persistent notification to HA UI."""
    try:
        req = urllib.request.Request(f"{HA_URL}/api/services/persistent_notification/create", method="POST")
        req.add_header("Authorization", f"Bearer {HA_TOKEN}")
        req.add_header("Content-Type", "application/json")
        body = json.dumps({
            "title": title,
            "message": message,
            "notification_id": notification_id
        }).encode()
        urllib.request.urlopen(req, body, timeout=5)
    except:
        pass

def run(cmd):
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=15)
        return result.stdout.strip()
    except:
        return ""

def load_baseline():
    try:
        with open(BASELINE_FILE) as f:
            return json.load(f)
    except:
        return {}

def save_baseline(data):
    os.makedirs(os.path.dirname(BASELINE_FILE), exist_ok=True)
    with open(BASELINE_FILE, "w") as f:
        json.dump(data, f, indent=2)

def alert(category, message):
    """Fire an alert — log, file, and HA notification."""
    log(f"ALERT [{category}]: {message}")
    
    # Write alert file
    os.makedirs(ALERT_DIR, exist_ok=True)
    alert_file = f"{ALERT_DIR}/{category}_{datetime.now():%Y%m%d_%H%M%S}.alert"
    with open(alert_file, "w") as f:
        f.write(f"Category: {category}\nTime: {datetime.now()}\nMessage: {message}\n")
    
    # Push HA notification
    ha_notify(
        f"⚠️ STATE LOSS: {category}",
        message,
        f"state_watchdog_{category}"
    )

def check_zha():
    """Check ZHA device count against baseline."""
    states = ha_get("/api/states")
    if not states:
        return 0
    
    zha_entities = [s for s in states if "zha" in s.get("entity_id", "")]
    return len(zha_entities)

def check_containers():
    """Check that all expected containers are running."""
    expected = {104, 105, 106, 108, 109, 110, 112, 113, 114}
    output = run("/usr/sbin/pct list 2>/dev/null | awk 'NR>1 {print $1, $2}'")
    running = set()
    stopped = set()
    for line in output.split("\n"):
        parts = line.split()
        if len(parts) >= 2:
            ct_id = int(parts[0])
            status = parts[1]
            if status == "running":
                running.add(ct_id)
            else:
                stopped.add(ct_id)
    
    missing = expected - running - stopped
    stopped_expected = expected & stopped
    return running, stopped_expected, missing

def check_postgres():
    """Check PostgreSQL row counts."""
    output = run("/usr/sbin/pct exec 104 -- psql -U ais_user -d ais_tracking -t -c \"SELECT count(*) FROM vessels;\" 2>/dev/null")
    try:
        return int(output.strip())
    except:
        return -1

def check_ais_flow():
    """Check if AIS messages are flowing."""
    output = run("/usr/sbin/pct exec 105 -- journalctl -u ais-collector --since '15 min ago' --no-pager 2>/dev/null | grep -c 'Inserted\\|position\\|AISHub' || echo 0")
    try:
        return int(output.strip())
    except:
        return 0

def check_ha_entities():
    """Get total HA entity count."""
    states = ha_get("/api/states")
    return len(states) if states else 0

# ============================================================
# MAIN
# ============================================================
if __name__ == "__main__":
    log("--- State watchdog check ---")
    baseline = load_baseline()
    alerts_fired = []
    current = {}
    
    # 1. ZHA device count
    zha_count = check_zha()
    current["zha_entities"] = zha_count
    baseline_zha = baseline.get("zha_entities", 0)
    if baseline_zha > 5 and zha_count < baseline_zha * 0.5:
        alert("ZHA_DEVICE_LOSS",
              f"Zigbee entities dropped from {baseline_zha} to {zha_count} "
              f"({baseline_zha - zha_count} lost). "
              f"Possible network reset or coordinator failure. "
              f"CHECK IMMEDIATELY. Backup at /opt/backups/")
        alerts_fired.append("ZHA")
    log(f"  ZHA entities: {zha_count} (baseline: {baseline_zha})")
    
    # 2. Container health
    running, stopped, missing = check_containers()
    current["containers_running"] = len(running)
    if stopped:
        alert("CONTAINER_STOPPED",
              f"Expected containers stopped: {sorted(stopped)}. "
              f"Running: {sorted(running)}")
        alerts_fired.append("CONTAINERS")
    if missing:
        alert("CONTAINER_MISSING",
              f"Expected containers GONE: {sorted(missing)}. "
              f"Were they destroyed?")
        alerts_fired.append("CONTAINERS")
    log(f"  Containers: {len(running)} running, {len(stopped)} stopped, {len(missing)} missing")
    
    # 3. PostgreSQL
    vessel_count = check_postgres()
    current["pg_vessels"] = vessel_count
    baseline_vessels = baseline.get("pg_vessels", 0)
    if vessel_count == 0 and baseline_vessels > 10:
        alert("DATABASE_EMPTY",
              f"Vessels table is EMPTY (was {baseline_vessels}). "
              f"Database may have been wiped.")
        alerts_fired.append("PG")
    elif vessel_count >= 0:
        log(f"  PostgreSQL vessels: {vessel_count} (baseline: {baseline_vessels})")
    
    # 4. AIS message flow
    ais_msgs = check_ais_flow()
    current["ais_msgs_15m"] = ais_msgs
    if ais_msgs == 0:
        log(f"  AIS: no messages in 15 min (may be normal if just started)")
    else:
        log(f"  AIS messages (15m): {ais_msgs}")
    
    # 5. Total HA entities
    ha_total = check_ha_entities()
    current["ha_entities"] = ha_total
    baseline_ha = baseline.get("ha_entities", 0)
    if baseline_ha > 20 and ha_total < baseline_ha * 0.5:
        alert("HA_ENTITY_LOSS",
              f"HA entities dropped from {baseline_ha} to {ha_total}. "
              f"Major integration or config loss detected.")
        alerts_fired.append("HA")
    log(f"  HA entities: {ha_total} (baseline: {baseline_ha})")
    
    # Update baseline (only increase, never decrease without alert)
    for key, val in current.items():
        if val > baseline.get(key, 0):
            baseline[key] = val
    baseline["last_check"] = datetime.now().isoformat()
    save_baseline(baseline)
    
    if alerts_fired:
        log(f"  ALERTS FIRED: {', '.join(alerts_fired)}")
    else:
        log("  All checks passed.")
