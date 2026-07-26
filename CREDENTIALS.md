# Pukalani Home Control — Credentials & Secrets

> **IMPORTANT**: This file is mode 600. Do not commit to git.

## Home Assistant Long-Lived Access Tokens

### Active Tokens (as of 2026-07-24)
| Name | Created | Suffix | Used By |
|------|---------|--------|---------|
| new antigravity token | 2026-07-24 | ...aDY7aWPLAc | Antigravity sessions (may be stale) |
| Alerts long lived token (v2) | 2026-07-24 | ...VTMXjyw | /root/.ha_token → sensor pusher, backups |

### Token File
- **`/root/.ha_token`** on Proxmox host (mode 600)
- All scripts read from this file — never hardcode tokens

### Scripts Using HA Token
| Script | Location | Purpose |
|--------|----------|---------|
| ha-sensor-pusher.py | /opt/hawaii-tracker/scripts/ | Push PM + BirdNET sensors to HA (cron */5) |
| system-backup.sh | /opt/hawaii-tracker/scripts/ | System backup (cron 0 */6) |
| state-watchdog.py | /opt/hawaii-tracker/scripts/ | State-loss detection (cron */5) |

## Database Credentials

### Project Manager DB (CT104)
| Field | Value |
|-------|-------|
| Host | 192.168.1.104 |
| Port | 5432 |
| Database | project_mgr |
| User | pm_user |
| Password | pukalani_pm |
| Used by | CT110 (hawaii-pm), CT108 (server.js pmPool) |

### Tracking DB (CT104)
| Field | Value |
|-------|-------|
| Host | 192.168.1.104 |
| Port | 5432 |
| Database | tracking_db |
| User | postgres |
| Password | (trust/peer auth) |
| Used by | CT108 (server.js main pool), CT105 (ais-collector) |

## Token Rotation Log
- **2026-07-24 22:14**: "Alerts long lived token" accidentally deleted, recreated as v2
  - Old suffix: ...aDY7aWPLAc (REVOKED)
  - New suffix: ...VTMXjyw
  - Updated: /root/.ha_token
