<!-- doc: README.md | topic: Index/Sitemap | last-updated: 2026-07-23 -->

# Pukalani Home Control - Architecture Documentation

**Purpose:** Modular, AI-friendly documentation for the Pukalani Home Control system. Each file is self-contained.

## Quick Reference
* **Location:** Pukalani, Maui, Hawaii
* **Repository:** https://github.com/gavinfischer-keenan/pukalanihomecontrol
* **Host IP:** 192.168.1.100 (Gateway: 192.168.1.1)

## Documentation Files
| File | Description |
|------|-------------|
| [hardware.md](hardware.md) | Physical hardware, Proxmox host, storage, USBs |
| [containers.md](containers.md) | Inventory of all containers and VMs |
| [services.md](services.md) | Services, roles, and open ports |
| [database.md](database.md) | PostgreSQL schema (tracking_db) |
| [display-system.md](display-system.md) | Display server and kiosk projection |
| [sdr-pipeline.md](sdr-pipeline.md) | Radio pipeline (AIS, ADS-B, NRSC-5) |
| [cameras.md](cameras.md) | Cameras, RTSP streams, Frigate NVR |
| [network.md](network.md) | Network topology, IPs, and IoT devices |
| [credentials.md](credentials.md) | Credentials, tokens, and secrets |
| [reconstruction.md](reconstruction.md) | Step-by-step rebuild playbook |
| [troubleshooting.md](troubleshooting.md) | Known issues and fixes |
| [maintenance.md](maintenance.md) | Daily maintenance, health checks, PM2 management |
| [helper-apps.md](helper-apps.md) | Helper applications (Photo Chrono, PDF tools, NRSC-5, Project Manager) |

## IP & Port Quick Reference
See [containers.md](containers.md) for IPs and [services.md](services.md) for ports.
