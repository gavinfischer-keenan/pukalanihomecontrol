<!-- doc: cameras.md | topic: Camera & NVR System | last-updated: 2026-07-23 -->

# Camera & NVR System

## Frigate NVR (CT113)
* **Deployment:** Docker on CT113 (Port 5000).
* **Hardware:** Uses Google Coral TPU for fast object detection.
* **Storage:** 32GB on igdata pool.

## Camera Registry
RTSP Port for all cameras: 8554. System supports up to 9 slots.

| Camera | Name | IP | Credentials | Detect Stream | Record Stream |
|--------|------|----|-------------|---------------|---------------|
| aqara_cam_1 | Front Garden from Roof | 192.168.1.32 | 772:885 | /1080p | /1520p |
| aqara_cam_2 | Back Deck | 192.168.1.33 | 294:698 | /1080p | /1520p |
| aqara_cam_3 | House Looking Down Front Stairs | 192.168.1.34 | 741:574 | /1080p | /1520p |
| Slots 4-9 | - | - | - | - | - |

## Integrations
* **Audio:** Camera audio streams are additionally routed to BirdNET (CT112) as RTSP audio sources.
* **Displays:** Kiosk uses direct MJPEG feeds from Frigate, Remote UI uses proxy snapshots.
* **Resolution streams:** All Aqara cameras support /1520p, /1080p, /720p, /360p suffixes.
