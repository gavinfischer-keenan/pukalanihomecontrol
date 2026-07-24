<!-- doc: database.md | topic: Database Schema | last-updated: 2026-07-23 -->

# Database Schema

**Instance:** PostgreSQL 17 on CT104:5432
**Database:** tracking_db
**User:** tracker/pukalani

## Core Tables

| Table | Primary Key | Description | Populated By |
|-------|-------------|-------------|--------------|
| live_tracks | id (UUID) | Real-time vessel/aircraft positions | ais-collector, adsb-collector |
| vessel_info | mmsi (INT) | Vessel static data (name, type) | ais-collector |
| aircraft_info | icao24 (VARCHAR) | Aircraft static data (callsign, model) | adsb-collector |
| pws_obs | timestamp | Ecowitt personal weather station data | env-collector |
| buoy_obs | timestamp | NOAA buoy marine weather | env-collector |
| tide_predictions | timestamp | NOAA tide levels | env-collector |
| aviation_weather | timestamp | METAR/TAF for local airports | avia-collector |

## Daily Maintenance

A cron job runs daily at **4:00 AM HST** on CT104.
* **Script:** /opt/db-maintenance.sh
* **Actions:** Cleans orphaned rows, purges AIS data older than 48h, purges ADS-B data older than 1h.
* **Manual run:** pct exec 104 -- bash /opt/db-maintenance.sh

*Note: Need complete DDL export for full schema.*
