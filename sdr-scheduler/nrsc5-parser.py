#!/usr/bin/env python3
"""
nrsc5-parser.py — runs on Proxmox host as part of the SDR scheduler.

Launched by the scheduler for each station dwell period. Invokes nrsc5,
captures stdout/stderr in real-time, and parses every data type we care about.
Sends structured JSON events to CT 111 API via HTTP POST.

PHILOSOPHY: Capture everything, drop only audio/station metadata.
"""

import subprocess, sys, os, re, json, time, struct, io
import urllib.request, urllib.error
import threading, queue, hashlib, base64
from pathlib import Path
from datetime import datetime, timezone

# ── Config ────────────────────────────────────────────────────────────────────
API_URL      = os.environ.get("NRSC5_API_URL", "http://192.168.1.114:3011/ingest")
LOT_DIR      = Path(os.environ.get("LOT_DIR", "/opt/sdr-data/lots"))
NRSC5_BIN   = os.environ.get("NRSC5_BIN", "/usr/local/bin/nrsc5")
FREQ_MHZ     = float(sys.argv[1]) if len(sys.argv) > 1 else 101.9
DWELL_SEC    = int(sys.argv[2])   if len(sys.argv) > 2 else 90
SDR_DEVICE   = os.environ.get("SDR_DEVICE", "1")   # Blog V4 is device index 1 (readsb holds index 0)

STATION_TAG = f"{FREQ_MHZ:.1f}MHz"
LOT_STATION_DIR = LOT_DIR / STATION_TAG
LOT_STATION_DIR.mkdir(parents=True, exist_ok=True)

send_queue = queue.Queue()

# ── HTTP sender thread ─────────────────────────────────────────────────────────
def sender_thread():
    while True:
        item = send_queue.get()
        if item is None:
            break
        try:
            payload = json.dumps(item).encode("utf-8")
            req = urllib.request.Request(
                API_URL,
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            urllib.request.urlopen(req, timeout=5)
        except Exception as e:
            print(f"[sender] POST failed: {e}", file=sys.stderr)
        finally:
            send_queue.task_done()

def send(event_type, data):
    send_queue.put({
        "type": event_type,
        "freq": FREQ_MHZ,
        "station": STATION_TAG,
        "ts": datetime.now(timezone.utc).isoformat(),
        **data
    })

# ── LOT file handler ───────────────────────────────────────────────────────────
def handle_lot_file(filepath, content_type, port, size):
    """
    Called when nrsc5 writes a LOT file to disk. We:
    1. Copy it to our archive
    2. Try to parse it based on content type
    3. Send parsed data (or raw metadata) to CT 111
    """
    try:
        with open(filepath, "rb") as f:
            raw = f.read()
    except Exception as e:
        print(f"[lot] Cannot read {filepath}: {e}", file=sys.stderr)
        return

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    filename = os.path.basename(filepath)
    fname = filename  # for prefix checks below
    archive_path = LOT_STATION_DIR / f"{ts}_{port}_{filename}"
    with open(archive_path, "wb") as f:
        f.write(raw)

    sha = hashlib.sha256(raw).hexdigest()[:12]

    # Determine content type from file extension (nrsc5 uses hex MIME codes, not strings)
    ext = Path(filename).suffix.lower()
    ext_map = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
               '.txt': 'text/plain', '.xml': 'application/xml', '.html': 'text/html'}
    ct = ext_map.get(ext, content_type or 'application/octet-stream')

    # DWRI = Doppler Weather Radar Info (coordinates, legend) — always text/plain
    if fname.startswith("DWRI") or "_DWRI_" in fname:
        try:
            text = raw.decode("utf-8", errors="replace")
            parse_dwri(text, port, sha, filename)
        except Exception as e:
            print(f"[lot] DWRI parse error: {e}", file=sys.stderr)
        return

    # DWRO = Doppler Weather Radar Overlay PNG (live map overlay)
    if fname.startswith("DWRO") or "_DWRO_" in fname:
        parse_dwro(raw, port, sha, filename)
        return

    if ct.startswith("image/"):
        # Station logo or album art — send as base64 thumbnail only if <50KB
        if size < 51200:
            b64 = base64.b64encode(raw).decode("ascii")
            send("image", {"content_type": ct, "port": port,
                           "filename": filename, "data_b64": b64, "sha": sha})
        return


    if "navteq" in ct or "vnd.navteq" in ct:
        parse_navteq_lot(raw, ct, port, sha, archive_path)
        return

    if ct in ("application/xml", "text/xml") or filename.endswith(".xml"):
        parse_xml_lot(raw, port, sha, filename)
        return

    if ct.startswith("text/"):
        try:
            text = raw.decode("utf-8", errors="replace")
            parse_text_lot(text, port, sha, filename)
        except Exception as e:
            print(f"[lot] text parse error: {e}", file=sys.stderr)
        return

def parse_dwri(text, port, sha, filename):
    """Parse Doppler Weather Radar Info file — gives us coordinates & legend."""
    global _dwri_meta
    meta = {"area": "", "nw": None, "se": None, "legend": {}}
    for line in text.splitlines():
        line = line.strip()
        if line.startswith('DWR_Area_ID='):
            meta["area"] = line.split('=',1)[1].strip('"')
        if line.startswith('Coordinates='):
            m = dwri_coords_re.search(line)
            if m:
                meta["nw"] = [float(m.group(1)), float(m.group(2))]
                meta["se"] = [float(m.group(3)), float(m.group(4))]
        if line.startswith('Legend_Rain='):
            meta["legend"]["rain"] = line.split('=',1)[1]
    _dwri_meta[STATION_TAG] = meta
    send("radar_meta", {"port": port, "sha": sha, "filename": filename, **meta})
    print(f"[dwri] Radar area={meta['area']} nw={meta['nw']} se={meta['se']}", flush=True)

def parse_dwro(raw, port, sha, filename):
    """Parse Doppler Weather Radar Overlay PNG — send with bounding box."""
    meta = _dwri_meta.get(STATION_TAG, {})
    b64 = base64.b64encode(raw).decode("ascii")
    send("radar_overlay", {
        "port": port, "sha": sha, "filename": filename,
        "nw": meta.get("nw"), "se": meta.get("se"),
        "area": meta.get("area", ""),
        "data_b64": b64,
        "size": len(raw),
    })
    print(f"[dwro] Radar overlay {len(raw)//1024}KB nw={meta.get('nw')} se={meta.get('se')}", flush=True)

def parse_navteq_lot(raw, ct, port, sha, path):
    """Parse NAVTEQ/HERE traffic, gas, and POI LOT files."""
    # NAVTEQ Traffic Message Channel (TMC) format
    if "traffic" in ct or "tmc" in str(path).lower():
        incidents = decode_navteq_traffic(raw)
        if incidents:
            send("traffic", {"incidents": incidents, "sha": sha,
                             "count": len(incidents)})
        return

    # NAVTEQ NPE format — gas prices, POI, parking
    if "npe" in ct or "gas" in str(path).lower() or "poi" in str(path).lower():
        items = decode_navteq_npe(raw)
        for item in items:
            send(item.get("_type", "poi"), {k: v for k, v in item.items() if k != "_type"})
        return

    # Unknown NAVTEQ format — save reference
    send("navteq_unknown", {"content_type": ct, "sha": sha,
                             "size": len(raw), "archive": str(path)})

def decode_navteq_traffic(raw):
    """
    Decode NAVTEQ TMC binary format.
    TMC incidents contain: event code, road name, coords, severity, description.
    Format is proprietary but many fields are parseable from the binary.
    """
    incidents = []
    # TMC binary: look for ASCII road names and lat/lon pairs (stored as int32 * 1e-5)
    # Scan for coordinate pairs (lat range 18-24, lon range -162 to -154 for Hawaii)
    i = 0
    while i < len(raw) - 8:
        try:
            # Try reading as little-endian int32 pair
            lat_raw = struct.unpack_from("<i", raw, i)[0]
            lon_raw = struct.unpack_from("<i", raw, i + 4)[0]
            lat = lat_raw / 100000.0
            lon = lon_raw / 100000.0
            if 18.0 <= lat <= 23.0 and -162.0 <= lon <= -154.0:
                # Extract event code if present
                event_code = struct.unpack_from("<H", raw, max(0, i - 2))[0] if i >= 2 else 0
                # Try to get road name string nearby
                road_name = extract_nearby_string(raw, i, window=64)
                severity = tmc_event_severity(event_code)
                desc = tmc_event_description(event_code)
                incidents.append({
                    "lat": lat, "lon": lon,
                    "road": road_name,
                    "event_code": event_code,
                    "severity": severity,
                    "description": desc,
                })
                i += 8
                continue
        except Exception:
            pass
        i += 1
    return incidents

def decode_navteq_npe(raw):
    """Decode NAVTEQ NPE (gas/POI/parking) binary data."""
    items = []
    # NPE: scan for ASCII strings + coordinate pairs
    # Gas price records typically have a price field (uint16, cents) near coordinates
    text = raw.decode("latin-1", errors="replace")
    # Look for price patterns like "$3.89" or "389" near location data
    price_pattern = re.compile(r'\b([3-9]\d{2})\b')  # cents, e.g. 389 = $3.89
    coord_i = 0
    while coord_i < len(raw) - 8:
        try:
            lat_raw = struct.unpack_from("<i", raw, coord_i)[0]
            lon_raw = struct.unpack_from("<i", raw, coord_i + 4)[0]
            lat = lat_raw / 100000.0
            lon = lon_raw / 100000.0
            if 18.0 <= lat <= 23.0 and -162.0 <= lon <= -154.0:
                name = extract_nearby_string(raw, coord_i, window=128)
                # Look for price bytes
                chunk = text[max(0, coord_i - 20):coord_i + 40]
                prices = price_pattern.findall(chunk)
                if prices:
                    items.append({
                        "_type": "gas",
                        "lat": lat, "lon": lon,
                        "name": name or "Unknown Station",
                        "regular": int(prices[0]) / 100.0 if len(prices) > 0 else None,
                        "midgrade": int(prices[1]) / 100.0 if len(prices) > 1 else None,
                        "premium": int(prices[2]) / 100.0 if len(prices) > 2 else None,
                        "diesel": int(prices[3]) / 100.0 if len(prices) > 3 else None,
                    })
                else:
                    items.append({
                        "_type": "poi",
                        "lat": lat, "lon": lon,
                        "name": name or "Unknown POI",
                    })
                coord_i += 8
                continue
        except Exception:
            pass
        coord_i += 1
    return items

def extract_nearby_string(raw, offset, window=64):
    """Extract the nearest ASCII string within a byte window."""
    start = max(0, offset - window)
    chunk = raw[start:offset + window]
    strings = re.findall(rb'[\x20-\x7e]{4,}', chunk)
    if strings:
        # Return longest found string, stripped
        return max(strings, key=len).decode("ascii", errors="replace").strip()
    return ""

def tmc_event_severity(code):
    """Map TMC event code to human severity."""
    if code in range(100, 200):   return "MAJOR"
    if code in range(200, 400):   return "MODERATE"
    if code in range(400, 1000):  return "MINOR"
    return "UNKNOWN"

def tmc_event_description(code):
    """Common TMC event code descriptions (partial)."""
    tmc_codes = {
        101: "Closed", 102: "Closed ahead", 201: "Heavy traffic", 202: "Traffic queuing",
        203: "Slow traffic", 204: "Traffic flowing freely", 301: "Accident",
        302: "Multi-vehicle accident", 303: "Accident involving heavy lorries",
        401: "Road works", 402: "Construction work", 403: "Road closed for maintenance",
        501: "Lane closed", 502: "Two lanes closed", 701: "Fog", 702: "Rain",
        801: "Roadway icing", 901: "Special event", 902: "Parade or demonstration",
    }
    return tmc_codes.get(code, f"Event {code}")

def parse_xml_lot(raw, port, sha, filename):
    """Parse XML LOT files — weather, schedules, etc."""
    try:
        text = raw.decode("utf-8", errors="replace")
        # Weather alerts (CAP/ATOM format)
        if "<alert" in text.lower() or "<cap:" in text.lower():
            send("weather_alert", {"xml": text[:4000], "sha": sha,
                                    "filename": filename, "port": port})
            return
        # EPG / program guide — we said we don't care, so just log it
        # Sports scores in XML
        if "score" in text.lower() or "game" in text.lower():
            send("sports", {"xml": text[:2000], "sha": sha,
                            "filename": filename, "port": port})
            return
        # Generic XML data
        send("xml_data", {"text": text[:2000], "sha": sha,
                          "filename": filename, "port": port})
    except Exception as e:
        print(f"[lot] XML parse error: {e}", file=sys.stderr)

def parse_text_lot(text, port, sha, filename):
    """Parse text/HTML LOT files."""
    # News headlines
    if any(kw in text.lower() for kw in ["headline", "breaking", "news"]):
        send("news", {"text": text[:3000], "sha": sha,
                      "filename": filename, "port": port})
        return
    # Stock data
    if any(kw in text.lower() for kw in ["nasdaq", "dow", "nyse", "stock", "share"]):
        send("stocks", {"text": text[:3000], "sha": sha,
                        "filename": filename, "port": port})
        return
    # Anything else
    send("text_data", {"text": text[:2000], "sha": sha,
                       "filename": filename, "port": port})

# ── nrsc5 stdout parser ────────────────────────────────────────────────────────
# Actual nrsc5 --dump-aas-files output format:
# LOT file: port=0801 lot=42026 name=SLKUCD$$0110540000.png size=10935 mime=4F328CA0 expiry=...
# Files are written to lot_dir as: {lot}_{name}
lot_re   = re.compile(r"LOT file: port=(\w+)\s+lot=(\d+)\s+name=(\S+)\s+size=(\d+)\s+mime=(\w+)")
eas_re   = re.compile(r"EAS: (.+)")
alert_re = re.compile(r"(?:Alert|Warning|Watch|Advisory): (.+)", re.IGNORECASE)
mer_re   = re.compile(r"MER: ([\d.]+)")
ber_re   = re.compile(r"BER: ([\d.]+)")
sync_re  = re.compile(r"Synchronized")
# Doppler Weather Radar from HD Radio
dwri_coords_re = re.compile(r'Coordinates="\(([\d.-]+),([\d.-]+)\)".*"\(([\d.-]+),([\d.-]+)\)"')
_dwri_meta = {}  # station -> {nw, se, legend}

def parse_line(line, lot_base_dir):
    line = line.strip()
    if not line:
        return

    # Signal metrics — useful for monitoring SDR health
    m = mer_re.search(line)
    if m:
        send("signal", {"mer": float(m.group(1))})
        return

    m = ber_re.search(line)
    if m:
        send("signal", {"ber": float(m.group(1))})
        return

    if sync_re.search(line):
        send("signal", {"synced": True})
        return

    # EAS Emergency Alerts — highest priority
    m = eas_re.search(line)
    if m:
        send("eas_alert", {"raw": m.group(1), "severity": "EXTREME"})
        return

    m = alert_re.search(line)
    if m:
        send("weather_alert", {"text": m.group(1)})
        return

    # LOT file written to disk by nrsc5 --dump-aas-files
    # Format: LOT file: port=0801 lot=42026 name=SLKUCD$$.png size=10935 mime=4F328CA0
    # File on disk: {lot_work_dir}/{lot}_{name}
    m = lot_re.search(line)
    if m:
        port, lot_num, name, size, mime_hex = m.group(1), m.group(2), m.group(3), int(m.group(4)), m.group(5)
        full_path = Path(lot_base_dir) / f"{lot_num}_{name}"
        if full_path.exists():
            handle_lot_file(str(full_path), mime_hex, port, size)
        else:
            # Small delay — nrsc5 may still be writing
            import time as _time; _time.sleep(0.2)
            if full_path.exists():
                handle_lot_file(str(full_path), mime_hex, port, size)
            else:
                print(f"[lot] File not found: {full_path}", file=sys.stderr)
        return

    # Everything else printed for debug
    # (station name, callsign, etc. — we deliberately ignore these)

# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    LOT_DIR.mkdir(parents=True, exist_ok=True)
    lot_work_dir = LOT_STATION_DIR / "work"
    lot_work_dir.mkdir(parents=True, exist_ok=True)

    # Start sender thread
    t = threading.Thread(target=sender_thread, daemon=True)
    t.start()

    send("session_start", {"dwell_sec": DWELL_SEC})
    print(f"[nrsc5-parser] Tuning {FREQ_MHZ} MHz for {DWELL_SEC}s → {API_URL}", flush=True)

    # Run nrsc5:
    # Correct flags from `nrsc5 --help`:
    #   -d  device-index
    #   --dump-aas-files  directory for LOT/AAS file output
    #   -q  quiet (suppress non-data output)
    #   frequency  in Hz
    #   program    0 = main program service
    # NOTE: -t means audio-type (wav/raw), NOT timeout. Timeout via Python.
    freq_hz = int(FREQ_MHZ * 1e6)
    cmd = [
        NRSC5_BIN,
        "-d", SDR_DEVICE,                    # Blog V4 = device index 1
        "--dump-aas-files", str(lot_work_dir), # save all LOT/AAS data files
        "-o", "/dev/null",                   # discard audio output
        "-t", "raw",                         # audio type required when -o given
        str(freq_hz), "0",                   # freq Hz, program 0 (MPS)
    ]
    print(f"[nrsc5-parser] CMD: {' '.join(cmd)}", flush=True)

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            cwd=str(lot_work_dir)
        )

        # Kill nrsc5 after DWELL_SEC regardless of whether it produces output.
        # The for-line loop blocks if nrsc5 is silent (e.g. weak signal / no HD lock),
        # so we can't rely on an inline time check.
        def _kill():
            print(f"[nrsc5-parser] Dwell {DWELL_SEC}s reached — terminating", flush=True)
            try:
                proc.terminate()
            except Exception:
                pass
        kill_timer = threading.Timer(DWELL_SEC, _kill)
        kill_timer.start()

        try:
            for line in proc.stdout:
                stripped = line.strip()
                if stripped:
                    print(f"  nrsc5: {stripped}", flush=True)
                parse_line(stripped, lot_work_dir)
        finally:
            kill_timer.cancel()

        proc.wait(timeout=5)
        if proc.returncode not in (0, None) and proc.returncode not in [-2, -15]:
            print(f"[nrsc5-parser] nrsc5 exited with code {proc.returncode}", flush=True)
    except FileNotFoundError:
        print(f"[nrsc5-parser] ERROR: nrsc5 binary not found at {NRSC5_BIN}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        proc.terminate()

    send("session_end", {"dwell_sec": DWELL_SEC})

    # Drain sender queue
    send_queue.put(None)
    t.join(timeout=10)
    print(f"[nrsc5-parser] Done — {FREQ_MHZ} MHz", flush=True)

if __name__ == "__main__":
    main()
