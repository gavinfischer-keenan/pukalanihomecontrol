#!/usr/bin/env python3
"""
Aviation Weather Collector — METAR/ATIS + Winds Aloft for Hawaii airports
Polls aviationweather.gov GeoJSON API every 5 minutes
Stores in PostgreSQL for the dashboard
"""
import re
import requests, psycopg2, logging, time, json
from datetime import datetime, timezone

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

DB_HOST = "192.168.1.104"
DB_NAME = "tracking_db"
DB_USER = "tracker"
DB_PASS = "pukalani"

# Hawaii airports with METAR/ATIS
AIRPORTS = [
    {"icao": "PHNL", "name": "Honolulu Intl",         "lat": 21.3245, "lon": -157.9251},
    {"icao": "PHJR", "name": "Kalaeloa (Barbers Pt)", "lat": 21.3074, "lon": -158.0699},
    {"icao": "PHHI", "name": "Wheeler AAF",            "lat": 21.4835, "lon": -158.0399},
    {"icao": "PHNG", "name": "Kaneohe Bay MCAS",       "lat": 21.4504, "lon": -157.7679},
    {"icao": "PHMK", "name": "Molokai",                "lat": 21.1529, "lon": -157.0957},
    {"icao": "PHOG", "name": "Kahului (Maui)",         "lat": 20.8986, "lon": -156.4305},
    {"icao": "PHKO", "name": "Kona Intl",              "lat": 19.7388, "lon": -156.0456},
    {"icao": "PHTO", "name": "Hilo Intl",              "lat": 19.7214, "lon": -155.0481},
]

# Winds aloft station IDs used by aviationweather.gov
# Use the nearest rawinsonde/model point for Hawaii
WINDS_ALOFT_STATIONS = ["HNL", "OGG", "ITO"]

METAR_URL = "https://aviationweather.gov/api/data/metar"
WINDS_URL = "https://aviationweather.gov/api/data/windtemp"

def get_db():
    return psycopg2.connect(host=DB_HOST, database=DB_NAME, user=DB_USER, password=DB_PASS)

def ensure_schema(conn):
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS metar_obs (
            id          SERIAL PRIMARY KEY,
            icao        VARCHAR(10) NOT NULL,
            name        TEXT,
            lat         REAL,
            lon         REAL,
            obs_time    TIMESTAMPTZ NOT NULL,
            raw_metar   TEXT,
            temp_c      REAL,
            dewp_c      REAL,
            wind_dir    INTEGER,
            wind_spd    INTEGER,
            wind_gst    INTEGER,
            vis_sm      REAL,
            altim_hpa   REAL,
            sky_cond    TEXT,    -- JSON array of layers
            wx_string   TEXT,
            flight_cat  VARCHAR(10),
            fetched_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(icao, obs_time)
        );
        CREATE INDEX IF NOT EXISTS idx_metar_icao ON metar_obs(icao, obs_time DESC);

        CREATE TABLE IF NOT EXISTS winds_aloft (
            id          SERIAL PRIMARY KEY,
            station     VARCHAR(10) NOT NULL,
            valid_time  TIMESTAMPTZ NOT NULL,
            level_ft    INTEGER NOT NULL,
            wind_dir    INTEGER,
            wind_spd    INTEGER,
            wind_tmp_c  REAL,
            fetched_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(station, valid_time, level_ft)
        );
        CREATE INDEX IF NOT EXISTS idx_winds_aloft ON winds_aloft(station, valid_time DESC);
    """)
    conn.commit()
    cur.close()
    logger.info("Aviation weather schema ready")

def fetch_metars():
    """Fetch METARs from aviationweather.gov GeoJSON API."""
    icao_list = ",".join(a["icao"] for a in AIRPORTS)
    try:
        r = requests.get(METAR_URL, params={
            "ids": icao_list,
            "format": "json",
            "hours": 2,
        }, timeout=15)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.error(f"METAR fetch error: {e}")
        return []

def store_metars(conn, metars):
    if not metars:
        return 0
    cur = conn.cursor()
    # Build lookup for airport info
    airport_info = {a["icao"]: a for a in AIRPORTS}
    count = 0
    for m in metars:
        try:
            icao = m.get("icaoId", m.get("stationId", ""))
            if not icao:
                continue
            info = airport_info.get(icao, {})

            obs_time_str = m.get("obsTime", m.get("reportTime", ""))
            # aviationweather.gov returns epoch seconds as int
            if isinstance(obs_time_str, (int, float)):
                obs_time = datetime.fromtimestamp(int(obs_time_str), tz=timezone.utc)
            elif isinstance(obs_time_str, str) and obs_time_str:
                try:
                    obs_time = datetime.fromisoformat(obs_time_str.replace("Z", "+00:00"))
                except:
                    obs_time = datetime.now(timezone.utc)
            else:
                obs_time = datetime.now(timezone.utc)

            sky_cond = json.dumps(m.get("clouds", m.get("sky", [])))
            flight_cat = m.get("fltCat", m.get("flightCategory", m.get("fltcat", "")))

            cur.execute("""
                INSERT INTO metar_obs (icao, name, lat, lon, obs_time, raw_metar,
                    temp_c, dewp_c, wind_dir, wind_spd, wind_gst,
                    vis_sm, altim_hpa, sky_cond, wx_string, flight_cat)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (icao, obs_time) DO UPDATE SET
                    raw_metar=EXCLUDED.raw_metar,
                    temp_c=EXCLUDED.temp_c, dewp_c=EXCLUDED.dewp_c,
                    wind_dir=EXCLUDED.wind_dir, wind_spd=EXCLUDED.wind_spd,
                    wind_gst=EXCLUDED.wind_gst, vis_sm=EXCLUDED.vis_sm,
                    altim_hpa=EXCLUDED.altim_hpa, sky_cond=EXCLUDED.sky_cond,
                    wx_string=EXCLUDED.wx_string, flight_cat=EXCLUDED.flight_cat,
                    fetched_at=CURRENT_TIMESTAMP;
            """, (
                icao,
                info.get("name", m.get("name", "")),
                m.get("lat", info.get("lat")),
                m.get("lon", info.get("lon")),
                obs_time,
                m.get("rawOb", m.get("rawMETAR", "")),
                m.get("temp"),
                m.get("dewp"),
                m.get("wdir"),
                m.get("wspd"),
                m.get("wgst"),
                (lambda v: None if v is None else (10.0 if str(v).startswith("10+") else float(v)) if v != "" else None)(m.get("visib")),
                m.get("altim"),
                sky_cond,
                m.get("wxString", m.get("presentWeather", "")),
                flight_cat,
            ))
            count += 1
        except Exception as e:
            logger.warning(f"METAR store error: {e} — {m}")
            conn.rollback()
    conn.commit()
    cur.close()
    return count

def fetch_winds_aloft():
    """Fetch winds aloft from aviationweather.gov text-format FD product."""
    try:
        r = requests.get("https://aviationweather.gov/api/data/windtemp", params={
            "region": "hawaii",
            "fcst": "06",
        }, timeout=15)
        r.raise_for_status()
        return r.text  # Returns text FD report
    except Exception as e:
        logger.error(f"Winds aloft fetch error: {e}")
        return ""

def _decode_fd_wind(code_str, level_ft):
    """
    Decode an FD winds aloft code like '2618-09':
      DD  = wind direction (degrees / 10, so 26 → 260°)
      SS  = wind speed (knots)
      TT  = temperature (°C, may be negative)
    Special cases: '9900' = light and variable, '///' = missing.
    Returns (wind_dir, wind_spd, wind_tmp_c) or None if not decodable.
    """
    code_str = code_str.strip()
    if not code_str or code_str in ('////', '/////', '/////', '//////'):
        return None
    try:
        # Remove temp part if present (after sign)
        m = re.match(r'^(\d{4})([+-]\d{2})?$', code_str)
        if not m:
            # Handle format like '9900' (light & variable, no temp at low levels)
            if code_str == '9900':
                return (0, 0, None)
            return None
        dspd, temp = m.group(1), m.group(2)
        dd = int(dspd[0:2]) * 10   # direction
        ss = int(dspd[2:4])         # speed
        tt = int(temp) if temp else None

        # High-speed encoding: if speed ≥ 100 at high levels, dir encoded as dd+50
        if ss >= 100 and level_ft >= 24000:
            ss -= 100
            dd = (dd + 500) % 3600
            dd //= 10
            dd *= 10

        if dd == 990 and ss == 0:
            return (0, 0, tt)  # light and variable

        return (dd, ss, tt)
    except Exception:
        return None

def store_winds_aloft(conn, text_data):
    """Parse FD text-format winds aloft report and store to DB."""
    if not text_data or not text_data.strip():
        return 0

    cur = conn.cursor()
    count = 0
    lines = text_data.strip().splitlines()

    # Find the header line with level columns (FT  3000  6000 ...)
    header_idx = None
    levels = []
    for i, line in enumerate(lines):
        if line.strip().startswith("FT"):
            header_idx = i
            # Parse level columns like "3000", "6000", etc.
            parts = line.split()
            levels = [(p, int(p)) for p in parts if p.isdigit()]
            break

    # Extract valid time from the report header (line like "VALID 09/1800Z FOR USE...")
    valid_time = datetime.now(timezone.utc)
    for line in lines[:header_idx or 5]:
        m = re.search(r'VALID\s+(\d{2})/(\d{2})(\d{2})Z', line)
        if m:
            now = datetime.now(timezone.utc)
            day, hour, minute = int(m.group(1)), int(m.group(2)), int(m.group(3))
            try:
                valid_time = valid_time.replace(day=day, hour=hour, minute=minute, second=0, microsecond=0)
            except Exception:
                pass
            break

    if header_idx is None or not levels:
        logger.warning("Winds aloft: could not parse header line")
        return 0

    # Parse data lines
    for line in lines[header_idx + 1:]:
        line = line.strip()
        if not line or len(line) < 4:
            continue
        parts = line.split()
        if not parts:
            continue
        station = parts[0]
        if len(station) != 3 or not station.isalpha():
            continue  # Not a station line

        data_parts = parts[1:]
        for i, (level_key, level_ft) in enumerate(levels):
            if i >= len(data_parts):
                break
            decoded = _decode_fd_wind(data_parts[i], level_ft)
            if decoded is None:
                continue
            wdir, wspd, wtmp = decoded
            try:
                cur.execute("""
                    INSERT INTO winds_aloft (station, valid_time, level_ft, wind_dir, wind_spd, wind_tmp_c)
                    VALUES (%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (station, valid_time, level_ft) DO UPDATE SET
                        wind_dir=EXCLUDED.wind_dir, wind_spd=EXCLUDED.wind_spd,
                        wind_tmp_c=EXCLUDED.wind_tmp_c, fetched_at=CURRENT_TIMESTAMP;
                """, (station, valid_time, level_ft, wdir, wspd, wtmp))
                count += 1
            except Exception as e:
                logger.warning(f"Winds aloft store error: {e}")
                conn.rollback()

    conn.commit()
    cur.close()
    return count

def cleanup(conn):
    cur = conn.cursor()
    cur.execute("DELETE FROM metar_obs WHERE obs_time < NOW() - INTERVAL '24 hours';")
    cur.execute("DELETE FROM winds_aloft WHERE valid_time < NOW() - INTERVAL '12 hours';")
    conn.commit()
    cur.close()

def main():
    logger.info("Aviation Weather Collector started")
    conn = get_db()
    ensure_schema(conn)

    while True:
        try:
            logger.info("--- Fetching METARs ---")
            metars = fetch_metars()
            n = store_metars(conn, metars)
            logger.info(f"Stored {n} METAR records")

            logger.info("--- Fetching Winds Aloft ---")
            winds = fetch_winds_aloft()
            n = store_winds_aloft(conn, winds)
            logger.info(f"Stored {n} winds aloft records")

            cleanup(conn)
        except Exception as e:
            logger.error(f"Collection error: {e}")
            try: conn.close()
            except: pass
            time.sleep(15)
            conn = get_db()

        logger.info("Sleeping 5 minutes...")
        time.sleep(300)

if __name__ == "__main__":
    main()
