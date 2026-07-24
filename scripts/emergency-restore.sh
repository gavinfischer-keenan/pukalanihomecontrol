#!/bin/bash
# =============================================================================
# emergency-restore.sh — Restore critical state from backup
# Usage: emergency-restore.sh [backup_dir] [component]
# 
# Components: zha, ha-full, postgresql, ais, dashboard, birdnet, all
# If no backup_dir specified, uses /opt/backups/latest
# =============================================================================

set -uo pipefail

BACKUP_DIR="${1:-/opt/backups/latest}"
COMPONENT="${2:-}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[RESTORE]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
err() { echo -e "${RED}[ERROR]${NC} $1"; }

if [ ! -d "$BACKUP_DIR" ]; then
    err "Backup directory not found: $BACKUP_DIR"
    echo "Available backups:"
    ls -1d /opt/backups/2* 2>/dev/null | sort -r | head -10
    exit 1
fi

echo "============================================"
echo " EMERGENCY RESTORE"
echo " Backup: $(readlink -f $BACKUP_DIR)"
echo " Component: ${COMPONENT:-interactive}"
echo "============================================"

if [ -z "$COMPONENT" ]; then
    echo ""
    echo "Available components:"
    echo "  1) zha         - Zigbee pairings (zigbee.db)"
    echo "  2) ha-full     - Full HA config (.storage + YAML)"
    echo "  3) postgresql  - Both databases"
    echo "  4) ais         - AIS collector script"
    echo "  5) dashboard   - Dashboard source code"
    echo "  6) birdnet     - BirdNET config + database"
    echo "  7) all         - Everything (DANGEROUS)"
    echo ""
    read -p "Select component (1-7): " choice
    case $choice in
        1) COMPONENT="zha" ;;
        2) COMPONENT="ha-full" ;;
        3) COMPONENT="postgresql" ;;
        4) COMPONENT="ais" ;;
        5) COMPONENT="dashboard" ;;
        6) COMPONENT="birdnet" ;;
        7) COMPONENT="all" ;;
        *) err "Invalid choice"; exit 1 ;;
    esac
fi

restore_zha() {
    log "Restoring ZHA (Zigbee pairings)..."
    if [ ! -f "$BACKUP_DIR/homeassistant/zigbee.db" ]; then
        err "zigbee.db not found in backup!"
        return 1
    fi
    
    warn "This will REPLACE the current Zigbee network with the backup."
    warn "All devices paired AFTER this backup was taken will be lost."
    read -p "Continue? (yes/no): " confirm
    [ "$confirm" != "yes" ] && { log "Aborted."; return 0; }
    
    log "Stopping HA core..."
    qm guest exec 100 -- ha core stop 2>/dev/null
    sleep 5
    
    log "Copying zigbee.db..."
    cat "$BACKUP_DIR/homeassistant/zigbee.db" | qm guest exec 100 -- sh -c 'cat > /config/zigbee.db' 2>/dev/null
    
    log "Starting HA core..."
    qm guest exec 100 -- ha core start 2>/dev/null
    sleep 10
    
    log "ZHA restore complete. Devices should rejoin within 2-5 minutes."
}

restore_ha_full() {
    log "Restoring full HA config..."
    if [ ! -f "$BACKUP_DIR/homeassistant/ha-storage.tar.gz" ]; then
        err "ha-storage.tar.gz not found in backup!"
        return 1
    fi
    
    warn "This will REPLACE all HA integrations, dashboards, and entity configs."
    warn "Any changes made after this backup will be lost."
    read -p "Continue? (yes/no): " confirm
    [ "$confirm" != "yes" ] && { log "Aborted."; return 0; }
    
    log "Stopping HA core..."
    qm guest exec 100 -- ha core stop 2>/dev/null
    sleep 5
    
    log "Backing up current .storage as .storage.pre-restore..."
    qm guest exec 100 -- sh -c 'cp -a /config/.storage /config/.storage.pre-restore' 2>/dev/null
    
    log "Restoring .storage..."
    cat "$BACKUP_DIR/homeassistant/ha-storage.tar.gz" | qm guest exec 100 -- sh -c 'cd /config && tar xzf -' 2>/dev/null
    
    # Restore YAML files
    for f in configuration.yaml automations.yaml scripts.yaml scenes.yaml; do
        if [ -f "$BACKUP_DIR/homeassistant/$f" ]; then
            cat "$BACKUP_DIR/homeassistant/$f" | qm guest exec 100 -- sh -c "cat > /config/$f" 2>/dev/null
        fi
    done
    
    log "Starting HA core..."
    qm guest exec 100 -- ha core start 2>/dev/null
    sleep 10
    
    log "Full HA restore complete."
}

restore_postgresql() {
    log "Restoring PostgreSQL databases..."
    
    for db_file in tracking_db.dump project_mgr.dump; do
        if [ -f "$BACKUP_DIR/postgresql/$db_file" ]; then
            db_name="${db_file%.dump}"
            warn "Restoring $db_name..."
            read -p "Continue with $db_name? (yes/no): " confirm
            [ "$confirm" != "yes" ] && continue
            
            pct push 104 "$BACKUP_DIR/postgresql/$db_file" "/tmp/$db_file" 2>/dev/null
            pct exec 104 -- su - postgres -c "pg_restore --clean --if-exists -d $db_name /tmp/$db_file" 2>/dev/null
            pct exec 104 -- rm -f "/tmp/$db_file" 2>/dev/null
            log "  $db_name: restored"
        fi
    done
}

restore_ais() {
    log "Restoring AIS collector..."
    if [ -f "$BACKUP_DIR/ais-collector/ais-collector.py" ]; then
        pct exec 105 -- cp /opt/ais-collector.py /opt/ais-collector.py.pre-restore 2>/dev/null
        pct push 105 "$BACKUP_DIR/ais-collector/ais-collector.py" /opt/ais-collector.py 2>/dev/null
        pct exec 105 -- systemctl restart ais-collector 2>/dev/null
        log "  AIS collector restored and restarted"
    fi
}

restore_dashboard() {
    log "Restoring Dashboard..."
    if [ -f "$BACKUP_DIR/dashboard/dashboard-src.tar.gz" ]; then
        pct push 108 "$BACKUP_DIR/dashboard/dashboard-src.tar.gz" /tmp/dashboard-src.tar.gz 2>/dev/null
        pct exec 108 -- sh -c 'cd / && tar xzf /tmp/dashboard-src.tar.gz' 2>/dev/null
        pct exec 108 -- sh -c 'cd /opt/dashboard/client && npm run build' 2>/dev/null
        pct exec 108 -- pm2 restart all 2>/dev/null
        log "  Dashboard restored, rebuilt, and restarted"
    fi
}

restore_birdnet() {
    log "Restoring BirdNET..."
    if [ -f "$BACKUP_DIR/birdnet/config.yaml" ]; then
        pct exec 112 -- docker exec birdnet_go sh -c 'cat > /config/config.yaml' < "$BACKUP_DIR/birdnet/config.yaml" 2>/dev/null
        pct exec 112 -- docker restart birdnet_go 2>/dev/null
        log "  BirdNET config restored and restarted"
    fi
}

case "$COMPONENT" in
    zha) restore_zha ;;
    ha-full) restore_ha_full ;;
    postgresql) restore_postgresql ;;
    ais) restore_ais ;;
    dashboard) restore_dashboard ;;
    birdnet) restore_birdnet ;;
    all)
        restore_zha
        restore_ha_full
        restore_postgresql
        restore_ais
        restore_dashboard
        restore_birdnet
        ;;
    *) err "Unknown component: $COMPONENT" ;;
esac

echo ""
log "Restore operation complete."
