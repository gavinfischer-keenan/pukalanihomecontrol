<!-- doc: network.md | topic: Network Map | last-updated: 2026-07-23 -->

# Network Map

* **LAN Subnet**: `192.168.1.0/24`
* **Gateway**: `192.168.1.1`
* **Bridge**: All containers use `vmbr0`
* **External Access**: None (All local, no port forwarding). GitHub push enabled.

## Container IP Assignments
See [containers.md](containers.md) for full CT IP list.

## IoT Devices
| Device | IP | Role |
|--------|----|------|
| Aqara Camera 1 | 192.168.1.32 | Surveillance & Audio |
| Aqara Camera 2 | 192.168.1.33 | Surveillance & Audio |
| Ecowitt GW2000 | DHCP | Personal Weather Station (to HA) |
| Enphase Envoy | DHCP | Solar monitoring (to HA) |
