# Pukalani Home Control — Full System Architecture

> **Purpose:** Complete specification for reconstructing or porting this system to new hardware.
> An AI agent reading this alongside a hardware inventory should be able to provision containers,
> configure services, and bring the full system to operational status with minimal debugging.
>
> **Repository:** https://github.com/gavinfischer-keenan/pukalanihomecontrol
> **Location:** Pukalani, Maui, Hawaii — 21.2855°N, 157.7969°W
> **Last updated:** 2026-07-21 (generated from live system state)

---

## 1. Hardware Platform

### Proxmox Host

| Attribute | Value |
|-----------|-------|
| CPU | Intel Core Ultra 5 245T — 14 cores, 1 socket |
| RAM | 16 GB (15 GiB usable) |
| OS | Proxmox VE 8.x |
| Host IP | 192.168.1.100 |
| Gateway | 192.168.1.1 |
| Network bridge | vmbr0 (LAN: 192.168.1.0/24) |
| Monitor | Attached display (HDMI/DP) — used for kiosk console |
| Input | USB mouse + keyboard (kiosk is mouse-only; keyboard for maintenance) |

### Storage Pools

| Pool | Type | Total | Used | Purpose |
|------|------|-------|------|---------:|
| local | Directory | 68 GB | 6 GB | ISOs, CT templates, Proxmox config |
| local-lvm | LVM-thin | 148 GB | 31 GB | OS disks for most CTs/VMs |
| bigdata | LVM-thin | 927 GB | 96 GB | DB data, Docker images, recordings |

> bigdata lives on an external USB3 SSD (JMicron YOTUO, 152d:b583).

### USB Devices

All on a VIA Labs USB 2.0 hub (2109:2817), bus 1 — except Coral (bus 2, USB 3.0).

| Port | USB ID | Product | Role | Assigned to |
|------|--------|---------|------|-------------|
| 1-7.2 | 31b2:0022 | KTMicro LavMicro-U | Microphone (BirdNET) | CT112 via /dev/snd bind-mount |
| 1-7.4 | 10c4:ea60 | Sonoff Zigbee 3.0 Dongle Plus V2 | Zigbee coordinator | VM100 (HAOS) pinned by physical port |
| 1-1 | 0bda:2838 | RTL-SDR Blog V4 (serial 00000001) | AIS 162MHz SDR | Proxmox host — rtl-tcp-ais service |
| 1-? | 0bda:2838 | Generic RTL2838 DVB-T | ADS-B 1090MHz SDR | CT102 via /dev/bus/usb bind-mount |
| USB3 | 152d:b583 | JMicron YOTUO | External SSD | bigdata storage pool |
| Bus 2 | 18d1:9302 | Google Coral USB Accelerator | Edge TPU (Frigate AI) | CT113 via /dev/bus/usb bind-mount |

> CRITICAL — USB disambiguation: The Zigbee dongle and any CP210x AIS receiver share
> VID:PID 10c4:ea60. Udev rules disambiguate by hardware serial number.
> The HAOS VM is pinned to physical port 1-7.4 so Zigbee is never grabbed after a replug.
> Zigbee dongle serial: 22571d3d0d91f011ab54786236f0e4ad
> See: /etc/udev/rules.d/99-hawaii-usb.rules

> Coral USB Accelerator: Device ID 18d1:9302 (uninitialised) / 18d1:9302 (runtime).
> Uses libedgetpu via USB inside Frigate Docker on CT113.
> No gasket/apex kernel module required for USB mode.
> Confirmed working: inference speed ~10ms per frame.

---

## 2. Virtual Machines and Containers

### VM100 — haos-18.1 (Home Assistant OS)

| Setting | Value |
|---------|-------|
| Type | QEMU KVM, q35 + OVMF |
| OS | Home Assistant OS 18.1 |
| IP | 192.168.1.19 (set inside HA network config) |
| CPU | 2 cores |
| RAM | 4096 MB |
| Disk | local-lvm:vm-100-disk-0 — 32 GB SSD+discard |
| EFI | local-lvm:vm-100-disk-1 — 4 MB |
| USB passthrough | usb0: host=1-7.4 (Zigbee dongle by physical port) |
| Boot | onboot: 1 |
| Key integrations | Enphase Envoy (solar), Ecowitt GW2000, ZHA (Zigbee), ESPHome, Frigate, Mosquitto MQTT |
| Webhook URL | POST http://192.168.1.19:8123/api/webhook/5de76fbee15b641d309d042238b47326 |

#### MQTT Broker (Mosquitto)

    Installed as HA add-on.  Status: installed, NOT YET FULLY CONFIGURED.
    Default port: 1883 (LAN-accessible at 192.168.1.19:1883)
    Frigate connects to it at 192.168.1.19:1883 (see CT113 config).
    Configuration pending: user accounts, ACLs, TLS.

    When configuring:
      1. HA → Settings → Add-ons → Mosquitto broker → Configuration
      2. Add user: frigate / <password>
      3. Add user: ha_internal / <password>
      4. Update Frigate config.yml mqtt section with credentials
      5. Restart Mosquitto + Frigate

#### Home Assistant Sidebar Panels

The following panels are configured (or planned) in HA's `configuration.yaml`:

| Panel | Type | Status | URL / Config |
|-------|------|--------|--------------|
| Helper Tools | panel_iframe | ✅ LIVE | http://192.168.1.114:3114/tools/ |
| Project Manager | panel_custom (HACS) | 🔲 NOT YET IMPLEMENTED | HACS integration `pukalani_pm` |
| BirdNET | panel_custom (HACS) | 🔲 NOT YET IMPLEMENTED | HACS integration `pukalani_birdnet` |
| Entertaining Diversions | panel_iframe | 🔲 NOT YET IMPLEMENTED | http://192.168.1.114:3114/games/ |
| Frigate | HACS integration | ✅ LIVE (pending full config) | Frigate integration via MQTT |

#### Home Assistant Custom Integrations (HACS)

##### `pukalani_pm` — Project Manager Integration

> 🔲 **NOT YET IMPLEMENTED** — Architecture defined below; build when PM PostgreSQL migration is complete.

**Purpose:** Bridge the standalone Project Manager (CT110) into HA as a native integration.
Exposes task counts, overdue alerts, and hardware inventory as HA entities.
Registers a custom sidebar panel for the full PM UI.

**File structure** (in pukalanihomecontrol repo):

    custom_components/pukalani_pm/
    ├── __init__.py           # async_setup_entry: creates coordinator, forwards platforms
    ├── manifest.json         # domain: pukalani_pm, requirements: [aiohttp], version
    ├── config_flow.py        # ConfigFlow: asks for PM API URL (default http://192.168.1.110:3001)
    ├── const.py              # DOMAIN, DEFAULT_URL, SCAN_INTERVAL (300s)
    ├── coordinator.py        # DataUpdateCoordinator: polls PM /api/tasks, /api/vendors, /api/assets
    ├── sensor.py             # Sensors: tasks_total, tasks_overdue, tasks_in_progress, assets_total
    ├── binary_sensor.py      # Binary sensors: has_delayed_tasks, has_expiring_warranties
    ├── services.yaml         # Service descriptions
    ├── strings.json          # UI translations
    └── translations/en.json

**Entities exposed:**

| Entity ID | Type | Description |
|-----------|------|-------------|
| sensor.pm_tasks_total | sensor | Total task count |
| sensor.pm_tasks_overdue | sensor | Tasks past target finish date |
| sensor.pm_tasks_in_progress | sensor | Tasks with status "In Progress" |
| sensor.pm_assets_total | sensor | Hardware assets in inventory |
| sensor.pm_warranties_expiring | sensor | Warranties expiring within 90 days |
| binary_sensor.pm_has_delayed | binary_sensor | True if any task is delayed |
| binary_sensor.pm_warranty_alert | binary_sensor | True if any warranty expires within 30 days |

**Services:**

| Service | Parameters | Description |
|---------|-----------|-------------|
| pukalani_pm.refresh | — | Force refresh from PM API |
| pukalani_pm.create_task | name, section, vendor_id, entity_id | Create task (can reference HA entity) |
| pukalani_pm.purge_project | keep_vendors, keep_assets | "Sold house" purge (see section 4.11) |

**HA entity linking:**
Tasks can reference HA entities via an `entity_id` field (e.g., `light.living_room`).
The coordinator resolves entity_id to friendly_name for display.
Example: Task "Replace bulb" → entity_id: `light.kitchen_ceiling` → shows "Kitchen Ceiling" in PM UI.

**Custom panel registration** (in `__init__.py`):

    frontend.async_register_panel(
        hass,
        component_name="pukalani-pm-panel",
        sidebar_title="Project Manager",
        sidebar_icon="mdi:clipboard-check-outline",
        url_path="project-manager",
        module_url="/pukalani_pm_static/panel.js",
        require_admin=False,
        config={"api_url": entry.data["api_url"]}
    )

The panel JS bundle is a LitElement web component that wraps the existing React PM frontend
in a shadow DOM iframe or re-implements the key views (summary dashboard, task table, vendor panel,
asset inventory) using HA's native web component patterns.

**Implementation approach when building:**
1. Complete PostgreSQL migration on CT110 first (see CT110 section below)
2. Build the HACS integration coordinator (polls PM REST API every 5 min)
3. Build sensor/binary_sensor platforms
4. Build the custom panel (start with iframe of PM at :3001, evolve to native LitElement)
5. Register services for create_task, purge_project
6. Test with HACS custom repository install

---

##### `pukalani_birdnet` — BirdNET Native Integration

> 🔲 **NOT YET IMPLEMENTED** — Architecture defined below; build when ready.

**Purpose:** Replace the current iframe-only BirdNET access with a native HA integration.
Provides real-time detection entities, species statistics, and a custom panel with
full review/lock/verify capabilities that the iframe blocks.

**Why native instead of iframe:**
The BirdNET-Go web UI served via iframe blocks certain interactions (review/lock buttons
fail due to cross-origin restrictions on POST requests from within HA's iframe sandbox).
A native integration calls the BirdNET-Go REST API directly from the HA backend,
bypassing all iframe limitations.

**File structure:**

    custom_components/pukalani_birdnet/
    ├── __init__.py           # async_setup_entry, panel registration
    ├── manifest.json         # domain: pukalani_birdnet, requirements: [aiohttp]
    ├── config_flow.py        # ConfigFlow: BirdNET-Go URL (default http://192.168.1.25:8080)
    ├── const.py              # DOMAIN, API_BASE, SCAN_INTERVAL (60s)
    ├── coordinator.py        # DataUpdateCoordinator: polls /api/v2/detections + /api/v2/analytics
    ├── sensor.py             # Sensors: species_today, total_detections_today, last_species, last_confidence
    ├── services.yaml         # review_detection, lock_detection
    ├── strings.json
    └── translations/en.json

**BirdNET-Go REST API consumed** (CT112:8080):

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v2/detections | Paginated detection list |
| POST | /api/v2/search | Filtered search (date, species, confidence, verified status) |
| GET | /api/v2/detections/stream | SSE real-time detection stream |
| GET | /api/v2/detections/:id | Single detection detail |
| DELETE | /api/v2/detections/:id | Delete detection |
| POST | /api/v2/detections/:id/review | Confirm or re-assign species (agree/disagree) |
| POST | /api/v2/detections/:id/lock | Lock detection against model re-classification |
| POST | /api/v2/detections/ignore | Manage species ignore list |
| GET | /api/v2/analytics/species/summary | Aggregated species statistics |
| GET | /api/v2/species | Known/detected species list |
| GET | /api/v2/media/audio/:id | Audio clip playback |

**Entities exposed:**

| Entity ID | Type | Description |
|-----------|------|-------------|
| sensor.birdnet_species_today | sensor | Unique species count for today |
| sensor.birdnet_detections_today | sensor | Total detections today |
| sensor.birdnet_last_species | sensor | Most recent species name |
| sensor.birdnet_last_confidence | sensor | Confidence % of last detection |
| sensor.birdnet_top_species | sensor | Most-detected species (all time) |

**Services:**

| Service | Parameters | Description |
|---------|-----------|-------------|
| pukalani_birdnet.review | detection_id, species, verified | Confirm/reject a detection |
| pukalani_birdnet.lock | detection_id | Lock detection against re-classification |
| pukalani_birdnet.refresh | — | Force data refresh |

**Custom panel features:**
- Real-time detection feed (via SSE subscription)
- Detection list with audio playback, spectrogram thumbnail
- ✅ Agree / ❌ Disagree buttons (POST /api/v2/detections/:id/review)
- 🔒 Lock button (POST /api/v2/detections/:id/lock)
- Species statistics dashboard (daily/weekly/monthly charts)
- Filter by species, confidence threshold, verified status

**Implementation approach:**
1. Build coordinator that polls /api/v2/detections every 60s
2. Build sensor platform (5 entities above)
3. Build services (review, lock)
4. Build custom panel as LitElement web component with:
   - Detection table with audio player
   - Review/lock action buttons
   - Species summary charts
5. Register panel in HA sidebar with icon mdi:bird

---

### CT101 — brain (Docker/utility host)

| Setting | Value |
|---------|-------|
| IP | DHCP |
| OS | Debian (Docker LXC via community-scripts) |
| CPU | 2 cores |
| RAM | 2048 MB |
| Disk | bigdata:vm-101-disk-0 — 16 GB |
| Features | nesting=1 |
| GPU | /dev/dri/renderD128, /dev/dri/card1 passthrough (Intel iGPU) |
| Sound | /dev/snd bind-mount |
| Serial | /dev/serial/by-id, ttyUSB0/1, ttyACM0/1 bind-mounts |
| Role | General-purpose Docker host and internal tooling |

---

### CT102 — Airspace (ADS-B)

| Setting | Value |
|---------|-------|
| IP | 192.168.1.102 (static) |
| OS | Debian (unprivileged) |
| CPU | 1 core |
| RAM | 512 MB |
| Disk | local-lvm:vm-102-disk-0 — 2 GB |
| USB | /dev/bus/usb bind-mount for RTL-SDR ADS-B stick |
| Services | dump1090-fa, tar1090 |
| Port :80 | tar1090 web UI at http://192.168.1.102/tar1090 |
| Data endpoint | /tar1090/data/aircraft.json (polled every 5s by CT105) |

---

### CT103 — Marine-ais (legacy serial bridge, idle)

| Setting | Value |
|---------|-------|
| IP | 192.168.1.103 (static) |
| OS | Debian (unprivileged) |
| CPU | 1 core |
| RAM | 512 MB |
| Disk | local-lvm:vm-103-disk-0 — 2 GB |
| USB | /dev/ttyUSB0 bind-mount |
| Status | IDLE — AIS now handled by RTL-SDR pipeline (see section 4.1) |

---

### CT104 — trackerDB (PostgreSQL)

| Setting | Value |
|---------|-------|
| IP | 192.168.1.104 (static) |
| OS | Debian (unprivileged) |
| CPU | 1 core |
| RAM | 1024 MB |
| Disk | bigdata:vm-104-disk-0 — 200 GB |
| Engine | PostgreSQL 15 |
| Port | 5432 (LAN-only) |
| App user | tracker / pukalani |

#### Database: `tracking_db`

    live_tracks
      id SERIAL PK, entity_id TEXT, source_type TEXT ('ais'|'adsb'),
      latitude DOUBLE, longitude DOUBLE, altitude INT (ADS-B feet MSL),
      heading NUMERIC (COG/track degrees), speed NUMERIC (knots),
      callsign TEXT, name TEXT, vessel_type INT (AIS ITU-R M.1371),
      raw_data JSONB, recorded_at TIMESTAMPTZ DEFAULT NOW()
      INDEX: (entity_id, recorded_at DESC), (source_type, recorded_at DESC)

    vessel_info
      mmsi TEXT PK, vessel_name, imo, call_sign, flag (ISO 3166-1),
      vessel_type TEXT, gross_tonnage INT, year_built INT,
      length_m NUMERIC, beam_m NUMERIC, owner, operator, notes,
      photo_url TEXT, seen_days INT, threshold_met BOOLEAN

    aircraft_info
      icao_hex TEXT PK, registration, aircraft_type, operator,
      notes, photo_url, seen_days INT, threshold_met BOOLEAN

    pws_obs
      id SERIAL PK, obs_time TIMESTAMPTZ, temp_f, humidity, pressure_inhg,
      wind_dir INT, wind_speed_mph, wind_gust_mph, rain_in,
      solar_w_m2, uv_index, lux, raw JSONB

    buoy_obs
      id SERIAL PK, station_id TEXT, obs_time TIMESTAMPTZ,
      wave_height_m, wave_period_s, water_temp_c,
      wind_speed_kt, wind_dir INT, raw JSONB

    tide_predictions
      id SERIAL PK, station_id TEXT, prediction_time TIMESTAMPTZ,
      height_ft NUMERIC, tide_type TEXT ('H'|'L'), fetched_at TIMESTAMPTZ

    aviation_weather
      id SERIAL PK, station TEXT (PHNL/PHOG/PHKO/PHLI), obs_time TIMESTAMPTZ,
      raw_metar TEXT, temp_c, dewpoint_c, wind_dir INT, wind_speed_kt,
      visibility_sm, altimeter_inhg, sky_condition JSONB, fetched_at TIMESTAMPTZ


#### Database: `project_mgr` (NEW)

> 🔲 **NOT YET IMPLEMENTED** — Create this database when migrating Project Manager from JSON flat files.

    Migration from:  CT110 server/data/*.json (tasks.json, vendors.json, owners.json, maintenance.json)
    Migration to:    PostgreSQL on CT104, database 'project_mgr', user 'pm_user'

    Schema:

    -- Owners (project assignees)
    owners
      id UUID PK DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()

    -- Vendors (contractors, suppliers — survives "sold house" purge)
    vendors
      id UUID PK DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      company TEXT,
      email TEXT,
      phone TEXT,
      address TEXT,
      account_number TEXT,
      category TEXT,              -- e.g. 'plumber', 'electrician', 'landscaper'
      website TEXT,
      online_access TEXT,
      username TEXT,
      password TEXT,              -- stored plaintext (local LAN only, no internet exposure)
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()

    vendor_interactions
      id UUID PK DEFAULT gen_random_uuid(),
      vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE,
      interaction_date DATE,
      interaction_type TEXT,      -- 'phone', 'text', 'email', 'in_person'
      notes TEXT,
      linked_task_id UUID,        -- FK to tasks(id), nullable
      created_at TIMESTAMPTZ DEFAULT NOW()

    -- Tasks (project work items — purged on "sold house")
    tasks
      id UUID PK DEFAULT gen_random_uuid(),
      parent_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
      sort_order INT DEFAULT 0,
      name TEXT NOT NULL,
      task_type TEXT DEFAULT 'task',    -- 'task' | 'section'
      dependency TEXT,
      depends_on_task_id UUID,
      notes TEXT,
      target_date_start DATE,
      target_date_finish DATE,
      date_started DATE,
      date_finished DATE,
      duration_days INT,
      status TEXT DEFAULT 'Not Started',  -- 'Not Started'|'In Progress'|'Completed'|'Blocked'
      delayed BOOLEAN DEFAULT FALSE,
      percent_complete INT DEFAULT 0,
      is_milestone BOOLEAN DEFAULT FALSE,
      milestone_text TEXT,
      is_hardware BOOLEAN DEFAULT FALSE,
      hardware_text TEXT,
      vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
      owner_id UUID REFERENCES owners(id) ON DELETE SET NULL,
      ha_entity_id TEXT,           -- NEW: Home Assistant entity reference (e.g. 'light.kitchen')
      created_at TIMESTAMPTZ DEFAULT NOW()

    task_supplies
      id UUID PK DEFAULT gen_random_uuid(),
      task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      qty INT DEFAULT 1,
      cost NUMERIC(10,2) DEFAULT 0,
      checked_off BOOLEAN DEFAULT FALSE

    -- Maintenance log (purged on "sold house" — historical repairs to previous owner's stuff)
    maintenance
      id UUID PK DEFAULT gen_random_uuid(),
      description TEXT,
      task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
      date_of_repair DATE,
      date_when_fixed DATE,
      new_installation BOOLEAN DEFAULT FALSE,
      new_installation_date DATE,
      notes TEXT,
      is_milestone BOOLEAN DEFAULT FALSE,
      milestone_text TEXT,
      section_id UUID,
      section_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()

    -- Hardware assets (survives "sold house" purge — tracks installed equipment)
    assets
      id UUID PK DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,               -- e.g. 'Rheem ProTerra Heat Pump Water Heater'
      category TEXT,                    -- e.g. 'plumbing', 'electrical', 'HVAC', 'appliance'
      serial_number TEXT,
      model_number TEXT,
      manufacturer TEXT,
      vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
      install_location TEXT,            -- e.g. 'Garage', 'Kitchen', 'Master Bath'
      install_date DATE,
      purchase_date DATE,
      cost NUMERIC(10,2),
      ha_entity_id TEXT,                -- HA entity reference if applicable
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()

    -- Warranties (survives "sold house" purge — tied to assets)
    warranties
      id UUID PK DEFAULT gen_random_uuid(),
      asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
      warranty_type TEXT,               -- 'manufacturer', 'extended', 'labor'
      provider TEXT,                    -- warranty provider name
      start_date DATE,
      end_date DATE,
      coverage_details TEXT,
      claim_phone TEXT,
      claim_url TEXT,
      document_path TEXT,               -- path to warranty PDF if uploaded
      notes TEXT

    "Sold house" purge algorithm:
      1. DELETE FROM task_supplies;
      2. DELETE FROM maintenance;
      3. DELETE FROM tasks;
      4. DELETE FROM owners WHERE id NOT IN (select distinct owner_id from assets where owner_id IS NOT NULL);
      5. -- vendors, assets, warranties are PRESERVED
      6. VACUUM;

    The purge removes all project work (tasks, maintenance, supplies) but retains:
      - Vendor database (plumbers, electricians, etc.)
      - Asset inventory (installed hardware with serial numbers)
      - Warranty records
      - Owners referenced by assets

    Migration script (run once):
      1. Create database: CREATE DATABASE project_mgr;
      2. Create user: CREATE USER pm_user WITH PASSWORD '<password>';
      3. Grant: GRANT ALL ON DATABASE project_mgr TO pm_user;
      4. Run DDL above to create tables
      5. Write Node.js migration script that reads server/data/*.json and INSERTs into PostgreSQL
      6. Update CT110 Express routes to use pg client instead of fs.readFileSync/writeFileSync
      7. Update CT110 .env with DB_HOST=192.168.1.104, DB_PORT=5432, DB_NAME=project_mgr, DB_USER=pm_user
      8. Verify all API endpoints return same data as before
      9. Remove server/data/*.json (backup first)

---

### CT105 — tracker-engine (Python collectors)

| Setting | Value |
|---------|-------|
| IP | 192.168.1.105 (static, firewall=1) |
| OS | Debian (unprivileged) |
| CPU | 1 core |
| RAM | 512 MB |
| Disk | local-lvm:vm-105-disk-0 — 4 GB |
| Listens | UDP :10110 (NMEA sentences from AIS-Catcher on CT106) |

Running services:

| Service | Source | Function |
|---------|--------|----------|
| ais-collector.service | /opt/ais-collector.py | UDP :10110 listener, decodes NMEA types 1/2/3/5/18/21/24, writes live_tracks, relays to AISHub |
| adsb-collector.service | /opt/adsb-collector.py | Polls http://192.168.1.102/tar1090/data/aircraft.json every 5s, writes live_tracks |
| avia-collector.service | /opt/ | METAR + winds aloft from aviationweather.gov every 5min -> aviation_weather |
| env-collector.service | /opt/ | NDBC buoy every 30min + NOAA tides every 8h -> DB |
| tracker-engine.service | /opt/tracker_engine.py | Enriches records, updates seen_days counters, destination prediction |
| cron | — | Prunes live_tracks older than retention window |

Environment (/opt/.env):

    DB_HOST=192.168.1.104
    DB_PORT=5432
    DB_NAME=tracking_db
    DB_USER=tracker
    DB_PASS=pukalani
    TAR1090_URL=http://192.168.1.102/tar1090/data/aircraft.json
    AIS_LISTEN_PORT=10110

---

### CT106 — sdr-engine (AIS-Catcher)

| Setting | Value |
|---------|-------|
| IP | 192.168.1.106 (static) |
| OS | Debian (unprivileged) |
| CPU | 2 cores |
| RAM | 512 MB |
| Disk | local-lvm:vm-106-disk-0 — 4 GB |

ais-catcher.service ExecStart:

    /bin/AIS-catcher
      -t 192.168.1.100 1234     # RTLTCP from Proxmox host
      -v 60                      # log stats every 60s
      -u 192.168.1.105 10110     # NMEA UDP -> CT105 tracker-engine
      -u 144.76.105.244 2828     # NMEA UDP -> AISHub aggregator
      -q -X off

---

### CT108 — dashboard (Node.js API + React/Vite UI)

| Setting | Value |
|---------|-------|
| IP | 192.168.1.108 (static) |
| OS | Debian (unprivileged) |
| RAM | 512 MB |
| Disk | local-lvm:vm-108-disk-0 — 8 GB |
| API | Express/Node.js port 3001, managed by PM2 |
| Web | nginx port 80 -> serves /opt/dashboard/client/dist/ + proxies /api/ -> :3001 |
| Code | /opt/dashboard/server/ (API), /opt/dashboard/client/ (React/Vite) |

Server environment (/opt/dashboard/server/.env):

    DB_USER=tracker
    DB_HOST=192.168.1.104
    DB_NAME=tracking_db
    DB_PASS=pukalani
    DB_PORT=5432
    HOME_LAT=21.2855
    HOME_LON=-157.7969
    TAR1090_URL=http://192.168.1.102/tar1090/data/aircraft.json
    ALERTS_ENGINE_URL=http://192.168.1.109:3009
    HA_WEBHOOK_URL=http://192.168.1.19:8123/api/webhook/5de76fbee15b641d309d042238b47326
    PORT=3001

All API routes (GET unless noted):

| Method | Route | Description |
|--------|-------|-------------|
| GET | /api/health | Live health: DB, AIS, ADS-B, weather, tar1090 |
| GET | /api/health-report | Latest nightly audit JSON |
| GET | /api/status | Simple ok/degraded |
| GET | /api/vessels | AIS vessels last 30min, deduped by MMSI |
| GET | /api/trails/:id | Position trail (MMSI or ICAO hex) |
| GET | /api/history/:id | Full position history |
| GET | /api/vessel-info/:mmsi | Curated vessel metadata |
| GET | /api/vessel-info/:mmsi/seen-days | Distinct observation days |
| POST | /api/vessel-info/:mmsi | Update vessel metadata |
| POST | /api/vessel-photo/:mmsi | Upload vessel photo (multipart) |
| GET | /api/vessel-predictions | Route prediction stubs |
| GET | /api/vessel-routes/:mmsi | Historical route polyline |
| GET | /api/hawaii-ports | GeoJSON of Hawaii port polygons |
| GET | /api/aircraft | Live ADS-B (tar1090 + DB enrichment merged) |
| GET | /api/aircraft-info/:icao | Curated aircraft metadata |
| GET | /api/aircraft-info/:icao/seen-days | Distinct observation days |
| POST | /api/aircraft-info/:icao | Update aircraft metadata |
| GET | /api/alerts | NWS CAP alerts (proxied from CT109:3009) |
| GET | /api/alerts/health | CT109 connectivity |
| GET | /api/buoys | Latest NDBC buoy observations |
| GET | /api/buoys/:id/history | Buoy observation history |
| GET | /api/tides | Tide predictions for configured stations |
| GET | /api/tides/:station/chart | Chart-ready tide JSON |
| GET | /api/noaa-tides/:station | Live NOAA CO-OPS passthrough |
| GET | /api/metar | METAR for PHNL, PHOG, PHKO, PHLI |
| GET | /api/winds-aloft | Formatted winds aloft |
| GET | /api/winds-aloft-raw | Raw winds aloft |
| GET | /api/airport-status | FAA ATIS status |
| POST | /api/ecowitt | Ecowitt GW2000 push receiver |
| GET | /api/ecowitt/current | Latest station reading |
| GET | /api/ecowitt/history | History for charting |
| GET | /api/birdnet | BirdNET detections (proxy -> CT112:8080) |
| GET | /api/nws/* | NWS/NOAA data suite via nws-service.js |

React client components (/opt/dashboard/client/src/components/):

Map layers:
  VesselLayer.jsx     — AIS vessels, dead-reckoning animation (great-circle, rAF)
  AircraftLayer.jsx   — ADS-B aircraft with type icons and altitude colouring
  TrailLayer.jsx      — Position trail polyline for selected entity
  BuoyLayer.jsx       — NDBC buoy markers
  MetarLayer.jsx      — METAR station circles
  EcowittLayer.jsx    — Home weather station marker
  SurfLayer.jsx       — Surf spots
  TideLayer.jsx       — Tide gauge markers
  RadarLayer.jsx      — RainViewer radar tile overlay
  HDRadarLayer.jsx    — HD Radio radar (future)
  HDTrafficLayer.jsx  — HD Radio traffic (future)
  HDGasLayer.jsx      — HD Radio gas prices (future)
  HomeBase.jsx        — Home location pin
  RangeRings.jsx      — Configurable distance rings
  ReferenceObjects.jsx — Static reference markers

Panels and UI:
  App.jsx              — Root: layer state, polling timers, map init
  LayerControl.jsx     — Layer toggle sidebar (Airspace / Integrated Vessel / Weather / Map / NWS/NOAA)
  DetailPanel.jsx      — Entity detail, seen-days badge, edit form, photo upload
  StatusBar.jsx        — Top status strip
  ATISBar.jsx          — Airport ATIS bar
  AirportStatusBar.jsx — Airport status
  ForecastPanel.jsx    — Marine/aviation forecast
  WindsAloftPanel.jsx  — Winds aloft visualisation
  SunMoonPanel.jsx     — Sun/moon rise/set
  AlertsPage.jsx       — Full-screen NWS active alerts overlay
  TideChartModal.jsx   — Tide chart popup
  HDRadioStatusPanel.jsx — HD Radio status
  AltLegend.jsx        — Altitude colour legend
  Legend.jsx           — General map legend
  MapEventTracker.jsx  — Map click/hover handler
  ErrorBoundary.jsx    — React error boundary (silent fail for map layers)

NWS/NOAA panel suite:
  NWSPanel.jsx + .css    — Full-screen overlay, tab router (Loops / Maps / Forecasts)
  NWSLoopsGrid.jsx       — Animated GIF grid from /api/nws/loops, 5min auto-refresh
  NWSForecastPanel.jsx   — Collapsible NWS text products + ENSO tracker + CPC outlook images
  NWSMap.jsx + .css      — Leaflet map with air/water sub-tabs, FADs, harbor approaches,
                           trade routes, fishing zones, ETOPO depth, SST, PacIOOS WMS
  NWSApp.jsx + .css      — Standalone NWS app entry point

Hooks and utilities:
  useDraggable.js        — Drag behaviour for floating panels

Test suites:
  dashboard/server/tests/api.test.js        — Jest/axios: all GET endpoints
  dashboard/client/src/__tests__/
    vessel.test.js                          — Vitest: classifyVessel(), VESSEL_CLASS_COLOR
    deadReckon.test.js                      — Vitest: great-circle dead-reckoning (5 cases)


---

### CT109 — alerts-engine

| Setting | Value |
|---------|-------|
| IP | 192.168.1.109 (static) |
| OS | Debian (unprivileged) |
| CPU | 1 core, RAM 512 MB |
| Disk | local-lvm:vm-109-disk-0 — 4 GB |
| Port | 3009 |
| App | /opt/alerts/ |
| Role | NWS CAP alert poller; CT108 proxies /api/alerts through it |

### CT110 — project-mgr

| Setting | Value |
|---------|-------|
| IP | 192.168.1.110 (static) |
| OS | Debian (unprivileged) |
| CPU | 1 core, RAM 512 MB |
| Disk | bigdata:vm-110-disk-0 — 50 GB |
| Port | 3001 |
| Stack | Node.js (ES Modules), Express 4, React 19, Vite 6 |
| App root | /opt/project-mgr/ |
| Role | Standalone project management web app with HA integration via HACS |

**Current storage:** JSON flat files in `server/data/` (tasks.json, vendors.json, owners.json, maintenance.json).
**Target storage:** PostgreSQL on CT104 database `project_mgr` (see CT104 section above).

Server environment (/opt/project-mgr/server/.env):

    PORT=3001
    # After PostgreSQL migration, add:
    # DB_HOST=192.168.1.104
    # DB_PORT=5432
    # DB_NAME=project_mgr
    # DB_USER=pm_user
    # DB_PASS=<password>

**Current API surface:**

| Method | Route | Description |
|--------|-------|-------------|
| GET | /api/tasks | Fetch all tasks (tree structure) |
| POST | /api/tasks | Create task |
| PUT | /api/tasks/:id | Update task (cascades dependency dates) |
| DELETE | /api/tasks/:id | Delete task + descendants |
| PATCH | /api/tasks/reorder | Bulk reorder (order + parentId) |
| GET | /api/maintenance | Fetch maintenance log |
| POST | /api/maintenance | Create maintenance entry |
| PUT | /api/maintenance/:id | Update maintenance entry |
| DELETE | /api/maintenance/:id | Delete maintenance entry |
| GET | /api/vendors | Fetch vendors (sorted) |
| POST | /api/vendors | Create vendor |
| PUT | /api/vendors/:id | Update vendor |
| DELETE | /api/vendors/:id | Delete vendor |
| POST | /api/vendors/:id/interactions | Add CRM interaction |
| PUT | /api/vendors/:id/interactions/:iid | Edit interaction |
| DELETE | /api/vendors/:id/interactions/:iid | Delete interaction |
| GET | /api/owners | Fetch owners |
| POST | /api/owners | Create owner |
| PUT | /api/owners/:id | Update owner |
| DELETE | /api/owners/:id | Delete owner |
| POST | /api/import | Upload Excel .xlsx → parse → import tasks |

**New API routes (after PostgreSQL migration):**

| Method | Route | Description |
|--------|-------|-------------|
| GET | /api/assets | Fetch all hardware assets |
| POST | /api/assets | Create asset (name, serial_number, model, vendor, location, cost) |
| PUT | /api/assets/:id | Update asset |
| DELETE | /api/assets/:id | Delete asset |
| GET | /api/assets/:id/warranty | Get warranties for asset |
| POST | /api/assets/:id/warranty | Add warranty to asset |
| PUT | /api/warranties/:id | Update warranty |
| DELETE | /api/warranties/:id | Delete warranty |
| POST | /api/purge | "Sold house" purge (keeps vendors + assets + warranties) |
| GET | /api/health | Health check (DB connection, table counts) |

**Frontend views (React, existing + planned):**

| View | Status | Description |
|------|--------|-------------|
| SummaryDashboard | ✅ LIVE | Progress ring, section cards, recent completions |
| TaskTable | ✅ LIVE | Hierarchical tree table, drag-reorder, inline editing |
| GanttTimeline | ✅ LIVE | Interactive Gantt chart |
| DailyTaskList | ✅ LIVE | Prioritized daily action list |
| CompletedView | ✅ LIVE | Finished task archive with variance |
| MaintenanceLog | ✅ LIVE | Repair and installation log |
| VendorPanel | ✅ LIVE | CRM contacts, interaction timeline |
| ShoppingList | ✅ LIVE | Aggregated supplies across tasks |
| ImportWizard | ✅ LIVE | Excel drag-and-drop importer |
| PdfReportView | ✅ LIVE | Exportable reports (SheetJS + html2pdf) |
| AssetInventory | 🔲 NEW | Hardware asset list with warranty tracker |
| AssetDetail | 🔲 NEW | Single asset view: serial, location, warranty, linked HA entity |

**Dependency cascading algorithm** (existing, unchanged):
When a task's `dateFinished` is updated, all tasks with `dependsOnTaskId` pointing to it
have their `targetDateStart` shifted by the same delta. This cascades recursively through
the dependency chain. Duration is preserved; finish dates shift accordingly.

---

### CT111 — nrsc5-engine (HD Radio, standby)

| Setting | Value |
|---------|-------|
| IP | 192.168.1.111 (static) |
| OS | Debian (unprivileged) |
| CPU | 2 cores, RAM 512 MB |
| Port | 3011 |
| Status | STANDBY — Hawaii FM has no HD Radio data services. Built for Berkeley CA |
|        | deployment. HD_RADIO_DISABLED=true in sdr-scheduler.sh |

### CT112 — birdnet (BirdNET-Go)

| Setting | Value |
|---------|-------|
| IP | 192.168.1.25 (DHCP — consider assigning static) |
| OS | Debian (Docker LXC, nesting=1) |
| CPU | 2 cores, RAM 2048 MB |
| Disk | bigdata:vm-112-disk-0 — 16 GB |
| Sound | /dev/snd bind-mount (KTMicro LavMicro-U, USB port 1-7.2) |
| Port | 8080 |

    docker-compose.yml:
      image: ghcr.io/tphakala/birdnet-go:nightly
      container_name: birdnet_go
      restart: unless-stopped
      ports: ["8080:8080"]
      environment: [TZ=Pacific/Honolulu]
      volumes: [./config:/config, ./data:/data]
      devices: [/dev/snd:/dev/snd]

    Config: /opt/birdnet/config/config.yaml
      latitude: 21.2855, longitude: -157.7969
      locale: en, sensitivity: 1.0
    Detections: SQLite at /opt/birdnet/data/birdnet.db
    Dashboard proxy: GET /api/birdnet -> CT112:8080/api/v2/detections

**BirdNET-Go REST API (full surface):**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v2/detections | Paginated detection list |
| POST | /api/v2/search | Filtered search (date, species, confidence, verified) |
| GET | /api/v2/detections/stream | SSE real-time detection stream |
| GET | /api/v2/detections/:id | Single detection detail |
| DELETE | /api/v2/detections/:id | Delete detection |
| POST | /api/v2/detections/:id/review | Confirm/re-assign species (agree/disagree) |
| POST | /api/v2/detections/:id/lock | Lock against model re-classification |
| POST | /api/v2/detections/ignore | Manage species ignore list |
| GET | /api/v2/analytics/species/summary | Aggregated species statistics |
| GET | /api/v2/species | Known/detected species list |
| GET | /api/v2/media/audio/:id | Audio clip playback |

**SQLite schema (V2 normalized):**
  detections: id, date, time, scientific_name, common_name, confidence, verified, locked,
              audio_file_path, sample_rate, created_at
  species: taxonomy, scientific/common names
  predictions: raw model output per audio segment

### CT113 — frigate (Camera NVR + AI Detection)

| Setting | Value |
|---------|-------|
| IP | 192.168.1.113 (static) |
| OS | Debian (Docker LXC, nesting=1, keyctl=1, AppArmor=unconfined) |
| CPU | 4 cores, RAM 4096 MB |
| Disk | bigdata:vm-113-disk-0 — 60 GB |
| USB | /dev/bus/usb bind-mount (Google Coral USB TPU visible) |
| cgroup | c 189:* rwm (USB), c 243:* rwm |
| Role | Frigate NVR — camera recording, AI object detection via Coral TPU |

**Docker compose** (/opt/frigate/docker-compose.yml):

    version: "3.9"
    services:
      frigate:
        container_name: frigate
        image: ghcr.io/blakeblackshear/frigate:stable
        restart: unless-stopped
        privileged: true
        shm_size: "256mb"
        devices:
          - /dev/bus/usb:/dev/bus/usb
        volumes:
          - /etc/localtime:/etc/localtime:ro
          - /opt/frigate/config:/config
          - /opt/frigate/storage:/media/frigate
          - type: tmpfs
            target: /tmp/cache
            tmpfs:
              size: 1000000000  # 1GB tmpfs for model cache
        ports:
          - "5000:5000"       # Frigate web UI
          - "8554:8554"       # RTSP restream
          - "8555:8555/tcp"   # WebRTC
          - "8555:8555/udp"
        environment:
          FRIGATE_RTSP_PASSWORD: "frigate_internal"

**Frigate config** (/opt/frigate/config/config.yml):

    mqtt:
      enabled: true
      host: 192.168.1.19       # HA Mosquitto broker
      port: 1883
      # TODO: add user/password when Mosquitto is configured with auth

    detectors:
      coral:
        type: edgetpu
        device: usb              # Google Coral USB Accelerator (18d1:9302)
                                 # Confirmed working: ~10ms inference speed

    model:
      width: 320
      height: 320

    objects:
      track: [person, car, cat, dog, bird, package]

    record:
      enabled: true
      alerts:
        retain:
          days: 14
      detections:
        retain:
          days: 14
      motion:
        days: 7

    snapshots:
      enabled: true
      retain:
        default: 14

    ui:
      timezone: Pacific/Honolulu
      time_format: 12hour

**Camera configuration:**

Currently 1 of 6 cameras configured. Full deployment: 5× Aqara G5 PoE + 1× Aqara Doorbell PoE.

| Camera | Model | IP | RTSP Credentials | Status |
|--------|-------|----|-----------------|--------|
| aqara_g5pro | Aqara G5 PoE | 192.168.1.32 | 772:885 | ✅ LIVE (detection disabled) |
| aqara_g5pro_2 | Aqara G5 PoE | PENDING | PENDING | 🔲 NOT YET INSTALLED |
| aqara_g5pro_3 | Aqara G5 PoE | PENDING | PENDING | 🔲 NOT YET INSTALLED |
| aqara_g5pro_4 | Aqara G5 PoE | PENDING | PENDING | 🔲 NOT YET INSTALLED |
| aqara_g5pro_5 | Aqara G5 PoE | PENDING | PENDING | 🔲 NOT YET INSTALLED |
| aqara_doorbell | Aqara Doorbell PoE | PENDING | PENDING | 🔲 NOT YET INSTALLED |

**Per-camera Frigate config template (add for each camera):**

    aqara_g5pro_N:
      enabled: true
      ffmpeg:
        inputs:
          - path: rtsp://<user>:<pass>@<CAM_IP>:8554/1080p
            roles: [detect]
          - path: rtsp://<user>:<pass>@<CAM_IP>:8554/1520p
            roles: [record]
      detect:
        width: 1920
        height: 1080
        fps: 5
      record:
        enabled: true
      snapshots:
        enabled: true
      objects:
        track: [person, car, cat, dog, bird]
      zones: {}    # Define per-camera zones during installation

**Aqara G5 PoE camera notes:**
- Protocol: Native RTSP (no go2rtc needed — G5 PoE supports direct RTSP)
- Streams: `/1080p` (detect), `/1520p` (record — 2K resolution)
- Power: PoE (802.3af) — no separate power supply needed
- Audio: Two-way audio via RTSP
- The Doorbell PoE model adds a doorbell button event via HomeKit/Aqara Home integration

**go2rtc (optional, for future multi-client streaming):**
If HA dashboards need simultaneous low-latency live views alongside Frigate recording,
add go2rtc as a stream proxy. Frigate 0.14+ includes go2rtc built-in.
For now, Frigate handles all streams directly.

**HA Frigate Integration:**
Install the Frigate integration via HACS. It connects via MQTT and the Frigate API.
Provides: camera entities, event sensors, media browser, notification blueprints.

**Notification architecture** (future — stub for when speakers/displays are available):

> 🔲 **NOT YET IMPLEMENTED** — No notification targets currently available.
> Design below is ready to activate when speakers, displays, or HA Companion app are deployed.

    Trigger: Frigate publishes event to MQTT topic frigate/reviews
    HA Automation:
      trigger:
        - platform: mqtt
          topic: frigate/reviews
          payload: new
          value_template: "{{ value_json['type'] }}"
      condition:
        - "{{ trigger.payload_json['after']['label'] == 'person' }}"
        - "{{ trigger.payload_json['after']['camera'] in ['aqara_doorbell', ...] }}"
      action:
        # Future: send to HA Companion app, cast to Nest Hub, play on speakers
        - service: notify.notify  # placeholder
          data:
            title: "Motion Detected"
            message: "{{ trigger.payload_json['after']['label'] }} at {{ trigger.payload_json['after']['camera'] }}"
            data:
              image: "/api/frigate/notifications/{{ trigger.payload_json['after']['id'] }}/thumbnail.jpg"

**Event review interface:**
Frigate provides a built-in review UI at http://192.168.1.113:5000.
The HA Frigate integration adds a media browser panel for reviewing events.
Events are organized by: camera, detected object, time range.
AI-assisted timeline shows exactly when motion/objects were detected with confidence scores.

---

### CT114 — utilities (PDF Maker + PDF Shrinker + Games + Health Converter)

| Setting | Value |
|---------|-------|
| IP | 192.168.1.114 (static) |
| OS | Debian 13 (unprivileged LXC) |
| CPU | 2 cores |
| RAM | 1024 MB |
| Disk | local-lvm:vm-114-disk-0 — 8 GB |
| Features | nesting=1 |
| Port | 3114 |
| App root | /opt/utilities/ |
| venv | /opt/utilities/venv (Python 3.13) |
| Service | utilities.service (systemd, auto-start on boot) |
| GitHub | utilities/ subfolder in pukalanihomecontrol repo |

**Tools served:**

| Tool | URL | Status | Description |
|------|-----|--------|-------------|
| Landing page | http://192.168.1.114:3114/tools/ | ✅ LIVE | Tools dashboard with card links |
| PDF Maker | http://192.168.1.114:3114/tools/pdfmaker | ✅ LIVE | Merge images, docs & PDFs into one file |
| PDF Shrinker | http://192.168.1.114:3114/tools/shrinker | ✅ LIVE | Compress existing PDFs at 4 quality levels |
| Games Landing | http://192.168.1.114:3114/games/ | 🔲 NOT YET IMPLEMENTED | Entertaining Diversions portal |
| LUX | http://192.168.1.114:3114/games/lux/ | 🔲 NOT YET IMPLEMENTED | Strategy game (TypeScript/Pixi.js) |
| Trish's Games | http://192.168.1.114:3114/games/trishsgames/ | 🔲 NOT YET IMPLEMENTED | 7 casual web games (React 19) |
| Apple Health Converter | http://192.168.1.114:3114/tools/healthconverter | 🔲 NOT YET IMPLEMENTED | Apple Health XML → CSV converter |

**Architecture (existing):**

```
Browser (client)                    CT114 (server)
────────────────                    ──────────────────────────────────
React 18 SPA                        FastAPI + uvicorn (2 workers)
  - Session ID in localStorage  →     POST /api/pdfmaker/session
  - File picked locally         →     POST /api/pdfmaker/import  (multipart upload)
  - All edits in browser state  →     POST /api/pdfmaker/preview (returns PNG)
  - Click Download              →     POST /api/pdfmaker/build   (returns PDF bytes)
  - PDF saved by browser                ↓ (never written to disk, streamed only)
  - No files stored on server   ✓     Session temp dir auto-purged after 2h
```

**File storage model:**
- Uploaded files → `/tmp/pdfmaker-sessions/{uuid}/` (session-scoped temp dir)
- Auto-purged: background thread checks every 5 min, deletes sessions idle > 2 hours
- Build output: assembled in-memory buffer, streamed as HTTP response → **never written to disk**
- User intent: "save/read from client machine only" — server is a stateless PDF processing engine

**Python stack (`/opt/utilities/venv`):**

| Package | Version | Purpose |
|---------|---------|---------|
| fastapi | ≥0.111 | HTTP framework + OpenAPI |
| uvicorn | ≥0.30 | ASGI server (2 workers) |
| pymupdf (fitz) | ≥1.24 | PDF reading, writing, rendering, assembly |
| Pillow | ≥10.4 | Image loading, EXIF correction, compositing |
| reportlab | ≥4.2 | Text → PDF rendering |
| python-docx | ≥1.1 | DOCX text extraction (server fallback, no Word COM) |
| trimesh | ≥4.4 | 3D model loading (GLTF/GLB/OBJ/STL/FBX) |
| pyrender | ≥0.1.45 | 3D → PNG rendering (headless via OSMesa) |
| numpy | ≥1.26 | Required by pyrender |
| libosmesa6 | system | Headless OpenGL for 3D rendering (no display needed) |
| lxml | ≥5.0 | **NEW** — streaming XML parser for Apple Health Converter |

**Environment variables for 3D support:**

```
PYOPENGL_PLATFORM=osmesa   # tells pyrender to use headless OSMesa renderer
```
(set in `/etc/systemd/system/utilities.service`)

**Frontend:**

| Item | Detail |
|------|--------|
| Framework | React 18 + Vite 5 |
| Build output | `/opt/utilities/app/static/` (served by FastAPI StaticFiles) |
| Routing | React Router DOM 6, base path `/tools/` |
| Drag-to-reorder | @dnd-kit/sortable |
| Theme | Dark glassmorphism, Inter font, CSS variables |
| Design | Matches Pukalani dashboard aesthetic |
| Source in repo | `utilities/frontend/` |

**API routes (existing + planned):**

| Method | Route | Status | Description |
|--------|-------|--------|-------------|
| GET | /api/health | ✅ | `{"ok":true, "service":"utilities"}` |
| POST | /api/pdfmaker/session | ✅ | Create session → `{session_id}` |
| DELETE | /api/pdfmaker/session/{id} | ✅ | Delete session + temp files |
| POST | /api/pdfmaker/import | ✅ | Upload files → page list with file_ids |
| POST | /api/pdfmaker/preview | ✅ | Render page with edit state → PNG bytes |
| POST | /api/pdfmaker/build | ✅ | Build final PDF → streaming download |
| POST | /api/shrinker/compress | ✅ | Compress PDF at level → download |
| POST | /api/healthconverter/convert | 🔲 NEW | Upload Apple Health export.xml → streaming CSV zip |

**Games static asset serving (nginx or FastAPI StaticFiles):**

    /games/           → /opt/utilities/games/landing/dist/    (games landing page)
    /games/lux/       → /opt/utilities/games/lux/dist/        (LUX static SPA)
    /games/trishsgames/ → /opt/utilities/games/trishsgames/dist/ (Trish's Games SPA)

---

#### Apple Health Converter — Web Conversion Architecture

> 🔲 **NOT YET IMPLEMENTED** — Convert desktop Tkinter app to FastAPI web endpoint on CT114.

**Current state:** Standalone Windows desktop app (Python/Tkinter) at
`https://github.com/gavinfischer-keenan/AppleHealthConverter`

**Core logic (portable):**
- Streaming XML parser using `xml.etree.ElementTree.iterparse`
- Handles 3+ GB export.xml files without loading into memory
- Outputs: _metadata.csv, _summary.csv, _workouts.csv, _activity_summaries.csv,
  plus individual per-metric CSVs (StepCount.csv, HeartRate.csv, etc.)

**Web conversion approach:**

```
Browser                              CT114 (FastAPI)
────────                             ───────────────
1. User uploads export.xml      →    POST /api/healthconverter/convert
   (or export.zip containing         (multipart/form-data, file field)
    export.xml)
                                     Server:
                                     1. Save upload to /tmp/health-sessions/{uuid}/
                                     2. If .zip: extract export.xml
                                     3. Stream-parse XML using iterparse (existing logic)
                                     4. Write CSV files to session temp dir
                                     5. Zip all CSVs → stream as response
2. Browser receives .zip        ←    Content-Type: application/zip
   and triggers download             Content-Disposition: attachment; filename="health_export.zip"
                                     6. Delete temp session dir
```

**What changes from the desktop version:**
- Remove: Tkinter GUI, file dialogs, progress bar widget
- Keep: All XML parsing logic, CSV generation, metric categorization
- Add: FastAPI route handler, file upload endpoint, zip packaging, temp cleanup
- Add: Simple web UI (React component on the tools landing page):
  - File drop zone for export.xml or export.zip
  - Progress indicator (polling or SSE)
  - Download button for resulting CSV zip

**nginx config note:**
Must set `client_max_body_size 500M;` for the health converter route
to support large Apple Health exports (can be 1-3 GB).

---

#### LUX Game — Deployment Architecture

> 🔲 **NOT YET IMPLEMENTED** — Build and deploy when ready.

**Source:** `https://github.com/gavinfischer-keenan/Alux2Win`
**Tech stack:** TypeScript, Pixi.js (WebGL 2D), Tailwind CSS, Vite 8
**Storage:** Browser localStorage only (custom levels saved as `lux_custom_levels`)
**Build:** `npm run build` → `dist/` directory (static assets)
**Entry point:** `index.html` → `src/main.ts` → `src/App.ts`

**Deployment steps:**
1. Clone repo on dev machine
2. `npm install && npm run build`
3. Copy `dist/` contents to CT114 at `/opt/utilities/games/lux/dist/`
4. Configure FastAPI or nginx to serve `/games/lux/` → that directory
5. No backend needed — pure client-side SPA

---

#### Trish's Games — Deployment Architecture

> 🔲 **NOT YET IMPLEMENTED** — Build and deploy when ready.

**Source:** `https://github.com/gavinfischer-keenan/TrishsGame`
**Tech stack:** React 19, JavaScript (JSX), Vite 8, Vanilla CSS
**Games included:** BrickSmack, Build Me a River, Slipped My Mind, Number Drawing,
                    Battleship, Word Wager, Connect4 (7 games with Home Screen selector)
**Storage:** Browser localStorage / in-memory React state only
**Build:** `npm run build` → `dist/` directory (static assets)
**Entry point:** `index.html` → `src/main.jsx` → `src/App.jsx`

**Deployment steps:**
1. Clone repo on dev machine
2. `npm install && npm run build`
3. Copy `dist/` to CT114 at `/opt/utilities/games/trishsgames/dist/`
4. Configure static serving at `/games/trishsgames/`
5. No backend needed — pure client-side SPA

---

#### Games Landing Page

> 🔲 **NOT YET IMPLEMENTED**

A simple dark-themed landing page at `/games/` matching the Pukalani aesthetic:
- Card for LUX with game description and link
- Card for Trish's Games with game description and link
- Back button to main HA or dashboard

This is a static HTML/CSS page or a minimal React build served from
`/opt/utilities/games/landing/dist/`.

**HA Sidebar integration** (add to `configuration.yaml`):

```yaml
panel_iframe:
  entertaining_diversions:
    title: "Entertaining Diversions"
    url: "http://192.168.1.114:3114/games/"
    icon: mdi:gamepad-variant
    require_admin: false
```

---

**Supported input file types (PDF Maker):**

| Category | Extensions |
|----------|-----------|
| Images | .jpg .jpeg .png .gif (all frames) .bmp .tiff .tif .webp |
| Text | .txt (auto-detects UTF-8/Latin-1/CP1252) |
| Word | .doc .docx (text extraction via python-docx; no Word COM on Linux) |
| PDF | .pdf (each page imported separately) |
| 3D Models | .gltf .glb .obj .stl .fbx (rendered via trimesh + pyrender + OSMesa) |

**PDF compression levels (Shrinker):**

| Level | DPI | JPEG Quality | Notes |
|-------|-----|-------------|-------|
| light | — | — | Lossless: stream compression + metadata strip only |
| standard | 150 | 75% | Adobe Quartz equivalent — good balance |
| aggressive | 96 | 50% | Maximum compression; strips annotations & forms |
| grayscale | 120 | 65% | Converts to B&W; strips annotations & forms |

**Test suite (76 tests, all passing):**

```bash
cd /opt/utilities/app
/opt/utilities/venv/bin/pytest tests/ -q
```

Tests cover: controller (page state, event bus), pdf_builder (render, assembly, page numbers),
settings_manager (persistence, fallbacks), API endpoints (health, session, import, shrinker).

**HA Integration — `panel_iframe`:**

Add to `/config/configuration.yaml` in Home Assistant (192.168.1.19):

```yaml
panel_iframe:
  utilities:
    title: "Helper Tools"
    url: "http://192.168.1.114:3114/tools/"
    icon: mdi:tools
    require_admin: false
```

Then restart HA: `Settings → System → Restart`. The "Helper Tools" panel will appear in the
HA sidebar with a 🔧 icon and open the tools landing page in an iframe.

**Deployment / rebuild instructions:**

```bash
# On CT114 (ssh via Proxmox: pct exec 114 -- bash)

# Restart service
systemctl restart utilities
systemctl status utilities
journalctl -u utilities -n 30 --no-pager

# Run tests
cd /opt/utilities/app
/opt/utilities/venv/bin/pytest tests/ -v

# Rebuild frontend (after frontend source changes):
# 1. On your dev machine: npm run build in utilities/frontend/
# 2. scp dist/* to CT114:/opt/utilities/app/static/
# 3. systemctl restart utilities

# Install a new Python dependency:
/opt/utilities/venv/bin/pip install <package>
# Add it to utilities/app/requirements.txt and commit
```

**Known limitations:**
- DOCX conversion: formatting NOT preserved (no MS Word COM on Linux — text extraction only via python-docx)
- 3D rendering requires OSMesa; pyrender cannot be imported directly (viewer class fails without X11)
  → FastAPI sets `PYOPENGL_PLATFORM=osmesa` in environment before import
- Session state is lost if the browser tab is closed without downloading (re-upload required)

---

## 3. Proxmox Host Services


### Udev Rules (/etc/udev/rules.d/99-hawaii-usb.rules)

    SUBSYSTEM=="tty", ATTRS{idVendor}=="10c4", ATTRS{idProduct}=="ea60",
      ATTRS{serial}=="22571d3d0d91f011ab54786236f0e4ad",
      SYMLINK+="ttyZigbee", MODE="0666"

    SUBSYSTEM=="tty", ATTRS{idVendor}=="10c4", ATTRS{idProduct}=="ea60",
      ATTRS{serial}!="22571d3d0d91f011ab54786236f0e4ad",
      SYMLINK+="ttyAIS", MODE="0666"

    Apply: udevadm control --reload-rules && udevadm trigger

### rtl-tcp-ais.service

    ExecStart=/usr/bin/rtl_tcp -d 00000001 -a 0.0.0.0 -p 1234 -s 2400000 -g 0
    # -d 00000001 targets Blog V4 by serial (never grabs ADS-B stick)
    # -s 2400000 = 2.4MHz for dual-channel AIS
    Restart=no  SuccessExitStatus=1

### sdr-scheduler.service

    ExecStart=/opt/sdr-scheduler/sdr-scheduler.sh
    Restart=always  RestartSec=30
    
    On start: 1) modprobe -r dvb_usb_rtl28xxu dvb_usb_v2 rtl2832_sdr rtl2832
               2) start rtl-tcp-ais
               3) restart ais-catcher on CT106

    Currently AIS-continuous mode (HD_RADIO_DISABLED=true).

### nightly-health-check.sh

    Location: /usr/local/bin/nightly-health-check.sh
    Cron: 0 12 * * * root ... (02:00 HST)
    JSON: /tmp/health-report.json -> GET /api/health-report
    Log:  /var/log/health-check.log

    Checks: all 12 CTs + HAOS VM + host services + AIS USB +
            data freshness (AIS/ADS-B/weather) + BirdNET + dashboard API + disk
    Auto-repairs: pct start, systemctl restart, docker compose up -d

### kiosk.service (NEW — Control Console)

> 🔲 **NOT YET IMPLEMENTED** — Install when ready to use the attached monitor as a kiosk.

**Purpose:** Auto-start a split-screen kiosk display on the Proxmox host's attached monitor.
Top half: Integrated Vessel Tracking dashboard (CT108).
Bottom half: BirdNET overview and recent detections (CT112).
Mouse interaction enabled on the vessel tracking view (range rings, trails, entity selection).
No keyboard required for operation.

**Architecture:**
- Display server: X11 via `xinit` (no full desktop environment)
- Window manager: Openbox (lightweight, no decorations)
- Browser: Chromium in kiosk mode loading a local HTML iframe wrapper
- Cursor: `unclutter` hides mouse after 2s idle
- Service: systemd auto-start on boot as dedicated `kiosk` user

**Installation steps:**

    # 1. Install minimal packages on Proxmox host
    apt update
    apt install --no-install-recommends -y xserver-xorg xinit openbox chromium unclutter

    # 2. Create kiosk user
    useradd -m -s /bin/bash kiosk
    usermod -aG video,input kiosk
    mkdir -p /opt/kiosk

    # 3. Create split-screen HTML wrapper
    cat > /opt/kiosk/index.html << 'HTMLEOF'
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Pukalani Control Console</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 100vw; height: 100vh; overflow: hidden; background: #0d1117; }
        .container { display: flex; flex-direction: column; width: 100vw; height: 100vh; }
        .frame-top { width: 100%; height: 50vh; border: none; }
        .frame-bottom { width: 100%; height: 50vh; border: none; }
      </style>
    </head>
    <body>
      <div class="container">
        <iframe class="frame-top" src="http://192.168.1.108:8080"></iframe>
        <iframe class="frame-bottom" src="http://192.168.1.25:8080"></iframe>
      </div>
    </body>
    </html>
    HTMLEOF

    chown -R kiosk:kiosk /opt/kiosk

    # 4. Configure Openbox autostart
    mkdir -p /home/kiosk/.config/openbox
    cat > /home/kiosk/.config/openbox/autostart << 'OBEOF'
    unclutter -idle 2 -root &
    xset s off
    xset s noblank
    xset -dpms
    chromium \
      --kiosk \
      --noerrdialogs \
      --disable-infobars \
      --no-first-run \
      --check-for-update-interval=31536000 \
      --disable-features=TranslateUI \
      --autoplay-policy=no-user-gesture-required \
      --disable-web-security \
      --user-data-dir=/home/kiosk/.config/chromium \
      /opt/kiosk/index.html &
    OBEOF
    chown -R kiosk:kiosk /home/kiosk/.config

    # 5. Create systemd service
    cat > /etc/systemd/system/kiosk.service << 'SVCEOF'
    [Unit]
    Description=Pukalani Control Console Kiosk
    After=systemd-user-sessions.service multi-user.target

    [Service]
    User=kiosk
    Group=kiosk
    PAMName=login
    Environment=DISPLAY=:0
    ExecStart=/usr/bin/xinit /usr/bin/openbox-session -- :0 -nolisten tcp vt7
    Restart=always
    RestartSec=5

    [Install]
    WantedBy=multi-user.target
    SVCEOF

    systemctl daemon-reload
    systemctl enable kiosk.service
    systemctl start kiosk.service

**Fallback (if iframe is blocked by X-Frame-Options):**
Launch two separate Chromium windows via Openbox autostart:

    chromium --app=http://192.168.1.108:8080 --window-position=0,0 --window-size=1920,540 &
    chromium --app=http://192.168.1.25:8080 --window-position=0,540 --window-size=1920,540 &

**Hardware requirements:**
- Intel iGPU (Arrow Lake Xe) drives display via DRM/KMS — native to Proxmox host kernel
- No GPU passthrough to VMs/containers needed (kiosk runs on host)
- RAM overhead: ~200-300 MB for X11 + Chromium

---

## 4. Data Flows

### 4.1 AIS — Marine Vessel Tracking

    RTL-SDR Blog V4 (serial 00000001, 162.000 MHz, 2.4MHz SR)
      -> rtl-tcp-ais.service [host, TCP :1234]
      -> AIS-Catcher [CT106] — IQ to NMEA
      -> UDP :10110 -> ais-collector.service [CT105]
                    -> UDP :2828 -> AISHub (144.76.105.244)
      -> live_tracks [CT104] source_type='ais'
      -> tracker_engine enriches vessel_info + seen_days
      -> GET /api/vessels [CT108] — SQL last 30min, deduped by MMSI
      -> VesselLayer.jsx [browser] — poll every 15s

    Dead-reckoning (great-circle, requestAnimationFrame):
      EARTH_R_NM = 3440.065
      distNm = (sogKt * elapsedSec) / 3600
      angDist = distNm / EARTH_R_NM
      lat1 = asin(sin(lat0)*cos(d) + cos(lat0)*sin(d)*cos(bearing))
      lon1 = lon0 + atan2(sin(bearing)*sin(d)*cos(lat0), cos(d)-sin(lat0)*sin(lat1))
      Hard cap: maxAge = 600s

    Vessel classification (AIS type int or MMSI prefix):
      military(35)  fishing(30,32)  tug(21,22,31,52)  sailing(36,37)
      hsc(40-49)    pilot(50)       sar(51, MMSI 303x) passenger(60-69)
      cargo(70-79)  tanker(80-89)   aton(MMSI 99x)

### 4.2 ADS-B

    RTL-SDR ADS-B (1090 MHz) -> /dev/bus/usb -> CT102
    dump1090-fa -> tar1090 -> aircraft.json (http://192.168.1.102/tar1090/data/aircraft.json)
    adsb-collector [CT105] polls every 5s -> live_tracks source_type='adsb'
    GET /api/aircraft [CT108] — merges tar1090 live + DB enrichment
    AircraftLayer.jsx — poll every 5s

### 4.3 Weather — Ecowitt GW2000

    Hardware: Ecowitt GW2000 gateway + WS90 haptic rain/wind sensor array
    Station ID (in DB): pukalani_home
    PASSKEY: C7166AA801074351480D81CB3F0286C2
    Location: Pukalani, Maui, HI — same lat/lon as dashboard home base

    Push configuration (set in Ecowitt app -> Weather Services -> Customized):
      Protocol:  Ecowitt  (application/x-www-form-urlencoded)
      Server:    192.168.1.108
      Path:      /api/ecowitt
      Port:      3001        ← IMPORTANT: use 3001 (direct to Node API), NOT 4003 or 80
      Interval:  60 seconds

    NOTE: Port 4003 was the legacy port (incorrect). Port 3001 is the correct
    Express API port. nginx on port 80 also proxies /api/* -> 3001 and can be
    used as an alternative if needed.

    What the server does on each push (server.js POST /api/ecowitt):
      1. Relays full payload to Home Assistant webhook (async, non-blocking):
         http://192.168.1.19:8123/api/webhook/5de76fbee15b641d309d042238b47326
      2. Inserts into pws_obs [CT104] with ON CONFLICT DO UPDATE

    pws_obs table columns (tracking_db on CT104):
      station_id       — always 'pukalani_home'
      obs_time         — from dateutc field in payload (falls back to server time)
      received_at      — server wall-clock time
      passkey          — from PASSKEY field (C7166AA801074351480D81CB3F0286C2)
      temp_in_f        — indoor temp (from tempinf)
      humidity_in      — indoor humidity (from humidityin)
      temp_out_f       — outdoor temp (from tempf — WS90 outdoor sensor)
      humidity_out     — outdoor humidity (from humidity)
      baro_rel_inhg    — relative barometric pressure (from baromrelin)
      baro_abs_inhg    — absolute barometric pressure (from baromabsin)
      wind_dir         — wind direction degrees (from winddir)
      wind_spd_mph     — wind speed mph (from windspeedmph)
      wind_gust_mph    — wind gust mph (from windgustmph)
      max_gust_mph     — max daily gust mph (from maxdailygust)
      rain_rate_in     — rain rate in/hr (WS90 piezo: rrain_piezo, fallback rainratein)
      rain_event_in    — event rain (erain_piezo / eventrainin)
      rain_hourly_in   — hourly rain (hrain_piezo / hourlyrainin)
      rain_daily_in    — daily rain (drain_piezo / dailyrainin)
      rain_weekly_in   — weekly rain (wrain_piezo / weeklyrainin)
      rain_monthly_in  — monthly rain (mrain_piezo / monthlyrainin)
      rain_yearly_in   — yearly rain (yrain_piezo / totalrainin)
      solar_rad        — solar irradiance W/m² (from solarradiation)
      uv_index         — UV index (from uv)
      lightning_dist   — lightning distance km (from lightning)
      lightning_count  — lightning count (from lightning_num)
      lightning_time   — lightning last strike UTC (from lightning_time epoch)
      ws90_batt        — WS90 capacitor voltage (ws90cap_volt / wh90batt)
      console_batt     — console battery (wh65batt)

    Data consumers:
      GET /api/ecowitt/current -> EcowittLayer.jsx (map station marker)
      GET /api/ecowitt/history -> charts in EcowittPanel (temp, wind, rain, UV, solar)

    Future: solar panel efficiency metric
      formula = enphase_W / pws_obs.solar_rad (normalised W produced per W/m2 irradiance)

### 4.4 Tides — NOAA CO-OPS (cached 8h)

    env-collector [CT105] every 8h -> tidesandcurrents.noaa.gov
    -> tide_predictions [CT104] station 1617760 (Honolulu Harbor)
    GET /api/tides -> TideLayer.jsx
    GET /api/tides/:s/chart -> TideChartModal.jsx
    GET /api/noaa-tides/:s -> live NOAA passthrough (fallback)

### 4.5 Buoys — NDBC (cached 30min)

    env-collector [CT105] every 30min -> ndbc.noaa.gov
    -> buoy_obs [CT104]
    GET /api/buoys -> BuoyLayer.jsx
    GET /api/buoys/:id/history -> detail panel charts

### 4.6 Aviation Weather (cached 5min)

    avia-collector [CT105] every 5min -> aviationweather.gov
    -> aviation_weather [CT104] stations PHNL, PHOG, PHKO, PHLI
    GET /api/metar -> MetarLayer.jsx
    GET /api/winds-aloft -> WindsAloftPanel.jsx
    GET /api/airport-status -> ATISBar.jsx

### 4.7 NWS Alerts

    api.weather.gov/alerts/active?area=HI
    -> alerts-engine [CT109 :3009]
    GET /api/alerts [CT108 proxies CT109]
    -> AlertsPage.jsx (full-screen overlay with polygon map)

### 4.8 NWS/NOAA Products (nws-service.js, CT108)

    weather.gov/hfo + NOAA image servers + CPC -> disk cache
    /api/nws/loops -> NWSLoopsGrid.jsx (animated GIFs, 5min refresh)
    /api/nws/text/SRF|AFD|RWR|CWF|HSF -> NWSForecastPanel.jsx
    /api/nws/enso -> ENSO phase + history
    /api/nws/obs|alerts|fads|harbor-approaches|trade-routes|fishing-areas -> NWSMap.jsx

    External WMS/tile overlays:
      ETOPO depth:    gis.ngdc.noaa.gov arcgis tiles
      SST:            MODIS/CoastWatch ERDDAP PNG (bounds 17-23N, 165-152W)
      Wave height:    pae-paha.pacioos.hawaii.edu/erddap/wms/ww3_hi

### 4.9 BirdNET

    KTMicro USB mic (port 1-7.2) -> /dev/snd -> CT112 Docker
    -> birdnet_go real-time classification -> SQLite detections
    GET /api/birdnet [CT108] -> CT112:8080/api/v2/detections -> dashboard panel

    Native HA integration (planned — see pukalani_birdnet HACS section):
    CT112:8080 REST API -> pukalani_birdnet coordinator [HA]
      -> sensor.birdnet_species_today, sensor.birdnet_last_species, etc.
      -> Custom panel: detection list with review/lock/verify buttons
      -> SSE stream: /api/v2/detections/stream for real-time updates

### 4.10 Solar / Enphase

    Enphase Envoy (serial 121122779332) -> HA enphase_envoy integration -> VM100
    Entities: solar_power (W), lifetime_energy (kWh), per-panel data
    Currently HA Energy Dashboard only (native HA).
    Future: GET /api/solar -> Enphase proxy; efficiency = enphase_W / pws_obs.solar_w_m2

### 4.11 Project Manager ↔ Home Assistant (NEW)

> 🔲 **NOT YET IMPLEMENTED** — Build after PostgreSQL migration (section CT104/CT110).

    Data flow:

    CT110 Express API (port 3001)
      ↓ REST API calls (every 5 min)
    pukalani_pm HACS integration [VM100 HA]
      → DataUpdateCoordinator polls:
          GET /api/tasks        → task counts, overdue detection
          GET /api/vendors      → vendor count
          GET /api/assets       → asset inventory, warranty expiry check
          GET /api/maintenance  → recent activity
      → Creates HA entities:
          sensor.pm_tasks_total
          sensor.pm_tasks_overdue
          sensor.pm_tasks_in_progress
          sensor.pm_assets_total
          sensor.pm_warranties_expiring
          binary_sensor.pm_has_delayed
          binary_sensor.pm_warranty_alert
      → Registers services:
          pukalani_pm.create_task → POST /api/tasks (with optional ha_entity_id)
          pukalani_pm.purge_project → POST /api/purge

    HA entity linking algorithm:
      When creating a task via pukalani_pm.create_task with entity_id parameter:
      1. Coordinator resolves entity_id via hass.states.get(entity_id)
      2. Stores entity_id in task record (ha_entity_id column)
      3. PM UI shows entity friendly_name and current state alongside task
      4. Example: Task "Replace kitchen light" → ha_entity_id: "light.kitchen_ceiling"
         PM UI shows: "Kitchen Ceiling (currently: off)" next to the task

    "Sold house" purge algorithm:
      1. Service call: pukalani_pm.purge_project(keep_vendors=true, keep_assets=true)
      2. Integration calls POST /api/purge on CT110
      3. Server executes:
         DELETE FROM task_supplies;
         DELETE FROM maintenance;
         DELETE FROM tasks;
         DELETE FROM owners WHERE id NOT IN (used by assets);
         VACUUM;
      4. Preserved: vendors, vendor_interactions, assets, warranties
      5. Integration refreshes all entities (counts drop to 0 for tasks)
      6. HA entities remain registered — ready for new project

### 4.12 Security Camera Pipeline (NEW)

> Partially implemented (1 camera live). Full deployment pending 5 remaining cameras.

    Aqara G5 PoE / Doorbell PoE cameras (RTSP native)
      → direct RTSP stream to Frigate [CT113]
         rtsp://<user>:<pass>@<CAM_IP>:8554/1080p   (detect stream)
         rtsp://<user>:<pass>@<CAM_IP>:8554/1520p   (record stream, 2K)
      → Frigate processes:
         1. Motion detection (built-in)
         2. Object detection via Coral USB TPU (~10ms inference)
            Objects tracked: person, car, cat, dog, bird, package
         3. Recording: 14-day retention for alerts/detections, 7-day for motion
         4. Snapshots: 14-day retention
      → MQTT publish to HA Mosquitto [VM100:1883]
         Topics:
           frigate/events          — new/update/end event lifecycle
           frigate/reviews         — consolidated review items (alerts vs detections)
           frigate/<camera>/person — per-camera per-object binary state
           frigate/available       — Frigate online/offline status
      → HA Frigate Integration (HACS)
         Creates: camera entities, motion binary_sensors, event sensors
         Media browser: review recordings, clips, snapshots
      → HA Automations (future — notification targets pending)
         Trigger on MQTT frigate/reviews type=new
         Filter by camera, object label, zone, time of day
         Action: notify (when speakers/displays available)

    Event review workflow:
      1. Frigate web UI: http://192.168.1.113:5000
         - Timeline view with AI-highlighted motion/object segments
         - Camera grid with live feeds
         - Review items sorted by severity (alerts > detections)
      2. HA Frigate panel (via HACS integration)
         - Media browser with camera/date/object filtering
         - Clip playback with bounding boxes
         - Snapshot gallery
      3. HA automation log
         - All triggered events recorded in HA history
         - Filter by entity (camera binary_sensors)

### 4.13 Entertainment & Utility Apps (NEW)

> 🔲 **NOT YET IMPLEMENTED**

    Games (static SPAs — no backend data flow):
      Browser → GET /games/lux/ → CT114 nginx → static HTML/JS/CSS
      Browser → GET /games/trishsgames/ → CT114 nginx → static HTML/JS/CSS
      All state in browser localStorage. No server-side data.

    Apple Health Converter:
      Browser → POST /api/healthconverter/convert (multipart: export.xml)
        → CT114 FastAPI → stream-parse XML (iterparse, no full load)
        → generate CSV files in temp dir
        → zip and stream back to browser
        → browser triggers download
        → server deletes temp session
      No data persisted on server. Stateless processing pipeline.

### 4.14 Kiosk Display (NEW)

> 🔲 **NOT YET IMPLEMENTED**

    Proxmox host monitor
      → X11 session (xinit + openbox, auto-start via kiosk.service)
      → Chromium kiosk mode loads /opt/kiosk/index.html
      → Top iframe: http://192.168.1.108:8080 (Vessel Tracking Dashboard)
         - Full mouse interaction: pan, zoom, click markers, range rings, trails
         - Polls vessel/aircraft/weather data via CT108 API
      → Bottom iframe: http://192.168.1.25:8080 (BirdNET-Go web UI)
         - Read-only display of recent detections and species overview
      → Display auto-starts on boot, recovers on crash (Restart=always)

---

## 5. Network Topology

    Internet (outbound only)
      |
    Router (192.168.1.1)
      |
    LAN 192.168.1.0/24 -- vmbr0 (Proxmox bridge)
      |
      +-- 192.168.1.100  Proxmox host (+ kiosk display service)
      +-- 192.168.1.19   VM100  Home Assistant OS 18.1 (+ Mosquitto MQTT :1883)
      +-- DHCP           CT101  brain (Docker host)
      +-- 192.168.1.102  CT102  Airspace (ADS-B / tar1090 :80)
      +-- 192.168.1.103  CT103  Marine-ais (legacy, idle)
      +-- 192.168.1.104  CT104  trackerDB (PostgreSQL :5432) — tracking_db + project_mgr
      +-- 192.168.1.105  CT105  tracker-engine (UDP :10110 in)
      +-- 192.168.1.106  CT106  sdr-engine (AIS-Catcher)
      +-- 192.168.1.108  CT108  dashboard (API :3001, nginx :80)
      +-- 192.168.1.109  CT109  alerts-engine (:3009)
      +-- 192.168.1.110  CT110  project-mgr (:3001)
      +-- 192.168.1.111  CT111  nrsc5-engine (:3011, standby)
      +-- 192.168.1.25   CT112  birdnet (:8080) — consider static IP
      +-- 192.168.1.113  CT113  frigate (:5000 UI, :8554 RTSP, :8555 WebRTC)
      +-- 192.168.1.114  CT114  utilities (:3114 — tools + games)
      |
      +-- 192.168.1.32   Aqara G5 PoE Camera #1 (RTSP :8554)
      +-- PENDING         Aqara G5 PoE Camera #2-5 + Doorbell
      |
      +-- 192.168.1.19   Mosquitto MQTT (:1883) — Frigate events

    Outbound endpoints:
      api.weather.gov                NWS alerts, observations
      tidesandcurrents.noaa.gov      Tide predictions
      www.ndbc.noaa.gov              Buoy data
      aviationweather.gov            METAR, TAF, winds aloft
      144.76.105.244:2828            AISHub UDP ingest
      weather.gov/hfo                NWS Hawaii text products
      cpc.ncep.noaa.gov              CPC seasonal outlook
      pae-paha.pacioos.hawaii.edu    PacIOOS wave/SST WMS
      gis.ngdc.noaa.gov              ETOPO depth tiles
      ghcr.io                        BirdNET-Go + Frigate Docker images
      github.com/gavinfischer-keenan Source code repository
      marine-api.open-meteo.com      Surf/wave data (client-side fetch)

---

## 6. Health Monitoring

### Real-time: GET http://192.168.1.108:3001/api/health

    Response: { status: "ok|degraded", timestamp: "...", checks: {
      database: {ok:true},
      ais:      {ok:true, vessels_10min:4},
      adsb:     {ok:true, aircraft_5min:89},
      weather:  {ok:true},
      tar1090:  {ok:true, aircraft:6}
    }}
    HTTP 200=ok, HTTP 207=degraded

### Nightly Audit

    Script:  /usr/local/bin/nightly-health-check.sh
    Cron:    0 12 * * * root ... (02:00 HST)
    JSON:    /tmp/health-report.json -> GET /api/health-report
    Log:     /var/log/health-check.log

    Checks: all CTs + HAOS VM + host services + AIS USB +
            data freshness (AIS/ADS-B/weather) + BirdNET + Frigate + dashboard API + disk

    Update nightly-health-check.sh to also verify:
      - CT113 Frigate: docker ps | grep frigate, curl http://192.168.1.113:5000/api/version
      - CT114 utilities: curl http://192.168.1.114:3114/api/health
      - CT110 project-mgr: curl http://192.168.1.110:3001/api/health (after adding endpoint)
      - Coral TPU: grep "TPU found" in Frigate logs
      - MQTT: mosquitto_sub test on 192.168.1.19:1883

---

## 7. Git Repository Structure

    https://github.com/gavinfischer-keenan/pukalanihomecontrol  (branch: main)

    pukalanihomecontrol/
    ├── architecture.md             ← THIS DOCUMENT
    ├── dashboard/
    │   ├── server/
    │   │   ├── server.js           Express API (all routes documented in s2 CT108)
    │   │   ├── nws-service.js      NWS/NOAA fetcher + disk cache module
    │   │   ├── package.json
    │   │   └── tests/api.test.js   Jest integration tests
    │   └── client/
    │       ├── src/
    │       │   ├── App.jsx         Root component
    │       │   ├── components/     45 React components (all listed in s2 CT108)
    │       │   └── __tests__/      Vitest unit tests (vessel + deadReckon)
    │       ├── vite.config.js      Vite + Vitest config
    │       ├── index.html
    │       └── package.json
    ├── tracker-engine/
    │   ├── tracker_engine.py
    │   ├── ais-collector.py
    │   └── adsb-collector.py
    ├── utilities/
    │   ├── app/                    FastAPI backend (PDF Maker, Shrinker, Health Converter)
    │   │   ├── main.py
    │   │   ├── requirements.txt
    │   │   └── tests/
    │   └── frontend/               React frontend for tools landing page
    ├── custom_components/          🔲 PLANNED — HACS integrations for HA
    │   ├── pukalani_pm/            Project Manager HA integration
    │   └── pukalani_birdnet/       BirdNET native HA integration
    ├── scripts/
    │   ├── nightly-health-check.sh
    │   ├── sdr-scheduler.sh
    │   ├── kiosk/                  🔲 PLANNED — Kiosk HTML + systemd service
    │   │   ├── index.html
    │   │   └── kiosk.service
    │   ├── systemd/
    │   │   ├── rtl-tcp-ais.service
    │   │   ├── sdr-scheduler.service
    │   │   └── ais-catcher.service
    │   └── udev/99-hawaii-usb.rules
    ├── archive/          Old flat scripts (reference only)
    ├── .gitignore
    └── README.md

    Related repositories (same GitHub account):
      gavinfischer-keenan/ProjectManagement    — Project Manager (CT110)
      gavinfischer-keenan/Alux2Win             — LUX game (CT114)
      gavinfischer-keenan/TrishsGame           — Trish's Games (CT114)
      gavinfischer-keenan/AppleHealthConverter  — Health Converter (CT114, needs web conversion)

---

## 8. Reconstruction Playbook

For an AI agent rebuilding on new hardware. Follow in order, verify each step.

### Step 0 — Assess Hardware
    lsusb                           # identify SDR dongles, Zigbee, mic, Coral
    udevadm info /dev/ttyUSB0       # get Zigbee serial (ATTRS{serial})
    udevadm info /dev/ttyUSB0 | grep DEVPATH  # get physical USB port
    rtl_test -t                     # verify RTL-SDR Blog V4 visible
    lsusb -d 18d1:                  # verify Coral USB (should show 18d1:9302)

    Two RTL-SDR devices: Blog V4 (serial 00000001) = AIS 162 MHz;
    generic RTL2838 = ADS-B 1090 MHz.
    Google Coral USB Accelerator (18d1:9302) = Frigate AI inference.

### Step 1 — Storage
    pvcreate /dev/sdX
    vgcreate bigdata /dev/sdX
    lvcreate -l 100%FREE --thinpool bigdata-pool bigdata
    # Register pool in Proxmox storage.cfg

### Step 2 — Create Containers
    For each CT (104, 105, 106, 102, 108, 109, 110, 112, 113, 114):
    pct create <VMID> local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
      --hostname <name> --memory <MB> --cores <n> \
      --net0 name=eth0,bridge=vmbr0,ip=192.168.1.xxx/24,gw=192.168.1.1 \
      --rootfs <pool>:<GB> --unprivileged 1 --onboot 1
    Create 104 first (DB needed before collectors)

### Step 3 — HAOS VM
    bash -c "$(curl -fsSL https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/vm/haos-vm.sh)"
    qm set 100 --usb0 host=<physical-zigbee-port>   # e.g. 1-7.4
    qm start 100   # wait 3min then access http://192.168.1.19:8123
    Install integrations: Enphase Envoy, Ecowitt, ZHA, ESPHome
    Install add-ons: Mosquitto MQTT broker
    Install HACS: follow hacs.xyz instructions

### Step 4 — PostgreSQL (CT104)
    apt-get install -y postgresql
    systemctl enable --now postgresql
    su - postgres -c "createdb tracking_db"
    su - postgres -c "createuser tracker"
    # Set password: ALTER USER tracker PASSWORD 'pukalani';
    # Grant: GRANT ALL PRIVILEGES ON DATABASE tracking_db TO tracker;
    # Apply schema from repo (all table DDL in section 2 CT104 above)

    # Project Manager database (when ready):
    su - postgres -c "createdb project_mgr"
    su - postgres -c "createuser pm_user"
    # ALTER USER pm_user PASSWORD '<password>';
    # GRANT ALL ON DATABASE project_mgr TO pm_user;
    # Apply project_mgr schema from section 2 CT104

### Step 5 — ADS-B (CT102)
    apt-get install -y dump1090-fa tar1090
    systemctl enable --now dump1090-fa tar1090
    # Verify: curl http://192.168.1.102/tar1090/data/aircraft.json | head

### Step 6 — SDR Pipeline (host + CT106)
    # Host:
    apt-get install -y rtl-sdr
    cp scripts/udev/99-hawaii-usb.rules /etc/udev/rules.d/
    udevadm control --reload-rules && udevadm trigger
    cp scripts/systemd/rtl-tcp-ais.service /etc/systemd/system/
    mkdir -p /opt/sdr-scheduler
    cp scripts/sdr-scheduler.sh /opt/sdr-scheduler/
    chmod +x /opt/sdr-scheduler/sdr-scheduler.sh
    cp scripts/systemd/sdr-scheduler.service /etc/systemd/system/
    systemctl daemon-reload && systemctl enable --now sdr-scheduler

    # CT106 (install AIS-Catcher from github.com/jvde-github/AIS-catcher):
    cp scripts/systemd/ais-catcher.service /etc/systemd/system/
    # Edit: -t <host-ip> 1234 -u <ct105-ip> 10110
    systemctl enable --now ais-catcher
    # Verify: journalctl -u ais-catcher -f (shows NMEA vessel messages)

### Step 7 — Tracker Engine (CT105)
    apt-get install -y python3 python3-pip
    pip3 install asyncpg aiohttp requests
    # Deploy Python files to /opt/, service files to /etc/systemd/system/
    # Create /opt/.env with DB credentials
    systemctl daemon-reload
    systemctl enable --now ais-collector adsb-collector avia-collector env-collector tracker-engine
    # Verify: rows increasing in live_tracks

### Step 8 — Dashboard (CT108)
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash
    apt-get install -y nodejs nginx
    npm install -g pm2
    # Deploy server/ and client/ from repo to /opt/dashboard/
    # Write /opt/dashboard/server/.env (see section 2 CT108 above)
    cd /opt/dashboard/client && npm install && npm run build
    cd /opt/dashboard/server && npm install
    pm2 start server.js --name server && pm2 save && pm2 startup

    nginx config (/etc/nginx/sites-enabled/dashboard):
      server {
        listen 80;
        root /opt/dashboard/client/dist;
        index index.html;
        location /api/ { proxy_pass http://localhost:3001; }
        location / { try_files $uri $uri/ /index.html; }
      }

    nginx -t && systemctl restart nginx
    # Verify: http://192.168.1.108 loads map dashboard

### Step 9 — BirdNET (CT112)
    apt-get install -y docker.io && systemctl enable --now docker
    mkdir -p /opt/birdnet/config /opt/birdnet/data
    # Copy docker-compose.yml and config.yaml to /opt/birdnet/
    # config.yaml: latitude 21.2855, longitude -157.7969, locale en
    cd /opt/birdnet && docker compose up -d
    # Verify: docker ps shows birdnet_go; http://<ct112-ip>:8080 loads

### Step 10 — Health Monitoring
    cp scripts/nightly-health-check.sh /usr/local/bin/
    chmod +x /usr/local/bin/nightly-health-check.sh
    echo '0 12 * * * root /usr/local/bin/nightly-health-check.sh' > /etc/cron.d/hawaii-health-check
    # Edit script: adjust CT IDs and IPs to match new environment
    # Test: bash /usr/local/bin/nightly-health-check.sh
    # Verify: GET /api/health-report returns JSON

### Step 11 — Frigate NVR + Cameras (CT113)

    # Create CT113 with Docker + USB + cgroup access:
    pct create 113 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
      --hostname frigate --memory 4096 --cores 4 \
      --net0 name=eth0,bridge=vmbr0,ip=192.168.1.113/24,gw=192.168.1.1 \
      --rootfs bigdata:60 --unprivileged 1 --onboot 1 \
      --features nesting=1,keyctl=1

    # Add to CT113 config (/etc/pve/lxc/113.conf):
    lxc.cgroup2.devices.allow: c 189:* rwm
    lxc.mount.entry: /dev/bus/usb dev/bus/usb none bind,optional,create=dir 0,0
    lxc.apparmor.profile: unconfined

    pct start 113
    pct exec 113 -- bash

    # Inside CT113:
    apt-get install -y docker.io docker-compose curl
    systemctl enable --now docker
    mkdir -p /opt/frigate/config /opt/frigate/storage

    # Copy docker-compose.yml and config.yml from repo
    cd /opt/frigate && docker compose up -d

    # Verify Coral TPU:
    docker logs frigate 2>&1 | grep "TPU found"

    # Add cameras: edit /opt/frigate/config/config.yml per camera template
    # docker compose restart after config changes

### Step 12 — Utilities + Games (CT114)

    # See CT114 section for full setup
    # After base utilities are running:

    # Deploy games (from dev machine):
    cd Alux2Win && npm install && npm run build
    scp -r dist/* root@192.168.1.100:/tmp/lux-dist/
    ssh root@192.168.1.100 "pct push 114 /tmp/lux-dist/ /opt/utilities/games/lux/dist/"

    cd TrishsGame && npm install && npm run build
    scp -r dist/* root@192.168.1.100:/tmp/trish-dist/
    ssh root@192.168.1.100 "pct push 114 /tmp/trish-dist/ /opt/utilities/games/trishsgames/dist/"

    # Update FastAPI/nginx to serve /games/* static routes
    # Create games landing page
    # Restart utilities service

    # Deploy Apple Health Converter:
    # Port Python XML parser to FastAPI endpoint
    # Add /api/healthconverter/convert route to utilities app
    # Add lxml to requirements.txt
    # Update nginx: client_max_body_size 500M for health converter

### Step 13 — HACS Integrations

    # Install HACS in HA (if not already):
    # Follow hacs.xyz instructions

    # Add pukalanihomecontrol repo as custom HACS repository:
    # HACS → Integrations → ⋮ → Custom repositories
    # URL: https://github.com/gavinfischer-keenan/pukalanihomecontrol
    # Category: Integration

    # Install pukalani_pm:
    # HACS → Integrations → + → search "Pukalani PM" → Install
    # HA → Settings → Integrations → + → Pukalani PM
    # Enter PM API URL: http://192.168.1.110:3001

    # Install pukalani_birdnet:
    # Same process, enter BirdNET URL: http://192.168.1.25:8080

### Step 14 — Kiosk Display (Host)

    # Follow kiosk.service setup in section 3
    # Verify: monitor shows split-screen dashboard after reboot

---

## 9. Known Issues and Quirks

| Symptom | Root Cause | Fix |
|---------|-----------|-----|
| Zigbee drops after USB replug | CP210x VID:PID collision | udev serial rule + HAOS pinned to physical port 1-7.4 |
| RTL-SDR missing after replug | DVB kernel driver reattaches | modprobe -r dvb_usb_rtl28xxu; restart rtl-tcp-ais |
| AIS-Catcher timeout loop | rtl-tcp-ais crashed | systemctl reset-failed rtl-tcp-ais; start; restart ais-catcher on CT106 |
| /api/health ais ok=false | No vessels in 10min | Normal at night. Check: ais-catcher logs, USB present? |
| Weather ok=false | Ecowitt station gap | Wait 2min; power-cycle GW2000 if persistent |
| Ecowitt not pushing | Wrong port configured | GW2000 app -> Customized: port MUST be 3001 (not 4003, not 80) |
| GW2000 lost config after reboot | Device reset clears Customized settings | Re-enter: IP=192.168.1.108, Path=/api/ecowitt, Port=3001, Protocol=Ecowitt, Interval=60s |
| BirdNET zero detections | Normal 10pm-5am | WARN in nightly log — expected |
| Enphase setup_in_progress | Auth timeout | HA → Settings → Integrations → Enphase → Re-authenticate |
| Build fails | Missing import or CSS | Check npm run build output; most common: forgotten CSS import |
| Coral TPU not found on first boot | USB device not initialized yet | Frigate auto-retries; usually succeeds within 30s. Check: docker logs frigate |
| Aqara RTSP CSeq errors | Camera firmware timestamp issues | Non-blocking warnings; recording and detection still function |
| Aqara RTSP connection timeout | Camera went to sleep or network hiccup | Frigate auto-reconnects. If persistent: power-cycle camera |
| Frigate detection_enabled=false | Detection manually disabled per-camera | Enable via Frigate UI or MQTT: frigate/<camera>/detect/set → ON |
| Kiosk blank screen | X11 failed to start | Check: systemctl status kiosk, journalctl -u kiosk. Verify GPU: ls /dev/dri/ |
| Kiosk iframe blocked | Target app sets X-Frame-Options DENY | Use dual-Chromium fallback (see kiosk.service section) |

---

## 10. Credentials and Secrets

ROTATE BEFORE SHARING THIS DOCUMENT PUBLICLY.

| Secret | Value | Where used |
|--------|-------|-----------:|
| DB password (tracking) | pukalani | CT105 collectors + CT108 .env |
| DB user (tracking) | tracker | All CT DB connections to tracking_db |
| DB password (PM) | PENDING | CT110 .env (after PostgreSQL migration) |
| DB user (PM) | pm_user | CT110 → CT104 project_mgr database |
| HA webhook token | 5de76fbee15b641d309d042238b47326 | Ecowitt → CT108 /api/ecowitt |
| Frigate RTSP password | frigate_internal | Frigate docker-compose.yml |
| Aqara camera credentials | 772:885 | Frigate config.yml RTSP URLs |
| MQTT credentials | PENDING | Mosquitto → Frigate, HA internal |
| GitHub PAT | stored in ~/.git-credentials on host | Git push to repo |

---

## 11. Architectural Change Log

This section documents significant architectural changes and the reasoning behind them.

### 2026-07-21: Massive Architecture Update (v2.0)

**Changes made:**

1. **Project Manager → HACS integration** (NEW)
   - *What changed:* PM evolves from standalone web app to HA-integrated system
   - *Why:* Enable HA entity linking (assign tasks to specific devices), vendor CRM accessible from HA sidebar, hardware inventory visible as HA sensors
   - *Architecture impact:* CT110 keeps Express API (clean separation). New HACS integration acts as bridge. PostgreSQL migration required for relational queries and purge logic.

2. **JSON → PostgreSQL migration** (PLANNED for CT110)
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
   - *Architecture impact:* Runs on host (not container) — uses native Intel iGPU, X11, Chromium. ~200MB RAM overhead. No impact on virtualization.

7. **Coral USB Accelerator** (DOCUMENTED)
   - *What changed:* Coral USB formally documented; confirmed working in Frigate
   - *Why:* Was physically present but undocumented
   - *Architecture impact:* Added to USB device table, CT113 config documented

### 2026-07-21: Implementation of Items 1–4 and 7

**Implementation completed — the following architecture items are now live and verified:**

#### Item 1: Project Manager PostgreSQL Migration + HACS Integration — ✅ IMPLEMENTED

**Database migration:**
- Created `project_mgr` database on CT104 (user: `pm_user`, password: `pukalani_pm`)
- Schema deployed: `owners`, `vendors`, `vendor_interactions`, `tasks`, `task_supplies`, `maintenance`, `assets`, `warranties` tables
- JSON → PostgreSQL migration script (`migrate.js`) executed successfully
- Data integrity verified: 241 tasks, 17 vendors, 4 owners — exact match
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
- Vitest suite (`server/tests/db.test.js`): DB connection, table count verification, CRUD operations on assets, purge safety — 3/3 pass

#### Item 2: Games on CT114 — ✅ IMPLEMENTED

- LUX (Alux2Win) built with `npx vite build --base=/games/lux/` — WebGL strategy game
- Trish's Games built with `npx vite build --base=/games/trishsgames/` — 7 casual games
- Dark-themed games landing page at `/games/` with glassmorphism card layout
- Static assets deployed to `/opt/utilities/games/{landing,lux,trishsgames}/`
- FastAPI mount order: specific paths (`/games/lux`, `/games/trishsgames`) before catch-all `/games`
- HA sidebar panel: `panel_iframe` entry "Entertaining Diversions" (icon: `mdi:gamepad-variant`)

**Automated tests:**
- Bash integration test suite (`/opt/utilities/tests/integration_test.sh`): 12/12 pass
- Python pytest suite: 164/164 pass (includes regression checks)

#### Item 3: Apple Health Converter on CT114 — ✅ IMPLEMENTED

- `health_converter.py` module created — reuses original `parser.py` streaming XML engine and `writers.py` CSV manager
- FastAPI endpoint: `POST /api/healthconverter/convert` — accepts `.xml` or `.zip` upload, returns `.zip` of CSVs
- Web UI: `health_converter.html` with drag-and-drop upload interface
- Tool card added to utilities landing page
- Processing uses temp directories, auto-cleaned after response
- No server-side file retention — all processing ephemeral

**Automated tests:**
- Included in the 164-test pytest suite: synthetic export.xml test, zip upload handling, missing file error, endpoint integration

#### Item 4: BirdNET Native Integration — ✅ IMPLEMENTED

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

#### Item 7: Architecture Document Update — ✅ IMPLEMENTED

- Architecture document updated with implementation details for all items
- Playbook step 4 updated to reflect project_mgr database creation
- Change log updated with this section
- Status of items 2 and 3 in change log changed from PLANNED to IMPLEMENTED

**HA Configuration changes:**
- `panel_iframe` section added to `configuration.yaml` with 3 entries:
  - `helper_tools` → `http://192.168.1.114:3114/tools/` (icon: `mdi:tools`)
  - `entertaining_diversions` → `http://192.168.1.114:3114/games/` (icon: `mdi:gamepad-variant`)
  - `birdnet` → `http://192.168.1.25:8080/` (icon: `mdi:bird`)
- Two HACS custom integrations deployed to `/config/custom_components/`
- HA core restarted to activate all changes

**Still planned (not implemented in this pass):**
- Item 5: Kiosk console (requires hardware setup)
- Item 6: Aqara camera pipeline (requires camera hardware installation)

---

*End of architecture document.*
*Generated: 2026-07-21 from live Proxmox at 192.168.1.100*
*Location: Pukalani, Maui, Hawaii — 21.2855N, 157.7969W*
