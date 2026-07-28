#!/bin/bash
# /opt/hawaii-tracker/scripts/track-maintenance.sh
# Runs every 15 minutes via cron
#
# Two-tier track storage:
#   live_tracks    = hot buffer (2 hours, full resolution)
#   track_history  = warm store (30 days, 1 point/entity/minute)
#
# This script:
#   1. Downsamples live_tracks → track_history (new data only)
#   2. Prunes live_tracks older than 2 hours
#   3. Prunes track_history older than 30 days
#   4. Lightweight VACUUM on hot table

LOG=/var/log/track-maintenance.log
TS=$(date '+%Y-%m-%d %H:%M:%S')
log() { echo "[$TS] $1" >> $LOG; }

DB_CMD="pct exec 104 -- su - postgres -c"

log "--- Track maintenance starting ---"

# Step 1: Downsample new live_tracks into track_history
INSERTED=$($DB_CMD "psql -d tracking_db -t -c \"
  INSERT INTO track_history (entity_id, entity_type, lat, lon, speed, heading, recorded_at, minute_bucket)
  SELECT DISTINCT ON (lt.entity_id, date_trunc('minute', lt.recorded_at))
    lt.entity_id,
    COALESCE(e.entity_type, 'UNKNOWN'),
    ST_Y(lt.location::geometry),
    ST_X(lt.location::geometry),
    lt.speed,
    lt.heading,
    lt.recorded_at,
    date_trunc('minute', lt.recorded_at)
  FROM live_tracks lt
  LEFT JOIN entities e ON e.entity_id = lt.entity_id
  WHERE lt.recorded_at > NOW() - INTERVAL '2 hours'
  ORDER BY lt.entity_id, date_trunc('minute', lt.recorded_at), lt.recorded_at DESC
  ON CONFLICT (entity_id, minute_bucket) DO NOTHING;
  SELECT COUNT(*) FROM track_history WHERE recorded_at > NOW() - INTERVAL '15 minutes';
\"" 2>/dev/null | tail -1 | tr -d ' ')
log "Downsample: ~${INSERTED} recent points in track_history"

# Step 2: Prune live_tracks (keep 2 hours)
PRUNED=$($DB_CMD "psql -d tracking_db -t -c \"
  WITH deleted AS (
    DELETE FROM live_tracks WHERE recorded_at < NOW() - INTERVAL '2 hours' RETURNING 1
  ) SELECT COUNT(*) FROM deleted;
\"" 2>/dev/null | tr -d ' ')
log "Pruned live_tracks: $PRUNED rows removed"

# Step 3: Prune track_history (keep 30 days)
HIST_PRUNED=$($DB_CMD "psql -d tracking_db -t -c \"
  WITH deleted AS (
    DELETE FROM track_history WHERE recorded_at < NOW() - INTERVAL '30 days' RETURNING 1
  ) SELECT COUNT(*) FROM deleted;
\"" 2>/dev/null | tr -d ' ')
log "Pruned track_history: $HIST_PRUNED rows removed"

# Step 4: Quick stats
LIVE_COUNT=$($DB_CMD "psql -d tracking_db -t -c \"SELECT COUNT(*) FROM live_tracks;\"" 2>/dev/null | tr -d ' ')
HIST_COUNT=$($DB_CMD "psql -d tracking_db -t -c \"SELECT COUNT(*) FROM track_history;\"" 2>/dev/null | tr -d ' ')
log "Current sizes: live_tracks=$LIVE_COUNT rows, track_history=$HIST_COUNT rows"

log "--- Track maintenance complete ---"
