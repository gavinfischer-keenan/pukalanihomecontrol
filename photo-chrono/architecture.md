# PicFolderChronologizer — Architecture & Deployment Guide

> **Purpose:** AI-powered photo chronologizer that scans a folder of photos, identifies a specific person
> across all ages using face recognition (InsightFace), estimates their age in each photo, and orders
> the collection chronologically — birth to present.
>
> **Repository:** https://github.com/gavinfischer-keenan/PicFolderChronologizer
> **Last updated:** 2026-07-23

---

## 1. Overview

### What It Does
1. User creates a **session** — names it, identifies the subject (name, birth year)
2. User provides a **source folder** of photos (Google Drive via rclone, local path, or remote bridge)
3. User **enrolls 3–5 seed faces** of the subject at known ages
4. AI **processes all photos** — finds the subject in each, estimates their age, assigns approximate dates
5. User **reviews uncertain matches** — confirms/rejects AI picks, assigns date hints
6. Photos are **exported** in chronological order with standardized filenames

### Key Features
- **InsightFace face recognition** — `buffalo_sc` model, CPU-based
- **Age estimation** — AI estimates subject's age in each photo → derives year
- **Single-face auto-match** — solo portraits automatically matched with lower threshold
- **No-face photo handling** — back-of-head / obscured photos get manual date assignment
- **Face bounding boxes** — visual overlay shows which face AI detected
- **Rescan capability** — re-run face detection if boxes are wrong
- **Portable SQLite sidecar** — `.photo-chrono.db` travels with the output folder
- **Bridge agent** — Windows bridge for scanning local folders remotely
- **Real-time progress** — SSE streaming during processing

---

## 2. System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Proxmox Host (192.168.1.100)               │
│                                                               │
│  ┌─ CT114 (Utilities LXC) ──────────────────────────────────┐ │
│  │                                                           │ │
│  │  ┌─────────────────┐   ┌──────────────────┐              │ │
│  │  │  FastAPI Backend │   │  Vite React SPA  │              │ │
│  │  │  (uvicorn:7777)  │   │  (static served) │              │ │
│  │  │                  │   │                   │              │ │
│  │  │  main.py         │   │  App.jsx          │              │ │
│  │  │  pipeline.py     │   │  Review.jsx       │              │ │
│  │  │  db.py           │   │  Processing.jsx   │              │ │
│  │  │  portable_db.py  │   │  Enrollment.jsx   │              │ │
│  │  └────────┬─────────┘   └──────────────────┘              │ │
│  │           │                                                │ │
│  │  ┌────────┴─────────┐   ┌──────────────────┐              │ │
│  │  │  SQLite DB        │   │  InsightFace      │              │ │
│  │  │  session.db       │   │  buffalo_sc model │              │ │
│  │  │  (backend/        │   │  ~/.insightface/   │              │ │
│  │  │   session.db)     │   │  CPU inference     │              │ │
│  │  └──────────────────┘   └──────────────────┘              │ │
│  │                                                           │ │
│  │  Source photos: /mnt/gdrive/... (rclone mount)            │ │
│  │  Output: /mnt/gdrive/.../output/ + .photo-chrono.db       │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─ VM100 (Home Assistant) ─────────────────────────────────┐ │
│  │  panel_iframe: http://192.168.1.114:7777                  │ │
│  │  Accessed via: http://192.168.1.19:8123/command-center    │ │
│  └───────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────┐
│  Windows Client (optional)          │
│  photo_chrono_bridge.py             │
│  Serves local photos over HTTP      │
│  for remote processing              │
└─────────────────────────────────────┘
```

---

## 3. Technology Stack

| Layer | Technology | Version/Notes |
|-------|-----------|---------------|
| **Backend** | Python 3.13 + FastAPI | uvicorn, single worker |
| **Face AI** | InsightFace | `buffalo_sc` model, ONNX Runtime CPU |
| **Database** | SQLite 3 | `session.db` (server), `.photo-chrono.db` (portable) |
| **Frontend** | React 19 + Vite 6 | SPA, no framework |
| **Styling** | Vanilla CSS | Dark theme, glassmorphism, CSS variables |
| **Photo Source** | rclone (Google Drive) | FUSE mount at `/mnt/gdrive/` |
| **Hosting** | Proxmox LXC (CT114) | Debian, 4GB RAM, shared with other utilities |
| **Access** | Home Assistant panel_iframe | Via HA proxy at port 8123 |

---

## 4. File Structure

```
/app/photo-chrono/
├── backend/
│   ├── main.py              # FastAPI app — all API routes, SSE, processing orchestration
│   ├── pipeline.py          # InsightFace wrapper — detect_faces, match_photo, embeddings
│   ├── db.py                # SQLite ORM — sessions, photos, embeddings, migrations
│   ├── portable_db.py       # Portable .photo-chrono.db sidecar — cross-run persistence
│   ├── requirements.txt     # Python dependencies
│   └── session.db           # Main SQLite database (auto-created)
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # Main app — routing, session management, SessionCard
│   │   ├── App.css          # Global styles — dark theme, components, animations
│   │   ├── main.jsx         # React entry point
│   │   ├── utils.js         # Shared utilities
│   │   └── components/
│   │       ├── SessionSetup.jsx    # Phase 1: Create session, pick source
│   │       ├── Enrollment.jsx      # Phase 2: Enroll seed faces
│   │       ├── FaceConfirmModal.jsx # Face selection modal for enrollment
│   │       ├── Processing.jsx      # Phase 3: AI processing with SSE progress
│   │       ├── Review.jsx          # Phase 4: Tabbed review (uncertain + no-face)
│   │       ├── Export.jsx          # Phase 5: Export chronological output
│   │       ├── StripViewer.jsx     # Horizontal filmstrip viewer
│   │       ├── Filmstrip.jsx       # Read-only filmstrip (Phase 5+)
│   │       ├── BridgeConnect.jsx   # Bridge agent connection UI
│   │       ├── FolderBrowser.jsx   # Remote folder browser
│   │       └── WelcomeSetup.jsx    # First-run rclone setup guide
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── bridge/
│   ├── photo_chrono_bridge.py  # Windows bridge agent (local file server)
│   ├── build.bat               # PyInstaller build script
│   └── requirements.txt
├── photo-chrono.service        # systemd unit file
└── architecture.md             # This file
```

---

## 5. Database Schema

### `sessions` table
| Column | Type | Purpose |
|--------|------|---------|
| id | TEXT PK | 8-char UUID |
| name | TEXT | Session display name |
| subject_name | TEXT | Person being tracked |
| subject_sex | TEXT | M/F/unknown |
| birth_year/month/day | INT | Subject's birthdate |
| source_path | TEXT | Photo source directory |
| output_path | TEXT | Export output directory |
| status | TEXT | setup → enrolling → processing → reviewing → done |
| total_photos | INT | Count of source photos |
| processed_photos | INT | Photos scanned so far |
| matched_photos | INT | Definite matches |
| uncertain_photos | INT | Needs human review |
| sim_match | REAL | Similarity threshold for match (default 0.45) |
| sim_uncertain | REAL | Similarity threshold for uncertain (default 0.35) |
| model_name | TEXT | InsightFace model (default buffalo_sc) |

### `photo_files` table
| Column | Type | Purpose |
|--------|------|---------|
| id | TEXT PK | Hash-based unique ID |
| session_id | TEXT FK | Links to session |
| file_path | TEXT | Absolute path to source photo |
| rel_path | TEXT | Relative path within source folder |
| status | TEXT | pending → processed |
| match_status | TEXT | matched / uncertain / no_match |
| match_score | REAL | Cosine similarity to reference (0–1) |
| matched_face_idx | INT | Which face in the image was matched |
| face_count | INT | Number of faces detected |
| estimated_age | INT | AI-estimated age of subject |
| estimated_year | INT | birth_year + estimated_age |
| date_hint_year/month | INT | User-provided date hint |
| date_hint_approx | INT | Whether date is approximate |
| date_locked | BOOL | User confirmed this date |
| age_override | INT | User-corrected age |
| user_confirmed | TEXT | yes / no / no_face |
| validated | BOOL | User validated in strip viewer |
| faces_cache | TEXT | JSON cache of face detection results |

### `embeddings` table
| Column | Type | Purpose |
|--------|------|---------|
| id | INT PK | Auto-increment |
| session_id | TEXT | Links to session |
| photo_id | TEXT | Source photo |
| face_idx | INT | Face index in photo |
| embedding | BLOB | 512-dim face embedding vector |
| age | REAL | Age when enrolled |
| is_anchor | BOOL | User-verified anchor point |

---

## 6. API Endpoints

### Sessions
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/sessions` | List all sessions |
| POST | `/api/sessions` | Create new session |
| GET | `/api/sessions/{sid}` | Get session details |
| DELETE | `/api/sessions/{sid}` | Delete session |
| PUT | `/api/sessions/{sid}/config` | Update session config |

### Photos & Faces
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/photo/{sid}/{pid}` | Serve photo (with ?size, ?crop, ?bbox params) |
| GET | `/api/faces/{sid}/{pid}` | Get face detection results (cached) |
| POST | `/api/faces/{sid}/{pid}/rescan` | Clear cache, re-detect faces |

### Enrollment
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/sessions/{sid}/enroll` | Enroll a face as reference |
| GET | `/api/sessions/{sid}/detect` | Detect faces for enrollment |

### Processing
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/sessions/{sid}/start` | Start AI processing |
| GET | `/api/sessions/{sid}/progress` | SSE stream for real-time progress |

### Review
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/sessions/{sid}/review` | Get review queue (uncertain + no_face categories) |
| POST | `/api/sessions/{sid}/review` | Submit review decision |

### Strip Viewer
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/sessions/{sid}/strip` | Get chronological photo strip |

### Bridge (optional)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/bridge-photo` | Proxy photo from bridge agent |
| POST | `/api/sessions/{sid}/scan-bridge` | Scan bridge for photos |

---

## 7. Processing Pipeline

```
1. User enrolls 3-5 seed faces → embeddings stored in DB
2. Reference vector = mean of all enrolled embeddings
3. For each photo in source folder:
   a. InsightFace detect_faces() → list of {bbox, age, embedding, score}
   b. For each face: cosine_similarity(face_embedding, reference)
   c. Best match score determines status:
      - score ≥ sim_match (0.45) → "matched"
      - score ≥ sim_uncertain (0.35) → "uncertain"
      - score < sim_uncertain → "no_match"
      - Special: single-face photo + score ≥ 0.15 → auto "matched"
   d. Estimated year = birth_year + estimated_age
4. Processing runs in ThreadPoolExecutor (batch_size=4)
5. Progress streamed via SSE to frontend
6. On completion: status → "reviewing"
```

---

## 8. Deployment

### Prerequisites
- Proxmox LXC with Python 3.11+ and Node.js 18+
- rclone configured for Google Drive (optional)
- ~700MB RAM for InsightFace model

### Install
```bash
# Backend
cd /app/photo-chrono/backend
python3 -m venv ../venv
source ../venv/bin/activate
pip install -r requirements.txt

# Frontend
cd /app/photo-chrono/frontend
npm install
npm run build

# Service
cp photo-chrono.service /etc/systemd/system/
systemctl enable --now photo-chrono
```

### systemd Service
```ini
[Unit]
Description=Photo Chronologizer — Pukalani Utilities
After=network.target

[Service]
Type=simple
WorkingDirectory=/app/photo-chrono/backend
ExecStart=/app/photo-chrono/venv/bin/uvicorn main:app --host 0.0.0.0 --port 7777 --workers 1
Restart=on-failure
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

### Home Assistant Integration
```yaml
# configuration.yaml
panel_iframe:
  photo_chrono:
    title: "Photo Chronologizer"
    url: "http://192.168.1.114:7777"
    icon: "mdi:image-multiple"
```

---

## 9. Known Limitations & Future Work

### Current Limitations
- **Single uvicorn worker** — CPU-bound face detection blocks HTTP responses during processing. Server becomes unresponsive until batch completes.
- **No GPU acceleration** — InsightFace runs on CPU only (container has no GPU access)
- **No per-user isolation** — All users share one rclone mount and session database
- **EXIF dates not used** — Could extract camera dates from EXIF metadata

### Planned Features
- **Phase 5: Multi-person identification** — "Scan for Friends" — DBSCAN clustering of non-subject faces
- **Read-only Filmstrip** — Integrated drag-to-reorder timeline view
- **Bridge .exe** — PyInstaller-compiled Windows executable for local folder access
- **Cross-run persistence** — Auto-detect `.photo-chrono.db` in output folder for session resume
- **EXIF date extraction** — Use camera metadata as primary date source when available
