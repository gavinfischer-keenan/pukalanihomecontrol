<!-- doc: display-system.md | topic: Display & Kiosk System | last-updated: 2026-07-23 -->

# Display & Kiosk System (CT114)

## Architecture
* **display-server**: Node.js Express + Vite React app at :3000. WebSocket state sync.
* **Source code**: /opt/display-server/ on CT114.
* **Service**: corner-kiosk.service runs Chromium on HDMI-3 at 3840x2160 (--window-size=3840,2160 --window-position=0,0).

## Endpoints
* /#corner - Kiosk display logic.
* /#maintv - Future main display.
* /#remote - Remote controller for displays.

## Integrations
* **Cameras**: Kiosk uses direct MJPEG from Frigate (http://192.168.1.113:5000/api/{cam}?h=X). Remote uses proxy snapshots.
* **Vessel Map**: Iframe directly to http://192.168.1.108:8080/.
* **Layout**: Auto-detects tile size via ResizeObserver or user override (2160/1080/720/540/480/360).
* **photo-chrono**: Systemd managed background script, resource limited.
