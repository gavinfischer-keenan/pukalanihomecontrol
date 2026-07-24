<!-- doc: credentials.md | topic: Credentials & Secrets | last-updated: 2026-07-23 -->

# Credentials & Secrets

> **ROTATE BEFORE SHARING THIS DOCUMENT PUBLICLY.**

| Secret | Value | Where Used |
|--------|-------|------------|
| DB user | tracker | All CT DB connections |
| DB password | pukalani | CT105 collectors + CT108 .env |
| Camera 1 RTSP (Aqara) | 772:885 | Frigate (CT113), BirdNET (CT112) |
| Camera 2 RTSP (Aqara) | 294:698 | Frigate (CT113), BirdNET (CT112) |
| Camera 3 RTSP (Aqara) | 741:574 | Frigate (CT113), BirdNET (CT112) |
| Front Doorbell RTSP | 549:322 | Frigate (CT113), BirdNET (CT112) |
| HA Webhook Token | 5de76fbee15b641d309d042238b47326 | Ecowitt → CT108 /api/ecowitt |
| GitHub PAT | stored in ~/.git-credentials on host | Git push to repo |
