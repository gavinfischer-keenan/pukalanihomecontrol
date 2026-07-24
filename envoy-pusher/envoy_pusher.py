#!/usr/bin/env python3
"""
Enphase Envoy → Home Assistant sensor pusher
Scrapes http://192.168.1.6/production and /home, pushes to HA REST API.
Runs every 60s as a systemd service.
"""

import os
import re
import time
import json
import logging
import urllib.request
import urllib.error

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [envoy] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S"
)
log = logging.getLogger("envoy")

ENVOY     = os.environ.get("ENVOY_URL", "http://192.168.1.6")
HA_URL    = os.environ.get("HA_URL", "http://192.168.1.19:8123")
HA_TOKEN  = os.environ.get("HA_TOKEN", "")
INTERVAL  = 60  # seconds


def scrape_page(path):
    """Fetch page and return plain text (HTML tags stripped) for regex matching."""
    try:
        url = f"{ENVOY}{path}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode("utf-8", errors="replace")
        # Strip scripts, styles, then all tags — so regexes work on plain text
        text = re.sub(r"<script[^>]*>.*?</script>", " ", html, flags=re.DOTALL)
        text = re.sub(r"<style[^>]*>.*?</style>",   " ", text, flags=re.DOTALL)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        log.debug(f"Scraped {path}: {len(text)} chars of text")
        return text
    except Exception as e:
        log.warning(f"Scrape {path} failed: {e}")
        return ""


def extract(pattern, text, cast=float, default=None):
    m = re.search(pattern, text)
    if m:
        try:
            return cast(m.group(1).replace(",", ""))
        except Exception:
            return default
    return default


def push_sensor(entity_id, state, attributes):
    """Push a sensor state to HA via REST API."""
    url = f"{HA_URL}/api/states/{entity_id}"
    payload = json.dumps({"state": str(state), "attributes": attributes}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {HA_TOKEN}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status in (200, 201)
    except urllib.error.HTTPError as e:
        log.warning(f"Push {entity_id} -> HTTP {e.code}: {e.read()[:100]}")
        return False
    except Exception as e:
        log.warning(f"Push {entity_id} failed: {e}")
        return False


def collect_and_push():
    prod_html = scrape_page("/production")
    home_html = scrape_page("/home")

    # --- Extract from /production ---
    _cur_kw = extract(r"Currently\s+([\d,.]+)\s+kW", prod_html, float, None)
    _cur_w  = extract(r"Currently\s+([\d,.]+)\s+W(?!h)", prod_html, float, None)
    current_w = int((_cur_kw * 1000) if _cur_kw is not None else (_cur_w or 0))
    today_kwh   = extract(r"Today\s+([\d.]+)\s+kWh",             prod_html, float, 0)
    week_kwh    = extract(r"Past Week\s+([\d.]+)\s+kWh",         prod_html, float, 0)
    lifetime_mwh = extract(r"Since Installation\s+([\d.]+)\s+MWh", prod_html, float, 0)
    live_date   = extract(r"live since\s+(.+?)(?:\s+HST|\s+PDT|\s+PST)", prod_html, str, "")

    # --- Extract from /home ---
    inv_online  = extract(r"Number of Microinverters Online\s+(\d+)", home_html, int, 0)
    inv_total   = extract(r"Number of Microinverters\s+(\d+)",         home_html, int, 0)
    last_conn   = extract(r"Last connection to website\s+([\d]+)\s+minutes", home_html, int, None)

    if current_w is None:
        log.warning("Could not parse production page — skipping push")
        return

    log.info(f"Solar: {current_w}W now | {today_kwh}kWh today | {week_kwh}kWh week | "
             f"{lifetime_mwh}MWh lifetime | {inv_online}/{inv_total} inverters")

    sensors = [
        ("sensor.solar_current_production", current_w, {
            "friendly_name": "Solar Current Production",
            "unit_of_measurement": "W",
            "device_class": "power",
            "state_class": "measurement",
            "icon": "mdi:solar-power",
        }),
        ("sensor.solar_energy_today", today_kwh, {
            "friendly_name": "Solar Energy Today",
            "unit_of_measurement": "kWh",
            "device_class": "energy",
            "state_class": "total_increasing",
            "icon": "mdi:solar-power",
        }),
        ("sensor.solar_energy_past_week", week_kwh, {
            "friendly_name": "Solar Energy Past Week",
            "unit_of_measurement": "kWh",
            "device_class": "energy",
            "icon": "mdi:solar-power",
        }),
        ("sensor.solar_energy_lifetime", lifetime_mwh, {
            "friendly_name": "Solar Lifetime Generation",
            "unit_of_measurement": "MWh",
            "device_class": "energy",
            "icon": "mdi:solar-power",
        }),
        ("sensor.solar_microinverters_online", inv_online, {
            "friendly_name": "Solar Microinverters Online",
            "unit_of_measurement": "",
            "icon": "mdi:solar-panel",
            "total": inv_total,
        }),
        ("sensor.solar_microinverters_total", inv_total, {
            "friendly_name": "Solar Microinverters Total",
            "unit_of_measurement": "",
            "icon": "mdi:solar-panel",
        }),
    ]

    if last_conn is not None:
        sensors.append(("sensor.solar_envoy_last_cloud_connection", last_conn, {
            "friendly_name": "Envoy Last Cloud Connection",
            "unit_of_measurement": "min",
            "icon": "mdi:cloud-check",
        }))

    ok = 0
    for entity_id, state, attrs in sensors:
        if push_sensor(entity_id, state, attrs):
            ok += 1

    log.info(f"Pushed {ok}/{len(sensors)} sensors to HA")


def main():
    log.info("Enphase Envoy → HA pusher starting")
    while True:
        try:
            collect_and_push()
        except Exception as e:
            log.error(f"Unhandled error: {e}")
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()