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
│   │   ├── __init__.py
│   │   ├── controller.py    ← Desktop GUI controller (shared w/ ReportPDFmaker)
│   │   ├── settings_manager.py ← Persistent settings (shared w/ desktop)
│   │   ├── converters/
│   │   │   ├── pdf_builder.py     ← Core PDF assembly & preview rendering
│   │   │   ├── pdf_compressor.py  ← PDF Shrinker engine (4 compression levels)
│   │   │   ├── image_converter.py ← Image → PDF (JPG, PNG, GIF, BMP, TIFF, WebP)
│   │   │   ├── text_converter.py  ← Plain text → PDF with ReportLab
│   │   │   ├── docx_converter.py  ← Word → PDF (docx2pdf or python-docx fallback)
│   │   │   ├── pdf_handler.py     ← PDF split/merge/error pages
│   │   │   └── gltf_converter.py  ← 3D models → rendered image → PDF
│   │   └── utils/
│   │       ├── color_utils.py     ← WCAG contrast & color utilities
│   │       └── file_utils.py      ← File type detection & dialog helpers
│   ├── tests/               ← pytest suite (235 tests)
│   │   ├── conftest.py
│   │   ├── test_api.py           ← API endpoint tests
│   │   ├── test_controller.py    ← AppController tests
│   │   ├── test_pdf_builder.py   ← PDF assembly & rendering tests
│   │   ├── test_pdf_compressor.py ← PDF Shrinker engine tests
│   │   ├── test_image_converter.py ← Image converter tests
│   │   ├── test_text_converter.py  ← Text converter tests
│   │   ├── test_pdf_handler.py    ← PDF handler tests
│   │   ├── test_docx_converter.py ← DOCX converter tests
│   │   ├── test_gltf_converter.py ← 3D converter tests
│   │   ├── test_settings_manager.py ← Settings tests
│   │   ├── test_file_utils.py    ← File utility tests
│   │   └── test_color_utils.py   ← Color utility tests
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── pages/           ← Landing, PDFMaker, Shrinker
    │   └── components/
    ├── package.json
    └── vite.config.js
```

## Converter Pipeline

```
File Upload → Extension Detection → Converter Dispatch → Single-page temp PDFs
                                                              ↓
                                         Build Request → PDF Assembly → Stream to browser
```

### Converter dispatch (`main.py::_convert_file`)

| Extension | Converter | Output |
|-----------|-----------|--------|
| `.jpg`, `.png`, `.gif`, `.bmp`, `.tiff`, `.webp` | `image_converter` | 1+ pages (animated GIF = multi) |
| `.txt` | `text_converter` | 1+ pages (multi for long text) |
| `.doc`, `.docx` | `docx_converter` | 1+ pages (Word COM or text fallback) |
| `.pdf` | `pdf_handler` | 1+ pages (split per source page) |
| `.gltf`, `.glb`, `.obj`, `.stl`, `.fbx` | `gltf_converter` | 1 page (rendered 3D snapshot) |

## PDF Shrinker — Compression Levels

| Level | DPI | JPEG Quality | Destructive | Features |
|-------|-----|-------------|-------------|----------|
| **Light** | — | — | No | Stream compression, dedup, metadata strip |
| **Standard** | 150 | 75% | No | Image resampling, font subsetting |
| **Aggressive** | 96 | 50% | Yes | Strip annotations, flatten forms |
| **Grayscale** | 120 | 65% | Yes | Convert to B&W, strip all |

## Session Model

Files uploaded by the browser are stored in `/tmp/pdfmaker-sessions/{uuid}/`.
They are purged automatically after **2 hours** of inactivity. The final PDF
is streamed directly to the browser — never stored on disk beyond processing.

## Test Coverage

| Module | Test File | Tests |
|--------|-----------|-------|
| `main.py` (API) | `test_api.py` | ✅ |
| `controller.py` | `test_controller.py` | ✅ |
| `pdf_builder.py` | `test_pdf_builder.py` | ✅ |
| `pdf_compressor.py` | `test_pdf_compressor.py` | ✅ |
| `image_converter.py` | `test_image_converter.py` | ✅ |
| `text_converter.py` | `test_text_converter.py` | ✅ |
| `pdf_handler.py` | `test_pdf_handler.py` | ✅ |
| `docx_converter.py` | `test_docx_converter.py` | ✅ |
| `gltf_converter.py` | `test_gltf_converter.py` | ✅ |
| `settings_manager.py` | `test_settings_manager.py` | ✅ |
| `file_utils.py` | `test_file_utils.py` | ✅ |
| `color_utils.py` | `test_color_utils.py` | ✅ |

**Total: 235 tests passing** (as of 2026-07-29)

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

## HA Integration

`panel_iframe` in `configuration.yaml`:
```yaml
panel_iframe:
  utilities:
    title: "Helper Tools"
    url: "http://192.168.1.114:3114/tools/"
    icon: mdi:tools
```

## Related Repositories

- **Web App**: Part of [pukalanihomecontrol](https://github.com/gavinfischer-keenan/pukalanihomecontrol) repo
- **Desktop App**: Standalone [ReportPDFmaker](https://github.com/gavinfischer-keenan/ReportPDFmaker) repo — shares the same `pdf_maker/` engine
