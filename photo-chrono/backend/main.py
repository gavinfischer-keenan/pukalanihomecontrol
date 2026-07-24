"""
Photo Chronologizer — FastAPI Backend v2
Serves React UI + all API endpoints.
Port 7777 on CT114 (192.168.1.114).
"""
import asyncio, json, os, shutil
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, BackgroundTasks, HTTPException, Response, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse
from pydantic import BaseModel

import db, pipeline as pip, portable_db

# ── Init ──────────────────────────────────────────────────────────────────────
app = FastAPI(title="Photo Chronologizer", version="2.0")
db.init_db()

DIST = Path(__file__).parent.parent / "frontend" / "dist"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".heic", ".heif", ".webp"}

_progress: dict[str, asyncio.Queue] = {}
_active_jobs: set[str] = set()

# ── Pydantic models ───────────────────────────────────────────────────────────
class NewSession(BaseModel):
    name: str = ""
    subject_name: str = ""
    subject_sex: str = "unknown"   # 'male' | 'female' | 'unknown'
    birth_year: int
    birth_month: int = 1
    birth_day: int = 1
    source_path: str
    output_path: str
    is_rerun: bool = False
    prior_session_id: Optional[str] = None
    model_name: str = "buffalo_sc"
    sim_match: float = 0.45
    sim_uncertain: float = 0.35

class EnrollFace(BaseModel):
    photo_id: str
    face_idx: int
    known_year: int | None = None

class ReviewDecision(BaseModel):
    photo_id: str
    confirmed: str          # 'yes' | 'no'
    date_hint_year: Optional[int] = None
    date_hint_month: Optional[int] = None
    date_hint_approx: bool = True
    age_override: Optional[int] = None

class ValidatePhoto(BaseModel):
    photo_id: str
    is_subject: bool
    date_hint_year: Optional[int] = None
    date_hint_month: Optional[int] = None
    date_hint_approx: bool = True
    age_override: Optional[int] = None
    lock_date: bool = False

class SaveHint(BaseModel):
    photo_id: str
    user_hint: str = ""        # free-text from user, e.g. "I think Ed looks older here"
    hint_direction: Optional[str] = None  # 'older' | 'younger' | 'confident' | None
    nudge_years: int = 4       # how many years older/younger to nudge

class RcloneAuthReq(BaseModel):
    token: str

class ExportRequest(BaseModel):
    age_bias: int = 0

class SessionConfig(BaseModel):
    single_face_auto_match: bool = True

# ── Bridge proxy helpers ──────────────────────────────────────────────────────
import urllib.request, urllib.error

def _bridge_get(bridge_url: str, path: str, timeout: int = 30):
    """Fetch from a bridge agent running on the user's machine."""
    url = bridge_url.rstrip('/')
    if not url.startswith('http'):
        url = f'http://{url}'
    req = urllib.request.Request(f'{url}{path}')
    return urllib.request.urlopen(req, timeout=timeout)

def _is_bridge_source(source_path: str) -> bool:
    return source_path.startswith('bridge://')

def _bridge_url_from(source_path: str) -> str:
    return source_path.replace('bridge://', '')

# ── rclone ────────────────────────────────────────────────────────────────────
import rclone_mgr

@app.get("/api/rclone/status")
def rclone_status():
    return rclone_mgr.get_status()

@app.get("/api/rclone/auth-url")
def rclone_auth_url():
    res = rclone_mgr.get_live_google_auth_url()
    if not res.get("ok"):
        raise HTTPException(500, res.get("detail", "Failed to generate Google Auth URL"))
    return res

@app.post("/api/rclone/auth")
def rclone_auth(req: RcloneAuthReq):
    res = rclone_mgr.create_remote(req.token)
    if not res.get("ok"):
        raise HTTPException(400, res.get("detail", "Failed to save remote"))
    return res

@app.post("/api/rclone/mount")
def rclone_mount():
    res = rclone_mgr.mount_gdrive()
    if not res.get("ok"):
        raise HTTPException(400, res.get("detail", "Failed to mount drive"))
    return res

@app.post("/api/rclone/unmount")
def rclone_unmount():
    return rclone_mgr.unmount_gdrive()

@app.get("/api/rclone/ls")
def rclone_ls(path: str = "gdrive:"):
    """Legacy endpoint — redirects to browse."""
    return browse_folder("/mnt/gdrive")

@app.get("/api/browse")
def browse_folder(path: str = "/mnt/gdrive"):
    """Browse folders on the local filesystem. Returns subfolders + image counts."""
    from pathlib import Path as P
    target = P(path)
    if not target.exists():
        raise HTTPException(404, f"Path not found: {path}")
    if not target.is_dir():
        raise HTTPException(400, f"Not a directory: {path}")
    # Security: only allow browsing under /mnt
    if not str(target).startswith("/mnt"):
        raise HTTPException(403, "Browsing restricted to /mnt")

    folders = []
    image_count = 0
    for child in sorted(target.iterdir()):
        if child.name.startswith('.'):
            continue
        if child.is_dir():
            # Count images inside (non-recursive, quick peek)
            img_count = sum(1 for f in child.iterdir()
                          if f.is_file() and f.suffix.lower() in IMAGE_EXTS)
            sub_count = sum(1 for f in child.iterdir() if f.is_dir() and not f.name.startswith('.'))
            folders.append({
                "name": child.name,
                "path": str(child),
                "image_count": img_count,
                "subfolder_count": sub_count,
            })
        elif child.is_file() and child.suffix.lower() in IMAGE_EXTS:
            image_count += 1

    return {
        "path": str(target),
        "parent": str(target.parent) if str(target) != "/mnt/gdrive" else None,
        "folders": folders,
        "image_count": image_count,
    }

# ── Re-run detection ──────────────────────────────────────────────────────────
@app.get("/api/sessions/detect-rerun")
def detect_rerun(path: str):
    """Sniff a folder for our naming pattern + check DB for prior sessions."""
    pattern_result = pip.detect_rerun_pattern(path)
    prior_sessions = db.get_sessions_by_output_path(path)
    return {
        **pattern_result,
        "prior_sessions": prior_sessions,
        "has_prior_session": len(prior_sessions) > 0,
        "suggested_prior": prior_sessions[0] if prior_sessions else None,
    }

# ── Portable DB detection ─────────────────────────────────────────────────────
@app.get("/api/sessions/detect-portable")
def detect_portable(path: str = Query(...)):
    """Check if an output folder already has a .photo-chrono.db from a prior run."""
    pdb = Path(path) / ".photo-chrono.db"
    if not pdb.exists():
        return {"found": False}
    try:
        info = portable_db.read_portable(str(pdb))
        return {"found": True, "info": info}
    except Exception as e:
        return {"found": False, "error": str(e)}

# ── Sessions ──────────────────────────────────────────────────────────────────
@app.get("/api/sessions")
def list_sessions():
    return db.list_sessions()

@app.post("/api/sessions")
def create_session(req: NewSession):
    sid = db.create_session(
        req.name or f"{req.subject_name} {req.birth_year}",
        req.subject_name, req.subject_sex,
        req.birth_year, req.birth_month, req.birth_day,
        req.source_path, req.output_path,
        req.model_name, req.sim_match, req.sim_uncertain,
        req.is_rerun, req.prior_session_id
    )
    # Import anchors from prior session if re-run
    imported_anchors = 0
    if req.is_rerun and req.prior_session_id:
        imported_anchors = db.import_anchors_from_session(sid, req.prior_session_id)
    s = db.get_session(sid)
    s["imported_anchors"] = imported_anchors
    return s

@app.get("/api/sessions/{sid}")
def get_session(sid: str):
    s = db.get_session(sid)
    if not s: raise HTTPException(404, "Session not found")
    s["enrollment_count"] = db.count_embeddings(sid)
    return s

class SessionConfig(BaseModel):
    single_face_auto_match: bool = True

@app.put("/api/sessions/{sid}/config")
def update_config(sid: str, cfg: SessionConfig):
    s = db.get_session(sid)
    if not s: raise HTTPException(404)
    # Store as JSON string in a config column, or use individual columns
    import json
    config = json.dumps({"single_face_auto_match": cfg.single_face_auto_match})
    db.update_session(sid, config=config)
    return {"ok": True}

@app.delete("/api/sessions/{sid}")
def delete_session(sid: str):
    s = db.get_session(sid)
    if not s: raise HTTPException(404)
    # Kill active processing job if running
    _active_jobs.discard(sid)
    q = _progress.pop(sid, None)
    # Delete all data for this session
    con = db.get_db()
    con.execute("DELETE FROM embeddings WHERE session_id=?", (sid,))
    con.execute("DELETE FROM photo_files WHERE session_id=?", (sid,))
    con.execute("DELETE FROM sessions WHERE id=?", (sid,))
    con.commit()
    con.close()
    return {"ok": True, "deleted": sid}

@app.put("/api/photos/{sid}/{pid}/exclude")
def exclude_photo(sid: str, pid: str):
    """Mark a photo as NOT containing the subject — excluded from processing."""
    con = db.get_db()
    row = con.execute("SELECT id FROM photo_files WHERE id=? AND session_id=?", (pid, sid)).fetchone()
    if not row:
        con.close()
        raise HTTPException(404)
    con.execute("UPDATE photo_files SET status='excluded' WHERE id=?", (pid,))
    con.commit()
    con.close()
    return {"ok": True, "excluded": pid}
@app.post("/api/sessions/{sid}/scan")
def scan_folder(sid: str):
    s = db.get_session(sid)
    if not s: raise HTTPException(404)
    src = Path(s["source_path"])
    if not src.exists():
        raise HTTPException(400, f"Source path does not exist: {src}")
    files = []
    for ext in IMAGE_EXTS:
        files.extend(src.rglob(f"*{ext}"))
        files.extend(src.rglob(f"*{ext.upper()}"))
    file_pairs = [(str(f), str(f.relative_to(src))) for f in sorted(set(files))]
    count = db.upsert_photos(sid, file_pairs)

    # If re-run: mark photos already validated in prior session
    if s.get("is_rerun") and s.get("prior_session_id"):
        _mark_validated_from_prior(sid, s["prior_session_id"], file_pairs)

    db.update_session(sid, status="enrolling")
    return {"total": count}

def _mark_validated_from_prior(new_sid: str, prior_sid: str, file_pairs: list):
    """Mark photos that were validated in a prior session as pre-validated."""
    validated = db.get_validated_photos(prior_sid)
    val_paths = {v["file_path"] for v in validated}
    con = db.get_db()
    for fp, _ in file_pairs:
        if fp in val_paths:
            con.execute("""
                UPDATE photo_files SET validated=TRUE, status='processed',
                match_status='matched', user_confirmed='yes'
                WHERE session_id=? AND file_path=?
            """, (new_sid, fp))
    con.commit()
    con.close()

@app.get("/api/sessions/{sid}/samples")
def get_samples(sid: str, n: int = 8, mode: str = "random"):
    """Random samples or age-bucketed samples for re-run calibration."""
    if mode == "bucketed":
        samples = db.get_samples_by_age_buckets(sid)
    else:
        samples = db.get_random_samples(sid, n)
    return [{"id": p["id"], "rel_path": p["rel_path"]} for p in samples]

# ── Photo serving ─────────────────────────────────────────────────────────────
@app.get("/api/photo/{sid}/{photo_id}")
def serve_photo(sid: str, photo_id: str, size: int = 800,
                crop: int = 0, face_idx: int = 0, bbox: str = ""):
    """
    Serve photo thumbnail OR a padded face crop.
    crop=1&face_idx=N → returns the face crop for the confirmation modal.
    bbox=x1,y1,x2,y2 → skip re-detection and use provided bbox directly.
    """
    con = db.get_db()
    row = con.execute("SELECT file_path FROM photo_files WHERE id=? AND session_id=?",
                      (photo_id, sid)).fetchone()
    con.close()
    if not row: raise HTTPException(404)

    if crop:
        if bbox:
            # Use provided bbox — skip expensive re-detection
            try:
                coords = [int(x) for x in bbox.split(",")]
                data = pip.make_face_crop(row["file_path"], coords)
            except Exception:
                raise HTTPException(400, "Invalid bbox format, expected x1,y1,x2,y2")
        else:
            # Fallback: re-detect faces (slow)
            faces = pip.detect_faces(row["file_path"])
            target = next((f for f in faces if f["idx"] == face_idx), None)
            if not target:
                raise HTTPException(404, f"Face {face_idx} not found")
            data = pip.make_face_crop(row["file_path"], target["bbox"])
    else:
        data = pip.make_thumbnail(row["file_path"], max_size=size)

    if not data: raise HTTPException(500, "Could not load image")
    return Response(content=data, media_type="image/jpeg")

@app.get("/api/faces/{sid}/{photo_id}")
def get_faces(sid: str, photo_id: str):
    import json as _json
    con = db.get_db()
    row = con.execute("SELECT file_path, faces_cache FROM photo_files WHERE id=? AND session_id=?",
                      (photo_id, sid)).fetchone()
    con.close()
    if not row: raise HTTPException(404)

    # Check cache first
    cached = None
    if row["faces_cache"]:
        try:
            cached = _json.loads(row["faces_cache"])
        except Exception:
            pass

    if cached:
        return cached

    # No cache — run detection (slow, ~3s)
    try:
        from PIL import Image, ImageOps
        img = Image.open(row["file_path"])
        img = ImageOps.exif_transpose(img)
        orig_w, orig_h = img.size
    except Exception:
        orig_w, orig_h = 1, 1

    faces = pip.detect_faces(row["file_path"])
    scale = min(800 / orig_w, 800 / orig_h, 1.0)
    scaled = []
    for f in faces:
        x1, y1, x2, y2 = f["bbox"]
        scaled.append({
            "idx": f["idx"], "age": f["age"], "score": round(f["score"], 3),
            "bbox": [int(x1*scale), int(y1*scale), int(x2*scale), int(y2*scale)],
            "bbox_orig": [x1, y1, x2, y2],  # Original coords for crop requests
        })

    result = {"faces": scaled, "thumb_w": int(orig_w*scale), "thumb_h": int(orig_h*scale)}

    # Cache for instant future lookups
    try:
        con2 = db.get_db()
        con2.execute("UPDATE photo_files SET faces_cache=? WHERE id=?",
                     (_json.dumps(result), photo_id))
        con2.commit()
        con2.close()
    except Exception:
        pass

    return result

@app.post("/api/faces/{sid}/{photo_id}/rescan")
def rescan_faces(sid: str, photo_id: str):
    """Clear face cache and re-detect faces for a photo."""
    import json as _json
    con = db.get_db()
    row = con.execute("SELECT file_path FROM photo_files WHERE id=? AND session_id=?",
                      (photo_id, sid)).fetchone()
    if not row:
        con.close()
        raise HTTPException(404)
    # Clear the cache
    con.execute("UPDATE photo_files SET faces_cache=NULL WHERE id=?", (photo_id,))
    con.commit()
    con.close()
    # Re-detect by calling get_faces (which will detect fresh since cache is cleared)
    return get_faces(sid, photo_id)

# ── Enrollment ────────────────────────────────────────────────────────────────
@app.post("/api/sessions/{sid}/enroll")
def enroll_face(sid: str, req: EnrollFace):
    con = db.get_db()
    row = con.execute("SELECT file_path FROM photo_files WHERE id=? AND session_id=?",
                      (req.photo_id, sid)).fetchone()
    con.close()
    if not row: raise HTTPException(404)
    faces = pip.detect_faces(row["file_path"])
    target = next((f for f in faces if f["idx"] == req.face_idx), None)
    if not target:
        raise HTTPException(400, f"Face {req.face_idx} not found in photo")
    db.save_embedding(sid, req.photo_id, req.face_idx, target["embedding"], target["age"])
    # If user provided a known year, save it to the photo record as a locked date
    if req.known_year:
        session = db.get_session(sid)
        birth_year = session.get("birth_year", 1967)
        known_age = req.known_year - birth_year
        db.update_photo(req.photo_id,
            date_hint_year=req.known_year,
            estimated_year=req.known_year,
            estimated_age=max(0, known_age),
            age_override=max(0, known_age),
            date_locked=True)
    count = db.count_embeddings(sid)
    return {"enrolled": count, "ready": count >= 3, "known_year": req.known_year}

# ── Processing ────────────────────────────────────────────────────────────────
@app.post("/api/sessions/{sid}/start")
async def start_processing(sid: str, background_tasks: BackgroundTasks):
    if sid in _active_jobs:
        return {"status": "already_running"}
    s = db.get_session(sid)
    if not s: raise HTTPException(404)
    emb_count = db.count_embeddings(sid)
    if emb_count < 3:
        raise HTTPException(400, f"Need at least 3 enrolled faces (have {emb_count})")
    _progress[sid] = asyncio.Queue()
    _active_jobs.add(sid)
    db.update_session(sid, status="processing")
    background_tasks.add_task(_process_session_async, sid)
    return {"status": "started"}

async def _process_session_async(sid: str):
    import concurrent.futures
    try:
        # Emit warm-up status
        await _emit(sid, {"type": "warmup", "msg": "Loading AI face recognition model…"})

        emb_rows = db.get_embeddings(sid)
        # Separate anchors (from validated prior session) from manual enrollments
        anchors = [r for r in emb_rows if r.get("is_anchor")]
        manual  = [r for r in emb_rows if not r.get("is_anchor")]
        reference = pip.build_enhanced_reference(manual, anchors)
        if reference is None:
            await _emit(sid, {"type": "error", "msg": "No reference embedding"})
            return

        session = db.get_session(sid)
        birth_year = session.get("birth_year") or 1967
        sim_match  = session.get("sim_match", 0.45)
        sim_unc    = session.get("sim_uncertain", 0.35)
        total = session["total_photos"]
        processed = 0

        # Read session config
        import json
        try:
            cfg = json.loads(session.get("config") or "{}")
        except Exception:
            cfg = {}
        single_face_auto = cfg.get("single_face_auto_match", True)

        # Pre-warm the model with one photo before parallel processing
        first_batch = db.get_pending_photos(sid, 1)
        if first_batch:
            await _emit(sid, {"type": "warmup", "msg": "Warming up AI engine with first photo…"})
            pip.match_photo(first_batch[0]["file_path"], reference, sim_match, sim_unc)

        await _emit(sid, {"type": "warmup", "msg": "AI engine ready — starting parallel processing…"})

        # Use 4 workers for 4 CPU cores, batch size 20 for fewer DB round-trips
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            while True:
                batch = db.get_pending_photos(sid, 20)
                if not batch:
                    break

                futures = {
                    executor.submit(pip.match_photo, p["file_path"], reference, sim_match, sim_unc, single_face_auto): p
                    for p in batch
                }

                # Batch DB updates — collect results then write all at once
                batch_updates = []
                batch_matched = 0
                batch_uncertain = 0

                for fut in concurrent.futures.as_completed(futures):
                    photo = futures[fut]
                    try:
                        match_status, score, age, face_idx, face_count = fut.result(timeout=30)
                    except Exception:
                        match_status, score, age, face_idx, face_count = "no_match", 0.0, -1, -1, 0

                    est_year = (birth_year + age) if (age > 0 and birth_year) else None

                    # Apply hint nudge to age if one exists (soft, advisory)
                    hint_adj = photo.get("age_adjustment_hint", 0) or 0
                    if hint_adj and age >= 0:
                        age = max(0, min(120, age + hint_adj))
                        est_year = (birth_year + age) if (birth_year and age >= 0) else est_year

                    batch_updates.append((
                        photo["id"], match_status, round(score, 4),
                        age if age >= 0 else None, est_year,
                        face_count, face_idx if face_idx >= 0 else None
                    ))

                    if match_status == "matched":
                        batch_matched += 1
                    elif match_status == "uncertain":
                        batch_uncertain += 1

                    processed += 1
                    # Flag single-face auto-matches with a ★ marker
                    auto_flag = face_count == 1 and match_status == 'matched' and score < sim_match
                    await _emit(sid, {
                        "type": "progress",
                        "processed": processed, "total": total,
                        "pct": round(processed / total * 100, 1) if total else 0,
                        "match_status": match_status,
                        "file": photo["rel_path"],
                        "age": age, "score": round(score, 3),
                        "faces": face_count,
                        "auto": auto_flag,
                    })

                # Batch write all results at once
                _batch_update_photos(batch_updates)
                db.increment_counters(sid,
                    processed=len(batch_updates),
                    matched=batch_matched,
                    uncertain=batch_uncertain)

        db.update_session(sid, status="reviewing")
        await _emit(sid, {"type": "done", "status": "reviewing"})
    except Exception as e:
        await _emit(sid, {"type": "error", "msg": str(e)})
    finally:
        _active_jobs.discard(sid)


def _batch_update_photos(updates: list):
    """Batch write photo results to DB in a single transaction."""
    if not updates:
        return
    con = db.get_db()
    con.executemany("""
        UPDATE photo_files SET
            status='processed',
            match_status=?,
            match_score=?,
            estimated_age=?,
            estimated_year=?,
            face_count=?,
            matched_face_idx=?
        WHERE id=?
    """, [(u[1], u[2], u[3], u[4], u[5], u[6], u[0]) for u in updates])
    con.commit()
    con.close()

async def _emit(sid: str, msg: dict):
    q = _progress.get(sid)
    if q:
        await q.put(msg)

@app.get("/api/sessions/{sid}/progress")
async def progress_stream(sid: str):
    if sid not in _progress:
        _progress[sid] = asyncio.Queue()
    async def event_gen():
        q = _progress[sid]
        while True:
            try:
                msg = await asyncio.wait_for(q.get(), timeout=30)
                yield f"data: {json.dumps(msg)}\n\n"
                if msg.get("type") in ("done", "error"):
                    break
            except asyncio.TimeoutError:
                yield 'data: {"type":"ping"}\n\n'
    return StreamingResponse(event_gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

# ── Review ────────────────────────────────────────────────────────────────────
@app.get("/api/sessions/{sid}/review")
def get_review(sid: str, category: str = "all"):
    uncertain = db.get_uncertain_photos(sid, 50)
    no_face = db.get_no_face_photos(sid, 50)
    if category == "uncertain":
        return {"photos": uncertain, "count": len(uncertain)}
    elif category == "no_face":
        return {"photos": no_face, "count": len(no_face)}
    return {
        "uncertain": uncertain,
        "no_face": no_face,
        "uncertain_count": len(uncertain),
        "no_face_count": len(no_face),
        "total_count": len(uncertain) + len(no_face),
        # Backward compat
        "photos": uncertain,
        "count": len(uncertain),
    }

@app.post("/api/sessions/{sid}/review")
def submit_review(sid: str, req: ReviewDecision):
    # confirmed can be: 'yes', 'no', 'no_face' (user confirms no face visible — assign date only)
    if req.confirmed == 'no_face':
        # No face visible — accept photo with user-assigned date, skip future face scans
        updates = {
            "user_confirmed": "no_face",
            "match_status": "matched",   # include in export
            "face_count": 0,
            "date_locked": True,
        }
        if req.date_hint_year:
            updates["date_hint_year"]  = req.date_hint_year
            updates["date_hint_month"] = req.date_hint_month or 1
            updates["date_hint_approx"] = int(req.date_hint_approx)
            # Calculate estimated age from year
            s = db.get_session(sid)
            if s and s.get("birth_year"):
                updates["estimated_age"] = req.date_hint_year - s["birth_year"]
                updates["estimated_year"] = req.date_hint_year
        db.update_photo(req.photo_id, **updates)
        return {"ok": True}

    updates = {"user_confirmed": req.confirmed,
               "match_status": "matched" if req.confirmed == "yes" else "no_match"}
    if req.date_hint_year:
        updates["date_hint_year"]  = req.date_hint_year
        updates["date_hint_month"] = req.date_hint_month
        updates["date_hint_approx"] = int(req.date_hint_approx)
        updates["date_locked"] = True      # user entered → locked
    if req.age_override is not None:
        updates["age_override"] = req.age_override
        s = db.get_session(sid)
        if s and s.get("birth_year") and req.age_override >= 0:
            updates["estimated_year"] = s["birth_year"] + req.age_override
    db.update_photo(req.photo_id, **updates)
    return {"ok": True}

# ── Strip viewer ──────────────────────────────────────────────────────────────
@app.get("/api/sessions/{sid}/strip")
def get_strip(sid: str, center_id: str = "", window: int = 10):
    """Return ±window photos around center_id in chronological order."""
    s = db.get_session(sid)
    if not s: raise HTTPException(404)
    if not center_id:
        photos = db.get_matched_photos(sid)
        return {"photos": photos[:20], "center_idx": 0, "total": len(photos), "global_idx": 0}
    result = db.get_strip_window(sid, center_id, window)
    return result

# ── Validation (strip viewer corrections) ────────────────────────────────────
@app.post("/api/sessions/{sid}/validate")
def validate_photo(sid: str, req: ValidatePhoto):
    """
    Mark a photo as validated by the user.
    User-entered dates (lock_date=True) are immutable from this point.
    AI-estimated data can be revised on re-run.
    """
    s = db.get_session(sid)
    if not s: raise HTTPException(404)

    updates: dict = {}

    if req.is_subject:
        updates["validated"]     = True
        updates["user_confirmed"] = "yes"
        updates["match_status"]  = "matched"
    else:
        updates["validated"]     = False
        updates["user_confirmed"] = "no"
        updates["match_status"]  = "no_match"

    # User-entered date — always locked once set
    if req.date_hint_year is not None:
        updates["date_hint_year"]  = req.date_hint_year
        updates["date_hint_month"] = req.date_hint_month
        updates["date_hint_approx"] = int(req.date_hint_approx)
        updates["date_locked"]     = True   # USER set this → immutable

    # Age override → recalculate year if birth_year known
    if req.age_override is not None:
        updates["age_override"] = req.age_override
        if s.get("birth_year"):
            updates["estimated_year"] = s["birth_year"] + req.age_override

    db.update_photo(req.photo_id, **updates)
    return {"ok": True, "validated": req.is_subject}

# ── Hints (soft nudges — not commands) ───────────────────────────────────────
@app.post("/api/sessions/{sid}/hint")
def save_hint(sid: str, req: SaveHint):
    """
    Save a user hint about a photo's apparent age.
    These are SOFT NUDGES — not commands. They influence estimated age on re-run.
    hint_direction: 'older' | 'younger' | 'confident' | null
    """
    db.save_hint(req.photo_id, req.user_hint, req.hint_direction, req.nudge_years)
    # Immediately apply the nudge to estimated_age for display
    con = db.get_db()
    photo = con.execute("SELECT * FROM photo_files WHERE id=?", (req.photo_id,)).fetchone()
    con.close()
    if photo and photo["estimated_age"] is not None:
        adj = req.nudge_years if req.hint_direction == 'older' else \
              -req.nudge_years if req.hint_direction == 'younger' else 0
        nudged_age = max(0, min(120, photo["estimated_age"] + adj))
        s = db.get_session(sid)
        birth_year = s.get("birth_year") if s else None
        nudged_year = birth_year + nudged_age if (birth_year and nudged_age is not None) else None
        return {"ok": True, "nudged_age": nudged_age, "nudged_year": nudged_year,
                "original_age": photo["estimated_age"],
                "hint_direction": req.hint_direction}
    return {"ok": True}

# ── Model update (manual trigger) ─────────────────────────────────────────────
@app.post("/api/sessions/{sid}/update-model")
def update_model(sid: str):
    """
    Rebuild the reference embedding from all enrollments + validated photos.
    Triggered explicitly by the user — not automatic.
    """
    emb_rows = db.get_embeddings(sid)
    validated = db.get_validated_photos(sid)

    # Build embeddings from validated photos (re-detect faces)
    anchor_count = 0
    for vp in validated:
        try:
            faces = pip.detect_faces(vp["file_path"])
            if faces:
                best = max(faces, key=lambda f: f["score"])
                db.save_embedding(sid, vp["id"], best["idx"],
                                  best["embedding"], best["age"], is_anchor=True)
                anchor_count += 1
        except Exception:
            pass

    all_embs   = db.get_embeddings(sid)
    manual_embs = [r for r in all_embs if not r.get("is_anchor")]
    anchor_embs = [r for r in all_embs if r.get("is_anchor")]
    ref = pip.build_enhanced_reference(manual_embs, anchor_embs)

    return {
        "ok": True,
        "manual_embeddings": len(manual_embs),
        "anchor_embeddings": len(anchor_embs),
        "new_anchors_added": anchor_count,
        "reference_built": ref is not None,
    }

# ── Export ────────────────────────────────────────────────────────────────────
@app.get("/api/sessions/{sid}/export/preview")
def export_preview(sid: str, age_bias: int = 0):
    s = db.get_session(sid)
    if not s: raise HTTPException(404)
    photos = db.get_matched_photos(sid)
    preview = []
    for p in photos:
        fname = _build_filename(p, age_bias, s.get("birth_year"))
        age = p.get("age_override") or p.get("estimated_age")
        yr  = p.get("date_hint_year") or p.get("estimated_year")
        preview.append({"id": p["id"], "original": p["rel_path"], "output": fname,
                        "age": age, "year": yr,
                        "validated": p.get("validated", False),
                        "date_locked": p.get("date_locked", False)})
    return {"count": len(preview), "preview": preview[:50]}

@app.post("/api/sessions/{sid}/export")
async def do_export(sid: str, req: ExportRequest, background_tasks: BackgroundTasks):
    s = db.get_session(sid)
    if not s: raise HTTPException(404)
    db.update_session(sid, status="exporting", age_bias=req.age_bias)
    _progress[sid] = asyncio.Queue()
    background_tasks.add_task(_export_async, sid, req.age_bias)
    return {"status": "started"}

async def _export_async(sid: str, age_bias: int):
    s = db.get_session(sid)
    out_root = Path(s["output_path"])
    out_root.mkdir(parents=True, exist_ok=True)
    photos = db.get_matched_photos(sid)
    birth_year = s.get("birth_year")
    total = len(photos)
    copied = 0
    for p in photos:
        fname = _build_filename(p, age_bias, birth_year)
        src = Path(p["file_path"])
        dst = out_root / fname
        try:
            shutil.copy2(str(src), str(dst))
            db.update_photo(p["id"], output_filename=fname)
            copied += 1
            await _emit(sid, {"type": "export_progress",
                               "copied": copied, "total": total,
                               "pct": round(copied/total*100, 1) if total else 0,
                               "file": fname})
        except Exception as e:
            await _emit(sid, {"type": "export_error", "file": p["rel_path"], "msg": str(e)})
    db.update_session(sid, status="done")
    await _emit(sid, {"type": "done", "copied": copied, "total": total})

    # Write portable metadata DB alongside exported photos
    try:
        portable_db.write_portable(sid, str(out_root))
        await _emit(sid, {"type": "portable_db", "status": "written"})
    except Exception as e:
        await _emit(sid, {"type": "portable_db_error", "msg": str(e)})

def _build_filename(photo: dict, age_bias: int, birth_year: Optional[int]) -> str:
    from pathlib import Path as P
    orig = P(photo["file_path"])
    ext  = orig.suffix.lower()
    stem = orig.stem

    # Age
    age = photo.get("age_override")
    if age is None: age = photo.get("estimated_age")
    if age is not None and age >= 0:
        age = max(0, min(120, age + age_bias))
        age_str = f"{int(age):03d}"
    else:
        age_str = "AGE"

    # Year — date_locked means user entered it, prefix with =
    if photo.get("date_hint_year"):
        prefix = "=" if photo.get("date_locked") else "~"
        year_str = f"{prefix}{photo['date_hint_year']}"
    elif birth_year and age is not None and age >= 0:
        year_str = f"~{birth_year + int(age)}"
    else:
        year_str = "no-date"

    return f"{age_str}_{year_str}_{stem}{ext}"

# ── Bridge endpoints ──────────────────────────────────────────────────────────
@app.get("/api/bridge/probe")
def bridge_probe(url: str = Query(...)):
    """Test connectivity to a bridge agent."""
    try:
        resp = _bridge_get(url, '/')
        data = json.loads(resp.read())
        return {"ok": True, "bridge": data}
    except Exception as e:
        raise HTTPException(502, f"Cannot reach bridge: {e}")

@app.post("/api/sessions/{sid}/scan-bridge")
def scan_bridge(sid: str):
    """Scan photos from a bridge agent instead of local filesystem."""
    s = db.get_session(sid)
    if not s:
        raise HTTPException(404)
    source = s["source_path"]
    if not _is_bridge_source(source):
        raise HTTPException(400, "Session source is not a bridge")
    bridge = _bridge_url_from(source)
    try:
        resp = _bridge_get(bridge, '/list')
        files = json.loads(resp.read())
    except Exception as e:
        raise HTTPException(502, f"Bridge error: {e}")

    import uuid as _uuid
    con = db.get_db()
    added = 0
    for f in files:
        pid = str(_uuid.uuid4())[:8]
        con.execute("""
            INSERT OR IGNORE INTO photo_files (id, session_id, file_path, rel_path, status)
            VALUES (?, ?, ?, ?, 'pending')
        """, (pid, sid, f'bridge://{bridge}/{f["name"]}', f["name"]))
        added += 1
    con.commit()
    db.update_session(sid, total_photos=added, status='enrolling')
    con.close()
    return {"added": added, "total": len(files)}

@app.get("/api/bridge-photo/{sid}/{photo_id}")
def serve_bridge_photo(sid: str, photo_id: str, size: int = 0):
    """Proxy a photo from the bridge agent."""
    con = db.get_db()
    row = con.execute("SELECT file_path, rel_path FROM photo_files WHERE id=? AND session_id=?",
                      (photo_id, sid)).fetchone()
    con.close()
    if not row:
        raise HTTPException(404)
    s = db.get_session(sid)
    if not s or not _is_bridge_source(s["source_path"]):
        raise HTTPException(400)
    bridge = _bridge_url_from(s["source_path"])
    fname = row["rel_path"]
    path = f'/photo/{fname}'
    if size:
        path += f'?size={size}'
    try:
        resp = _bridge_get(bridge, path, timeout=60)
        content = resp.read()
        ct = resp.headers.get('Content-Type', 'image/jpeg')
        return Response(content=content, media_type=ct)
    except Exception as e:
        raise HTTPException(502, f"Bridge error: {e}")

@app.post("/api/sessions/{sid}/import-portable")
def import_portable(sid: str, path: str = Query(...)):
    """Import reference faces from a portable DB into this session."""
    pdb = Path(path) / ".photo-chrono.db"
    if not pdb.exists():
        raise HTTPException(404, "No .photo-chrono.db found")
    try:
        count = portable_db.import_reference_faces(str(pdb), sid)
        return {"ok": True, "imported_faces": count}
    except Exception as e:
        raise HTTPException(500, str(e))

# ── Static / SPA ──────────────────────────────────────────────────────────────
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(DIST / "assets")), name="assets")

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        index = DIST / "index.html"
        if index.exists():
            return FileResponse(
                str(index),
                headers={
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache",
                    "Expires": "0",
                }
            )
        return JSONResponse({"error": "Frontend not built"}, status_code=503)
else:
    @app.get("/")
    def root():
        return JSONResponse({"status": "API running — build the frontend first"})
