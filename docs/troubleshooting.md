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
