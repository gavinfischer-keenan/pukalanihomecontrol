<!-- doc: helper-apps.md | topic: Helper Applications | last-updated: 2026-07-23 -->

# Helper Applications

## Photo Chronologizer (CT114 — port 7777)

FastAPI backend + React frontend for organizing and browsing photos by date.

* **URL:** http://192.168.1.114:7777
* **Stack:** FastAPI (Python) backend, React frontend
* **Storage:** rclone on-demand only (no persistent sync)
* **Service:** Systemd managed, resource limited

## Utilities / PDF Tools (CT114 — port 3114)

Web-based PDF utilities.

* **URL:** http://192.168.1.114:3114
* **Features:** PDF maker, PDF shrinker
* **Stack:** Node.js

## NRSC-5 HD Radio Engine (CT114 — port 3011)

HD Radio decoder and web interface.

* **URL:** http://192.168.1.114:3011
* **Status:** Future use — no active HD Radio broadcasts in Hawaii currently
* **Migrated from:** CT111 (destroyed)

## Project Manager (CT110 — port 3001)

Project management web application.

* **URL:** http://192.168.1.110:3001
* **Stack:** Vite + Node.js (hawaii-pm)
* **Process Manager:** PM2
* **Git repo:** ProjectManagement
