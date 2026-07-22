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

*Part of: Pukalani Home Control Architecture Documentation Suite*
*Repository: https://github.com/gavinfischer-keenan/pukalanihomecontrol*
*Last updated: 2026-07-21 evening session*
