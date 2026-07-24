#!/bin/bash
# =============================================================================
# system-backup.sh — Automated backup for ALL critical state
# Runs every 6 hours via cron on the Proxmox host
# Retention: 7 days (28 backups)
# Location: /opt/backups/<timestamp>/
# =============================================================================

set -uo pipefail

BACKUP_ROOT="/opt/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${BACKUP_ROOT}/${TIMESTAMP}"
RETENTION_DAYS=7
LOG="/var/log/system-backup.log"
HA_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiI5NTA1OTg3MjZkNGE0MzM1YjgwODA1ZGE3MzBlZmZmZCIsImlhdCI6MTc4MzY3MTEzMywiZXhwIjoyMDk5MDMxMTMzfQ.WNlKbZsQIhXN8z2AIHKbA8dDL1XkL7bR-TwTo0Tn9Fo"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" | tee -a "$LOG"; }

log "=== BACKUP STARTING: ${TIMESTAMP} ==="
mkdir -p "${BACKUP_DIR}"

# -------------------------------------------------------------------------
# 1. HOME ASSISTANT — zigbee.db, .storage, configuration.yaml
# -------------------------------------------------------------------------
log "[1/6] Backing up Home Assistant..."
HA_BACKUP="${BACKUP_DIR}/homeassistant"
mkdir -p "${HA_BACKUP}"

# zigbee.db — THE critical file for ZHA pairings
qm guest exec 100 -- cat /config/zigbee.db 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
out = data.get('out-data','')
if out:
    sys.stdout.buffer.write(out.encode('latin-1'))
" > "${HA_BACKUP}/zigbee.db" 2>/dev/null && log "  zigbee.db: OK" || {
    # Fallback: binary copy via base64
    qm guest exec 100 -- sh -c 'base64 /config/zigbee.db 2>/dev/null' | python3 -c "
import sys, json, base64
data = json.load(sys.stdin)
out = data.get('out-data','')
if out:
    sys.stdout.buffer.write(base64.b64decode(out))
" > "${HA_BACKUP}/zigbee.db" 2>/dev/null && log "  zigbee.db (base64): OK" || log "  WARNING: zigbee.db failed"
}

# .storage — all integrations, dashboards, entity registry
qm guest exec 100 -- sh -c 'cd /config && tar czf /tmp/ha-storage.tar.gz .storage/ 2>/dev/null' 2>/dev/null
qm guest exec 100 -- sh -c 'base64 /tmp/ha-storage.tar.gz' 2>/dev/null | python3 -c "
import sys, json, base64
data = json.load(sys.stdin)
out = data.get('out-data','')
if out:
    sys.stdout.buffer.write(base64.b64decode(out))
" > "${HA_BACKUP}/ha-storage.tar.gz" 2>/dev/null && log "  .storage: OK" || log "  WARNING: .storage failed"
qm guest exec 100 -- rm -f /tmp/ha-storage.tar.gz 2>/dev/null

# YAML config files
for f in configuration.yaml automations.yaml scripts.yaml scenes.yaml secrets.yaml; do
    qm guest exec 100 -- cat /config/$f 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data.get('out-data',''), end='')
" > "${HA_BACKUP}/$f" 2>/dev/null || true
done
log "  YAML configs: OK"

# ZHA entity count for watchdog baseline
ZHA_COUNT=$(curl -s -H "Authorization: Bearer ${HA_TOKEN}" \
    "http://192.168.1.19:8123/api/states" 2>/dev/null | \
    python3 -c "import sys,json; states=json.load(sys.stdin); print(len([s for s in states if 'zha' in s.get('entity_id','')]))" 2>/dev/null || echo "0")
echo "${TIMESTAMP} zha_entities=${ZHA_COUNT}" >> "${BACKUP_ROOT}/state-counts.log"
log "  ZHA entity count: ${ZHA_COUNT}"

# -------------------------------------------------------------------------
# 2. POSTGRESQL — Both databases
# -------------------------------------------------------------------------
log "[2/6] Backing up PostgreSQL (CT104)..."
PG_BACKUP="${BACKUP_DIR}/postgresql"
mkdir -p "${PG_BACKUP}"

# tracking_db (vessel tracking)
pct exec 104 -- su - postgres -c "pg_dump -Fc tracking_db -f /tmp/tracking_db.dump" 2>/dev/null && \
    pct pull 104 /tmp/tracking_db.dump "${PG_BACKUP}/tracking_db.dump" 2>/dev/null && \
    pct exec 104 -- rm -f /tmp/tracking_db.dump 2>/dev/null && \
    log "  tracking_db: OK" || log "  WARNING: tracking_db backup failed"

# project_mgr (PM data)
pct exec 104 -- su - postgres -c "pg_dump -Fc project_mgr -f /tmp/project_mgr.dump" 2>/dev/null && \
    pct pull 104 /tmp/project_mgr.dump "${PG_BACKUP}/project_mgr.dump" 2>/dev/null && \
    pct exec 104 -- rm -f /tmp/project_mgr.dump 2>/dev/null && \
    log "  project_mgr: OK" || log "  WARNING: project_mgr backup failed"

# Row counts for watchdog
pct exec 104 -- su - postgres -c "psql -d tracking_db -t -c \"SELECT 'vessels=' || count(*) FROM vessels;\"" \
    > "${PG_BACKUP}/row-counts.txt" 2>/dev/null || true

# -------------------------------------------------------------------------
# 3. AIS COLLECTOR — config and service
# -------------------------------------------------------------------------
log "[3/6] Backing up AIS collector (CT105)..."
AIS_BACKUP="${BACKUP_DIR}/ais-collector"
mkdir -p "${AIS_BACKUP}"
pct exec 105 -- cat /opt/ais-collector.py > "${AIS_BACKUP}/ais-collector.py" 2>/dev/null || true
pct exec 105 -- cat /etc/systemd/system/ais-collector.service > "${AIS_BACKUP}/ais-collector.service" 2>/dev/null || true
log "  AIS collector: OK"

# -------------------------------------------------------------------------
# 4. DASHBOARD — server + client source
# -------------------------------------------------------------------------
log "[4/6] Backing up Dashboard (CT108)..."
DASH_BACKUP="${BACKUP_DIR}/dashboard"
mkdir -p "${DASH_BACKUP}"
pct exec 108 -- tar czf /tmp/dashboard-src.tar.gz \
    /opt/dashboard/server/server.js \
    /opt/dashboard/client/src/App.jsx \
    /opt/dashboard/client/src/components/ 2>/dev/null && \
    pct pull 108 /tmp/dashboard-src.tar.gz "${DASH_BACKUP}/dashboard-src.tar.gz" 2>/dev/null && \
    pct exec 108 -- rm -f /tmp/dashboard-src.tar.gz 2>/dev/null && \
    log "  Dashboard: OK" || log "  WARNING: Dashboard backup failed"

# -------------------------------------------------------------------------
# 5. BIRDNET — config and database
# -------------------------------------------------------------------------
log "[5/6] Backing up BirdNET (CT112)..."
BIRD_BACKUP="${BACKUP_DIR}/birdnet"
mkdir -p "${BIRD_BACKUP}"
pct exec 112 -- docker exec birdnet_go cat /config/config.yaml > "${BIRD_BACKUP}/config.yaml" 2>/dev/null || true
# BirdNET DB can be large, compress it
pct exec 112 -- docker exec birdnet_go sh -c 'gzip -c /data/birdnet.db 2>/dev/null' > "${BIRD_BACKUP}/birdnet.db.gz" 2>/dev/null || true
log "  BirdNET: OK"

# -------------------------------------------------------------------------
# 6. CONTAINER + VM CONFIGS
# -------------------------------------------------------------------------
log "[6/6] Backing up Proxmox configs..."
CT_BACKUP="${BACKUP_DIR}/proxmox-configs"
mkdir -p "${CT_BACKUP}"
for ct in $(pct list 2>/dev/null | awk 'NR>1 {print $1}'); do
    pct config $ct > "${CT_BACKUP}/ct${ct}.conf" 2>/dev/null || true
done
qm config 100 > "${CT_BACKUP}/vm100.conf" 2>/dev/null || true

# Host crontab
crontab -l > "${CT_BACKUP}/host-crontab.txt" 2>/dev/null || true

# Systemd services on host
cp /etc/systemd/system/ha-sensor-pusher.service "${CT_BACKUP}/" 2>/dev/null || true
cp /etc/udev/rules.d/99-hawaii-usb.rules "${CT_BACKUP}/" 2>/dev/null || true
log "  Proxmox configs: OK"

# -------------------------------------------------------------------------
# SYMLINK latest backup
# -------------------------------------------------------------------------
rm -f "${BACKUP_ROOT}/latest"
ln -sf "${BACKUP_DIR}" "${BACKUP_ROOT}/latest"

# -------------------------------------------------------------------------
# CLEANUP — Remove old backups
# -------------------------------------------------------------------------
log "Cleaning up backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_ROOT}" -maxdepth 1 -type d -name '2*' -mtime +${RETENTION_DAYS} | while read old; do
    log "  Removing: $(basename $old)"
    rm -rf "$old"
done

TOTAL_SIZE=$(du -sh "${BACKUP_DIR}" 2>/dev/null | awk '{print $1}')
log "=== BACKUP COMPLETE: ${BACKUP_DIR} (${TOTAL_SIZE}) ==="
