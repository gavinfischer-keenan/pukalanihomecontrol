# Pukalani Home Control â€” Architectural Change Log

> This document records significant architectural changes and the reasoning behind them.
> Append-only â€” new entries are added at the bottom.
>
> **Part of the Pukalani Home Control Architecture Documentation Suite:**
> - [architecture.md](architecture.md) â€” System architecture (hardware, VMs, data flows, network)
> - [architecture-credentials.md](architecture-credentials.md) â€” Credentials, tokens, SSH access
> - **architecture-changelog.md** â€” This file (change log)
>
> **Repository:** https://github.com/gavinfischer-keenan/pukalanihomecontrol
> **Location:** Pukalani, Maui, Hawaii â€” 21.2855Â°N, 157.7969Â°W

---
### 2026-07-21: Massive Architecture Update (v2.0)

**Changes made:**

1. **Project Manager â†’ HACS integration** (NEW)
   - *What changed:* PM evolves from standalone web app to HA-integrated system
   - *Why:* Enable HA entity linking (assign tasks to specific devices), vendor CRM accessible from HA sidebar, hardware inventory visible as HA sensors
   - *Architecture impact:* CT110 keeps Express API (clean separation). New HACS integration acts as bridge. PostgreSQL migration required for relational queries and purge logic.

2. **JSON â†’ PostgreSQL migration** (PLANNED for CT110)
   - *What changed:* Data storage moves from flat JSON files to PostgreSQL on CT104
   - *Why:* JSON flat files don't support relational queries (warranty expiry checks, vendor-to-task joins), concurrent access is unsafe (fs.readFileSync/writeFileSync), and selective purging ("sold house") requires transactional DELETE cascades
   - *Architecture impact:* CT104 gets second database `project_mgr`. CT110 Express routes change from fs to pg client. Data model gains `assets`, `warranties` tables.

3. **BirdNET native integration** (NEW)
   - *What changed:* BirdNET moves from iframe-only to native HACS integration with custom panel
   - *Why:* iframe sandbox blocks POST requests to BirdNET-Go API (can't review/lock detections). Native integration calls API directly from HA backend.
   - *Architecture impact:* No infrastructure changes. New HACS component consumes existing CT112 REST API.

4. **Aqara camera pipeline** (EXPANDED)
   - *What changed:* CT113 Frigate expanded from placeholder to full 6-camera NVR
   - *Why:* Security monitoring with AI detection, event recording, future alerting
   - *Architecture impact:* Coral USB TPU confirmed working. MQTT broker (Mosquitto on HA) carries event data. 5 new cameras to be added to Frigate config when installed.

5. **CT114 utilities expansion** (EXPANDED)
   - *What changed:* CT114 grows from 2 tools to 2 tools + 2 games + 1 health converter
   - *Why:* Consolidate web-served utility apps on single container
   - *Architecture impact:* nginx/FastAPI gains new routes. Apple Health Converter requires web conversion from Tkinter desktop app. Games are pure static SPAs (no backend).

6. **Kiosk console** (NEW)
   - *What changed:* Proxmox host gains a kiosk display service
   - *Why:* Dedicated monitoring display for vessel tracking + bird detection
   - *Architecture impact:* Runs on host (not container) â€” uses native Intel iGPU, X11, Chromium. ~200MB RAM overhead. No impact on virtualization.

7. **Coral USB Accelerator** (DOCUMENTED)
   - *What changed:* Coral USB formally documented; confirmed working in Frigate
   - *Why:* Was physically present but undocumented
   - *Architecture impact:* Added to USB device table, CT113 config documented

### 2026-07-21: Implementation of Items 1â€“4 and 7

**Implementation completed â€” the following architecture items are now live and verified:**

#### Item 1: Project Manager PostgreSQL Migration + HACS Integration â€” âœ… IMPLEMENTED

**Database migration:**
- Created `project_mgr` database on CT104 (user: `pm_user`, password: `pukalani_pm`)
- Schema deployed: `owners`, `vendors`, `vendor_interactions`, `tasks`, `task_supplies`, `maintenance`, `assets`, `warranties` tables
- JSON â†’ PostgreSQL migration script (`migrate.js`) executed successfully
- Data integrity verified: 241 tasks, 17 vendors, 4 owners â€” exact match
- `dotenv` added to index.js for env var loading

**Express route conversion (CT110):**
- All routes converted from `fs.readFileSync/writeFileSync` to PostgreSQL `pg` pool queries
- Dependency cascading logic preserved (date propagation on task completion)
- New endpoints deployed: `/api/assets`, `/api/warranties`, `/api/purge`, `/api/health`
- Health endpoint returns: `{"status":"ok","database":"connected","counts":{...}}`
- PM2 service saved and auto-starts on reboot

**HACS integration (`pukalani_pm`):**
- Deployed to `/config/custom_components/pukalani_pm/` on HAOS
- Committed to GitHub repo under `custom_components/pukalani_pm/`
- DataUpdateCoordinator polls PM API every 300 seconds
- 6 sensor entities: `pm_total_tasks`, `pm_active_tasks`, `pm_overdue_tasks`, `pm_total_vendors`, `pm_total_assets`, `pm_warranties_expiring`
- 1 binary sensor: `pm_api_online`
- Graceful fallback when assets/warranties endpoints not yet available

**Automated tests:**
- Vitest suite (`server/tests/db.test.js`): DB connection, table count verification, CRUD operations on assets, purge safety â€” 3/3 pass

#### Item 2: Games on CT114 â€” âœ… IMPLEMENTED

- LUX (Alux2Win) built with `npx vite build --base=/games/lux/` â€” WebGL strategy game
- Trish's Games built with `npx vite build --base=/games/trishsgames/` â€” 7 casual games
- Dark-themed games landing page at `/games/` with glassmorphism card layout
- Static assets deployed to `/opt/utilities/games/{landing,lux,trishsgames}/`
- FastAPI mount order: specific paths (`/games/lux`, `/games/trishsgames`) before catch-all `/games`
- HA sidebar panel: `panel_iframe` entry "Entertaining Diversions" (icon: `mdi:gamepad-variant`)

**Automated tests:**
- Bash integration test suite (`/opt/utilities/tests/integration_test.sh`): 12/12 pass
- Python pytest suite: 164/164 pass (includes regression checks)

#### Item 3: Apple Health Converter on CT114 â€” âœ… IMPLEMENTED

- `health_converter.py` module created â€” reuses original `parser.py` streaming XML engine and `writers.py` CSV manager
- FastAPI endpoint: `POST /api/healthconverter/convert` â€” accepts `.xml` or `.zip` upload, returns `.zip` of CSVs
- Web UI: `health_converter.html` with drag-and-drop upload interface
- Tool card added to utilities landing page
- Processing uses temp directories, auto-cleaned after response
- No server-side file retention â€” all processing ephemeral

**Automated tests:**
- Included in the 164-test pytest suite: synthetic export.xml test, zip upload handling, missing file error, endpoint integration

#### Item 4: BirdNET Native Integration â€” âœ… IMPLEMENTED

**HACS integration (`pukalani_birdnet`):**
- Deployed to `/config/custom_components/pukalani_birdnet/` on HAOS
- Committed to GitHub repo under `custom_components/pukalani_birdnet/`
- DataUpdateCoordinator polls BirdNET-Go REST API every 60 seconds
- 5 sensor entities: `birdnet_species_today`, `birdnet_detections_today`, `birdnet_last_species`, `birdnet_last_confidence`, `birdnet_top_species`
- 3 services: `pukalani_birdnet.review`, `pukalani_birdnet.lock`, `pukalani_birdnet.refresh`
- Uses `Pacific/Honolulu` timezone for "today" filtering
- Graceful offline handling via `UpdateFailed` exception
- HA sidebar panel: `panel_iframe` entry "BirdNET" (icon: `mdi:bird`)

**Automated tests:**
- `test_coordinator.py`: Mocked HTTP responses, data parsing
- `test_sensor.py`: Entity creation, state verification
- `test_services.py`: Service call validation

#### Item 7: Architecture Document Update â€” âœ… IMPLEMENTED

- Architecture document updated with implementation details for all items
- Playbook step 4 updated to reflect project_mgr database creation
- Change log updated with this section
- Status of items 2 and 3 in change log changed from PLANNED to IMPLEMENTED

**HA Configuration changes:**
- `panel_iframe` section added to `configuration.yaml` with 3 entries:
  - `helper_tools` â†’ `http://192.168.1.114:3114/tools/` (icon: `mdi:tools`)
  - `entertaining_diversions` â†’ `http://192.168.1.114:3114/games/` (icon: `mdi:gamepad-variant`)
  - `birdnet` â†’ `http://192.168.1.25:8080/` (icon: `mdi:bird`)
- Two HACS custom integrations deployed to `/config/custom_components/`
- HA core restarted to activate all changes

**Still planned (not implemented in this pass):**
- Item 5: Kiosk console (requires hardware setup)
- Item 6: Aqara camera pipeline (requires camera hardware installation)

### 2026-07-21 (Evening): NWS/NOAA Dashboard Overhaul + 3D Asset Upload

**NWS/NOAA Dashboard â€” Breaking changes and data flow updates:**

1. **NWS Station Observations â€” Data source migration** (CRITICAL)
   - *Old:* `weather.gov/hfo/obs.kml` KML feed â†’ custom KML parser â†’ GeoJSON
   - *New:* NWS API v2 (`api.weather.gov/stations/{id}/observations/latest`) â†’ 12 HI stations fetched in parallel â†’ GeoJSON
   - *Why:* NWS deprecated all `/hfo/*.kml` endpoints (return 404). All 4 KML feeds (obs, wind, rain24, rain6) were broken.
   - *Impact:* `fetchObsKML()` in `nws-service.js` completely rewritten. Wind/rain KML feeds not yet replaced (obs only).
   - *Stations:* PHNL, PHOG, PHTO, PHLI, PHKO, PHJR, PHJH, PHNG, PHMK, PHMU, PHBK, PHHI, PHSF
   - *Output format:* GeoJSON FeatureCollection with properties: name, stationIdentifier, description (formatted text), temperature_f/c, wind_mph, wind_dir, humidity, textDescription, timestamp
   - *parseKMLToGeoJSON() function:* Removed (no longer needed)

2. **Depth layer â€” Tile source migration**
   - *Old:* GEBCO tiles (`tiles.gebco.net/tiles/gebco_latest/{z}/{x}/{y}.png`) at opacity 0.55
   - *New:* Esri Ocean Reference tiles with depth contours and labels, rendered in custom Leaflet pane (`depthPane`, z-index 250) at opacity 0.85
   - *Why:* GEBCO tile server unreachable (HTTP 000). Also, old layer had no custom pane so rendered behind/at-same-level as the base map (Esri World Ocean Base, which already includes GEBCO bathymetry).
   - *URL:* `https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}`

3. **Trade Routes and Harbor Approaches â€” REMOVED from UI**
   - *What:* `TradeRouteLayer`, `HarborLayer` components, NAVIGATION sidebar group, right-side route toggles panel â€” all deleted from `NWSMap.jsx`
   - *State removed:* `showHarbor`, `showRoutes`, `enabledRoutes`, `routeFeatures`, `handleRoutesLoaded`
   - *API routes:* `/api/nws/harbor-approaches` and `/api/nws/trade-routes` still exist in `nws-service.js` but are no longer called by the frontend
   - *Why:* User decision â€” data to be revamped in future. Lines and GeoJSON data were placeholder quality.

4. **Forecasts tab â€” Complete UI rewrite**
   - *Old:* Single scrolling list of `ProductCard` accordions under "Text Products" heading (wall of text)
   - *New:* Category-tabbed navigation: ðŸ„ Surf (SRF), ðŸŒ¤ï¸ Weather (AFD, RWR), â›µ Marine (CWF, HSF), ðŸ“Š Climate (ENSO + CPC)
   - *New features:* Jump-to links for multi-product categories, product ID badges, description subtitles, "time ago" display, per-card scrollable body
   - *New files:* `NWSForecastPanel.css` (was using shared NWSApp.css styles)
   - *CSS class prefix:* Changed from `nws-product-*` / `nws-forecast-*` to `nfp-*`

5. **Loops tab â€” Complete UI rewrite**
   - *Old:* Grid of clickable cards with thumbnail images
   - *New:* Sidebar + viewer split layout. Left: clickable list with loop descriptions and "Best for" tips. Right: full-size imagery viewer.
   - *Descriptions added:* Plain-English explanation of each loop type and usage guidance
   - *New files:* `NWSLoopsGrid.css` (was using shared styles)
   - *CSS class prefix:* Changed from `nws-loop-*` / `nws-loops-*` to `nlg-*`

6. **Active Alerts â€” Verified working**
   - API route `/api/nws/alerts` uses NWS API v2 (`api.weather.gov/alerts/active?area=HI`)
   - Returns 0 alerts when none are active in Hawaii (valid state)
   - Frontend `AlertsLayer` renders alert polygons when data is present

**3D Asset Upload â€” All building floor plans complete:**

- 5 GLB files uploaded to HAOS at `/config/www/3d/` via chunked base64 transfer through Proxmox host
- Total uploaded: ~11.4 MB across 5 files
- Panorama directory created at `/config/www/3d/panoramas/` (awaiting roof panorama JPGs)
- See Section 12.8 for full file inventory and status

**Hawaii PM Frontend Fix:**

- Fixed data loading bug in `src/App.jsx` on CT110
- API returns wrapped objects (`{ tasks: [...] }`) but frontend expected raw arrays
- Updated 4 loaders: `refreshTasks`, `refreshMaintenance`, `refreshVendors`, `refreshOwners`
- CT110 memory temporarily increased to 2GB for `vite build` (OOM at 512MB)

**Files modified (CT108):**
- `/opt/dashboard/server/nws-service.js` â€” `fetchObsKML()` rewritten, `parseKMLToGeoJSON()` removed
- `/opt/dashboard/client/src/components/NWSMap.jsx` â€” DepthLayer, HarborLayer, TradeRouteLayer changes
- `/opt/dashboard/client/src/components/NWSForecastPanel.jsx` â€” Complete rewrite
- `/opt/dashboard/client/src/components/NWSForecastPanel.css` â€” NEW
- `/opt/dashboard/client/src/components/NWSLoopsGrid.jsx` â€” Complete rewrite
- `/opt/dashboard/client/src/components/NWSLoopsGrid.css` â€” NEW

**Files modified (CT110):**
- `/opt/hawaii-pm/src/App.jsx` â€” API response parsing fix

**Files added (HAOS VM100):**
- `/config/www/3d/floorplan.glb` (561 KB)
- `/config/www/3d/property_exterior.glb` (10.5 MB)
- `/config/www/3d/cabana_garage.glb` (245 KB)
- `/config/www/3d/utility_room.glb` (34 KB)
- `/config/www/3d/laundry_room.glb` (38 KB)


---

### 2026-07-22: Hurricane Tracking + PacIOOS Ocean Data Expansion

**Context:** User requested global tropical storm awareness (earliest possible detection), ocean current visualization, and PacIOOS water quality buoy integration. All governed by a "good citizen" caching policy.

**Changes made:**

1. **Hurricane Tracker Integration (HA VM100 — HAOS)**
   - *What:* Installed `aaronmayeux/ha-hurricane-tracker` v0.2.7 via direct download to `/mnt/data/supervisor/homeassistant/custom_components/hurricane_tracker/`
   - *Why:* Provides native HA entities (`sensor.hurricane_tracker_distance`, `sensor.hurricane_tracker_category`, `binary_sensor.hurricane_tracker_watch_or_warning`) backed by NHC GIS data including cone of uncertainty, past track, forecast polygons
   - *Scope:* `global` — all basins (AL, EP, CP) from earliest formation (Tropical Depressions included)
   - *Center:* Pukalani, Maui (20.8783°N, 156.6825°W)
   - Files: 20 files + 8.7MB basemap binary + bundled `hurricane-card.js` Lovelace card
   - `hurricane-card.js` copied to `/www/` for Lovelace resource registration

2. **HA Hurricane Automations (3 added to `automations.yaml`)**
   - `hurricane_1000mi_watch` — persistent notification + mobile push when storm < 1,000 mi
   - `hurricane_500mi_warning` — urgent mobile push when storm < 500 mi  
   - `hurricane_all_clear` — dismisses all notifications when storm retreats > 1,200 mi (buffer prevents oscillation)
   - HA restart required after adding integration → configure via `Settings → Devices & Services → Hurricane Tracker`, scope = `global`

3. **CT108 Dashboard — `/api/hurricanes` server route**
   - *What:* New endpoint in `nws-service.js` polling `https://www.nhc.noaa.gov/CurrentStorms.json` every 30 minutes
   - *Good citizen:* Uses `If-Modified-Since` header, `User-Agent` identifies as `pukalanihome-ct108/1.0`, max 2 polls/hour
   - Returns: storm list sorted by distance from Pukalani, haversine distance (mi), compass bearing, threat level (`none` / `watch` / `warning` / `imminent`), NHC cone PNG URL, advisory link
   - Serves stale data up to 2h with `isStale` flag; warns after upstream unreachable

4. **CT108 Dashboard — `HurricanePanel.jsx` (NEW component)**
   - Dedicated `🌀 Storms` tab added to NWS/NOAA section
   - Two-pane layout: storm list sidebar (sorted by distance) + detail pane
   - Shows: category badge, wind speed (kt + mph conversion), distance, bearing, movement, pressure, last advisory time
   - Embeds NHC 5-day forecast cone PNG directly from `nhc.noaa.gov`
   - Threat level color system: 🟢 > 1,500mi / 🟡 < 1,500mi / 🟠 < 500mi / 🔴 < 250mi
   - Polls `/api/hurricanes` every 5 min (server caches at 30 min; good citizen)

5. **CT108 Dashboard — `StormLayer` (new map layer, both Air + Water tabs)**
   - Shows active storm markers on the Hawaii map (storms < 3,000 mi shown)
   - Color: grey (TD), yellow (TS), orange-red (HU)
   - Dashed bearing line from Pukalani to storm (< 2,000 mi)
   - Clickable popup: name, category, winds, distance, bearing, movement, NHC advisory link
   - Default: enabled (important always to see)

6. **CT108 Dashboard — `CurrentsLayer` (new Water-only map layer)**
   - *Source:* PacIOOS HF Radar (`hfradar_ushi_2km`) — **actual measured** near-real-time surface currents, not modeled
   - *WMS:* `https://pae-paha.pacioos.hawaii.edu/erddap/wms/hfradar_ushi_2km/request`
   - Layers: `hfradar_ushi_2km:u` (eastward, 0.55 opacity) + `hfradar_ushi_2km:v` (northward, 0.30 opacity)
   - Coverage: Hawaiian Islands, 2km resolution, ~hourly update
   - Default: disabled (user toggle)
   - *Good citizen:* WMS tiles served directly from PacIOOS CDN — browser caches, no server-side proxying

7. **CT108 Dashboard — `BuoyMarkerLayer` + `/api/pacioos/buoys` (new)**
   - *Sources:* PacIOOS ERDDAP tabledap — water quality buoys (`wqb_04`, `wqb_05`) + nearshore sensors (`nss_cwb_001`, `nss_cwb_003`, `nss_cwb_004`)
   - *Variables:* `temperature`, `salinity`, `turbidity`, `chlorophyll`, `oxygen`, `ph` (using actual ERDDAP field names)
   - *Cache:* 6-hour server-side cache, 12-hour stale limit (shows with `isStale` warning in popup)
   - *Good citizen:* ERDDAP is a shared public research server; 2-second stagger between station fetches, max 6h polling
   - Clickable markers on Water map with all available readings per station
   - Default: enabled

**Caching Policy (from architecture.md good-citizen mandate):**

| Source | Poll Rate | Stale Shown | Notes |
|---|---|---|---|
| NHC CurrentStorms.json | 30 min | Up to 2h | If-Modified-Since |
| PacIOOS HF Radar WMS | N/A (tiles) | N/A | PacIOOS CDN |
| PacIOOS ERDDAP Buoys | 6 hours | Up to 12h | Note shown in popup |
| NHC Cone PNG | Direct embed | N/A | NHC CDN |

**GitHub commit:** `75c052a` (feat) + `<fix commit>` (HF radar layer names)

---

### 2026-07-22: Bathymetry (ETOPO1), Vessel Map Cleanup, Currents Fix

---

#### A. NOAA ETOPO1 Depth Soundings — Full Methodology (Replication Guide)

This section is written explicitly so that when the system is redeployed for California (or any other region), the same approach can be followed with minimal friction.

##### Why ETOPO1?

NOAA's **ETOPO1** dataset is the gold standard 1 arc-minute global bathymetric relief model. It synthesises every hydrographic survey conducted by NOAA, GEBCO, and international partners. The same data underlies NOAA's official Raster Nautical Charts (RNCs). It is public domain (CC0), machine-readable, and served for free by multiple NOAA-operated ERDDAP instances.

##### Where the Data Lives

| Server | URL | Notes |
|---|---|---|
| **Primary (used):** CoastWatch ERDDAP | `https://coastwatch.pfeg.noaa.gov/erddap/` | NOAA West Coast node, highly reliable |
| NCEI ERDDAP | `https://www.ncei.noaa.gov/erddap/` | NOAA East Coast node, same data |
| Local file (post-download) | `/opt/dashboard/server/data/hawaii_depths.json` | Permanent — no re-download until user runs script |

##### Dataset ID and Variable

```
Dataset ID:  etopo180
Variable:    altitude   (depth is negative altitude, e.g. -4200 = 4200m deep)
Grid axes:   latitude, longitude  (1/60° = 1 arc-minute spacing)
```

##### How to Download for a New Region

Run the following `curl` command (or the stored script `/opt/dashboard/server/data/download_hawaii_depths.sh`), substituting the bounding box for the target region:

```bash
# Hawaii: south=17, north=24, west=-163, east=-153
# California: south=32, north=38, west=-122, east=-117  (adjust as needed)

SOUTH=32; NORTH=38; WEST=-122; EAST=-117   # ← change for new region

curl --max-time 300 --retry 2 \
  -H "User-Agent: myhome-ct108/1.0 (one-time bathymetric data pull)" \
  "https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180.json?\
altitude%5B(${SOUTH}.0):1:(${NORTH}.0)%5D%5B(${WEST}.0):1:(${EAST}.0)%5D" \
  -o /opt/dashboard/server/data/hawaii_depths_raw.json
```

The URL structure follows ERDDAP griddap syntax:
- `altitude[(south):stride:(north)][(west):stride:(east)]`
- Stride of `1` = every grid point (1 arc-minute)

##### How the Data is Processed

After download, a Python script buckets the raw grid into zoom-level-indexed point sets. The logic in `/tmp/retry_etopo_download.sh`:

```python
# Filter ocean-only points (altitude < -5m eliminates land and coastal fuzz)
ocean = [[lat, lon, int(abs(alt))] for lat, lon, alt in rows if alt < -5]

# Pre-bucket by zoom level with stride (density) per zoom
stride_map = {'7': 30, '8': 15, '9': 6, '10': 3, '11': 2, '12': 1, '13': 1}
by_zoom = {}
for zoom, stride in stride_map.items():
    by_zoom[zoom] = [pt for pt in ocean
                     if grid_i(pt[0]) % stride == 0 and grid_j(pt[1]) % stride == 0]
```

This produces a single JSON file. Hawaii result: **247,660 ocean points, 13MB** after zoom-bucketing.

##### How It's Served (Zero External Calls)

`/opt/dashboard/server/nws-service.js` — inside `init(app)`:

```javascript
// Loads once on startup, stays in memory for all subsequent requests
function loadBathyData() { /* fs.readFileSync('hawaii_depths.json') */ }
setImmediate(() => loadBathyData()); // pre-warm cache

app.get('/api/bathymetry', (req, res) => {
  const zoomKey = Math.min(13, Math.max(7, parseInt(req.query.zoom)));
  const points  = data.by_zoom[zoomKey];
  res.set('Cache-Control', 'public, max-age=86400'); // browser caches 24h
  res.json({ zoom, count, points });
});
```

**No external network call is ever made by this endpoint.** The ERDDAP download happens once, manually, by the operator.

##### How It's Rendered (NWSMap.jsx — BathymetryLayer)

```
Browser fetches /api/bathymetry?zoom=N (24h browser cache)
→ Returns array of [lat, lon, depth_metres]
→ Each point rendered as L.divIcon with class .depth-sounding-label
→ CSS: font-family Arial Narrow, italic, 10px, color #1a5fa0 (NOAA chart blue)
→ text-shadow halo for legibility over any base map
→ Pan events: only reshow in-bounds markers (no re-fetch)
→ Zoom events: fetch new zoom bucket, replace all markers
```

Layer 2 (contour lines, not soundings): Esri Ocean Reference CDN tiles
`https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}`
These cache in the browser forever after first view — static tiles, no auth needed.

##### Zoom Density Reference

| Zoom | Stride | Points shown | Equivalent nautical chart |
|---|---|---|---|
| 7 | 30 | ~310 | Overview / Pacific Wide Area |
| 8 | 15 | ~1,170 | Island chain overview |
| 9 | 6 | ~7,015 | Inter-island channels |
| 10 | 3 | ~27,742 | Island approach |
| 11 | 2 | ~62,168 | Harbor approach / NOAA Chart 19347-grade |
| 12 | 1 | ~247,660 | Nearshore / harbor detail |
| 13+ | 1 | ~247,660 | Max native zoom |

##### Update Procedure (Annual or As-Needed)

```bash
# On CT108:
rm /opt/dashboard/server/data/hawaii_depths.json
bash /tmp/retry_etopo_download.sh
pm2 restart hawaii-api
```

---

#### B. Ocean Currents WMS — Visibility Fix

**Problem:** The `CurrentsLayer` in `NWSMap.jsx` added WMS tiles for `hfradar_ushi_2km:u` and `hfradar_ushi_2km:v` (eastward/northward velocity components from PacIOOS HF Radar) but used empty `styles: ''`. ERDDAP's default rendering for velocity components produces near-transparent colour output that is visually indistinguishable from no layer.

**Fix:** Added ERDDAP-specific WMS vendor parameters:
```javascript
styles:          'boxfill/occam',      // diverging blue-white-red palette
COLORSCALERANGE: '-0.8,0.8',           // ±0.8 m/s covers nearshore speeds
BELOWMINCOLOR:   'extend',             // don't clip at extremes
ABOVEMAXCOLOR:   'extend',
```

For the v-component (northward), `boxfill/occam_r` (reversed) is used so the colour convention is consistent (blue = negative/westward/southward, red = positive/eastward/northward).

**Hourly cache-bust:** A `_cache: hourKey` parameter (hour-resolution epoch integer) is included. This is NOT sent to the WMS server (ERDDAP ignores unknown params). Its purpose is to cause Leaflet to request fresh tiles when the hour changes — currents update approximately hourly.

---

#### C. Vessel Map (App.jsx) — Cleanup

The integrated vessel/aircraft tracking map (`/`) had several features that made sense during development but created visual clutter for the intended use case (maritime situational awareness + air traffic):

| Removed | Reason |
|---|---|
| Airport Status bar (`AirportStatusBar` component) | California-centric (SFO/OAK/PDX defaults). Not meaningful in Hawaii maritime context. |
| Winds Aloft panel (`WindsAloftPanel` component) | Winds aloft data exists for aviation planning. Out of scope for vessel map. |
| Harbour / FADs layer toggle | FAD locations are on the NWS/Water map which is the correct context. |
| Settings section in LayerControl | Only contained airport picker — removed with airport status. |
| Associated imports, state, callbacks, polls | Full code removal (not just UI hide). `airportSettings`, `toggleAirport`, `windsAloft` poll all deleted. |

**Added:** Esri Ocean Reference depth contour tile layer — always active when Ocean base map is selected. No toggle: depth context is universally useful for marine operations and does not clutter the aircraft tracking view.

---

**GitHub commits:** `3bf182a` (bathymetry route fix), `78926bc` (vessel map cleanup + currents fix)

---

*Part of: Pukalani Home Control Architecture Documentation Suite*
*Repository: https://github.com/gavinfischer-keenan/pukalanihomecontrol*
*Last updated: 2026-07-22 — Bathymetry + vessel map session*

---

## [2026-07-22] Frequent Visitors System — Phase 1 Complete

### Overview
Added a persistent "Frequent Visitors" tracking system for both vessels and aircraft. The system auto-detects entities seen on 3+ distinct calendar days and surfaces them in a collapsible right-side panel on the main map. Users can also manually pin any vessel or aircraft.

### Database Changes (CT104 — tracking_db)

**Extended existing tables:**
```sql
-- vessel_info additions
ALTER TABLE vessel_info ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT false;
ALTER TABLE vessel_info ADD COLUMN IF NOT EXISTS friendly_name TEXT;
ALTER TABLE vessel_info ADD COLUMN IF NOT EXISTS auto_detected BOOLEAN DEFAULT false;

-- aircraft_info additions  
ALTER TABLE aircraft_info ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT false;
ALTER TABLE aircraft_info ADD COLUMN IF NOT EXISTS friendly_name TEXT;
ALTER TABLE aircraft_info ADD COLUMN IF NOT EXISTS auto_detected BOOLEAN DEFAULT false;
ALTER TABLE aircraft_info ADD COLUMN IF NOT EXISTS description TEXT;
```

**New tables:**
```sql
-- entity_schedule: Auto-detected OR manually set schedule patterns
CREATE TABLE entity_schedule (
  entity_type TEXT NOT NULL CHECK (entity_type IN ('vessel','aircraft')),
  identifier  TEXT NOT NULL,        -- MMSI for vessels, ICAO hex for aircraft
  source      TEXT DEFAULT 'auto',  -- 'auto' or 'manual' (manual wins in updates)
  days_of_week INTEGER[],           -- e.g. [0,6] = weekends
  days_label  TEXT,                 -- e.g. 'Weekends only'
  arrival_hour SMALLINT,
  depart_hour  SMALLINT,
  time_label  TEXT,                 -- e.g. 'morning arrival, evening departure'
  confidence  REAL DEFAULT 0,
  obs_count   INTEGER DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(entity_type, identifier)
);

-- entity_photos: Multiple photos per vessel/aircraft (replaces single photo_url string)
CREATE TABLE entity_photos (
  id            SERIAL PRIMARY KEY,
  entity_type   TEXT NOT NULL,
  identifier    TEXT NOT NULL,
  filename      TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  caption       TEXT,
  uploaded_at   TIMESTAMPTZ DEFAULT NOW()
);

-- entity_track_history: GPS track history for corridor overlay display
-- Only stored for auto_detected or is_pinned entities
-- Retention: unlimited for pinned, 90 days for auto-detected, 7 days for unknown
CREATE TABLE entity_track_history (
  id           BIGSERIAL PRIMARY KEY,
  entity_type  TEXT NOT NULL,
  identifier   TEXT NOT NULL,
  track_session UUID NOT NULL,  -- groups a single trip together
  lat          DOUBLE PRECISION NOT NULL,
  lon          DOUBLE PRECISION NOT NULL,
  altitude     INTEGER,         -- feet for aircraft, NULL for vessels
  speed        REAL,
  heading      SMALLINT,
  recorded_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX eth_lookup ON entity_track_history(entity_type, identifier, recorded_at DESC);
CREATE INDEX eth_session ON entity_track_history(track_session, recorded_at);

-- flight_routes: Cache of commercial flight number -> origin/destination
-- Fetched once from OpenSky Network and stored forever. Only fetched when a
-- new, never-seen-before flight number appears on a selected aircraft.
CREATE TABLE flight_routes (
  flight_number TEXT NOT NULL UNIQUE,
  airline_name  TEXT,
  origin_iata   TEXT,        -- e.g. 'HNL'
  dest_iata     TEXT,
  origin_lat    DOUBLE PRECISION,
  origin_lon    DOUBLE PRECISION,
  dest_lat      DOUBLE PRECISION,
  dest_lon      DOUBLE PRECISION,
  fetched_at    TIMESTAMPTZ DEFAULT NOW(),
  source        TEXT         -- 'opensky' | 'manual'
);
```

### Existing Tables Used (confirmed working before this change)
- `vessel_sightings (mmsi, seen_day)` — day-level vessel sighting calendar
- `vessel_info (mmsi PK, vessel_name, ..., seen_days)` — persistent vessel knowledge
- `aircraft_sightings (icao_hex, seen_day)` — day-level aircraft sighting calendar
- `aircraft_sighting_counts (icao_hex, sighting_count, ...)` — raw count tracker
- `aircraft_info (icao_hex PK, registration, aircraft_type, ..., seen_days)` — persistent aircraft knowledge
- Both `recordVesselSighting()` and `recordAircraftSighting()` were already running in production

**Initial data counts at migration time:** 24 known vessels (auto_detected), 0 aircraft (sightings not yet meeting 3-day threshold in current schema)

### Backend: known-entities-service.js (CT108)

New service module at `/opt/dashboard/server/known-entities-service.js`.

**API endpoints added:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/known-entities` | Unified list of all frequent/pinned vessels + aircraft |
| GET | `/api/known-entities/:type/:id` | Single entity detail with photos and schedule |
| GET | `/api/known-entities/:type/:id/track-history` | Historical GPS sessions for corridor overlay |
| POST | `/api/known-entities/:type/:id/photos` | Upload photo (multipart) |
| DELETE | `/api/known-entities/:type/:id/photos/:photoId` | Delete photo |
| PUT | `/api/known-entities/:type/:id/photos/reorder` | Reorder photos |
| PUT | `/api/vessel-info/:mmsi` | Update vessel metadata, pin, friendly name |
| PUT | `/api/aircraft-info/:icao` | Update aircraft metadata, pin, friendly name |
| PUT | `/api/entity-schedule/:type/:id` | Manual schedule override |
| GET | `/api/flight-route/:flightNumber` | Cached commercial route lookup |
| POST | `/api/flight-route` | Manual route entry |

**Background jobs:**
- Every 4 hours: promote vessels/aircraft with seen_days >= 3 to `auto_detected = true`
- Daily at 03:00 HST: run schedule pattern analysis + track history prune
- Track history retention enforced by nightly prune:
  - Pinned entities: unlimited retention
  - Auto-detected (not pinned): 90 days
  - Unknown: 7 days

**Good citizen policy:** Flight routes fetched from OpenSky Network once per flight number, cached forever. Never polled repeatedly.

**Track sessions:** In-memory Map tracks `{entityType}:{identifier}` -> `{sessionId UUID, lastAt}`. Session UUID resets after 30-minute position gap, allowing distinct trip sessions to be stored separately.

**Photo uploads:** Multi-photo support via `entity_photos` table. Files stored at `/opt/dashboard/uploads/entities/{type}/{identifier}/{timestamp}.jpg`.

### Frontend Components (CT108)

**FrequentVisitorsSidebar.jsx** — Collapsible right-side panel:
- Fetches `/api/known-entities` every 5 minutes
- Filter tabs: All / Aircraft / Vessels
- Search by name or friendly_name
- Sort: pinned ⭐ first, then auto-detected 🤖, then by last_seen
- Each row: emoji icon, badges, seen_days count, schedule pattern labels, relative last_seen time, thumbnail
- Bottom: PinForm to manually pin any MMSI/ICAO hex
- Collapse/expand via chevron button
- Toggle via floating "👥 Frequent Visitors" button (bottom-right of map)

**RouteCorridorLayer.jsx** — Historical GPS track overlay:
- When an entity is selected from the sidebar, fetches all 90-day GPS session history
- Renders each session as a translucent polyline (green for vessels, blue for aircraft)
- Custom Leaflet pane `routeCorridorPane` at z-index 350 (below markers)
- Shows "📍 Route history: N tracks" info control
- Capped at 150 sessions for performance

**FlightRouteLayer.jsx** — Commercial flight route arc:
- When a commercial aircraft (with flight number in callsign) is selected, fetches cached route
- Draws 60-point great-circle arc between origin and destination airports
- Dashed amber polyline (`#ff9f1c`) with IATA code labels at endpoints
- Route data cached in component memory to avoid repeat API calls

### Replication Guide (for California deployment)

To replicate the Frequent Visitors system in a new location:

1. **Run the same DB migration** — the schema is location-independent. Tables are already defined above.
2. **Populate flight_routes manually** for local commercial flights, OR let OpenSky Network auto-populate on first selection of each flight number.
3. **Aircraft threshold:** The 3-day threshold for `auto_detected` fires automatically once the aircraft sightings calendar fills. No location-specific configuration needed.
4. **Airport coordinates:** Add any California-area airports to the `AIRPORT_COORDS` map in `known-entities-service.js` for flight route arc display:
   ```javascript
   SFO: [37.6213, -122.3790], OAK: [37.7213, -122.2208],
   SJC: [37.3626, -121.9290], SMF: [38.6954, -121.5908],
   LAX: [33.9425, -118.4081],  // already included
   ```
5. **Upload directory:** Change `ENTITY_PHOTOS_DIR` if desired. Default: `/opt/dashboard/uploads/entities/`.

---

## [2026-07-22] Auto Photo Fetch — Google Custom Search Integration

### Overview
Added automated image search for all frequent/pinned vessels and aircraft. The system searches curated photo databases via Google Custom Search API, downloads the top 3 matching images, and presents them in the Frequent Visitors sidebar as "POTENTIAL — Not Confirmed" with one-click confirm/reject buttons.

### Database Changes
```sql
-- Added to entity_photos table:
ALTER TABLE entity_photos ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'confirmed'
  CHECK (status IN ('confirmed','potential','rejected'));
ALTER TABLE entity_photos ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual'
  CHECK (source IN ('manual','google_image_search'));
ALTER TABLE entity_photos ADD COLUMN IF NOT EXISTS vision_labels JSONB;
ALTER TABLE entity_photos ADD COLUMN IF NOT EXISTS original_url TEXT;
CREATE INDEX IF NOT EXISTS ep_status_idx ON entity_photos(entity_type, identifier, status);
```

### Photo Search Architecture

**Trigger:** On API startup (2-minute delay) + daily at 04:00 HST. Runs for any frequent/pinned entity with fewer than 3 non-rejected photos.

**Source: Google Custom Search API (PSE cx=661be9a75f259493f)**

The Programmable Search Engine is restricted to curated vessel and aircraft photo databases. No Vision API validation is needed because all sources are domain-authoritative:

| Domain | Content |
|--------|--------|
| marinetraffic.com | AIS vessel tracking with user-submitted photos |
| shipspotting.com | Community ship photography archive |
| vesseltracker.com | Commercial vessel photos and AIS data |
| fleetmon.com | Commercial fleet monitoring + photos |
| airliners.net | World's largest aviation photo database |
| planespotters.net | Every registration with photos, cn, operator |
| jetphotos.com | High-quality aviation photography |
| imgur.com | General image host (enthusiast uploads) |

**Search queries:**
- Vessels: `"<vessel_name>"` (quoted for precision)
- Aircraft: `"<registration>"` (ICAO registration is globally unique)

**Good citizen policy:**
- 3-second stagger between entities at startup
- Max 3 photos per entity ever (won't re-fetch if already have 3+)
- Rejected photos remembered permanently (status='rejected') — never re-fetched
- 50-entity cap per run to prevent runaway API use

### API Credentials (CT108 .env)
```
GOOGLE_GEOCODING_KEY=<key>   # Used for BOTH Geocoding API and Custom Search API
GOOGLE_CSE_CX=661be9a75f259493f  # Programmable Search Engine ID
```
**IP restriction:** Removed (home ISP uses DHCP — external IP can change). Key is restricted by API type only (Geocoding API + Custom Search API). Key lives only on CT108 — never in frontend code or public repos.

### New API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/known-entities/:type/:id/photos` | All non-rejected photos with status field |
| PUT | `/api/known-entities/:type/:id/photos/:id/confirm` | Promote potential → confirmed |
| PUT | `/api/known-entities/:type/:id/photos/:id/reject` | Mark rejected + delete local file |

### Frontend: EntityPhotoPanel (inside FrequentVisitorsSidebar)
- Confirmed photos: displayed as thumbnail grid
- Potential photos: displayed with **⚠️ AUTO-FOUND · NOT CONFIRMED** orange banner
- Each potential photo has **✓ Confirm** (green) and **✗ Reject** (red) buttons
- Rejected photos are immediately removed from view and never re-served
- No-edit workflow: photos accumulate automatically; user only acts on wrong ones

### Replication Guide (California deployment)
1. Create a new Google Programmable Search Engine at programmablesearchengine.google.com
2. Add the same 8 curated sites (or regional equivalents)
3. Enable Image Search in PSE settings
4. Use same GOOGLE_GEOCODING_KEY (or create a new one for the CA server)
5. Set GOOGLE_CSE_CX to the new PSE's Search Engine ID
6. The autoFetchAllPhotos() job will auto-run 2 minutes after API startup
7. No Vision API key needed — curated sites are domain-trusted
