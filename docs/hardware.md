<!-- doc: hardware.md | topic: Physical Hardware | last-updated: 2026-07-23 -->

# Physical Hardware

## Proxmox Host
* **CPU:** Intel Core Ultra 5 245T (14 cores)
* **RAM:** 16GB
* **Network:** IP: 192.168.1.100 | Gateway: 192.168.1.1 | Bridge: vmbr0

## Storage Pools
| Pool | Type | Size | Notes |
|------|------|------|-------|
| `local` | dir | 68GB | Host OS / ISOs |
| `local-lvm` | thin | 148GB | Fast VM/CT storage |
| `bigdata` | thin | 927GB | External USB3 SSD (JMicron YOTUO 152d:b583) |

## USB Devices
| Device | ID | Location / Role |
|--------|----|-----------------|
| KTMicro LavMicro-U mic | `31b2:0022` | Passed to CT112 (BirdNET) |
| Sonoff Zigbee dongle | `10c4:ea60` | Passed to VM100 (HAOS) port 1-7.4 (Serial: 22571d3d0d91f011ab54786236f0e4ad) |
| RTL-SDR Blog V4 | `0bda:2838` | AIS (Serial 00000001) - Host attached |
| RTL2838 | `0bda:2838` | ADS-B - Passed to CT102 |
| JMicron SSD | `152d:b583` | `bigdata` pool |

*Note: Udev rules are used for disambiguation.*

## HDMI Outputs
| Port | Status | Usage |
|------|--------|-------|
| HDMI-1 | Unused | - |
| HDMI-2 | Planned | Main TV |
| HDMI-3 | Active | Corner monitor (1920x1080 kiosk) |
