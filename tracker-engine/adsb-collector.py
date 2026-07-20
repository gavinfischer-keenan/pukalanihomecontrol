#!/usr/bin/env python3
"""
adsb-collector.py — Dedicated ADS-B collection service for CT105

Responsibilities:
  - Poll CT102 tar1090 every 5 seconds
  - Store aircraft positions to DB (entities + live_tracks)
  - Completely independent of AIS — no shared state, no shared threads

Extracted cleanly from tracker_engine.py.
"""

import psycopg2
import logging
import time
import requests

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s [%(threadName)s]: %(message)s',
    datefmt='%H:%M:%S',
)
logger = logging.getLogger(__name__)

# ─── Config ───────────────────────────────────────────────────────────────────
DB_HOST       = "192.168.1.104"
DB_NAME       = "tracking_db"
DB_USER       = "tracker"
DB_PASS       = "pukalani"
TAR1090_URL   = "http://192.168.1.102/tar1090/data/aircraft.json"
ADSB_INTERVAL = 5   # seconds between polls


# ─── Helpers ──────────────────────────────────────────────────────────────────
def safe_float(val):
    if val is None: return None
    if isinstance(val, (int, float)): return float(val)
    if isinstance(val, str):
        try: return float(val)
        except (ValueError, TypeError): return None
    return None

def valid_position(lat, lon) -> bool:
    if lat is None or lon is None: return False
    if abs(lat) > 90 or abs(lon) > 180: return False
    if lat == 0.0 and lon == 0.0: return False
    return True


# ─── DB connection ────────────────────────────────────────────────────────────
def get_db_connection():
    retries = 10
    for attempt in range(retries):
        try:
            conn = psycopg2.connect(
                host=DB_HOST, database=DB_NAME,
                user=DB_USER, password=DB_PASS,
                connect_timeout=5,
                application_name="adsb-collector",
            )
            conn.autocommit = False
            logger.info("DB connected.")
            return conn
        except Exception as e:
            wait = min(2 ** attempt, 30)
            logger.warning(f"DB connect failed ({attempt+1}/{retries}): {e}. Retry in {wait}s")
            time.sleep(wait)
    logger.critical("Cannot connect to DB after all retries — exiting.")
    return None


# ─── Main poll loop ───────────────────────────────────────────────────────────
def poll_adsb():
    logger.info("ADS-B poller starting.")
    conn = get_db_connection()
    if not conn:
        return

    while True:
        try:
            resp = requests.get(TAR1090_URL, timeout=5)
            if resp.status_code != 200:
                time.sleep(ADSB_INTERVAL)
                continue

            data     = resp.json()
            aircraft = [a for a in data.get("aircraft", [])
                        if a.get("lat") is not None and a.get("lon") is not None]

            cur = conn.cursor()
            stored = 0
            for ac in aircraft:
                hex_code = ac.get("hex", "").lower().strip()
                if not hex_code:
                    continue

                lat = safe_float(ac.get("lat"))
                lon = safe_float(ac.get("lon"))
                if not valid_position(lat, lon):
                    continue

                speed     = safe_float(ac.get("gs"))
                heading   = safe_float(ac.get("track") or ac.get("calc_track"))
                alt_raw   = ac.get("alt_baro")
                altitude  = 0.0 if alt_raw == "ground" else safe_float(alt_raw)
                vert_rate = safe_float(ac.get("baro_rate"))
                squawk    = ac.get("squawk")
                rssi      = safe_float(ac.get("rssi"))

                # tar1090 provides r=registration, t=ICAO type, flight=callsign
                registration = (ac.get("r")      or "").strip() or None
                flight       = (ac.get("flight") or "").strip() or None

                cur.execute("""
                    INSERT INTO entities (entity_id, entity_type, vessel_name, callsign)
                    VALUES (%s, 'AIRCRAFT', %s, %s)
                    ON CONFLICT (entity_id) DO UPDATE SET
                        last_seen   = CURRENT_TIMESTAMP,
                        vessel_name = COALESCE(EXCLUDED.vessel_name, entities.vessel_name),
                        callsign    = COALESCE(EXCLUDED.callsign,    entities.callsign);
                """, (hex_code, registration, flight))

                cur.execute("""
                    INSERT INTO live_tracks
                        (entity_id, location, speed, heading, altitude,
                         vert_rate, squawk, rssi, source_type)
                    VALUES
                        (%s, ST_SetSRID(ST_MakePoint(%s,%s),4326),
                         %s, %s, %s, %s, %s, %s, 'adsb');
                """, (hex_code, lon, lat, speed, heading, altitude, vert_rate, squawk, rssi))
                stored += 1

            conn.commit()
            cur.close()

            if stored:
                logger.info(f"Stored {stored} aircraft positions.")

        except requests.RequestException as e:
            logger.warning(f"tar1090 unreachable: {e}")
        except Exception as e:
            logger.error(f"Unexpected error: {type(e).__name__}: {e}")
            try: conn.rollback()
            except Exception: pass

        time.sleep(ADSB_INTERVAL)


# ─── Entry point ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    logger.info("ADS-B Collector starting.")
    poll_adsb()
