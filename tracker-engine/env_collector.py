#!/usr/bin/env python3
"""
Buoy + Tide Collector
Pulls NOAA NDBC buoy data and CO-OPS tide predictions for Oahu
Runs every 10 minutes for buoys, every 30 minutes for tides
"""
import requests, psycopg2, logging, time, json
from datetime import datetime, timedelta, timezone

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

DB_HOST = "192.168.1.104"
DB_NAME = "tracking_db"
DB_USER = "tracker"
DB_PASS = "pukalani"

# NDBC buoys near Hawaii/Oahu
BUOYS = [
    {"id": "51202", "name": "Mokapu Point",       "lat": 21.417, "lon": -157.675},
    {"id": "51201", "name": "Waimea Bay",          "lat": 21.673, "lon": -158.116},
    {"id": "51207", "name": "Kaneohe Bay",         "lat": 21.477, "lon": -157.752},
    {"id": "51208", "name": "Hilo",                "lat": 19.618, "lon": -154.970},
    {"id": "51001", "name": "NW Hawaii",           "lat": 23.445, "lon": -162.279},
    {"id": "51002", "name": "SW Hawaii",           "lat": 17.094, "lon": -157.808},
    {"id": "51003", "name": "W Hawaii",            "lat": 19.087, "lon": -160.737},
    {"id": "51004", "name": "SE Hawaii",           "lat": 17.525, "lon": -152.382},
    {"id": "51101", "name": "Pearl Harbor",        "lat": 21.309, "lon": -158.179},
]

# NOAA CO-OPS tide stations — Oahu (from Hawaii project tide.ts)
TIDE_STATIONS = [
    {"id": "1612340", "name": "Honolulu",    "lat": 21.3067, "lon": -157.8670},
    {"id": "1612480", "name": "Moku O Loe",  "lat": 21.4330, "lon": -157.7900},
    {"id": "1612424", "name": "Waianae",     "lat": 21.4360, "lon": -158.1960},
    {"id": "1612668", "name": "Haleiwa",     "lat": 21.5950, "lon": -158.1030},
    {"id": "1613198", "name": "Kaunakakai",  "lat": 21.0830, "lon": -157.0300},
]

NDBC_URL  = "https://www.ndbc.noaa.gov/data/realtime2/{id}.txt"
NOAA_TIDE = "https://tidesandcurrents.noaa.gov/api/datagetter"
NOAA_WL   = "https://tidesandcurrents.noaa.gov/api/datagetter"

def get_db():
    return psycopg2.connect(host=DB_HOST, database=DB_NAME, user=DB_USER, password=DB_PASS)

def ensure_schema(conn):
    cur = conn.cursor()
    cur.execute("""
        -- Buoy observations
        CREATE TABLE IF NOT EXISTS buoy_stations (
            buoy_id     VARCHAR(20) PRIMARY KEY,
            name        TEXT,
            lat         REAL,
            lon         REAL
        );
        CREATE TABLE IF NOT EXISTS buoy_obs (
            id          SERIAL PRIMARY KEY,
            buoy_id     VARCHAR(20) REFERENCES buoy_stations(buoy_id),
            obs_time    TIMESTAMPTZ NOT NULL,
            wdir        REAL,   -- wind direction deg
            wspd        REAL,   -- wind speed m/s
            gst         REAL,   -- gust m/s
            wvht        REAL,   -- wave height m
            dpd         REAL,   -- dominant wave period s
            apd         REAL,   -- average wave period s
            mwd         REAL,   -- wave direction deg
            atmp        REAL,   -- air temp C
            wtmp        REAL,   -- water temp C
            pres        REAL,   -- pressure hPa
            fetched_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(buoy_id, obs_time)
        );
        CREATE INDEX IF NOT EXISTS idx_buoy_obs_time ON buoy_obs(buoy_id, obs_time DESC);

        -- Tide predictions
        CREATE TABLE IF NOT EXISTS tide_stations (
            station_id  VARCHAR(20) PRIMARY KEY,
            name        TEXT,
            lat         REAL,
            lon         REAL,
            updated_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS tide_predictions (
            id          SERIAL PRIMARY KEY,
            station_id  VARCHAR(20) REFERENCES tide_stations(station_id),
            pred_time   TIMESTAMPTZ NOT NULL,
            height_ft   REAL NOT NULL,
            tide_type   VARCHAR(1),
            is_hilo     BOOLEAN DEFAULT FALSE,
            fetched_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(station_id, pred_time, is_hilo)
        );
        CREATE TABLE IF NOT EXISTS tide_water_level (
            id          SERIAL PRIMARY KEY,
            station_id  VARCHAR(20) REFERENCES tide_stations(station_id),
            obs_time    TIMESTAMPTZ NOT NULL,
            height_ft   REAL,
            fetched_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(station_id, obs_time)
        );
        CREATE INDEX IF NOT EXISTS idx_tide_pred ON tide_predictions(station_id, pred_time);
        CREATE INDEX IF NOT EXISTS idx_tide_wl   ON tide_water_level(station_id, obs_time DESC);
    """)

    for b in BUOYS:
        cur.execute("""
            INSERT INTO buoy_stations (buoy_id, name, lat, lon)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (buoy_id) DO UPDATE SET name=EXCLUDED.name, lat=EXCLUDED.lat, lon=EXCLUDED.lon;
        """, (b["id"], b["name"], b["lat"], b["lon"]))

    for s in TIDE_STATIONS:
        cur.execute("""
            INSERT INTO tide_stations (station_id, name, lat, lon)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (station_id) DO UPDATE SET name=EXCLUDED.name, lat=EXCLUDED.lat, lon=EXCLUDED.lon, updated_at=CURRENT_TIMESTAMP;
        """, (s["id"], s["name"], s["lat"], s["lon"]))

    conn.commit()
    cur.close()
    logger.info("Schema ready")

def safe_float(v):
    try:
        f = float(v)
        return None if f in (999.0, 9999.0, 99.0, 999.9, 9999.9) else f
    except:
        return None

def fetch_buoy(buoy_id):
    """Parse NDBC realtime2 text file."""
    url = NDBC_URL.format(id=buoy_id)
    try:
        r = requests.get(url, timeout=15)
        r.raise_for_status()
        lines = r.text.strip().splitlines()
        # Header lines start with #
        # #YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE
        headers = None
        data_rows = []
        for line in lines:
            if line.startswith('#YY'):
                headers = line.lstrip('#').split()
            elif not line.startswith('#') and headers:
                data_rows.append(line.split())

        if not headers or not data_rows:
            return []

        results = []
        for row in data_rows[:24]:  # last 24 hours
            if len(row) < 5:
                continue
            try:
                year = int(row[0]); month = int(row[1]); day = int(row[2])
                hour = int(row[3]); minute = int(row[4])
                t = datetime(year, month, day, hour, minute, tzinfo=timezone.utc)
            except:
                continue

            def get(col):
                try:
                    idx = headers.index(col)
                    return safe_float(row[idx]) if idx < len(row) else None
                except ValueError:
                    return None

            results.append({
                "obs_time": t,
                "wdir": get("WDIR"),
                "wspd": get("WSPD"),
                "gst":  get("GST"),
                "wvht": get("WVHT"),
                "dpd":  get("DPD"),
                "apd":  get("APD"),
                "mwd":  get("MWD"),
                "atmp": get("ATMP"),
                "wtmp": get("WTMP"),
                "pres": get("PRES"),
            })
        return results
    except Exception as e:
        logger.warning(f"Buoy {buoy_id} fetch error: {e}")
        return []

def store_buoy_obs(conn, buoy_id, observations):
    if not observations:
        return 0
    cur = conn.cursor()
    count = 0
    for obs in observations:
        try:
            cur.execute("""
                INSERT INTO buoy_obs (buoy_id, obs_time, wdir, wspd, gst, wvht, dpd, apd, mwd, atmp, wtmp, pres)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (buoy_id, obs_time) DO UPDATE SET
                    wdir=EXCLUDED.wdir, wspd=EXCLUDED.wspd, gst=EXCLUDED.gst,
                    wvht=EXCLUDED.wvht, dpd=EXCLUDED.dpd, apd=EXCLUDED.apd,
                    mwd=EXCLUDED.mwd, atmp=EXCLUDED.atmp, wtmp=EXCLUDED.wtmp,
                    pres=EXCLUDED.pres, fetched_at=CURRENT_TIMESTAMP;
            """, (buoy_id, obs["obs_time"], obs["wdir"], obs["wspd"], obs["gst"],
                  obs["wvht"], obs["dpd"], obs["apd"], obs["mwd"],
                  obs["atmp"], obs["wtmp"], obs["pres"]))
            count += 1
        except Exception as e:
            logger.warning(f"Buoy obs insert error: {e}")
    conn.commit()
    cur.close()
    return count

def fetch_tide_predictions(station_id, begin, end, interval="hilo"):
    params = {
        "station": station_id, "begin_date": begin, "end_date": end,
        "product": "predictions", "datum": "MLLW", "time_zone": "gmt",
        "interval": interval, "units": "english",
        "application": "hawaii_command_center", "format": "json",
    }
    try:
        r = requests.get(NOAA_TIDE, params=params, timeout=15)
        data = r.json()
        return data.get("predictions", [])
    except Exception as e:
        logger.warning(f"Tide fetch {station_id}/{interval}: {e}")
        return []

def fetch_water_level(station_id):
    """Fetch actual observed water level for last 24h."""
    now = datetime.now(timezone.utc)
    begin = (now - timedelta(hours=24)).strftime("%Y%m%d %H:%M")
    params = {
        "station": station_id,
        "begin_date": (now - timedelta(hours=24)).strftime("%Y%m%d"),
        "end_date": now.strftime("%Y%m%d"),
        "product": "water_level", "datum": "MLLW", "time_zone": "gmt",
        "units": "english", "application": "hawaii_command_center", "format": "json",
    }
    try:
        r = requests.get(NOAA_WL, params=params, timeout=15)
        data = r.json()
        return data.get("data", [])
    except Exception as e:
        logger.warning(f"Water level {station_id}: {e}")
        return []

def store_tide_predictions(conn, station_id, predictions, is_hilo):
    if not predictions:
        return 0
    cur = conn.cursor()
    count = 0
    for p in predictions:
        try:
            t = datetime.fromisoformat(p["t"].replace(" ", "T") + ":00+00:00")
            h = float(p["v"])
            tide_type = p.get("type")
            cur.execute("""
                INSERT INTO tide_predictions (station_id, pred_time, height_ft, tide_type, is_hilo)
                VALUES (%s,%s,%s,%s,%s)
                ON CONFLICT (station_id, pred_time, is_hilo) DO UPDATE SET
                    height_ft=EXCLUDED.height_ft, tide_type=EXCLUDED.tide_type, fetched_at=CURRENT_TIMESTAMP;
            """, (station_id, t, h, tide_type, is_hilo))
            count += 1
        except Exception as e:
            logger.warning(f"Tide pred insert: {e}")
    conn.commit()
    cur.close()
    return count

def store_water_level(conn, station_id, levels):
    if not levels:
        return 0
    cur = conn.cursor()
    count = 0
    for lv in levels:
        try:
            t = datetime.fromisoformat(lv["t"].replace(" ", "T") + ":00+00:00")
            h = float(lv["v"])
            cur.execute("""
                INSERT INTO tide_water_level (station_id, obs_time, height_ft)
                VALUES (%s,%s,%s)
                ON CONFLICT (station_id, obs_time) DO UPDATE SET height_ft=EXCLUDED.height_ft, fetched_at=CURRENT_TIMESTAMP;
            """, (station_id, t, h))
            count += 1
        except: pass
    conn.commit()
    cur.close()
    return count

def cleanup(conn):
    cur = conn.cursor()
    cur.execute("DELETE FROM buoy_obs WHERE obs_time < NOW() - INTERVAL '7 days';")
    cur.execute("DELETE FROM tide_predictions WHERE pred_time < NOW() - INTERVAL '3 days';")
    cur.execute("DELETE FROM tide_water_level WHERE obs_time < NOW() - INTERVAL '7 days';")
    conn.commit()
    cur.close()

def collect_buoys(conn):
    logger.info("--- Collecting buoy data ---")
    for b in BUOYS:
        obs = fetch_buoy(b["id"])
        n = store_buoy_obs(conn, b["id"], obs)
        logger.info(f"  Buoy {b['name']} ({b['id']}): {n} records")
        time.sleep(0.5)

def collect_tides(conn):
    logger.info("--- Collecting tide data ---")
    now = datetime.now(timezone.utc)
    begin = (now - timedelta(days=1)).strftime("%Y%m%d")
    end   = (now + timedelta(days=3)).strftime("%Y%m%d")
    for s in TIDE_STATIONS:
        # Hi/lo predictions (tide markers)
        hilo = fetch_tide_predictions(s["id"], begin, end, "hilo")
        n = store_tide_predictions(conn, s["id"], hilo, True)
        logger.info(f"  Tides {s['name']}: {n} hi/lo")
        time.sleep(0.4)
        # Hourly predictions (chart)
        hourly = fetch_tide_predictions(s["id"], begin, end, "h")
        store_tide_predictions(conn, s["id"], hourly, False)
        time.sleep(0.4)
        # Actual observed water level
        levels = fetch_water_level(s["id"])
        store_water_level(conn, s["id"], levels)
        time.sleep(0.4)

def main():
    logger.info("Buoy + Tide Collector started")
    conn = get_db()
    ensure_schema(conn)

    buoy_cycle = 0
    tide_cycle = 0

    while True:
        try:
            collect_buoys(conn)
            buoy_cycle += 1
            if buoy_cycle % 3 == 0:  # Every 30 min
                collect_tides(conn)
                tide_cycle += 1
            cleanup(conn)
        except Exception as e:
            logger.error(f"Collection error: {e}")
            try: conn.close()
            except: pass
            time.sleep(10)
            conn = get_db()

        logger.info("Sleeping 10 minutes...")
        time.sleep(600)

if __name__ == "__main__":
    main()
