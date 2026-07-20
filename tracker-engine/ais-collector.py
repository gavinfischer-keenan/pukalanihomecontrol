#!/usr/bin/env python3
"""
ais-collector.py — Multi-source AIS collection with best-data merge

Sources (priority order for position):
  1. LOCAL ANTENNA (source_type='ais')  — direct hardware, always preferred if fresh
  2. AISSTREAM.IO  (source_type='aisstream') — WebSocket global feed, fills gaps

Merge strategy:
  - Position: local antenna wins if last heard < LOCAL_WINS_SEC ago; otherwise aisstream fills
  - Metadata (name/type/dest): additive COALESCE — first good value wins, never overwritten with null
  - Both sources write their own live_tracks rows so trail history is complete
  - Server query sorts: fresh local > fresh aisstream > stale local > stale aisstream

Also:
  - AISHub UDP forwarder stub (activate when port assigned)
  - Vessel route detector (port arrivals/departures)
  - Destination predictor thread (runs every 10 min)
"""

import json
import math
import socket
import urllib.request
import json
import threading
import time
import websocket
import requests
import re
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

from websocket import WebSocketTimeoutException
from datetime import datetime, timezone

import psycopg2
import pyais
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s [%(threadName)s]: %(message)s',
    datefmt='%H:%M:%S',
)
logger = logging.getLogger(__name__)

# ─── Config ───────────────────────────────────────────────────────────────────
DB_HOST  = "192.168.1.104"
DB_NAME  = "tracking_db"
DB_USER  = "tracker"
DB_PASS  = "pukalani"

UDP_IP   = "0.0.0.0"
UDP_PORT = 10110

# ─── Local antenna ────────────────────────────────────────────────────────────
# Set False while hardware is offline. Set True when new USB AIS receiver arrives.
#
# TO RE-ENABLE when new hardware arrives:
#   1. Plug USB AIS stick into Proxmox host
#   2. Verify:  ls /dev/ttyUSB0   (or /dev/ttyAIS via udev symlink)
#   3. Enable:  systemctl enable --now ais-forwarder   (on Proxmox host)
#               Service file: /etc/systemd/system/ais-forwarder.service
#               (socat reads serial, UDP unicasts to 192.168.1.105:10110)
#   4. Set LOCAL_ANTENNA_ENABLED = True  below and redeploy this file
#   5. Local antenna will immediately take priority over aisstream
#      for any vessel it hears (see LOCAL_WINS_SEC below)
#
LOCAL_ANTENNA_ENABLED = True    # ← flip to False if hardware goes offline again

# If local antenna heard a vessel within this many seconds, it wins over aisstream
LOCAL_WINS_SEC = 90

# ─── Home base ───────────────────────────────────────────────────────────────
# Used to bound AISStream subscription and DB vessel query
HOME_LAT =  21.2855   # 3786 Pukalani Pl, Honolulu
HOME_LON = -157.7969
RANGE_NM =  200       # nautical miles — subscription + DB filter radius

# ─── AISStream.io config ──────────────────────────────────────────────────────
AISSTREAM_ENABLED = True
AISSTREAM_KEY     = "c17ec7582694c240a7fb38ef281e18a4cdfdfd4a"
AISSTREAM_URL     = "wss://stream.aisstream.io/v0/stream"

# Bounding box for AISStream subscription.
# Calculated: 200nm around home (21.2855N, -157.7969W)
#   Lat pad  = 200nm / 60nm-per-deg          = 3.33°
#   Lon pad  = 200nm / (60 * cos(21.3°)) nm  = 3.58°
# Using a rectangle slightly generous on edges; PostGIS circle filter in
# server.js enforces the true 200nm radius on what gets served to the map.
AISSTREAM_BBOX = [[[  # [[lat_min, lon_min], [lat_max, lon_max]]  (aisstream order)
    [HOME_LAT - 3.34, HOME_LON - 3.59],
    [HOME_LAT + 3.34, HOME_LON + 3.59],
]]]

# ─── AISHub stub config ───────────────────────────────────────────────────────
# AISHub sharing — send local NMEA to AISHub, receive their global feed back
AISHUB_ENABLED  = True
AISHUB_HOST     = "data.aishub.net"   # 144.76.105.244
AISHUB_TX_PORT  = 2828                # UDP: send our NMEA here
AISHUB_RX_PORT  = 2829                # UDP: listen for their feed back (AISHub assigns)
AISHUB_USERNAME = "AH_2828_A392C354"  # API key for webservice
# Legacy alias so existing references still work
AISHUB_PORT     = AISHUB_TX_PORT


# ─── Hawaii port geofences ────────────────────────────────────────────────────
HAWAII_PORTS = [
    ("PHNL_harbor",   "Honolulu Harbor",          21.3069, -157.8700, 0.8),
    ("PHNL_pier",     "Pier 38 / Aloha Tower",    21.3050, -157.8680, 0.5),
    ("kahului",       "Kahului Harbor, Maui",     20.8960, -156.4690, 0.7),
    ("kawaihae",      "Kawaihae Harbor, HI",      20.0370, -155.8310, 0.6),
    ("nawiliwili",    "Nawiliwili, Kauai",         21.9550, -159.3510, 0.6),
    ("kaumalapau",    "Kaumalapau, Lanai",         20.7840, -156.9990, 0.5),
    ("kaunakakai",    "Kaunakakai, Molokai",       21.0940, -157.0230, 0.5),
    ("barbers_point", "Barbers Point Anchorage",  21.3140, -158.1190, 1.0),
    ("pearl_harbor",  "Pearl Harbor",              21.3564, -157.9650, 0.8),
]

# ─── Shared state ─────────────────────────────────────────────────────────────
# Tracks when we last received a position from LOCAL ANTENNA per MMSI.
# Used to gate aisstream writes — if local is fresh, aisstream position is suppressed.
_local_last_seen: dict = {}   # mmsi -> monotonic timestamp
_local_last_lock = threading.Lock()

# Vessel metadata cache — prevents redundant entity upserts
_vessel_meta_cache: dict = {}
_vessel_meta_lock  = threading.Lock()
META_REFRESH_SEC   = 3600

# Vessel last position for route detection
_vessel_last_pos: dict = {}
_vessel_last_lock = threading.Lock()

# ─── Multi-part NMEA sentence buffer ──────────────────────────────────────────
# AIS Type 5 and Type 24 arrive as 2-sentence sequences over separate UDP packets.
# Buffer them here until all parts have arrived, then decode together.
# Key: (total_count, seq_id, channel)  Value: {part_num: raw_line, ts: monotonic}
_mp_buffer: dict = {}          # multipart sentence buffer
_mp_lock = threading.Lock()
MP_EXPIRE_SEC = 10.0           # drop incomplete sets after 10 seconds

def _mp_prune():
    """Expire stale incomplete multi-part sets (called on each new arrival)."""
    now = time.monotonic()
    stale = [k for k, v in _mp_buffer.items() if now - v['ts'] > MP_EXPIRE_SEC]
    for k in stale:
        _mp_buffer.pop(k, None)

def _mp_add(raw_line: str):
    """
    Add a NMEA sentence to the multi-part buffer.
    Returns a list of raw lines (all parts) when the set is complete, else None.
    Format: !AIVDM,total,partnum,seqid,channel,payload,pad
    """
    try:
        fields = raw_line.split(',')
        total   = int(fields[1])
        partnum = int(fields[2])
        seqid   = fields[3]       # may be empty string for single-part
        channel = fields[4]
    except (IndexError, ValueError):
        return [raw_line]          # malformed — pass through as-is

    if total == 1:
        return [raw_line]          # single-part: no buffering needed

    key = (total, seqid, channel)
    with _mp_lock:
        _mp_prune()
        if key not in _mp_buffer:
            _mp_buffer[key] = {'ts': time.monotonic()}
        _mp_buffer[key][partnum] = raw_line
        _mp_buffer[key]['ts']    = time.monotonic()
        # Check if we have all parts
        parts = [_mp_buffer[key].get(i) for i in range(1, total + 1)]
        if all(parts):
            _mp_buffer.pop(key)
            return parts           # complete set — ready to decode
    return None                    # still waiting



# ─── AISHub — bidirectional integration ───────────────────────────────────────
# TX: we send every locally-received NMEA sentence to AISHub UDP:2828
# RX: AISHub sends their global feed back; we decode it identically to
#     the aisstream path so vessel names/types enrich our DB immediately.
_aishub_sock = None

def _init_aishub_socket():
    global _aishub_sock
    if AISHUB_ENABLED and AISHUB_HOST:
        _aishub_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        logger.info(f"AISHub TX forwarder ready → {AISHUB_HOST}:{AISHUB_TX_PORT}")
    else:
        logger.info("AISHub: disabled")

def forward_to_aishub(raw_nmea: str):
    """Relay raw NMEA sentence to AISHub UDP TX port. Called for every local sentence."""
    if not AISHUB_ENABLED or not _aishub_sock:
        return
    try:
        sentence = raw_nmea.rstrip('\r\n') + '\r\n'
        _aishub_sock.sendto(sentence.encode('ascii', errors='replace'),
                            (AISHUB_HOST, AISHUB_TX_PORT))
    except Exception as e:
        logger.debug(f"AISHub TX error: {e}")

def run_aishub_receiver():
    """
    Background thread: HTTP polling of AISHub webservice every 65 seconds.
    Replaces the UDP receiver, as AISHub uses a REST API for data retrieval.
    """
    if not AISHUB_ENABLED:
        logger.info("AISHub RX: disabled")
        return

    conn = get_db_connection("aishub_rx")
    if not conn:
        logger.error("AISHub RX: DB connect failed")
        return

    logger.info("AISHub RX: started HTTP poller (every 75s)")
    url = f"http://data.aishub.net/ws.php?username={AISHUB_USERNAME}&format=1&output=json&compress=0&latmin=18&latmax=23&lonmin=-161&lonmax=-154"
    
    consecutive_errors = 0
    while True:
        try:
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=15) as response:
                data = json.loads(response.read().decode('utf-8'))
            
            # format=1 returns: [{"ERROR": false}, [{"MMSI": ...}, ...]]
            if isinstance(data, list) and len(data) >= 2:
                if data[0].get("ERROR"):
                    logger.error(f"AISHub API Error: {data[0].get('ERROR_MESSAGE')}")
                else:
                    vessels = data[1]
                    logger.info(f"AISHub API: retrieved {len(vessels)} vessels")
                    for v in vessels:
                        _process_aishub_api_message(conn, v)
                    consecutive_errors = 0
            else:
                logger.warning(f"AISHub API: unexpected format: {str(data)[:100]}")
        except Exception as e:
            consecutive_errors += 1
            logger.error(f"AISHub API fetch error: {type(e).__name__}: {e}")
        
        time.sleep(75)

def _process_aishub_api_message(conn, v):
    """
    Process a vessel dictionary returned from AISHub API.
    """
    try:
        mmsi = str(v.get('MMSI', '')).strip()
        if not mmsi or mmsi == '0':
            return
            
        cur = conn.cursor()
        
        vname = (v.get('NAME') or '').strip() or None
        vtype = v.get('TYPE') or None
        callsign = (v.get('CALLSIGN') or '').strip() or None
        destination = (v.get('DEST') or '').strip() or None
        
        # Upsert entities (metadata)
        if vname or vtype:
            cur.execute('''
                INSERT INTO entities (entity_id, entity_type, vessel_name, vessel_type,
                                     callsign, destination, first_seen, last_seen)
                VALUES (%s,'VESSEL',%s,%s,%s,%s,NOW(),NOW())
                ON CONFLICT (entity_id) DO UPDATE SET
                    vessel_name  = COALESCE(entities.vessel_name,  EXCLUDED.vessel_name),
                    vessel_type  = COALESCE(entities.vessel_type,  EXCLUDED.vessel_type),
                    callsign     = COALESCE(entities.callsign,     EXCLUDED.callsign),
                    destination  = COALESCE(entities.destination,  EXCLUDED.destination),
                    last_seen    = NOW();
            ''', (mmsi, vname, vtype, callsign, destination))
            
        # Check if local antenna has a recent fix
        with _local_last_lock:
            local_ts = _local_last_seen.get(mmsi, 0)
        age_local = time.monotonic() - local_ts
        
        if age_local < LOCAL_WINS_SEC:
            cur.close()
            return  # local antenna is fresher — skip AISHub position

        lat = v.get('LATITUDE')
        lon = v.get('LONGITUDE')
        if lat is None or lon is None or lat == 0.0 or lon == 0.0:
            cur.close()
            return
            
        speed = v.get('SOG')
        heading = v.get('HEADING') or v.get('COG')
        rot = None
        nav_st = v.get('NAVSTAT')
        
        # Ensure entity exists before inserting live_track
        cur.execute('''
            INSERT INTO entities (entity_id, entity_type, first_seen, last_seen)
            VALUES (%s,'VESSEL',NOW(),NOW())
            ON CONFLICT (entity_id) DO UPDATE SET last_seen=NOW();
        ''', (mmsi,))
        
        # Insert position track
        cur.execute('''
            INSERT INTO live_tracks
                (entity_id, location, speed, heading, rot, nav_status,
                 source_type, recorded_at)
            VALUES (
                %s,
                ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography,
                %s,%s,%s,%s,'aishub',NOW()
            );
        ''', (mmsi, lon, lat, speed, heading, rot, nav_st))
        
        conn.commit()
        cur.close()
        
    except Exception as e:
        logger.debug(f"AISHub API DB insert error: {type(e).__name__}: {e}")
        try: conn.rollback()
        except: pass

def _process_aishub_api_message(conn, v):
    """
    Process a vessel dictionary returned from AISHub API.
    """
    try:
        mmsi = str(v.get('MMSI', '')).strip()
        if not mmsi or mmsi == '0':
            return
            
        cur = conn.cursor()
        
        vname = (v.get('NAME') or '').strip() or None
        vtype = v.get('TYPE') or None
        callsign = (v.get('CALLSIGN') or '').strip() or None
        destination = (v.get('DEST') or '').strip() or None
        
        # Upsert entities (metadata)
        if vname or vtype:
            cur.execute('''
                INSERT INTO entities (entity_id, entity_type, vessel_name, vessel_type,
                                     callsign, destination, first_seen, last_seen)
                VALUES (%s,'VESSEL',%s,%s,%s,%s,NOW(),NOW())
                ON CONFLICT (entity_id) DO UPDATE SET
                    vessel_name  = COALESCE(entities.vessel_name,  EXCLUDED.vessel_name),
                    vessel_type  = COALESCE(entities.vessel_type,  EXCLUDED.vessel_type),
                    callsign     = COALESCE(entities.callsign,     EXCLUDED.callsign),
                    destination  = COALESCE(entities.destination,  EXCLUDED.destination),
                    last_seen    = NOW();
            ''', (mmsi, vname, vtype, callsign, destination))
            
        # Check if local antenna has a recent fix
        with _local_last_lock:
            local_ts = _local_last_seen.get(mmsi, 0)
        age_local = time.monotonic() - local_ts
        
        if age_local < LOCAL_WINS_SEC:
            cur.close()
            return  # local antenna is fresher — skip AISHub position

        lat = v.get('LATITUDE')
        lon = v.get('LONGITUDE')
        if lat is None or lon is None or lat == 0.0 or lon == 0.0:
            cur.close()
            return
            
        speed = v.get('SOG')
        heading = v.get('HEADING') or v.get('COG')
        rot = None
        nav_st = v.get('NAVSTAT')
        
        # Ensure entity exists before inserting live_track
        cur.execute('''
            INSERT INTO entities (entity_id, entity_type, first_seen, last_seen)
            VALUES (%s,'VESSEL',NOW(),NOW())
            ON CONFLICT (entity_id) DO UPDATE SET last_seen=NOW();
        ''', (mmsi,))
        
        # Insert position track
        cur.execute('''
            INSERT INTO live_tracks
                (entity_id, location, speed, heading, rot, nav_status,
                 source_type, recorded_at)
            VALUES (
                %s,
                ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography,
                %s,%s,%s,%s,'aishub',NOW()
            );
        ''', (mmsi, lon, lat, speed, heading, rot, nav_st))
        
        conn.commit()
        cur.close()
        
    except Exception as e:
        logger.debug(f"AISHub API DB insert error: {type(e).__name__}: {e}")
        try: conn.rollback()
        except: pass

def safe_float(val):
    if val is None: return None
    if isinstance(val, (int, float)): return float(val)
    if isinstance(val, str):
        try: return float(val)
        except: return None
    return None

def safe_int(val):
    if val is None: return None
    try: return int(val)
    except: return None

def valid_position(lat, lon) -> bool:
    if lat is None or lon is None: return False
    if abs(lat) > 90 or abs(lon) > 180: return False
    if lat == 0.0 and lon == 0.0: return False
    return True

def nm_distance(lat1, lon1, lat2, lon2) -> float:
    R = 3440.065
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.asin(math.sqrt(max(0, a)))

def nearest_port(lat, lon):
    for port_id, name, plat, plon, radius in HAWAII_PORTS:
        if nm_distance(lat, lon, plat, plon) <= radius:
            return port_id, name
    return None, None

def local_is_fresh(mmsi: str) -> bool:
    """Return True if local antenna gave us a position within LOCAL_WINS_SEC."""
    with _local_last_lock:
        ts = _local_last_seen.get(mmsi)
        return ts is not None and (time.monotonic() - ts) < LOCAL_WINS_SEC

def mark_local_seen(mmsi: str):
    with _local_last_lock:
        _local_last_seen[mmsi] = time.monotonic()


# ─── Metadata cache helpers ───────────────────────────────────────────────────
def _vessel_needs_update(mmsi, name, vessel_type, callsign) -> bool:
    with _vessel_meta_lock:
        cached = _vessel_meta_cache.get(mmsi)
        if cached is None: return True
        if time.monotonic() - cached['ts'] > META_REFRESH_SEC: return True
        if (name and name != cached.get('name')) or \
           (vessel_type and vessel_type != cached.get('vessel_type')) or \
           (callsign and callsign != cached.get('callsign')):
            return True
        return False

def _cache_vessel_meta(mmsi, name, vessel_type, callsign):
    with _vessel_meta_lock:
        _vessel_meta_cache[mmsi] = {
            'name': name, 'vessel_type': vessel_type,
            'callsign': callsign, 'ts': time.monotonic(),
        }


# ─── DB helpers ───────────────────────────────────────────────────────────────
def get_db_connection(label: str = ""):
    retries = 10
    for attempt in range(retries):
        try:
            conn = psycopg2.connect(
                host=DB_HOST, database=DB_NAME,
                user=DB_USER, password=DB_PASS,
                connect_timeout=5,
                application_name=f"ais-collector-{label}",
            )
            conn.autocommit = False
            logger.info(f"[{label}] DB connected.")
            return conn
        except Exception as e:
            wait = min(2 ** attempt, 30)
            logger.warning(f"[{label}] DB connect failed ({attempt+1}/{retries}): {e}. Retry in {wait}s")
            time.sleep(wait)
    logger.critical(f"[{label}] Cannot connect — giving up.")
    return None


# ─── Core DB write: position ──────────────────────────────────────────────────
def write_position(conn, mmsi: str, lat: float, lon: float,
                   speed=None, heading=None, rot=None,
                   nav_status=None, source_type='ais'):
    """
    Upsert entity existence and insert one live_tracks row.
    Thread-safe: each thread has its own conn.
    Returns True on success.
    """
    try:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO entities (entity_id, entity_type)
            VALUES (%s, 'VESSEL')
            ON CONFLICT (entity_id) DO UPDATE SET last_seen = CURRENT_TIMESTAMP;
        """, (mmsi,))
        cur.execute("""
            INSERT INTO live_tracks
                (entity_id, location, speed, heading, rot, nav_status, source_type)
            VALUES (%s, ST_SetSRID(ST_MakePoint(%s,%s),4326), %s, %s, %s, %s, %s);
        """, (mmsi, lon, lat, speed, heading, rot, nav_status, source_type))
        conn.commit()
        cur.close()
        return True
    except Exception as e:
        logger.warning(f"write_position({mmsi}) error: {e}")
        try: conn.rollback()
        except: pass
        return False


def write_metadata(conn, mmsi: str, vessel_name=None, vessel_type=None,
                   callsign=None, destination=None, eta=None,
                   length=None, beam=None, draught=None):
    """
    Upsert entity metadata. Uses COALESCE so existing good data is never
    overwritten by null from a lower-quality source.
    """
    if not _vessel_needs_update(mmsi, vessel_name, vessel_type, callsign):
        return
    try:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO entities
                (entity_id, entity_type, vessel_name, vessel_type,
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
        cur.close()
        _cache_vessel_meta(mmsi, vessel_name, vessel_type, callsign)
    except Exception as e:
        logger.warning(f"write_metadata({mmsi}) error: {e}")
        try: conn.rollback()
        except: pass


# ─── Route detection ──────────────────────────────────────────────────────────
def check_route_event(conn, mmsi: str, lat: float, lon: float):
    port_id, port_name = nearest_port(lat, lon)
    with _vessel_last_lock:
        prev = _vessel_last_pos.get(mmsi)
        prev_port = prev.get('port') if prev else None
        _vessel_last_pos[mmsi] = {
            'lat': lat, 'lon': lon, 'ts': datetime.now(timezone.utc),
            'port': port_id,
        }
        if port_id and prev_port != port_id and prev_port is None:
            depart_port = prev.get('depart_port') if prev else None
            depart_time = prev.get('depart_time') if prev else None
            if depart_port and depart_time:
                try:
                    cur = conn.cursor()
                    cur.execute("SELECT vessel_name, vessel_type FROM entities WHERE entity_id=%s", (mmsi,))
                    row = cur.fetchone()
                    arrive_time = datetime.now(timezone.utc)
                    elapsed_hrs = (arrive_time - depart_time).total_seconds() / 3600.0
                    dist = nm_distance(prev.get('depart_lat', lat), prev.get('depart_lon', lon), lat, lon)
                    avg_spd = (dist / elapsed_hrs) if elapsed_hrs > 0.01 else None
                    cur.execute("""
                        INSERT INTO vessel_routes
                            (mmsi, vessel_name, vessel_type,
                             depart_port, arrive_port,
                             depart_time, arrive_time, avg_speed, distance_nm)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    """, (mmsi, row[0] if row else None, row[1] if row else None,
                          depart_port, port_name, depart_time, arrive_time, avg_spd, dist))
                    conn.commit()
                    cur.close()
                    logger.info(f"Route: {mmsi} {depart_port}→{port_name} {dist:.1f}nm")
                except Exception as e:
                    logger.warning(f"Route record error: {e}")
                    try: conn.rollback()
                    except: pass
        elif not port_id and prev_port:
            _vessel_last_pos[mmsi]['depart_port'] = prev_port
            _vessel_last_pos[mmsi]['depart_time'] = datetime.now(timezone.utc)
            _vessel_last_pos[mmsi]['depart_lat']  = lat
            _vessel_last_pos[mmsi]['depart_lon']  = lon
            logger.info(f"Departure: {mmsi} leaving {prev_port}")


# ─── Local NMEA antenna decoder ───────────────────────────────────────────────
def process_ais_message(conn, raw_lines):
    """
    Decode one complete AIS message (may be multi-part) from local antenna.
    raw_lines: list of raw NMEA strings (all parts of the message).
    """
    decoded  = None
    msg_type = None
    try:
        # Decode: pass all parts together so pyais can assemble multi-part messages
        decoded  = pyais.decode(*[l.encode() for l in raw_lines])
        msg_type = decoded.msg_type
        mmsi     = str(decoded.mmsi)
        if not mmsi or mmsi == '0':
            return

        forward_to_aishub(raw_lines[0])

        if msg_type in (1, 2, 3, 18):
            lat     = safe_float(getattr(decoded, 'lat',    None))
            lon     = safe_float(getattr(decoded, 'lon',    None))
            if not valid_position(lat, lon): return
            speed      = safe_float(getattr(decoded, 'speed',   None))
            heading    = safe_float(getattr(decoded, 'heading',  None))
            course     = safe_float(getattr(decoded, 'course',   None))
            rot        = safe_float(getattr(decoded, 'rot',      None)) if msg_type in (1,2,3) else None
            nav_status = safe_int(getattr(decoded,   'status',  None)) if msg_type in (1,2,3) else None
            true_heading = course if heading == 511 else (heading or course)

            if write_position(conn, mmsi, lat, lon, speed, true_heading, rot, nav_status, 'ais'):
                mark_local_seen(mmsi)   # ← flag this MMSI as freshly heard from hardware
                logger.info(f"AIS local {msg_type}: {mmsi} {lat:.4f},{lon:.4f} spd={speed} hdg={true_heading}")
                try: check_route_event(conn, mmsi, lat, lon)
                except: pass

        elif msg_type == 5:
            vn  = getattr(decoded, 'shipname',    None)
            vt  = safe_int(getattr(decoded, 'ship_type', None))
            cs  = getattr(decoded, 'callsign',    None)
            dst = getattr(decoded, 'destination', None)
            eta = getattr(decoded, 'eta',         None)
            to_bow  = safe_float(getattr(decoded, 'to_bow',       0)) or 0.0
            to_stern= safe_float(getattr(decoded, 'to_stern',     0)) or 0.0
            to_port = safe_float(getattr(decoded, 'to_port',      0)) or 0.0
            to_star = safe_float(getattr(decoded, 'to_starboard', 0)) or 0.0
            draught = safe_float(getattr(decoded, 'draught', None))
            length = to_bow + to_stern if (to_bow + to_stern) > 0 else None
            beam   = to_port + to_star if (to_port + to_star) > 0 else None
            if vn:  vn  = vn.strip().rstrip('@')  or None
            if cs:  cs  = cs.strip().rstrip('@')   or None
            if dst: dst = dst.strip().rstrip('@')  or None
            write_metadata(conn, str(decoded.mmsi), vn, vt, cs, dst,
                           str(eta) if eta else None, length, beam, draught)
            logger.info(f"AIS local 5 (name): {decoded.mmsi} name='{vn}' dest='{dst}'")

        elif msg_type == 24:
            vn = getattr(decoded, 'shipname', None)
            cs = getattr(decoded, 'callsign',  None)
            vt = safe_int(getattr(decoded, 'ship_type', None))
            if vn: vn = vn.strip().rstrip('@') or None
            if cs: cs = cs.strip().rstrip('@') or None
            write_metadata(conn, str(decoded.mmsi), vn, vt, cs)
            if vn:
                logger.info(f"AIS local 24 (name): {decoded.mmsi} name='{vn}'")

        elif msg_type == 21:
            pass  # AtoN buoys — suppress

    except pyais.exceptions.InvalidNMEAMessageException: pass
    except pyais.exceptions.UnknownMessageException: pass
    except Exception as e:
        mt = getattr(decoded, 'msg_type', msg_type) if decoded is not None else '?'
        logger.warning(f"AIS parse error (type={mt}): {type(e).__name__}: {e}")
        try: conn.rollback()
        except: pass


# ─── AISStream.io WebSocket thread ────────────────────────────────────────────
def run_aisstream():
    """
    Connect to aisstream.io, subscribe to Hawaii bounding box.
    For each position message: only write to DB if local antenna hasn't
    seen this MMSI recently (LOCAL_WINS_SEC). This way local antenna
    always wins for position accuracy; aisstream fills the gaps for
    vessels beyond antenna range.
    Metadata (name/type/destination) is always written — it's additive.
    Reconnects automatically on any error.
    """
    logger.info("AISStream thread starting.")
    conn = get_db_connection("aisstream")
    if not conn:
        logger.error("AISStream: DB connect failed — thread exiting.")
        return

    subscribe_msg = json.dumps({
        "APIkey": AISSTREAM_KEY,
        "FilterMessageTypes": [
            "PositionReport",
            "StandardClassBPositionReport",
            "ShipStaticData",
            "ExtendedClassBPositionReport",
        ],
    })

# ─── AISStream.io WebSocket thread ────────────────────────────────────────────
#
# GOOD-CITIZEN CONTRACT WITH AISSTREAM.IO
# ─────────────────────────────────────────
# AISStream is a PUSH WebSocket service — they send data to us.
# We do NOT poll them. Rate/frequency concerns are about reconnection behaviour,
# not request rate. Our commitments:
#
#   1. SINGLE CONNECTION: Only one WebSocket open at a time, ever.
#      The thread is a daemon — it cannot accidentally duplicate.
#
#   2. EXPONENTIAL BACKOFF + JITTER on reconnect:
#      Attempt  1 → wait  5–10s
#      Attempt  2 → wait  10–20s
#      Attempt  3 → wait  20–40s
#      …
#      Attempt  7+ → wait 120–240s  (hard cap)
#      Jitter prevents thundering herd if their service restarts.
#
#   3. CIRCUIT BREAKER: After 10 consecutive failures we back off to
#      5-minute retries and log a loud warning. This protects both us
#      and them from a tight retry storm in case of extended outage.
#
#   4. CLEAN CLOSE: ws.close() always called before reconnecting so
#      the server-side slot is freed immediately.
#
#   5. SUBSCRIBE ONCE: Single JSON subscription sent per connection.
#      Never re-subscribe on the same connection.
#
#   6. PING/PONG: websocket-client handles RFC 6455 ping/pong
#      automatically — we never need to send manual heartbeats.
#
def run_aisstream():
    """
    Maintain a single persistent WebSocket to aisstream.io.
    Implements exponential backoff + jitter + circuit breaker.
    Best-data merge: local antenna wins for position when fresh.
    """
    logger.info("AISStream thread starting.")
    conn = get_db_connection("aisstream")
    if not conn:
        logger.error("AISStream: DB connect failed — thread exiting.")
        return

    subscribe_msg = json.dumps({
        "APIkey":       AISSTREAM_KEY,
        "FilterMessageTypes": [
            "PositionReport",
            "StandardClassBPositionReport",
            "ShipStaticData",
            "ExtendedClassBPositionReport",
        ],
    })

    # ── Reconnect state ───────────────────────────────────────────────────────
    attempt          = 0
    MAX_BACKOFF_SEC  = 240   # hard cap on wait between reconnects
    MIN_BACKOFF_SEC  = 5     # minimum wait before first retry
    CIRCUIT_BREAKER  = 10    # after this many failures, switch to slow-retry mode
    SLOW_RETRY_SEC   = 300   # 5-minute retry when circuit breaker trips
    RESET_AFTER_SEC  = 120   # reset attempt counter if connection held this long
    import random

    while True:
        ws = None
        connection_start = None
        try:
            logger.info(f"AISStream: connecting (attempt {attempt + 1}) …")
            ws = websocket.create_connection(
                AISSTREAM_URL,
                timeout=60,
                # Ensure websocket-client sends automatic pong replies
                # (enabled by default; listed here for documentation)
                enable_multithread=False,
            )
            ws.send(subscribe_msg)
            connection_start = time.monotonic()
            logger.info("AISStream: connected and subscribed to Hawaii bbox.")

            # ── Receive loop ──────────────────────────────────────────────
            while True:
                try:
                    raw = ws.recv()
                except WebSocketTimeoutException:
                    # No message in 60s — Hawaii is quiet. Keep connection alive.
                    continue
                if not raw:
                    continue

                # If we've held the connection for RESET_AFTER_SEC, reset backoff
                if connection_start and (time.monotonic() - connection_start) > RESET_AFTER_SEC:
                    if attempt > 0:
                        logger.info("AISStream: connection stable — resetting backoff counter.")
                    attempt = 0

                msg      = json.loads(raw)
                msg_type = msg.get("MessageType", "")
                meta     = msg.get("MetaData", {})
                mmsi     = str(meta.get("MMSI", "") or "").strip()
                if not mmsi or mmsi == "0":
                    continue

                # ── Position messages ──────────────────────────────────
                if msg_type in ("PositionReport",
                                "StandardClassBPositionReport",
                                "ExtendedClassBPositionReport"):
                    sub_key = msg_type   # key name matches MessageType
                    pos = msg.get("Message", {}).get(sub_key, {})
                    lat = safe_float(pos.get("Latitude")  or meta.get("latitude"))
                    lon = safe_float(pos.get("Longitude") or meta.get("longitude"))
                    if not valid_position(lat, lon):
                        continue
                    speed      = safe_float(pos.get("Sog"))
                    cog        = safe_float(pos.get("Cog"))
                    heading_raw= safe_float(pos.get("TrueHeading"))
                    heading    = cog if (heading_raw is None or heading_raw == 511) else heading_raw
                    rot        = safe_float(pos.get("RateOfTurn"))
                    nav_status = safe_int(pos.get("NavigationalStatus"))

                    # Best-data gate: always write the track for history,
                    # but only gap-fill log when local is absent
                    is_gap_fill = not local_is_fresh(mmsi)
                    write_position(conn, mmsi, lat, lon, speed, heading,
                                   rot, nav_status, 'aisstream')
                    if is_gap_fill:
                        logger.info(f"AISStream gap-fill: {mmsi} "
                                    f"{lat:.4f},{lon:.4f} spd={speed}")
                        try: check_route_event(conn, mmsi, lat, lon)
                        except: pass

                    # Vessel name on every position message (aisstream enriches this)
                    ship_name = (meta.get("ShipName") or "").strip() or None
                    if ship_name and ship_name not in ("", "Unknown"):
                        write_metadata(conn, mmsi, vessel_name=ship_name)

                # ── Static/voyage data ─────────────────────────────────
                elif msg_type == "ShipStaticData":
                    static = msg.get("Message", {}).get("ShipStaticData", {})
                    vn  = (static.get("Name")        or "").strip().rstrip("@") or None
                    cs  = (static.get("CallSign")    or "").strip().rstrip("@") or None
                    dst = (static.get("Destination") or "").strip().rstrip("@") or None
                    vt  = safe_int(static.get("Type"))
                    dim = static.get("Dimension", {}) or {}
                    to_bow   = safe_float(dim.get("A", 0)) or 0.0
                    to_stern = safe_float(dim.get("B", 0)) or 0.0
                    to_port  = safe_float(dim.get("C", 0)) or 0.0
                    to_star  = safe_float(dim.get("D", 0)) or 0.0
                    length   = (to_bow + to_stern) or None
                    beam     = (to_port + to_star) or None
                    draught  = safe_float(static.get("MaximumStaticDraught"))
                    eta_obj  = static.get("Eta")
                    eta_str  = json.dumps(eta_obj) if eta_obj else None
                    write_metadata(conn, mmsi, vn, vt, cs, dst,
                                   eta_str, length, beam, draught)
                    logger.info(f"AISStream static: {mmsi} name='{vn}' dest='{dst}'")

        except Exception as e:
            attempt += 1
            logger.error(f"AISStream error (attempt {attempt}): "
                         f"{type(e).__name__}: {e}")
        finally:
            # Always close cleanly before sleeping — frees server-side slot
            if ws is not None:
                try:
                    ws.close()
                    logger.info("AISStream: connection closed cleanly.")
                except Exception:
                    pass
            ws = None
            # Roll back any uncommitted DB transaction
            try:
                if conn and not conn.closed:
                    conn.rollback()
            except Exception:
                pass
            # Reconnect DB if it went away
            if conn is None or conn.closed:
                conn = get_db_connection("aisstream")

        # ── Backoff calculation ───────────────────────────────────────────
        if attempt >= CIRCUIT_BREAKER:
            wait = SLOW_RETRY_SEC
            logger.warning(
                f"AISStream: circuit breaker tripped after {attempt} failures. "
                f"Waiting {wait}s before next attempt. Check API key and connectivity."
            )
        else:
            # Exponential backoff: MIN_BACKOFF * 2^(attempt-1), capped at MAX_BACKOFF
            base = min(MIN_BACKOFF_SEC * (2 ** (attempt - 1)), MAX_BACKOFF_SEC)
            # Add ±25% jitter to prevent thundering herd on service restart
            jitter = base * random.uniform(-0.25, 0.25)
            wait = max(MIN_BACKOFF_SEC, base + jitter)
            logger.info(f"AISStream: reconnecting in {wait:.1f}s "
                        f"(attempt {attempt}, base={base}s)")

        time.sleep(wait)




# ─── Destination predictor ────────────────────────────────────────────────────
def run_destination_predictor():
    logger.info("Destination predictor thread starting.")
    conn = get_db_connection("predictor")
    if not conn:
        logger.error("Predictor: DB connect failed — exiting.")
        return

    while True:
        try:
            time.sleep(600)
            cur = conn.cursor()
            cur.execute("""
                SELECT DISTINCT ON (l.entity_id)
                    l.entity_id AS mmsi,
                    e.vessel_name, e.vessel_type, e.destination AS ais_dest,
                    ST_Y(l.location::geometry) AS lat,
                    ST_X(l.location::geometry) AS lon,
                    l.heading, l.speed
                FROM live_tracks l
                JOIN entities e ON l.entity_id = e.entity_id
                WHERE e.entity_type = 'VESSEL'
                  AND l.recorded_at > NOW() - INTERVAL '2 hours'
                ORDER BY l.entity_id, l.recorded_at DESC;
            """)
            vessels = cur.fetchall()

            for row in vessels:
                mmsi, vname, vtype, ais_dest, lat, lon, heading, speed = row
                if not valid_position(lat, lon): continue

                predicted_dest = None
                confidence     = 0.0
                method         = None

                # Priority 1: AIS-declared destination
                ais_clean = (ais_dest or '').strip().upper()
                if ais_clean and ais_clean not in ('', '@@@@@@@@@@@@@@@@@@@@', 'UNKNOWN'):
                    predicted_dest = ais_dest.strip()
                    confidence     = 0.90
                    method         = 'ais_declared'

                # Priority 2: Historical frequency
                if not predicted_dest:
                    cur2 = conn.cursor()
                    cur2.execute("""
                        SELECT arrive_port, COUNT(*) AS cnt
                        FROM vessel_routes WHERE mmsi = %s
                          AND depart_time > NOW() - INTERVAL '180 days'
                        GROUP BY arrive_port ORDER BY cnt DESC LIMIT 1;
                    """, (mmsi,))
                    hist = cur2.fetchone()
                    cur2.close()
                    if hist and hist[1] >= 2:
                        port_name = next(
                            (n for pid, n, _, _, _ in HAWAII_PORTS if pid == hist[0]),
                            hist[0]
                        )
                        predicted_dest = port_name
                        confidence     = min(0.5 + hist[1] * 0.05, 0.80)
                        method         = 'historical'

                # Priority 3: Heading corridor
                if not predicted_dest and heading is not None and speed and speed > 1.0:
                    best_port  = None
                    best_score = 999.0
                    for port_id, name, plat, plon, _ in HAWAII_PORTS:
                        dist = nm_distance(lat, lon, plat, plon)
                        if dist < 0.5: continue
                        dlat = math.radians(plat - lat)
                        dlon = math.radians(plon - lon)
                        y = math.sin(dlon) * math.cos(math.radians(plat))
                        x = math.cos(math.radians(lat)) * math.sin(math.radians(plat)) - \
                            math.sin(math.radians(lat)) * math.cos(math.radians(plat)) * math.cos(dlon)
                        bearing = (math.degrees(math.atan2(y, x)) + 360) % 360
                        angle_off = abs(((bearing - (heading % 360) + 180) % 360) - 180)
                        score = angle_off * (1.0 + dist / 100.0)
                        if angle_off <= 35.0 and score < best_score:
                            best_score = score
                            best_port  = name
                    if best_port:
                        confidence = max(0.0, 0.55 - best_score / 300.0)
                        if confidence > 0.20:
                            predicted_dest = best_port
                            method         = 'heading_corridor'

                if predicted_dest:
                    cur.execute("""
                        INSERT INTO vessel_predictions
                            (mmsi, vessel_name, predicted_dest, confidence, method)
                        VALUES (%s,%s,%s,%s,%s)
                        ON CONFLICT (mmsi) DO UPDATE SET
                            vessel_name    = EXCLUDED.vessel_name,
                            predicted_dest = EXCLUDED.predicted_dest,
                            confidence     = EXCLUDED.confidence,
                            method         = EXCLUDED.method,
                            predicted_at   = NOW();
                    """, (mmsi, vname, predicted_dest, confidence, method))

            conn.commit()
            cur.close()
            logger.info(f"Predictor: updated {len(vessels)} vessels.")
        except Exception as e:
            logger.error(f"Predictor error: {type(e).__name__}: {e}")
            try: conn.rollback()
            except: pass

# ─── Instant Vessel Metadata Fetcher ──────────────────────────────────────────
def run_meta_fetcher():
    """Background thread that identifies unknown vessels via myshiptracking.com"""
    logger.info("MetaFetcher starting.")
    conn = get_db_connection("meta_fetcher")
    if not conn: return
    
    TYPE_MAP = {
        'sailing': 36, 'pleasure': 37, 'tug': 52, 'port tender': 53,
        'search and rescue': 51, 'law enforcement': 55, 'military': 35, 'coast guard': 55,
        'passenger': 60, 'cargo': 70, 'tanker': 80, 'fishing': 30,
        'high speed craft': 40, 'pilot': 50
    }
    
    while True:
        try:
            cur = conn.cursor()
            # Find vessels missing a name that were updated recently
            cur.execute("""
                SELECT entity_id FROM entities 
                WHERE vessel_name IS NULL 
                  AND last_seen > NOW() - INTERVAL '6 hours'
                ORDER BY last_seen DESC LIMIT 5
            """)
            unknowns = [r[0] for r in cur.fetchall()]
            cur.close()
            
            for mmsi in unknowns:
                url = f"https://www.myshiptracking.com/vessels/mmsi-{mmsi}"
                headers = {"User-Agent": "Mozilla/5.0"}
                try:
                    resp = requests.get(url, headers=headers, verify=False, timeout=10)
                    if resp.status_code == 200:
                        name_match = re.search(r'<title>([^\|]+)\|', resp.text)
                        if name_match:
                            parts = name_match.group(1).split('-')
                            vname = parts[0].strip()
                            vtype_str = parts[1].strip().split('(')[0].strip().lower() if len(parts) > 1 else ""
                            
                            vtype = 0
                            for k, v in TYPE_MAP.items():
                                if k in vtype_str:
                                    vtype = v
                                    break
                            
                            if vname and "MMSI" not in vname:
                                cur = conn.cursor()
                                cur.execute("""
                                    UPDATE entities 
                                    SET vessel_name = %s, vessel_type = %s 
                                    WHERE entity_id = %s AND vessel_name IS NULL
                                """, (vname, vtype, mmsi))
                                conn.commit()
                                cur.close()
                                logger.info(f"MetaFetcher: Resolved {mmsi} -> {vname} (Type: {vtype})")
                except Exception as e:
                    logger.debug(f"MetaFetcher error for {mmsi}: {e}")
                time.sleep(2) # polite delay between requests
                
        except Exception as e:
            logger.error(f"MetaFetcher DB error: {e}")
            try: conn.rollback()
            except: pass
        
        time.sleep(30) # check every 30 seconds


# ─── Main AIS UDP listener ────────────────────────────────────────────────────
def run_ais_listener():
    logger.info("Local AIS listener starting.")
    conn = get_db_connection("ais")
    if not conn:
        logger.error("AIS: DB connect failed — exiting.")
        return

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    sock.bind((UDP_IP, UDP_PORT))
    logger.info(f"AIS: listening on UDP {UDP_IP}:{UDP_PORT}")

    consecutive_errors = 0
    MAX_CONSECUTIVE    = 10

    while True:
        try:
            data, _addr = sock.recvfrom(4096)
            raw = data.decode('utf-8', errors='ignore').strip()
            consecutive_errors = 0
            for line in raw.splitlines():
                line = line.strip()
                if line.startswith("!AIVDM") or line.startswith("!AIVDO"):
                    # Buffer multi-part sentences; decode only when complete
                    parts = _mp_add(line)
                    if parts is not None:
                        process_ais_message(conn, parts)
        except OSError as e:
            consecutive_errors += 1
            logger.error(f"AIS socket error: {e}")
            if consecutive_errors >= MAX_CONSECUTIVE:
                logger.critical("Too many socket errors — pausing 10s")
                time.sleep(10)
                consecutive_errors = 0
        except Exception as e:
            consecutive_errors += 1
            logger.error(f"AIS unexpected error: {type(e).__name__}: {e}")


# ─── Entry point ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    logger.info("AIS Collector starting — local antenna + aisstream.io + destination predictor")

    _init_aishub_socket()

    # AISHub RX — receive their global feed for vessel name/type enrichment
    aishub_rx_thread = threading.Thread(target=run_aishub_receiver,
                                        name="aishub_rx", daemon=True)
    aishub_rx_thread.start()

    # AISStream.io — primary internet feed (active when local antenna is offline)
    if AISSTREAM_ENABLED:
        aisstream_thread = threading.Thread(target=run_aisstream,
                                            name="aisstream", daemon=True)
        aisstream_thread.start()
    else:
        logger.info("AISStream disabled (set AISSTREAM_ENABLED=True to activate).")

    # Destination predictor — every 10 minutes
    pred_thread = threading.Thread(target=run_destination_predictor,
                                   name="predictor", daemon=True)
    pred_thread.start()

    # MetaFetcher — identifies unknown MMSIs instantly
    meta_thread = threading.Thread(target=run_meta_fetcher,
                                   name="meta_fetcher", daemon=True)
    meta_thread.start()

    # Local antenna listener
    if LOCAL_ANTENNA_ENABLED:
        logger.info("Local antenna ENABLED — listening for NMEA on UDP 0.0.0.0:10110")
        run_ais_listener()   # blocks main thread
    else:
        logger.info(
            "Local antenna DISABLED (hardware offline). "
            "Running on aisstream.io only. "
            "Set LOCAL_ANTENNA_ENABLED=True and redeploy when new hardware arrives."
        )
        # Keep main thread alive so daemon threads (aisstream, predictor) keep running
        while True:
            time.sleep(60)
