#!/bin/bash
# ══════════════════════════════════════════════════════════════
# COLD START RECOVERY SCRIPT v2
# Run after a full power loss / DB purge to restore all services
# Location: /opt/hawaii-tracker/scripts/cold-start-recovery.sh
# ══════════════════════════════════════════════════════════════
set -e

LOG="/var/log/cold-start-recovery.log"
echo "$(date) === Cold Start Recovery BEGIN ===" | tee -a "$LOG"

# ── 1. Wait for PostgreSQL ──────────────────────────────────
echo "[1/7] Waiting for PostgreSQL..." | tee -a "$LOG"
for i in $(seq 1 30); do
  pct exec 104 -- su - postgres -c "pg_isready -q" 2>/dev/null && break
  echo "  Attempt $i/30..." | tee -a "$LOG"
  sleep 5
done

# ── 2. Fix DB permissions (tracker user needs DDL on public) ─
echo "[2/7] Fixing DB permissions..." | tee -a "$LOG"
pct exec 104 -- su - postgres -c "psql -d tracking_db -c '
  GRANT ALL ON SCHEMA public TO tracker;
  GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO tracker;
  GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO tracker;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO tracker;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO tracker;
'" 2>&1 | tee -a "$LOG"

# ── 3. Seed reference tables ────────────────────────────────
echo "[3/7] Seeding reference tables..." | tee -a "$LOG"

# PWS station (Ecowitt)
pct exec 104 -- su - postgres -c "psql -d tracking_db -c \"
INSERT INTO pws_stations (station_id, passkey, model, lat, lon, name)
VALUES ('pukalani_home', NULL, 'HP2564BU_Pro_WS90', 20.8783, -156.6825, 'Pukalani Home Weather')
ON CONFLICT (station_id) DO NOTHING;
\"" 2>&1 | tee -a "$LOG"

# Tide stations (NOAA CO-OPS Hawaii)
pct exec 104 -- su - postgres -c "psql -d tracking_db -c \"
INSERT INTO tide_stations (station_id, name, lat, lon) VALUES
  ('1615680', 'Kahului, Maui', 20.895, -156.4767),
  ('1612340', 'Honolulu, Oahu', 21.3067, -157.867),
  ('1617433', 'Kawaihae, Hawaii', 20.0367, -155.8283),
  ('1612480', 'Mokuoloe, Oahu', 21.4333, -157.79),
  ('1611400', 'Nawiliwili, Kauai', 21.9544, -159.3561),
  ('1617760', 'Hilo, Hawaii', 19.7303, -155.06)
ON CONFLICT (station_id) DO NOTHING;
\"" 2>&1 | tee -a "$LOG"

# Buoy stations (NDBC Hawaii) — column is buoy_id
pct exec 104 -- su - postgres -c "psql -d tracking_db -c \"
INSERT INTO buoy_stations (buoy_id, name, lat, lon) VALUES
  ('51001', 'NW Hawaii', 23.445, -162.279),
  ('51002', 'SW Hawaii', 17.094, -157.808),
  ('51003', 'W Hawaii', 19.228, -160.822),
  ('51004', 'SE Hawaii', 17.525, -152.382),
  ('51101', 'NW Hawaii 2', 24.361, -162.075),
  ('51201', 'Waimea Bay', 21.673, -158.116),
  ('51202', 'Mokapu Point', 21.417, -157.68),
  ('51207', 'Kaneohe Bay', 21.477, -157.752),
  ('51208', 'Hilo', 19.78, -154.97)
ON CONFLICT (buoy_id) DO NOTHING;
\"" 2>&1 | tee -a "$LOG"

# Hawaii ports — column is port_id
pct exec 104 -- su - postgres -c "psql -d tracking_db -c \"
INSERT INTO hawaii_ports (port_id, name, lat, lon) VALUES
  ('HNL', 'Honolulu Harbor', 21.3069, -157.8674),
  ('OGG', 'Kahului Harbor', 20.8950, -156.4725),
  ('KWH', 'Kawaihae Harbor', 20.0350, -155.8300),
  ('ITO', 'Hilo Harbor', 19.7300, -155.0600),
  ('NWL', 'Nawiliwili Harbor', 21.9544, -159.3561),
  ('BPT', 'Barbers Point Harbor', 21.2931, -158.1233),
  ('PAK', 'Port Allen', 21.9019, -159.5914)
ON CONFLICT (port_id) DO NOTHING;
\"" 2>&1 | tee -a "$LOG"

echo "  Seed data complete." | tee -a "$LOG"

# ── 4. Restart failed collectors on CT105 ────────────────────
echo "[4/7] Restarting CT105 collectors..." | tee -a "$LOG"
pct exec 105 -- systemctl restart avia-collector 2>&1 | tee -a "$LOG"
pct exec 105 -- systemctl restart env-collector 2>&1 | tee -a "$LOG"
sleep 3
echo "  avia-collector: $(pct exec 105 -- systemctl is-active avia-collector 2>/dev/null)" | tee -a "$LOG"
echo "  env-collector:  $(pct exec 105 -- systemctl is-active env-collector 2>/dev/null)" | tee -a "$LOG"

# ── 5. Verify HA token ──────────────────────────────────────
echo "[5/7] Verifying HA token..." | tee -a "$LOG"
TOKEN=$(cat /root/.ha_token 2>/dev/null)
if [ -z "$TOKEN" ]; then
  echo "  ⚠️  No HA token at /root/.ha_token — manual refresh needed!" | tee -a "$LOG"
else
  RESULT=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" http://192.168.1.19:8123/api/ 2>/dev/null)
  if [ "$RESULT" = "200" ]; then
    echo "  ✅ HA token valid" | tee -a "$LOG"
  else
    echo "  ❌ HA token INVALID (HTTP $RESULT) — generate new token at http://192.168.1.19:8123/profile" | tee -a "$LOG"
  fi
fi

# ── 6. Restart PM2 apps ─────────────────────────────────────
echo "[6/7] Restarting PM2 apps..." | tee -a "$LOG"
for ct in 108 109 110; do
  pct exec $ct -- pm2 restart all --update-env 2>/dev/null | tail -1
  echo "  CT$ct restarted" | tee -a "$LOG"
done

# ── 7. Restart host services ────────────────────────────────
echo "[7/7] Restarting host services..." | tee -a "$LOG"
systemctl restart ha-sensor-pusher 2>/dev/null
echo "  ha-sensor-pusher restarted" | tee -a "$LOG"

# ── Summary ─────────────────────────────────────────────────
echo "" | tee -a "$LOG"
echo "$(date) === Cold Start Recovery COMPLETE ===" | tee -a "$LOG"
echo "" | tee -a "$LOG"
echo "=== SERVICE STATUS ===" | tee -a "$LOG"
echo "CT104 PostgreSQL: $(pct exec 104 -- systemctl is-active postgresql@17-main 2>/dev/null)" | tee -a "$LOG"
echo "CT105 adsb-col:   $(pct exec 105 -- systemctl is-active adsb-collector 2>/dev/null)" | tee -a "$LOG"
echo "CT105 ais-col:    $(pct exec 105 -- systemctl is-active ais-collector 2>/dev/null)" | tee -a "$LOG"
echo "CT105 avia-col:   $(pct exec 105 -- systemctl is-active avia-collector 2>/dev/null)" | tee -a "$LOG"
echo "CT105 env-col:    $(pct exec 105 -- systemctl is-active env-collector 2>/dev/null)" | tee -a "$LOG"
echo "CT108 dashboard:  $(pct exec 108 -- pm2 pid hawaii-api 2>/dev/null | grep -c '[0-9]') process(es)" | tee -a "$LOG"
echo "CT109 alerts:     $(pct exec 109 -- pm2 pid hawaii-alerts 2>/dev/null | grep -c '[0-9]') process(es)" | tee -a "$LOG"
echo "CT110 PM:         $(pct exec 110 -- pm2 pid hawaii-pm 2>/dev/null | grep -c '[0-9]') process(es)" | tee -a "$LOG"
echo "Host pusher:      $(systemctl is-active ha-sensor-pusher 2>/dev/null)" | tee -a "$LOG"
echo "" | tee -a "$LOG"
echo "⚠️  Manual checks still needed:" | tee -a "$LOG"
echo "  - Camera IPs (run /opt/hawaii-tracker/scripts/update-camera-ips.sh if changed)" | tee -a "$LOG"
echo "  - HA token (if invalid above, regenerate at HA profile page)" | tee -a "$LOG"
