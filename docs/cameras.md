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
| `front_garden_cam` (cam 1) | Front Garden from Roof | 192.168.1.7 | `18:C2:3C:5A:A8:C2` | 772:885 | `/1080p` | `/1520p` |
| `back_deck_cam` (cam 2) | Back Deck | 192.168.1.9 | `18:C2:3C:5A:AA:E9` | 294:698 | `/1080p` | `/1520p` |
| `front_stairs_cam` (cam 3) | Front Stairs | 192.168.1.8 | `18:C2:3C:5A:BD:AE` | 741:574 | `/1080p` | `/1520p` |
| `front_doorbell_cam` (cam 4) | Front Doorbell | 192.168.1.4 | `18:C2:3C:7A:03:00` | 549:322 | `/ch2` (960p) | `/ch1` (1536p) |
| `garage_cam` (cam 5) | Garage | 192.168.1.22 | UNKNOWN | 737:796 | `/ch2` | `/ch1` |
| `aqara_cam_6` (roof_view) | Roof View (Diamond Head) | 192.168.1.30 | `18:C2:3C:7A:E9:DB` | 646:145 | `/ch2` (1080p) | `/ch1` (1520p) |
| Slots 7-9 | Reserved | - | - | - | - | - |

> [!WARNING]
> Camera IPs shift after power outages due to DHCP. Update `/opt/hawaii-tracker/camera-registry.json` and run `/opt/hawaii-tracker/scripts/update-camera-ips.sh`.

## Stream Resolution Reference
* **Aqara cameras:** `/1520p` (ch1), `/1080p` (ch2), `/720p` (ch3), `/360p` (ch4)
* **Front Doorbell:** `/ch1` (1536p), `/ch2` (960p), `/ch3` (480p)

## Integrations
* **Audio:** Camera audio streams are routed to BirdNET-Go (CT112) as RTSP audio sources.
* **Kiosk Displays:** CT114 display server proxies Frigate/go2rtc feeds and hosts camera views.
* **Diamond Head Timelapse:** CT114 `roofcam` service captures snapshots from `aqara_cam_6` (`192.168.1.30:8554/ch1`).
