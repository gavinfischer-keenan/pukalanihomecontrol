#!/usr/bin/env python3
"""Push Ecowitt weather data from CT108 dashboard API to HA.
Hardened version - skips push when data is stale or unavailable.
Runs as a cron job every 5 minutes on the Proxmox host."""

import json
import urllib.request
import urllib.error
import sys
import time

HA_URL = "http://192.168.1.19:8123"
DASHBOARD_URL = "http://192.168.1.108:3001"
STALE_THRESHOLD = 600  # 10 minutes - if data older than this, skip


def get_ha_token():
    return open("/root/.ha_token").read().strip()


def fetch_ecowitt():
    req = urllib.request.Request(f"{DASHBOARD_URL}/api/ecowitt/current")
    try:
        resp = urllib.request.urlopen(req, timeout=10)
        result = json.loads(resp.read())
        data = result.get("data", result)
        stale = result.get("stale", False)
        return data, stale
    except Exception as e:
        print(f"Error fetching ecowitt: {e}", file=sys.stderr)
        return None, True


def push_to_ha(entity_id, state, attributes):
    token = get_ha_token()
    data = json.dumps({"state": str(state), "attributes": attributes}).encode()
    req = urllib.request.Request(
        f"{HA_URL}/api/states/{entity_id}",
        data=data,
        method="POST"
    )
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    try:
        urllib.request.urlopen(req, timeout=10)
        return True
    except urllib.error.HTTPError as e:
        print(f"Error pushing {entity_id}: HTTP {e.code}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"Error pushing {entity_id}: {e}", file=sys.stderr)
        return False


def main():
    data, stale = fetch_ecowitt()
    if not data:
        print("No ecowitt data available - skipping push")
        # Push health sensor to indicate offline
        push_to_ha("sensor.ecowitt_health", "offline", {
            "friendly_name": "Ecowitt Weather Station Health",
            "icon": "mdi:weather-cloudy-alert",
        })
        sys.exit(1)

    if stale:
        print("Ecowitt data is stale - pushing but marking as stale")

    solar_rad = data.get("solar_rad", 0)
    uv_index = data.get("uv_index", 0)
    temp_f = data.get("temp_out_f", 0)
    humidity = data.get("humidity_out", 0)
    wind_spd = data.get("wind_spd_mph", 0)
    wind_dir = data.get("wind_dir", 0)
    wind_gust = data.get("wind_gust_mph", 0)
    rain_rate = data.get("rain_rate_in", 0)
    rain_daily = data.get("rain_daily_in", 0)
    baro = data.get("baro_rel_inhg", 0)
    dew_point = data.get("dew_point_f", 0)

    # Validate temp range (sanity check)
    if not (30 < float(temp_f) < 120):
        print(f"Temp {temp_f}F outside sane range - possible bad data, skipping")
        return

    ok = 0
    total = 0

    sensors = [
        ("sensor.ecowitt_solar_radiation", solar_rad, {
            "friendly_name": "Ecowitt Solar Radiation",
            "unit_of_measurement": "W/m\u00b2",
            "device_class": "irradiance",
            "state_class": "measurement",
            "icon": "mdi:white-balance-sunny"
        }),
        ("sensor.ecowitt_uv_index", uv_index, {
            "friendly_name": "Ecowitt UV Index",
            "unit_of_measurement": "UV",
            "state_class": "measurement",
            "icon": "mdi:weather-sunny-alert"
        }),
        ("sensor.ecowitt_outdoor_temperature", temp_f, {
            "friendly_name": "Ecowitt Outdoor Temperature",
            "unit_of_measurement": "\u00b0F",
            "device_class": "temperature",
            "state_class": "measurement",
            "icon": "mdi:thermometer"
        }),
        ("sensor.ecowitt_outdoor_humidity", humidity, {
            "friendly_name": "Ecowitt Outdoor Humidity",
            "unit_of_measurement": "%",
            "device_class": "humidity",
            "state_class": "measurement",
            "icon": "mdi:water-percent"
        }),
        ("sensor.ecowitt_wind_speed", wind_spd, {
            "friendly_name": "Ecowitt Wind Speed",
            "unit_of_measurement": "mph",
            "state_class": "measurement",
            "icon": "mdi:weather-windy"
        }),
        ("sensor.ecowitt_wind_gust", wind_gust, {
            "friendly_name": "Ecowitt Wind Gust",
            "unit_of_measurement": "mph",
            "state_class": "measurement",
            "icon": "mdi:weather-windy-variant"
        }),
        ("sensor.ecowitt_wind_direction", wind_dir, {
            "friendly_name": "Ecowitt Wind Direction",
            "unit_of_measurement": "\u00b0",
            "state_class": "measurement",
            "icon": "mdi:compass"
        }),
        ("sensor.ecowitt_rain_rate", rain_rate, {
            "friendly_name": "Ecowitt Rain Rate",
            "unit_of_measurement": "in/hr",
            "state_class": "measurement",
            "icon": "mdi:weather-rainy"
        }),
        ("sensor.ecowitt_rain_daily", rain_daily, {
            "friendly_name": "Ecowitt Daily Rain",
            "unit_of_measurement": "in",
            "state_class": "total_increasing",
            "icon": "mdi:weather-pouring"
        }),
        ("sensor.ecowitt_barometric_pressure", baro, {
            "friendly_name": "Ecowitt Barometric Pressure",
            "unit_of_measurement": "inHg",
            "device_class": "pressure",
            "state_class": "measurement",
            "icon": "mdi:gauge"
        }),
        ("sensor.ecowitt_dew_point", dew_point, {
            "friendly_name": "Ecowitt Dew Point",
            "unit_of_measurement": "\u00b0F",
            "device_class": "temperature",
            "state_class": "measurement",
            "icon": "mdi:water-thermometer"
        }),
    ]

    for entity_id, state, attrs in sensors:
        total += 1
        if push_to_ha(entity_id, state, attrs):
            ok += 1

    # Health sensor
    push_to_ha("sensor.ecowitt_health", "online" if not stale else "stale", {
        "friendly_name": "Ecowitt Weather Station Health",
        "icon": "mdi:weather-partly-cloudy" if not stale else "mdi:weather-cloudy-alert",
        "sensors_pushed": f"{ok}/{total}",
    })

    print(f"Pushed {ok}/{total}: solar={solar_rad}W/m2, UV={uv_index}, "
          f"temp={temp_f}F, hum={humidity}%, wind={wind_spd}mph g{wind_gust}, "
          f"rain={rain_rate}in/hr, baro={baro}inHg")


if __name__ == "__main__":
    main()
