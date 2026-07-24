#!/bin/bash
# /opt/db-maintenance.sh — Daily live_tracks cleanup
# Installed by cron: 0 4 * * * /opt/db-maintenance.sh >> /var/log/db-maintenance.log 2>&1

LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"
export PGPASSWORD=pukalani
P="psql -h 127.0.0.1 -U tracker -d tracking_db -t"

echo "$LOG_PREFIX Starting daily DB maintenance..."

# 1. Delete orphaned rows (NULL source_type)
ORPHANS=$($P -c "DELETE FROM live_tracks WHERE source_type IS NULL RETURNING 1;" | wc -l)
echo "$LOG_PREFIX Deleted $ORPHANS orphaned rows"

# 2. Delete AIS older than 48 hours
AIS=$($P -c "DELETE FROM live_tracks WHERE source_type = 'ais' AND recorded_at < now() - interval '48 hours' RETURNING 1;" | wc -l)
echo "$LOG_PREFIX Deleted $AIS stale AIS rows"

# 3. Delete ADSB older than 1 hour
ADSB=$($P -c "DELETE FROM live_tracks WHERE source_type = 'adsb' AND recorded_at < now() - interval '1 hour' RETURNING 1;" | wc -l)
echo "$LOG_PREFIX Deleted $ADSB stale ADSB rows"

# 4. VACUUM ANALYZE
$P -c "VACUUM ANALYZE live_tracks;" > /dev/null 2>&1
echo "$LOG_PREFIX VACUUM ANALYZE complete"

# 5. Report current state
TOTAL=$($P -c "SELECT count(*) FROM live_tracks;")
SIZE=$($P -c "SELECT pg_size_pretty(pg_total_relation_size('live_tracks'));")
echo "$LOG_PREFIX Current state: $TOTAL rows, $SIZE"

echo "$LOG_PREFIX Daily maintenance complete."
