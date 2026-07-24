<!-- doc: ais-pipeline.md | topic: AIS Marine Pipeline Architecture | last-updated: 2026-07-24 -->

# AIS Marine Pipeline Architecture

## Complete Data Flow

```
SDR Blog V4 USB Dongle
  → rtl_tcp (host, port 1234, serial 00000001)
    → AIS-catcher (CT106, systemd service)
      → UDP 192.168.1.105:10110
        → ais-collector.py (CT105, systemd service)
          → PostgreSQL live_tracks (CT104)
          → AISHub TX (UDP to data.aishub.net:2828)
          → AISHub RX (HTTP poll every 120s → memory cache)
            → HTTP :3105 /api/aishub-nearby → dashboard /api/vessels/nearby
            → Enriches entities table for locally-seen vessels
            → AIS receiver health cross-check (15nm radius)
```

## Component Breakdown

### 1. Physical Receiver & Host Stream
- **Hardware**: RTL-SDR Blog V4 USB Dongle with serial number `00000001` connected to the Proxmox host.
- **Service**: `rtl-tcp-ais.service` runs `rtl_tcp` on host port `1234`.
- **Purpose**: Streams raw I/Q samples from the SDR over TCP to the decoder container.

### 2. Decoder Container (CT106: sdr-engine)
- **Service**: `AIS-catcher.service` systemd service running in CT106.
- **Function**: Connects to `host:1234`, decodes dual-channel AIS (161.975 MHz and 162.025 MHz NMEA sentences).
- **Forwarding**: Outputs raw NMEA sentences via UDP to `192.168.1.105:10110`.

### 3. Collector & Processor (CT105: tracker-engine)
- **Service**: `ais-collector.py` systemd service running on CT105.
- **Primary Roles**:
  1. **Database Persistence**: Parses local NMEA messages and inserts track records into PostgreSQL `live_tracks` table in CT104 (`tracking_db`).
  2. **AISHub Telemetry Transmit (TX)**: Forwards raw NMEA sentence stream via UDP to AISHub network (`data.aishub.net:2828`).
  3. **AISHub Telemetry Receive (RX - Enrich-Only Pattern)**:
     - Polls AISHub REST API every 120 seconds (30nm radius bounding box: 20.785–21.786°N, 158.334–157.260°W).
     - Maintains in-memory cache (`_aishub_cache` dict, ~30 vessels) with a 10-minute expiry.
     - Exposes cache over HTTP at `http://192.168.1.105:3105/api/aishub-nearby` for dashboard UI (`/api/vessels/nearby`).
     - **Enrichment**: Updates static metadata (vessel name, callsign, length, type) in `entities` table for vessels received locally (never inserts new records into `live_tracks`).
     - **Receiver Health Cross-Check**: Compares AISHub feed with local receiver. If 3+ vessels are within 15nm on AISHub but zero local packets are received within 5 minutes, writes `/tmp/ais-receiver-health` to trigger auto-healing restarts of `rtl_tcp` and `AIS-catcher`.
