# Photo Chronologizer Desktop — Architecture & Deployment Guide

> **Purpose:** AI-powered photo chronologizer that scans a folder of photos, identifies a specific person
> across all ages using face recognition (InsightFace), estimates their age in each photo, and orders
> the collection chronologically — birth to present.
>
> **Repository:** https://github.com/gavinfischer-keenan/PicFolderChronologizer
> **Last updated:** 2026-08-01
> **Version:** 3.0 — Desktop-First Architecture

---

## 1. Overview

### What It Does
1. User creates a **session** — names it, identifies the subject (name, birth year)
2. User provides a **local folder** of photos from their Windows machine
3. User **enrolls 3–5 seed faces** of the subject at known ages
4. AI **processes all photos** — finds the subject in each, estimates their age, assigns approximate dates
5. User **reviews uncertain matches** — confirms/rejects AI picks, assigns date hints
6. Photos are **exported** in chronological order with standardized filenames
7. **Reload & refine** — import a prior session's portable DB to improve results with new data

### Key Features
- **Desktop-first** — runs locally on Gavin's Windows machine, no iframe issues
- **InsightFace face recognition** — `buffalo_sc` model via CT114 ML API
- **Age estimation** — AI estimates subject's age in each photo → derives year
- **Single-face auto-match** — solo portraits automatically matched with lower threshold
- **No-face photo handling** — back-of-head / obscured photos get manual date assignment
- **Portable SQLite sidecar** — `.photo-chrono.db` travels with the output folder for reload
- **Session reload** — auto-detects prior run output, reconciles added/deleted photos
- **Real-time progress** — SSE streaming during processing

### Removed in v3.0
- ~~Google Drive / rclone integration~~ — all local now
- ~~Bridge agent~~ — no network transfer needed
- ~~HA iframe integration~~ — runs directly in local browser
- ~~Server-side photo storage~~ — photos stay on local machine

---

## 2. System Architecture

```
┌─────────────────────────────────────────┐        ┌──────────────────────────┐
│  Windows Desktop (Gavin's machine)      │        │  CT114 (ML Engine Only)  │
│                                         │        │                          │
│  photo-chrono-desktop/                  │        │  /app/photo-chrono-ml/   │
│  ├── backend/                           │  HTTP  │  ├── ml_api.py (FastAPI) │
│  │   ├── main.py (FastAPI, localhost)   │───────▶│  ├── pipeline.py         │
│  │   ├── db.py (SQLite)                │◀───────│  └── InsightFace/ONNX    │
│  │   ├── pipeline_client.py (→ CT114)  │        │                          │
│  │   └── portable_db.py                │        │  Port 7778               │
│  ├── frontend/dist/ (pre-built React)  │        │  Stateless — no DB,      │
│  ├── data/                             │        │  no storage, no sessions │
│  │   └── session.db                    │        └──────────────────────────┘
│  ├── requirements.txt                  │
│  └── launch.bat                        │
│                                         │
│  localhost:7777 → browser auto-opens    │
│  Reads from: C:\Users\gavin\Downloads\  │
│  Writes to:  C:\Users\gavin\Downloads\  │
└─────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Location | Role |
|-----------|----------|------|
| FastAPI Backend | Windows localhost:7777 | Session management, photo serving, review, export |
| React SPA | Pre-built dist/ served by FastAPI | All UI — enrollment, processing, review, export |
| SQLite DB | `data/session.db` | Sessions, photo metadata, embeddings |
| pipeline_client.py | Windows | HTTP client calling CT114 ML API for face detection |
| ML API | CT114:7778 | Stateless InsightFace face detection/embedding |
| Portable DB | `.photo-chrono.db` in output folder | Metadata sidecar for reload/refine |

---

## 3. ML API (CT114)

Stateless FastAPI server on port 7778. Accepts image uploads, returns face detection results.

### Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/detect` | Accept image → return face detections + embeddings |
| POST | `/thumbnail` | Accept image → return JPEG thumbnail |
| POST | `/face-crop` | Accept image + bbox → return cropped JPEG |
| POST | `/match` | Accept image + reference embedding → return match status |

### Systemd Service
- Unit: `/etc/systemd/system/photo-chrono-ml.service`
- Uses existing venv at `/app/photo-chrono/venv`
- Model: `buffalo_sc` (InsightFace)

---

## 4. Local Desktop Backend

### Key Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/system-info` | Returns Downloads path, OS, version |
| GET | `/api/browse-folder?path=...` | Browse local folders |
| GET | `/api/open-folder?path=...` | Open folder in File Explorer |
| POST | `/api/sessions` | Create new session |
| POST | `/api/sessions/{sid}/scan` | Scan local folder for photos |
| POST | `/api/sessions/{sid}/enroll` | Enroll a face for matching |
| POST | `/api/sessions/{sid}/start` | Start AI processing |
| GET | `/api/sessions/{sid}/progress` | SSE progress stream |
| GET | `/api/sessions/{sid}/review` | Get uncertain/no-face photos |
| POST | `/api/sessions/{sid}/export` | Export chronologically named photos |
| POST | `/api/sessions/reload-portable` | Reload session from portable DB |

### Session Reload Workflow
1. Point at a folder containing `.photo-chrono.db` from a prior export
2. Backend reads portable DB, matches photos against current folder contents
3. Photos still present keep their metadata (age, year, validation status)
4. Deleted photos are removed from tracking
5. New photos are added as 'pending' for processing
6. Reference face embeddings from prior session are imported

---

## 5. Deployment

### Windows Desktop
```batch
# First run:
cd C:\Users\gavin\Downloads\photo-chrono-desktop
launch.bat
# → Creates venv, installs deps, starts server, opens browser

# Subsequent runs:
launch.bat
# → Starts server (venv already exists), opens browser
```

### CT114 ML API
```bash
systemctl status photo-chrono-ml    # Check status
systemctl restart photo-chrono-ml   # Restart if needed
journalctl -u photo-chrono-ml -f    # View logs
```

---

## 6. Filename Convention

Output filenames follow the pattern: `AGE_YEAR_ORIGINAL.ext`

- `025_~1992_photo.jpg` → Age 25, AI-estimated year 1992
- `025_=1992_photo.jpg` → Age 25, user-confirmed year 1992
- `AGE_no-date_photo.jpg` → Age unknown

Alphabetical sort = chronological order in any file browser.

---

## 7. Dependencies

### Local (Windows)
- Python 3.14+
- fastapi, uvicorn, Pillow, numpy, httpx, aiofiles, python-multipart

### CT114 ML API
- Python 3.x (existing venv)
- insightface, onnxruntime, opencv-python-headless, fastapi, uvicorn
