# Utilities — CT114

Home automation helper tools hosted at `http://192.168.1.114:3114`.

## Tools

| Tool | URL | Description |
|------|-----|-------------|
| **PDF Maker** | `/tools/pdfmaker` | Merge images, docs & PDFs into one file |
| **PDF Shrinker** | `/tools/shrinker` | Compress an existing PDF at 4 quality levels |

## Architecture

- **Container**: CT114 (`utilities`), 192.168.1.114, Debian 13, 1 GB RAM, 8 GB disk
- **Backend**: FastAPI + uvicorn on port 3114, Python 3.13 venv at `/opt/utilities/venv`
- **Frontend**: React 18 + Vite, built to `/opt/utilities/app/static/`
- **Service**: systemd unit `utilities.service` (auto-starts on boot)
- **3D support**: pyrender + trimesh + numpy via OSMesa (headless OpenGL)

## Directory layout

```
utilities/
├── app/
│   ├── main.py              ← FastAPI app (sessions, routes, converters)
│   ├── pdf_maker/           ← Core Python PDF engine
│   │   ├── converters/      ← pdf_builder, image, text, docx, gltf, compressor
│   │   └── utils/
│   ├── tests/               ← pytest suite (76 tests)
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── pages/           ← Landing, PDFMaker, Shrinker
    │   └── components/
    ├── package.json
    └── vite.config.js
```

## Deployment

```bash
# On CT114:
cd /opt/utilities/app
/opt/utilities/venv/bin/pytest tests/ -q   # run tests
systemctl restart utilities               # restart service

# Frontend rebuild (after code changes):
cd /opt/utilities/frontend   # if source deployed there
npm run build
cp -r dist/* /opt/utilities/app/static/
systemctl restart utilities
```

## Session model

Files uploaded by the browser are stored in `/tmp/pdfmaker-sessions/{uuid}/`.
They are purged automatically after **2 hours** of inactivity. The final PDF
is streamed directly to the browser — never stored on disk beyond processing.

## HA Integration

`panel_iframe` in `configuration.yaml`:
```yaml
panel_iframe:
  utilities:
    title: "Helper Tools"
    url: "http://192.168.1.114:3114/tools/"
    icon: mdi:tools
```
