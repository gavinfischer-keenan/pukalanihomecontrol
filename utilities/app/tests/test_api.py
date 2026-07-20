"""
FastAPI endpoint tests for the Utilities backend.
Run with: pytest tests/test_api.py -v
"""
import io
import pytest
from pathlib import Path
from httpx import AsyncClient, ASGITransport

# Add parent to path so imports resolve
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from main import app


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


# ── Health ────────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_health(client):
    r = await client.get("/api/health")
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert data["service"] == "utilities"


# ── Sessions ──────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_create_session(client, tmp_path, monkeypatch):
    import main
    monkeypatch.setattr(main, "SESSIONS_DIR", tmp_path)
    r = await client.post("/api/pdfmaker/session")
    assert r.status_code == 200
    sid = r.json()["session_id"]
    assert len(sid) == 36   # UUID length


@pytest.mark.anyio
async def test_delete_session(client, tmp_path, monkeypatch):
    import main
    monkeypatch.setattr(main, "SESSIONS_DIR", tmp_path)
    r = await client.post("/api/pdfmaker/session")
    sid = r.json()["session_id"]
    r2 = await client.delete(f"/api/pdfmaker/session/{sid}")
    assert r2.status_code == 200
    assert r2.json()["ok"] is True


# ── Import ────────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_import_png(client, tmp_path, monkeypatch):
    """Upload a real PNG and get back a page list."""
    import main
    monkeypatch.setattr(main, "SESSIONS_DIR", tmp_path)

    # Create session
    r = await client.post("/api/pdfmaker/session")
    sid = r.json()["session_id"]
    # Touch the .last_active marker so _require_session passes
    (tmp_path / sid / ".last_active").touch()

    # Create a tiny test PNG in memory
    from PIL import Image
    img = Image.new("RGB", (100, 100), color=(255, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)

    r2 = await client.post(
        "/api/pdfmaker/import",
        data={"session_id": sid},
        files={"files": ("test.png", buf, "image/png")},
    )
    assert r2.status_code == 200
    pages = r2.json()["pages"]
    assert len(pages) == 1
    assert pages[0]["source_type"] == "image"
    assert pages[0]["display_name"] == "test.png"
    assert pages[0]["file_id"] is not None


@pytest.mark.anyio
async def test_import_unsupported_type(client, tmp_path, monkeypatch):
    """Unsupported file type returns a page with a warning."""
    import main
    monkeypatch.setattr(main, "SESSIONS_DIR", tmp_path)

    r = await client.post("/api/pdfmaker/session")
    sid = r.json()["session_id"]
    (tmp_path / sid / ".last_active").touch()

    r2 = await client.post(
        "/api/pdfmaker/import",
        data={"session_id": sid},
        files={"files": ("file.xyz", b"data", "application/octet-stream")},
    )
    assert r2.status_code == 200
    pages = r2.json()["pages"]
    assert pages[0]["source_type"] == "unknown"
    assert len(pages[0]["warnings"]) > 0


# ── Shrinker ──────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_shrinker_returns_pdf(client, tmp_path):
    """Upload a tiny valid PDF and get a compressed PDF back."""
    import fitz
    doc = fitz.open()
    doc.new_page()
    doc.new_page()
    pdf_bytes = doc.tobytes()
    doc.close()

    r = await client.post(
        "/api/shrinker/compress",
        data={"level": "light"},
        files={"file": ("test.pdf", io.BytesIO(pdf_bytes), "application/pdf")},
    )
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content[:4] == b"%PDF"


@pytest.mark.anyio
async def test_shrinker_invalid_level(client):
    """Invalid compression level returns 400."""
    r = await client.post(
        "/api/shrinker/compress",
        data={"level": "ultra-mega"},
        files={"file": ("x.pdf", b"%PDF-1.4", "application/pdf")},
    )
    assert r.status_code == 400
