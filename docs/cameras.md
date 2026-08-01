<!-- doc: cameras.md | topic: Camera & NVR System | last-updated: 2026-07-23 -->

# Camera & NVR System

## Frigate NVR (CT113)
* **Deployment:** Docker on CT113 (Port 5000).
* **Hardware:** Uses Google Coral TPU for fast object detection.
* **Storage:** 32GB on `bigdata` pool.

## Camera Registry
System supports up to 9 slots. All cameras use RTSP on port `8554`.

| Camera | Name | IP | Credentials | Detect Stream | Record Stream | Type |
|--------|------|----|-------------|---------------|---------------|------|
| aqara_cam_1 | Front Garden from Roof | 192.168.1.32 | 772:885 | `/1080p` | `/1520p` | Aqara |
| aqara_cam_2 | Back Deck | 192.168.1.33 | 294:698 | `/1080p` | `/1520p` | Aqara |
| aqara_cam_3 | House Looking Down Front Stairs | 192.168.1.34 | 741:574 | `/1080p` | `/1520p` | Aqara |
| front_doorbell | Front Doorbell | 192.168.1.35 | 549:322 | `/ch2` (960p) | `/ch1` (1536p) | Doorbell |
| garage_cam | Garage | 192.168.1.22 | 737:796 | `/ch2` | `/ch1` | Aqara |
| aqara_cam_6 | Roof View | 192.168.1.30 | 646:145 | `/ch2` (1080p) | `/ch1` (1520p) | Aqara |
| Slots 7-9 | - | - | - | - | - | - |

### Stream Resolution Reference
* **Aqara cameras:** `/1520p`, `/1080p`, `/720p`, `/360p`
* **Front Doorbell:** `/ch1` (1536p), `/ch2` (960p), `/ch3` (480p)

## Integrations
* **Audio:** Camera audio streams are additionally routed to BirdNET (CT112) as RTSP audio sources.
* **Displays:** Kiosk uses direct MJPEG feeds from Frigate, Remote UI uses proxy snapshots.
