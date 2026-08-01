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

## BIOS Settings (Intel NUC)

### After Power Failure → Power On
**CRITICAL**: Must be set for automatic recovery from power outages.
- Press **F2** during POST → **Power** → **Secondary Power Settings**
- Set "After Power Failure" to **"Power On"**

### Hardware Watchdog
- iTCO watchdog enabled via systemd
- `RuntimeWatchdogSec=30` — reboots on 30s kernel hang
- `RebootWatchdogSec=10min` — reboot timeout limit

### NIC Stability (e1000e)
- Intel I225 NIC can experience "Hardware Unit Hang"
- TSO/GSO disabled: `ethtool -K nic0 tso off gso off`
- Persisted in `/etc/network/interfaces` as `post-up` command

### USB SSD
- SMART monitoring available via `smartctl -a /dev/sda`
- Weekly short self-test recommended: `smartctl -t short /dev/sda`


## Aqara Camera 6 (Roof View)
* **IP:** 192.168.1.30:8554
* **Credentials:** 646:145
* **Streams:** /ch1 (1520p), /ch2 (1080p), /ch3 (720p), /ch4 (360p)
* **Status:** Registered, active
