<!-- doc: sdr-pipeline.md | topic: SDR & Radio Pipeline | last-updated: 2026-07-24 -->

# SDR & Radio Pipeline

> [!CAUTION]
> AIS and ADS-B must use **separate** SDR dongles. Never share an SDR between AIS and other uses.

## AIS Pipeline (Marine)
*(Detailed architectural documentation available in [ais-pipeline.md](file:///opt/hawaii-tracker/docs/ais-pipeline.md)).*

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

1. **Dongle**: RTL-SDR Blog V4 (Serial `00000001`) connected to host.
2. **Host**: `rtl-tcp-ais.service` runs `rtl_tcp` on port 1234.
3. **CT106**: `AIS-catcher` connects to host:1234, decodes AIS over UDP to CT105:10110.
4. **CT105**: `ais-collector.py` parses NMEA, writes to PostgreSQL `live_tracks` (CT104), sends TX stream to AISHub, polls AISHub RX feed into in-memory cache (:3105), enriches static metadata in `entities`, and cross-checks antenna health.

## ADS-B Pipeline (Aviation)
1. **Dongle**: RTL2838 connected and passed through to CT102.
2. **CT102**: `dump1090-fa` decodes ADS-B. Web UI at `:80` via `tar1090`.

## HD Radio (NRSC-5)
1. **CT114**: `nrsc5-engine` (:3011).
2. *Status*: Currently no active HD Radio in Hawaii, kept for future use.
