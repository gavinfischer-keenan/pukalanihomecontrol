#!/usr/bin/env python3
"""
GOES-18 Satellite + NEXRAD Radar Frame Collector
Runs every 10 minutes via cron in CT105.

Install crontab:
  crontab -e
  */10 * * * * /usr/bin/python3 /opt/satellite_collector.py >> /var/log/satellite.log 2>&1
"""

import re, time, json, urllib.request
from pathlib import Path
from datetime import datetime, timezone

MAX_FRAMES  = 12
OUT_DIR     = Path('/opt/public/satellite')
IMG_SIZE    = '1200x1200'

GOES_PRODUCTS = {
    'geocolor': {
        'name':     'GOES-18 GeoColor (Hawaii)',
        'url_base': 'https://cdn.star.nesdis.noaa.gov/GOES18/ABI/SECTOR/hi/GEOCOLOR/',
        'pattern':  r'href="(\d{11}_GOES18-ABI-hi-GEOCOLOR-1200x1200\.jpg)"',
        'subdir':   'goes_geocolor',
    },
    'band13': {
        'name':     'GOES-18 IR (Hawaii)',
        'url_base': 'https://cdn.star.nesdis.noaa.gov/GOES18/ABI/SECTOR/hi/13/',
        'pattern':  r'href="(\d{11}_GOES18-ABI-hi-13-1200x1200\.jpg)"',
        'subdir':   'goes_ir',
    },
}

def log(msg):
    ts = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
    print(f'[{ts}] {msg}', flush=True)

UA = {'User-Agent': 'Hawaii-Dashboard/1.0 (github.com/gavinfischer-keenan/pukalanihomecontrol)'}

def fetch(url, timeout=30):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()

def collect_goes(key, cfg):
    subdir = OUT_DIR / cfg['subdir']
    subdir.mkdir(parents=True, exist_ok=True)

    # Parse directory listing
    try:
        html  = fetch(cfg['url_base']).decode('utf-8', errors='replace')
        files = sorted(set(re.findall(cfg['pattern'], html)))
    except Exception as e:
        log(f'  {key} dir parse failed: {e}')
        files = []

    log(f'  {key}: {len(files)} files in listing')

    # Download newest we don't have (max 3 per run to avoid hammering)
    downloaded = 0
    for fname in files[-MAX_FRAMES * 2:]:
        if downloaded >= 3:
            break
        local = subdir / fname
        if not local.exists():
            try:
                data = fetch(cfg['url_base'] + fname)
                local.write_bytes(data)
                log(f'  Downloaded {fname} ({len(data)//1024}KB)')
                downloaded += 1
            except Exception as e:
                log(f'  Failed {fname}: {e}')

    # Purge beyond MAX_FRAMES
    for old in sorted(subdir.glob('*.jpg'))[:-MAX_FRAMES]:
        old.unlink()
        log(f'  Purged {old.name}')

    # Build manifest entries
    current = sorted(subdir.glob('*.jpg'))
    return [{'filename': f.name, 'url': f'/satellite/{cfg["subdir"]}/{f.name}', 'mtime': int(f.stat().st_mtime)} for f in current]

def collect_radar():
    subdir = OUT_DIR / 'nexrad'
    subdir.mkdir(parents=True, exist_ok=True)
    result = []

    # NWS RIDGE2 radar Hawaii composite — try various known paths
    candidates = [
        ('pacific', 'https://radar.weather.gov/ridge/standard/PACIFIC_REF_0.gif'),
        ('hi_comp', 'https://radar.weather.gov/ridge/Conus/Loop/HI_Reflectivity.gif'),
        ('hmo_n0r', 'https://radar.weather.gov/ridge/RadarImg/N0R/HMO_N0R_0.gif'),
        # RIDGE2 GeoTIFF available at api.weather.gov but requires auth — skip
    ]

    for key, url in candidates:
        try:
            data  = fetch(url, timeout=15)
            fname = f'{key}_{int(time.time())}.gif'
            fpath = subdir / fname
            fpath.write_bytes(data)
            log(f'  Radar {key}: {len(data)//1024}KB')
            # Keep last 6
            for old in sorted(subdir.glob(f'{key}_*.gif'))[:-6]:
                old.unlink()
            result.append({'key': key, 'url': f'/satellite/nexrad/{fname}', 'mtime': int(time.time())})
        except Exception as e:
            log(f'  Radar {key} failed: {e}')

    return result

def main():
    log('=== Satellite Collector START ===')
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    manifest = {'updated': datetime.now(timezone.utc).isoformat(), 'products': {}, 'radar': []}

    for key, cfg in GOES_PRODUCTS.items():
        log(f'Collecting {key}...')
        frames = collect_goes(key, cfg)
        manifest['products'][key] = {'name': cfg['name'], 'frames': frames}
        log(f'  {key}: {len(frames)} frames cached')

    log('Collecting NEXRAD...')
    manifest['radar'] = collect_radar()

    (OUT_DIR / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    log('=== DONE ===')

if __name__ == '__main__':
    main()
