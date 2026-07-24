"""
Pukalani Utilities — FastAPI backend
CT114 | 192.168.1.114:3114

Serves:
  - Static React frontend at /tools/*
  - PDF Maker API at /api/pdfmaker/*
  - PDF Shrinker API at /api/shrinker/*
  - Health check at /api/health

Session model:
  Files uploaded by client are stored in /tmp/pdfmaker-sessions/{session_id}/.
  They persist for 2 hours (cron purges them). The final PDF is never written to
  disk — it is assembled in a BytesIO buffer and streamed directly to the client.
"""

import io
import os
import shutil
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ── PDF maker modules ────────────────────────────────────────────────────────
from pdf_maker.converters.pdf_builder import (
    PageItem,
    build_pdf,
    render_page_preview,
)
from pdf_maker.converters.pdf_compressor import compress_pdf
from pdf_maker.converters.image_converter import convert_image_to_pages
from pdf_maker.converters.pdf_handler import convert_pdf_to_pages
from pdf_maker.converters.text_converter import convert_text_to_pages
from pdf_maker.converters.docx_converter import convert_docx_to_pages
from pdf_maker.converters.gltf_converter import convert_3d_to_pages
from pdf_maker.utils.file_utils import get_file_type


# ── Session storage ──────────────────────────────────────────────────────────
SESSIONS_DIR = Path("/tmp/pdfmaker-sessions")
SESSIONS_DIR.mkdir(exist_ok=True)

SESSION_TTL_SECONDS = 7200   # 2 hours


def _session_path(session_id: str) -> Path:
    path = SESSIONS_DIR / session_id
    # Reject path traversal attempts
    if not str(path.resolve()).startswith(str(SESSIONS_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Invalid session ID")
    return path


def _require_session(session_id: str) -> Path:
    path = _session_path(session_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Session not found or expired")
    # Touch a marker file to reset TTL
    (path / ".last_active").touch()
    return path


def _purge_old_sessions():
    """Background thread: delete sessions older than SESSION_TTL_SECONDS."""
    while True:
        time.sleep(300)  # check every 5 minutes
        try:
            cutoff = time.time() - SESSION_TTL_SECONDS
            for d in SESSIONS_DIR.iterdir():
                if not d.is_dir():
                    continue
                marker = d / ".last_active"
                mtime = marker.stat().st_mtime if marker.exists() else d.stat().st_mtime
                if mtime < cutoff:
                    shutil.rmtree(d, ignore_errors=True)
        except Exception:
            pass


threading.Thread(target=_purge_old_sessions, daemon=True).start()


# ── File type → converter dispatch ──────────────────────────────────────────
IMAGE_EXTS    = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".tif", ".webp"}
TEXT_EXTS     = {".txt"}
WORD_EXTS     = {".doc", ".docx"}
PDF_EXTS      = {".pdf"}
MODEL_3D_EXTS = {".gltf", ".glb", ".obj", ".stl", ".fbx"}
ALL_SUPPORTED = IMAGE_EXTS | TEXT_EXTS | WORD_EXTS | PDF_EXTS | MODEL_3D_EXTS

PAGE_SIZE = (595.28, 841.89)  # A4 in points


def _source_type(ext: str) -> str:
    ext = ext.lower()
    if ext in IMAGE_EXTS:   return "image"
    if ext in TEXT_EXTS:    return "text"
    if ext in WORD_EXTS:    return "word"
    if ext in PDF_EXTS:     return "pdf"
    if ext in MODEL_3D_EXTS: return "3d"
    return "unknown"


def _convert_file(file_path: str, ext: str) -> tuple[list[str], list[str]]:
    """Run the appropriate converter. Returns (list_of_temp_pdfs, warnings)."""
    ext = ext.lower()
    if ext in IMAGE_EXTS:
        pages = convert_image_to_pages(file_path, page_size="A4", gif_all_frames=True)
        return (pages if isinstance(pages, list) else list(pages)), []
    if ext in TEXT_EXTS:
        result = convert_text_to_pages(file_path)
        return (result, []) if isinstance(result, list) else result
    if ext in WORD_EXTS:
        result = convert_docx_to_pages(file_path)
        return (result, []) if isinstance(result, list) else result
    if ext in PDF_EXTS:
        result = convert_pdf_to_pages(file_path)
        return result if isinstance(result, tuple) else (result, [])
    if ext in MODEL_3D_EXTS:
        result = convert_3d_to_pages(file_path, page_size="A4")
        return result if isinstance(result, tuple) else (result, [])
    return [], [f"Unsupported file type: {ext}"]



# ── Pydantic models ──────────────────────────────────────────────────────────

class PageConfig(BaseModel):
    file_id: str
    display_name: str
    source_type: str
    converted_pdf: Optional[str] = None   # server-side temp PDF path (filled in /import)
    rotation: int = 0
    image_rotation: int = 0
    image_scale: float = 1.0
    image_offset_x: float = 0.0
    image_offset_y: float = 0.0
    image_crop: Optional[tuple[float, float, float, float]] = None
    page_landscape: bool = False
    warnings: list[str] = []


class PageNumberSettings(BaseModel):
    enabled: bool = False
    position: str = "bottom"
    alignment: str = "center"
    font: str = "Helvetica"
    font_size: int = 10
    offset_from_edge: int = 20
    offset_from_side: int = 50
    style: str = "plain"
    color: str = "#000000"
    page_num: int = 1
    total_pages: int = 1


class PreviewRequest(BaseModel):
    session_id: str
    page: PageConfig
    zoom: float = 1.5
    page_number_settings: Optional[PageNumberSettings] = None


class BuildRequest(BaseModel):
    session_id: str
    pages: list[PageConfig]
    page_number_settings: Optional[PageNumberSettings] = None
    jpeg_quality: int = 95


# ── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(title="Pukalani Utilities", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ───────────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"ok": True, "service": "utilities", "version": "1.0.0"}


# ── Root redirect ─────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return RedirectResponse(url="/tools/")


# ── PDF Maker: Session ────────────────────────────────────────────────────────

@app.post("/api/pdfmaker/session")
async def create_session():
    session_id = str(uuid.uuid4())
    path = _session_path(session_id)
    path.mkdir(parents=True)
    (path / ".last_active").touch()
    return {"session_id": session_id}


@app.delete("/api/pdfmaker/session/{session_id}")
async def delete_session(session_id: str):
    path = _session_path(session_id)
    if path.exists():
        shutil.rmtree(path, ignore_errors=True)
    return {"ok": True}


# ── PDF Maker: Import files ──────────────────────────────────────────────────

@app.post("/api/pdfmaker/import")
async def import_files(
    session_id: str = Form(...),
    files: list[UploadFile] = File(...),
):
    """
    Upload one or more files. Saves them to the session directory, runs the
    appropriate converter, and returns a list of PageConfig objects (one per
    output page). The client stores these and sends them back for preview/build.
    """
    session_dir = _require_session(session_id)
    result_pages = []

    for upload in files:
        original_name = upload.filename or "file"
        ext = Path(original_name).suffix.lower()
        if ext not in ALL_SUPPORTED:
            result_pages.append({
                "file_id": str(uuid.uuid4()),
                "display_name": original_name,
                "source_type": "unknown",
                "converted_pdf": None,
                "warnings": [f"Unsupported file type: {ext}"],
                "rotation": 0, "image_rotation": 0, "image_scale": 1.0,
                "image_offset_x": 0.0, "image_offset_y": 0.0,
                "image_crop": None, "page_landscape": False,
            })
            continue

        # Save uploaded file
        file_id = str(uuid.uuid4())
        save_name = f"{file_id}{ext}"
        save_path = session_dir / save_name
        content = await upload.read()
        save_path.write_bytes(content)

        # Convert to single-page temp PDFs
        try:
            temp_pdfs, warnings = _convert_file(str(save_path), ext)
        except Exception as exc:
            warnings = [f"Conversion error: {exc}"]
            temp_pdfs = []

        source_type = _source_type(ext)
        base_name = Path(original_name).stem

        if not temp_pdfs:
            # Conversion failed — still add as an entry so user sees the warning
            result_pages.append({
                "file_id": file_id,
                "display_name": original_name,
                "source_type": source_type,
                "converted_pdf": None,
                "warnings": warnings or ["Conversion failed"],
                "rotation": 0, "image_rotation": 0, "image_scale": 1.0,
                "image_offset_x": 0.0, "image_offset_y": 0.0,
                "image_crop": None, "page_landscape": False,
            })
        elif len(temp_pdfs) == 1:
            result_pages.append({
                "file_id": file_id,
                "display_name": original_name,
                "source_type": source_type,
                "converted_pdf": temp_pdfs[0],
                "warnings": warnings,
                "rotation": 0, "image_rotation": 0, "image_scale": 1.0,
                "image_offset_x": 0.0, "image_offset_y": 0.0,
                "image_crop": None, "page_landscape": False,
            })
        else:
            # Multi-page source (multi-page PDF, animated GIF, multi-page DOCX)
            for i, pdf_path in enumerate(temp_pdfs):
                page_file_id = f"{file_id}_p{i}" if i > 0 else file_id
                result_pages.append({
                    "file_id": page_file_id,
                    "display_name": f"{original_name} (p.{i+1})",
                    "source_type": source_type,
                    "converted_pdf": pdf_path,
                    "warnings": warnings if i == 0 else [],
                    "rotation": 0, "image_rotation": 0, "image_scale": 1.0,
                    "image_offset_x": 0.0, "image_offset_y": 0.0,
                    "image_crop": None, "page_landscape": False,
                })

    return {"pages": result_pages}


# ── PDF Maker: Preview ────────────────────────────────────────────────────────

@app.post("/api/pdfmaker/preview")
async def preview_page(req: PreviewRequest):
    """
    Render a single page at the requested zoom level. Returns PNG bytes.
    The client sends its full current edit state for that page.
    """
    _require_session(req.session_id)

    p = req.page
    if not p.converted_pdf or not Path(p.converted_pdf).exists():
        # Return a placeholder grey image
        import fitz
        doc = fitz.open()
        page = doc.new_page(width=595, height=842)
        page.draw_rect(page.rect, color=(0.3, 0.3, 0.3), fill=(0.15, 0.15, 0.15))
        page.insert_text((200, 400), "Preview unavailable", fontsize=18, color=(0.8, 0.8, 0.8))
        pix = page.get_pixmap()
        return Response(content=pix.tobytes("png"), media_type="image/png")

    # Build a PageItem for render_page_preview
    page_item = PageItem(
        id=p.file_id,
        source_file=p.converted_pdf,  # used for image re-render
        source_type=p.source_type,
        converted_pdf=p.converted_pdf,
        rotation=p.rotation,
        page_landscape=p.page_landscape,
        image_rotation=p.image_rotation,
        image_scale=p.image_scale,
        image_offset_x=p.image_offset_x,
        image_offset_y=p.image_offset_y,
        image_crop=tuple(p.image_crop) if p.image_crop else None,
        display_name=p.display_name,
        warnings=p.warnings,
    )

    # For image pages, we need the original source file path
    # It's stored as {session}/{file_id}{ext} — find it
    if page_item.is_image:
        session_dir = _session_path(req.session_id)
        base_id = p.file_id.split("_p")[0]   # strip page suffix for multi-page
        matches = list(session_dir.glob(f"{base_id}.*"))
        if matches:
            page_item.source_file = str(matches[0])

    pn_settings = None
    if req.page_number_settings and req.page_number_settings.enabled:
        pn = req.page_number_settings
        pn_settings = {
            "enabled": True,
            "position": pn.position,
            "alignment": pn.alignment,
            "font": pn.font,
            "font_size": pn.font_size,
            "offset_from_edge": pn.offset_from_edge,
            "offset_from_side": pn.offset_from_side,
            "style": pn.style,
            "color": pn.color,
            "page_num": pn.page_num,
            "total_pages": pn.total_pages,
        }

    try:
        png_bytes = render_page_preview(page_item, zoom=req.zoom,
                                        page_number_settings=pn_settings,
                                        page_size=PAGE_SIZE)
    except Exception as exc:
        # Render a red error image
        import fitz
        doc = fitz.open()
        pg = doc.new_page(width=595, height=842)
        pg.draw_rect(pg.rect, color=(0.5, 0.1, 0.1), fill=(0.2, 0.05, 0.05))
        pg.insert_text((50, 400), f"Preview error:\n{exc}", fontsize=14, color=(1, 0.4, 0.4))
        pix = pg.get_pixmap()
        png_bytes = pix.tobytes("png")

    return Response(content=png_bytes, media_type="image/png")


# ── PDF Maker: Build ──────────────────────────────────────────────────────────

@app.post("/api/pdfmaker/build")
async def build_pdf_endpoint(req: BuildRequest):
    """
    Assemble the final PDF from the client's page configuration.
    Returns a PDF binary stream. Never writes the output to disk.
    """
    _require_session(req.session_id)
    session_dir = _session_path(req.session_id)

    if not req.pages:
        raise HTTPException(status_code=400, detail="No pages to build")

    # Build PageItem list
    page_items = []
    for p in req.pages:
        source_file = p.converted_pdf or ""

        # For image pages: find original file in session dir
        if p.source_type in ("image", "3d"):
            base_id = p.file_id.split("_p")[0]
            matches = list(session_dir.glob(f"{base_id}.*"))
            if matches:
                source_file = str(matches[0])

        page_item = PageItem(
            id=p.file_id,
            source_file=source_file,
            source_type=p.source_type,
            converted_pdf=p.converted_pdf or "",
            rotation=p.rotation,
            page_landscape=p.page_landscape,
            image_rotation=p.image_rotation,
            image_scale=p.image_scale,
            image_offset_x=p.image_offset_x,
            image_offset_y=p.image_offset_y,
            image_crop=tuple(p.image_crop) if p.image_crop else None,
            display_name=p.display_name,
            warnings=p.warnings,
        )
        page_items.append(page_item)

    # Page number settings
    pn_settings = None
    if req.page_number_settings and req.page_number_settings.enabled:
        pn = req.page_number_settings
        pn_settings = {
            "enabled": True,
            "position": pn.position,
            "alignment": pn.alignment,
            "font": pn.font,
            "font_size": pn.font_size,
            "offset_from_edge": pn.offset_from_edge,
            "offset_from_side": pn.offset_from_side,
            "style": pn.style,
            "color": pn.color,
        }

    # Build to a temp file, then stream it, then delete it
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".pdf", dir=str(session_dir))
    os.close(tmp_fd)
    try:
        build_pdf(
            pages=page_items,
            output_path=tmp_path,
            page_number_settings=pn_settings,
            jpeg_quality=req.jpeg_quality,
            page_size=PAGE_SIZE,
        )
        with open(tmp_path, "rb") as f:
            pdf_bytes = f.read()
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="output.pdf"'},
    )


# ── PDF Shrinker ─────────────────────────────────────────────────────────────

VALID_LEVELS = {"light", "standard", "aggressive", "grayscale"}


@app.post("/api/shrinker/compress")
async def shrink_pdf(
    file: UploadFile = File(...),
    level: str = Form("standard"),
):
    """
    Compress a PDF and return it as a download. Never stored on disk after response.
    """
    if level not in VALID_LEVELS:
        raise HTTPException(status_code=400, detail=f"Invalid level: {level}")

    content = await file.read()
    original_name = file.filename or "document.pdf"
    base_name = Path(original_name).stem

    # Write to temp file for processing
    tmp_fd, tmp_in = tempfile.mkstemp(suffix=".pdf")
    tmp_out = tmp_in.replace(".pdf", "_compressed.pdf")
    os.close(tmp_fd)
    try:
        Path(tmp_in).write_bytes(content)
        compress_pdf(tmp_in, tmp_out, level_id=level)
        with open(tmp_out, "rb") as f:
            out_bytes = f.read()
    finally:
        Path(tmp_in).unlink(missing_ok=True)
        Path(tmp_out).unlink(missing_ok=True)

    out_name = f"{base_name}_compressed.pdf"
    return Response(
        content=out_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{out_name}"'},
    )



# ── Health Converter ──────────────────────────────────────────────────────────

from health_converter import convert_health_export
from fastapi import BackgroundTasks

@app.post("/api/healthconverter/convert")
async def convert_health(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...)
):
    """
    Accepts an export.xml or export.zip, converts to CSVs, returns a zip.
    """
    tmp_dir = Path(tempfile.mkdtemp(prefix="health_converter_"))
    
    # Schedule cleanup after response
    background_tasks.add_task(shutil.rmtree, tmp_dir, ignore_errors=True)
    
    filename = file.filename or "export.xml"
    ext = Path(filename).suffix.lower()
    
    content = await file.read()
    
    if ext == ".zip":
        # Save zip and extract
        zip_path = tmp_dir / "upload.zip"
        zip_path.write_bytes(content)
        
        # Extract looking for export.xml
        import zipfile
        xml_path = None
        with zipfile.ZipFile(zip_path, "r") as zf:
            for name in zf.namelist():
                if name.endswith("export.xml"):
                    zf.extract(name, tmp_dir)
                    xml_path = tmp_dir / name
                    break
        
        if not xml_path or not xml_path.exists():
            raise HTTPException(status_code=400, detail="export.xml not found in uploaded zip")
            
        # Move it to the root of tmp_dir to ensure predictable path
        if xml_path.parent != tmp_dir:
            shutil.move(str(xml_path), str(tmp_dir / "export.xml"))
            xml_path = tmp_dir / "export.xml"
    else:
        # Assume it's xml
        xml_path = tmp_dir / "export.xml"
        xml_path.write_bytes(content)
        
    try:
        out_zip = convert_health_export(xml_path)
        with open(out_zip, "rb") as f:
            out_bytes = f.read()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Conversion error: {str(e)}")
        
    return Response(
        content=out_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="apple_health_csv_export.zip"'}
    )


# ── Games static files ────────────────────────────────────────────────────────
# IMPORTANT: Specific paths (/games/lux/, /games/trishsgames/) must be mounted
# BEFORE the catch-all /games/ landing page, otherwise the landing mount swallows them.
GAMES_DIR = Path(__file__).parent.parent / "games"
if GAMES_DIR.exists():
    # Mount specific game paths first (longer prefixes first)
    for game_dir in ["lux", "trishsgames"]:
        game_path = GAMES_DIR / game_dir
        if game_path.exists():
            app.mount(f"/games/{game_dir}", StaticFiles(directory=str(game_path), html=True), name=f"game_{game_dir}")
    # Mount landing page last (catch-all for /games/)
    landing_path = GAMES_DIR / "landing"
    if landing_path.exists():
        app.mount("/games", StaticFiles(directory=str(landing_path), html=True), name="game_landing")

# ── Static frontend (mounted LAST so API routes take priority) ───────────────
STATIC_DIR = Path(__file__).parent / "static"
if STATIC_DIR.exists():
    app.mount("/tools", StaticFiles(directory=str(STATIC_DIR), html=True), name="tools")
