<!-- doc: reconstruction.md | topic: Rebuild Playbook | last-updated: 2026-07-23 -->

# Rebuild Playbook

Follow these steps sequentially to rebuild the Pukalani Home Control system. See [containers.md](containers.md) and [services.md](services.md) for topology.

1. **Assess Hardware**: Check `lsusb` and `udevadm` for USB mappings. See [hardware.md](hardware.md).
2. **Storage Pools**: Initialize `local`, `local-lvm`, and `bigdata` pools.
3. **Containers**: Create base LXC containers. **Important**: Spin up CT104 (trackerDB) first.
4. **HAOS VM**: Deploy VM100 and restore Home Assistant backup. Add Zigbee USB.
5. **PostgreSQL**: Setup `tracking_db` on CT104. See [database.md](database.md).
6. **ADS-B**: Setup CT102 `dump1090-fa` passing through the ADS-B RTL-SDR.
7. **SDR Pipeline**: Setup Host `rtl_tcp` and CT106 `AIS-Catcher`. See [sdr-pipeline.md](sdr-pipeline.md).
8. **Tracker Engine**: Deploy Python collectors on CT105.
9. **Dashboard**: Deploy UI on CT108 (Nginx/PM2).
10. **BirdNET**: Deploy Docker container on CT112. Map lav mic USB.
11. **Frigate NVR**: Deploy Docker container on CT113. See [cameras.md](cameras.md).
12. **Display System**: Setup Node/Vite on CT114 and Chromium kiosk on HDMI-3. See [display-system.md](display-system.md).
13. **Health Monitoring**: Verify system state.
