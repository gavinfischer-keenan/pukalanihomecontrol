<!-- doc: sdr-pipeline.md | topic: SDR & Radio Pipeline | last-updated: 2026-07-23 -->

# SDR & Radio Pipeline

> [!CAUTION]
> AIS and ADS-B must use **separate** SDR dongles. Never share an SDR between AIS and other uses.

## AIS Pipeline (Marine)
1. **Dongle**: RTL-SDR Blog V4 (Serial 00000001) connected to host.
2. **Host**: `rtl-tcp-ais.service` runs `rtl_tcp` on port 1234.
3. **CT106**: `AIS-Catcher` connects to host:1234, decodes AIS.
4. **CT106 -> CT105**: NMEA sentences forwarded via UDP to CT105:10110.

## ADS-B Pipeline (Aviation)
1. **Dongle**: RTL2838 connected and passed through to CT102.
2. **CT102**: `dump1090-fa` decodes ADS-B. Web UI at `:80` via `tar1090`.

## HD Radio (NRSC-5)
1. **CT114**: `nrsc5-engine` (:3011).
2. *Status*: Currently no active HD Radio in Hawaii, kept for future use.
