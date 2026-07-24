<!-- doc: credentials.md | topic: Credentials & Secrets | last-updated: 2026-07-23 -->

# Credentials & Secrets

> [!WARNING]
> ROTATE ALL SECRETS BEFORE SHARING REPOSITORY OUTSIDE LOCAL NETWORK.

| Service | Location | Username | Password/Token |
|---------|----------|----------|----------------|
| PostgreSQL | CT104:5432 | `tracker` | `pukalani` |
| Camera 1 RTSP | 192.168.1.32 | `772` | `885` |
| Camera 2 RTSP | 192.168.1.33 | `294` | `698` |
| HA Webhook | VM100 | - | `5de76fbee15b641d309d042238b47326` |
| GitHub PAT | Host `~/.git-credentials` | - | *Stored on host* |

See [services.md](services.md) for service contexts.
