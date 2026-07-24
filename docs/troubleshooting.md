<!-- doc: troubleshooting.md | topic: Known Issues | last-updated: 2026-07-23 -->

# Troubleshooting & Known Issues

| Issue | Root Cause | Fix |
|-------|------------|-----|
| AIS not decoding | `rtl_tcp` crashed on host | `systemctl restart rtl-tcp-ais.service` on host |
| Kiosk screen black | Chromium out of memory | Restart `corner-kiosk.service` on CT114 |
| Camera feeds offline | Frigate integration failed | Check Coral TPU mapping in CT113 Docker config |
| BirdNET audio missing | USB Mic disconnected | Re-seat LavMicro-U on host, restart CT112 |
| Database connection error | CT104 offline or IP changed | Verify 192.168.1.104 is assigned, restart `tracker-engine` (CT105) |

*For more details on topology, see [network.md](network.md) and [services.md](services.md).*

## Power Failure Recovery

### Automatic (if BIOS "After Power Failure" = "Power On")
1. NUC powers on automatically after AC restored
2. Proxmox boots (~60-90s)
3. Containers start in order (CT104 first, CT110/114 last)
4. PM2 resurrects dashboard, alerts, project-mgr processes
5. Health check catches any stragglers within 5 minutes

### Manual (if NUC doesn't auto-power-on)
1. Press physical power button on NUC
2. Wait ~2-3 minutes for full boot
3. Verify: `ssh root@192.168.1.100 "pct list; qm list"`
4. If containers stopped: `pct start <id>` for each
5. Check dashboard: http://192.168.1.108:8080/

### NIC Hardware Hang
If network goes dead but NUC is running:
1. Check dmesg: `dmesg | grep "Hardware Unit Hang"`
2. Reset NIC: `ip link set nic0 down; sleep 2; ip link set nic0 up`
3. If persistent, reboot: `reboot`
4. TSO/GSO should already be disabled (check with `ethtool -k nic0 | grep tso`)
