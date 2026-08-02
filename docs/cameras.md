<!-- doc: cameras.md | topic: Camera & NVR System | last-updated: 2026-07-31 -->

# Camera & NVR System

## Frigate NVR (CT113)
* **Deployment:** Docker on CT113 (Port 5000, go2rtc Port 1984).
* **Hardware:** Uses Google Coral TPU for fast object detection.
* **Storage:** 32GB on `bigdata` pool.

## Central Camera Registry
System supports up to 9 slots. Central config lives at `/opt/hawaii-tracker/camera-registry.json`.
All Aqara cameras use RTSP on port `8554`.

| Camera ID | Name | IP | MAC | RTSP Creds | Detect Stream | Record Stream |
|-----------|------|----|-----|------------|---------------|---------------|
| `front_garden_cam` (cam 1) | Front Garden from Roof | 192.168.1.213 | `18:C2:3C:5A:A8:C2` | 772:885 | `/1080p` | `/1520p` |
| `back_deck_cam` (cam 2) | Back Deck | 192.168.1.143 | `18:C2:3C:5A:AA:E9` | 294:698 | `/1080p` | `/1520p` |
| `front_stairs_cam` (cam 3) | Front Stairs | 192.168.1.187 | `18:C2:3C:5A:BD:AE` | 741:574 | `/1080p` | `/1520p` |
| `front_doorbell_cam` (cam 4) | Front Doorbell | 192.168.1.141 | `18:C2:3C:7A:03:00` | 549:322 | `/ch2` (960p) | `/ch1` (1536p) |
| `garage_cam` (cam 5) | Garage | 192.168.1.80 | UNKNOWN | 737:796 | `/ch2` | `/ch1` |
| `aqara_cam_6` (roof_view) | Roof View (Diamond Head) | 192.168.1.222 | `18:C2:3C:7A:E9:DB` | 646:145 | `/ch2` (1080p) | `/ch1` (1536p) |
| Slots 7-9 | Reserved | - | - | - | - | - |

## Stream Resolution Reference
* **Aqara cameras:** `/ch1` (1520p / 1536p), `/ch2` (1080p), `/ch3` (720p), `/ch4` (360p)
* **Front Doorbell:** `/ch1` (1536p), `/ch2` (960p), `/ch3` (480p)

## Integrations
* **Audio:** Camera audio streams are routed to BirdNET-Go (CT112) as RTSP audio sources.
* **Kiosk Displays:** CT114 display server proxies Frigate/go2rtc feeds and hosts camera views.
* **Diamond Head All-Time Timelapse:** CT114 `roofcam` persistent capture daemon captures snapshots from `aqara_cam_6` (`192.168.1.222:8554/ch1`).
  - **Schedule:** Every 15 mins normally; sub-minute precision during golden hour (default `0.5` min = once every 30s).
  - **Player UI:** Full-sequence all-time movie player at `http://192.168.1.114:7780` and `http://192.168.1.114:3000/proxy/roofcam/`.
