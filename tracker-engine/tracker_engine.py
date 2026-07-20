#!/usr/bin/env python3
"""
tracker_engine.py — AIS + ADS-B ingestion engine for CT105
Architecture:
  - AIS: UDP listener on port 10110 (fed by CT103 socat → broadcast)
  - ADS-B: HTTP poll of CT102 tar1090 every 5s
  - Each has its OWN database connection (psycopg2 is not thread-safe)
  - In-process metadata cache (MMSI→name/type, hex→nothing needed, tar1090 now provides r/t)
  - live_tracks: position history, pruned by DB cron
  - entities: vessel/aircraft identity, updated only when changed

Key safety rules:
  1. Never reference a variable in except that may not have been assigned yet
  2. Never share a psycopg2 connection across threads
  3. Always rollback on exception before next query
  4. Validate lat/lon before inserting
"""

import socket
import psycopg2
import psycopg2.extras
import logging
import threading
import time
import requests
from datetime import datetime, timezone

import pyais

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s [%(threadName)s]: %(message)s',
    datefmt='%H:%M:%S',
)
logger = logging.getLogger(__name__)

# ─── Config ──────────────────────────────────────────────────────────────────
DB_HOST     = "192.168.1.104"
DB_NAME     = "tracking_db"
DB_USER     = "tracker"
DB_PASS     = "pukalani"

UDP_IP      = "0.0.0.0"
UDP_PORT    = 10110

TAR1090_URL = "http://192.168.1.102/tar1090/data/aircraft.json"
ADSB_INTERVAL = 5   # seconds between ADS-B polls

AISHUB_URL = "https://data.aishub.net/ws.php?username=AH_2828_A392C354&format=1&output=json&compress=0"
AISHUB_INTERVAL = 60  # seconds between AISHub polls

# ─── Metadata cache ──────────────────────────────────────────────────────────
# Prevents repeated entity upserts for vessels we've already stored metadata for
# Key: MMSI string → dict with keys: name, vessel_type, callsign, last_stored
# We only re-write entity metadata if something changes or it's been > 1 hour
_vessel_meta_cache: dict = {}
_vessel_meta_lock  = threading.Lock()
META_REFRESH_SEC   = 3600  # re-check metadata every hour at most


def _vessel_needs_update(mmsi: str, name, vessel_type, callsign) -> bool:
    """Return True if we should write entity metadata to DB."""
    with _vessel_meta_lock:
        cached = _vessel_meta_cache.get(mmsi)
        if cached is None:
            return True
        if time.monotonic() - cached['ts'] > META_REFRESH_SEC:
            return True
        # Only update if something meaningful changed
        if (name and name != cached.get('name')) or \
           (vessel_type and vessel_type != cached.get('vessel_type')) or \
           (callsign and callsign != cached.get('callsign')):
            return True
        return False


def _cache_vessel_meta(mmsi: str, name, vessel_type, callsign):
    with _vessel_meta_lock:
        _vessel_meta_cache[mmsi] = {
            'name': name, 'vessel_type': vessel_type,
            'callsign': callsign, 'ts': time.monotonic(),
        }


# ─── DB helpers ──────────────────────────────────────────────────────────────
def get_db_connection(label: str = ""):
    """Get a dedicated DB connection. Each thread should call this once."""
    retries = 10
    for attempt in range(retries):
        try:
            conn = psycopg2.connect(
                host=DB_HOST, database=DB_NAME,
                user=DB_USER, password=DB_PASS,
                connect_timeout=5,
                application_name=f"tracker-engine-{label}",
            )
            conn.autocommit = False
            logger.info(f"[{label}] DB connected.")
            return conn
        except Exception as e:
            wait = min(2 ** attempt, 30)
            logger.warning(f"[{label}] DB connect failed (attempt {attempt+1}/{retries}): {e}. Retry in {wait}s")
            time.sleep(wait)
    logger.critical(f"[{label}] Cannot connect to DB after {retries} attempts — exiting thread.")
    return None


def safe_float(val):
    """Convert any value to float or None, safely handles 'ground', None, etc."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        try:
            return float(val)
        except (ValueError, TypeError):
            return None
    return None


def safe_int(val):
    if val is None:
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


def valid_position(lat, lon) -> bool:
    """Return True only if lat/lon is a plausible, non-null-island position."""
    if lat is None or lon is None:
        return False
    if abs(lat) > 90 or abs(lon) > 180:
        return False
    if lat == 0.0 and lon == 0.0:
        return False
    return True


# ─── AIS message processing ──────────────────────────────────────────────────
def process_ais_message(conn, raw_line: str):
    """
    Parse one NMEA AIS sentence and store it.
    All exceptions are caught and logged — never propagates to caller.
    """
    decoded = None  # MUST be declared before try block to avoid UnboundLocalError
    msg_type = None

    try:
        decoded = pyais.decode(raw_line.encode())
        msg_type = decoded.msg_type
        mmsi = str(decoded.mmsi)

        if not mmsi or mmsi == '0':
            return

        cur = conn.cursor()

        # ── Position messages: Type 1, 2, 3 (Class A) and 18 (Class B) ───────
        if msg_type in (1, 2, 3, 18):
            lat = safe_float(getattr(decoded, 'lat', None))
            lon = safe_float(getattr(decoded, 'lon', None))
            if not valid_position(lat, lon):
                return

            speed   = safe_float(getattr(decoded, 'speed', None))
            heading = safe_float(getattr(decoded, 'heading', None))
            course  = safe_float(getattr(decoded, 'course', None))
            rot     = safe_float(getattr(decoded, 'rot', None)) if msg_type in (1, 2, 3) else None
            nav_status = safe_int(getattr(decoded, 'status', None)) if msg_type in (1, 2, 3) else None

            # 511 means "not available" in AIS. Use Course Over Ground (COG) if heading is invalid.
            true_heading = course if heading == 511 else (heading or course)

            # Ensure entity exists (touch last_seen)
            cur.execute("""
                INSERT INTO entities (entity_id, entity_type)
                VALUES (%s, 'VESSEL')
                ON CONFLICT (entity_id) DO UPDATE SET last_seen = CURRENT_TIMESTAMP;
            """, (mmsi,))

            cur.execute("""
                INSERT INTO live_tracks (entity_id, location, speed, heading, rot, nav_status)
                VALUES (%s, ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s, %s, %s, %s);
            """, (mmsi, lon, lat, speed, true_heading, rot, nav_status))

            conn.commit()
            logger.info(f"AIS Type{msg_type}: MMSI {mmsi} lat={lat:.4f} lon={lon:.4f} spd={speed}")

        # ── Static voyage data: Type 5 (Class A) ──────────────────────────────
        elif msg_type == 5:
            vessel_name = getattr(decoded, 'shipname', None)
            vessel_type = safe_int(getattr(decoded, 'ship_type', None))
            callsign    = getattr(decoded, 'callsign', None)
            destination = getattr(decoded, 'destination', None)
            eta         = getattr(decoded, 'eta', None)
            to_bow      = safe_float(getattr(decoded, 'to_bow',      0)) or 0.0
            to_stern    = safe_float(getattr(decoded, 'to_stern',    0)) or 0.0
            to_port     = safe_float(getattr(decoded, 'to_port',     0)) or 0.0
            to_star     = safe_float(getattr(decoded, 'to_starboard', 0)) or 0.0
            draught     = safe_float(getattr(decoded, 'draught', None))
            length = to_bow + to_stern if (to_bow + to_stern) > 0 else None
            beam   = to_port + to_star if (to_port + to_star) > 0 else None

            # Clean strings
            if vessel_name: vessel_name = vessel_name.strip().rstrip('@') or None
            if callsign:    callsign    = callsign.strip().rstrip('@') or None
            if destination: destination = destination.strip().rstrip('@') or None

            # Only write if metadata changed (cache check)
            if _vessel_needs_update(mmsi, vessel_name, vessel_type, callsign):
                cur.execute("""
                    INSERT INTO entities (entity_id, entity_type, vessel_name, vessel_type,
                                         callsign, destination, eta, length, beam, draught)
                    VALUES (%s, 'VESSEL', %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (entity_id) DO UPDATE SET
                        last_seen   = CURRENT_TIMESTAMP,
                        vessel_name = COALESCE(EXCLUDED.vessel_name, entities.vessel_name),
                        vessel_type = COALESCE(EXCLUDED.vessel_type, entities.vessel_type),
                        callsign    = COALESCE(EXCLUDED.callsign,    entities.callsign),
                        destination = COALESCE(EXCLUDED.destination, entities.destination),
                        eta         = COALESCE(EXCLUDED.eta,         entities.eta),
                        length      = COALESCE(EXCLUDED.length,      entities.length),
                        beam        = COALESCE(EXCLUDED.beam,        entities.beam),
                        draught     = COALESCE(EXCLUDED.draught,     entities.draught);
                """, (mmsi, vessel_name, vessel_type, callsign, destination,
                      str(eta) if eta else None, length, beam, draught))
                conn.commit()
                _cache_vessel_meta(mmsi, vessel_name, vessel_type, callsign)
                logger.info(f"AIS Type5: MMSI {mmsi} name='{vessel_name}' type={vessel_type} dest='{destination}'")

        # ── Class B static data: Type 24 ──────────────────────────────────────
        elif msg_type == 24:
            vessel_name = getattr(decoded, 'shipname', None)
            callsign    = getattr(decoded, 'callsign', None)
            vessel_type = safe_int(getattr(decoded, 'ship_type', None))
            if vessel_name: vessel_name = vessel_name.strip().rstrip('@') or None
            if callsign:    callsign    = callsign.strip().rstrip('@') or None

            if _vessel_needs_update(mmsi, vessel_name, vessel_type, callsign):
                cur.execute("""
                    INSERT INTO entities (entity_id, entity_type, vessel_name, vessel_type, callsign)
                    VALUES (%s, 'VESSEL', %s, %s, %s)
                    ON CONFLICT (entity_id) DO UPDATE SET
                        last_seen   = CURRENT_TIMESTAMP,
                        vessel_name = COALESCE(EXCLUDED.vessel_name, entities.vessel_name),
                        vessel_type = COALESCE(EXCLUDED.vessel_type, entities.vessel_type),
                        callsign    = COALESCE(EXCLUDED.callsign,    entities.callsign);
                """, (mmsi, vessel_name, vessel_type, callsign))
                conn.commit()
                _cache_vessel_meta(mmsi, vessel_name, vessel_type, callsign)
                logger.info(f"AIS Type24: MMSI {mmsi} name='{vessel_name}'")

        # ── Aid to Navigation: Type 21 ─────────────────────────────────────────
        elif msg_type == 21:
            pass  # buoys / AtoN — ignore for now

        else:
            pass  # msg types 6,7,8,9,10–27 — not relevant for vessel tracking

        cur.close()

    except pyais.exceptions.InvalidNMEAMessageException:
        # Corrupt/truncated UDP packet — very common at range edges, silently skip
        pass
    except pyais.exceptions.UnknownMessageException:
        pass
    except Exception as e:
        # Safe logging — decoded may be None if pyais.decode itself failed
        mt = getattr(decoded, 'msg_type', msg_type) if decoded is not None else '?'
        logger.warning(f"AIS parse error (msg_type={mt}): {type(e).__name__}: {e}")
        try:
            conn.rollback()
        except Exception:
            pass


# ─── ADS-B poller thread ─────────────────────────────────────────────────────
def poll_adsb():
    """
    Polls tar1090 every ADSB_INTERVAL seconds and stores aircraft positions.
    Has its OWN dedicated DB connection (thread-safe).
    tar1090 now provides r (registration) and t (type) fields thanks to the
    aircraft CSV database we configured in readsb. We store them in entities
    but don't need a separate cache since tar1090 already does the lookup.
    """
    logger.info("ADS-B poller thread started.")
    conn = get_db_connection("adsb")
    if not conn:
        logger.error("ADS-B: cannot connect to DB — thread exiting.")
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
            for ac in aircraft:
                hex_code = ac.get("hex", "").lower().strip()
                if not hex_code:
                    continue

                lat     = safe_float(ac.get("lat"))
                lon     = safe_float(ac.get("lon"))
                if not valid_position(lat, lon):
                    continue

                speed   = safe_float(ac.get("gs"))
                heading = safe_float(ac.get("track") or ac.get("calc_track"))
                alt_raw = ac.get("alt_baro")
                altitude = 0.0 if alt_raw == "ground" else safe_float(alt_raw)
                vert_rate = safe_float(ac.get("baro_rate"))
                squawk  = ac.get("squawk")
                rssi    = safe_float(ac.get("rssi"))

                # tar1090 enriches with registration (r) and ICAO type (t) from the CSV db
                registration = (ac.get("r") or "").strip() or None
                ac_type      = (ac.get("t") or "").strip() or None
                flight       = (ac.get("flight") or "").strip() or None

                # Upsert entity — store registration+type; these are stable so COALESCE is correct
                cur.execute("""
                    INSERT INTO entities (entity_id, entity_type, vessel_name, callsign)
                    VALUES (%s, 'AIRCRAFT', %s, %s)
                    ON CONFLICT (entity_id) DO UPDATE SET
                        last_seen   = CURRENT_TIMESTAMP,
                        vessel_name = COALESCE(EXCLUDED.vessel_name, entities.vessel_name),
                        callsign    = COALESCE(EXCLUDED.callsign,    entities.callsign);
                """, (hex_code, registration, flight))

                # Store position track
                cur.execute("""
                    INSERT INTO live_tracks
                        (entity_id, location, speed, heading, altitude, vert_rate, squawk, rssi, source_type)
                    VALUES
                        (%s, ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s, %s, %s, %s, %s, %s, 'adsb');
                """, (hex_code, lon, lat, speed, heading, altitude, vert_rate, squawk, rssi))

            conn.commit()
            cur.close()

            if aircraft:
                logger.info(f"ADS-B: stored {len(aircraft)} aircraft positions")

        except requests.RequestException as e:
            logger.warning(f"ADS-B: tar1090 unreachable: {e}")
        except Exception as e:
            logger.error(f"ADS-B: unexpected error: {type(e).__name__}: {e}")
            try:
                conn.rollback()
            except Exception:
                pass

        time.sleep(ADSB_INTERVAL)


# ─── AISHub poller thread ────────────────────────────────────────────────────
def poll_aishub():
    """
    Polls the AISHub API every AISHUB_INTERVAL seconds and stores vessel positions.
    Has its OWN dedicated DB connection (thread-safe).
    """
    logger.info("AISHub poller thread started.")
    conn = get_db_connection("aishub")
    if not conn:
        logger.error("AISHub: cannot connect to DB — thread exiting.")
        return

    while True:
        try:
            resp = requests.get(AISHUB_URL, timeout=15)
            if resp.status_code != 200:
                time.sleep(AISHUB_INTERVAL)
                continue

            data = resp.json()
            if not isinstance(data, list) or len(data) < 2:
                time.sleep(AISHUB_INTERVAL)
                continue
                
            vessels = data[1]
            if not isinstance(vessels, list):
                time.sleep(AISHUB_INTERVAL)
                continue

            cur = conn.cursor()
            for v in vessels:
                mmsi_raw = v.get("MMSI")
                if not mmsi_raw:
                    continue
                mmsi = str(mmsi_raw).strip()

                lat = safe_float(v.get("LATITUDE"))
                lon = safe_float(v.get("LONGITUDE"))
                if not valid_position(lat, lon):
                    continue

                speed = safe_float(v.get("SOG"))
                heading = safe_float(v.get("HEADING"))
                course = safe_float(v.get("COG"))
                rot = safe_float(v.get("ROT"))
                nav_status = safe_int(v.get("NAVSTAT"))

                true_heading = course if heading == 511 else (heading or course)

                vessel_name = (v.get("NAME") or "").strip().rstrip('@') or None
                vessel_type = safe_int(v.get("TYPE"))
                callsign = (v.get("CALLSIGN") or "").strip().rstrip('@') or None
                destination = (v.get("DEST") or "").strip().rstrip('@') or None
                eta = v.get("ETA")
                draught = safe_float(v.get("DRAUGHT"))
                
                # Approximate dimensions
                to_bow = safe_float(v.get("A")) or 0.0
                to_stern = safe_float(v.get("B")) or 0.0
                to_port = safe_float(v.get("C")) or 0.0
                to_star = safe_float(v.get("D")) or 0.0
                length = to_bow + to_stern if (to_bow + to_stern) > 0 else None
                beam = to_port + to_star if (to_port + to_star) > 0 else None

                # Upsert entity if metadata changed
                if _vessel_needs_update(mmsi, vessel_name, vessel_type, callsign):
                    cur.execute("""
                        INSERT INTO entities (entity_id, entity_type, vessel_name, vessel_type,
                                             callsign, destination, eta, length, beam, draught)
                        VALUES (%s, 'VESSEL', %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (entity_id) DO UPDATE SET
                            last_seen   = CURRENT_TIMESTAMP,
                            vessel_name = COALESCE(EXCLUDED.vessel_name, entities.vessel_name),
                            vessel_type = COALESCE(EXCLUDED.vessel_type, entities.vessel_type),
                            callsign    = COALESCE(EXCLUDED.callsign,    entities.callsign),
                            destination = COALESCE(EXCLUDED.destination, entities.destination),
                            eta         = COALESCE(EXCLUDED.eta,         entities.eta),
                            length      = COALESCE(EXCLUDED.length,      entities.length),
                            beam        = COALESCE(EXCLUDED.beam,        entities.beam),
                            draught     = COALESCE(EXCLUDED.draught,     entities.draught);
                    """, (mmsi, vessel_name, vessel_type, callsign, destination,
                          str(eta) if eta else None, length, beam, draught))
                    _cache_vessel_meta(mmsi, vessel_name, vessel_type, callsign)

                # Touch last_seen even if metadata didn't change
                cur.execute("""
                    INSERT INTO entities (entity_id, entity_type)
                    VALUES (%s, 'VESSEL')
                    ON CONFLICT (entity_id) DO UPDATE SET last_seen = CURRENT_TIMESTAMP;
                """, (mmsi,))

                # Store position track
                # Notice we assume 'aishub' can be stored in source_type, or it falls back to whatever the default is.
                # Since the schema defines `source_type` (we saw it used for ADSB), we'll try providing it, but wait:
                # In AIS, `process_ais_message` didn't specify `source_type`. Let's just specify the columns we need.
                # Actually, the tracker_engine schema for live_tracks has `source_type`? Wait, I saw it in the ADS-B insert. 
                # Let's match the AIS insert:
                cur.execute("""
                    INSERT INTO live_tracks (entity_id, location, speed, heading, rot, nav_status)
                    VALUES (%s, ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s, %s, %s, %s);
                """, (mmsi, lon, lat, speed, true_heading, rot, nav_status))

            conn.commit()
            cur.close()

            if vessels:
                logger.info(f"AISHub: stored {len(vessels)} vessel positions")

        except requests.RequestException as e:
            logger.warning(f"AISHub: API unreachable: {e}")
        except Exception as e:
            logger.error(f"AISHub: unexpected error: {type(e).__name__}: {e}")
            try:
                conn.rollback()
            except Exception:
                pass

        time.sleep(AISHUB_INTERVAL)


# ─── AIS listener ────────────────────────────────────────────────────────────
def run_ais_listener():
    """
    Main loop: binds to UDP :10110, receives AIS NMEA sentences from CT103 socat,
    decodes them and stores to DB.
    Has its OWN dedicated DB connection.
    """
    logger.info("AIS listener thread started.")
    conn = get_db_connection("ais")
    if not conn:
        logger.error("AIS: cannot connect to DB — thread exiting.")
        return

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    sock.bind((UDP_IP, UDP_PORT))
    logger.info(f"AIS: listening on UDP {UDP_IP}:{UDP_PORT}")

    consecutive_errors = 0
    MAX_CONSECUTIVE = 10

    while True:
        try:
            data, addr = sock.recvfrom(4096)
            raw = data.decode('utf-8', errors='ignore').strip()
            consecutive_errors = 0

            for line in raw.splitlines():
                line = line.strip()
                if line.startswith("!AIVDM") or line.startswith("!AIVDO"):
                    process_ais_message(conn, line)

        except OSError as e:
            consecutive_errors += 1
            logger.error(f"AIS: socket error: {e}")
            if consecutive_errors >= MAX_CONSECUTIVE:
                logger.critical("AIS: too many socket errors, restarting in 10s")
                time.sleep(10)
                consecutive_errors = 0
        except Exception as e:
            consecutive_errors += 1
            logger.error(f"AIS: unexpected error: {type(e).__name__}: {e}")


# ─── Entry point ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    logger.info("Tracker Engine starting up.")
    logger.info("NOTE: AIS UDP listener is DISABLED here — ais-collector.py owns UDP :10110.")
    logger.info("This process handles: ADS-B polling (tar1090) + AISHub API polling only.")

    # ADS-B runs in a daemon thread (exits when main thread exits)
    adsb_thread = threading.Thread(target=poll_adsb, name="adsb", daemon=True)
    adsb_thread.start()

    # AISHub runs in a daemon thread
    aishub_thread = threading.Thread(target=poll_aishub, name="aishub", daemon=True)
    aishub_thread.start()

    # AIS UDP listener REMOVED — ais-collector.py owns UDP :10110 exclusively.
    # Having two processes share SO_REUSEADDR on the same UDP port splits packets
    # between them and breaks multi-part NMEA buffering. All AIS decoding is done
    # by ais-collector.py which also handles source_type tagging, AISHub relay,
    # multi-part buffering, route detection, and destination prediction.
    logger.info("Tracker Engine running (ADS-B + AISHub threads). Sleeping main thread.")
    import time as _time
    while True:
        _time.sleep(60)
