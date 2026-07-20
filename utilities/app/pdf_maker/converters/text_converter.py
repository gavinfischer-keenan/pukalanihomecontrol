"""
Text Converter
==============
Converts plain-text files (.txt) into multi-page PDFs using ReportLab.

If the text file is corrupted or unreadable, falls back to an error page.
"""

import os
import tempfile
from pathlib import Path

from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.styles import ParagraphStyle
# reportlab.lib.units does not export 'pt' — use raw point values directly
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.colors import HexColor

PAGE_SIZES = {
    "A4":     A4,
    "Letter": letter,
}

FONT_FAMILY = "Courier"
FONT_SIZE_PT = 10
LEADING_PT   = 14
MARGIN_PT    = 54   # 0.75 inch


def _read_text_safely(file_path: str) -> tuple[str, list[str]]:
    """Try multiple encodings. Returns (text_content, warnings)."""
    warnings: list[str] = []
    for encoding in ("utf-8", "utf-8-sig", "latin-1", "cp1252"):
        try:
            with open(file_path, "r", encoding=encoding, errors="strict") as f:
                return f.read(), warnings
        except (UnicodeDecodeError, LookupError):
            continue

    # Last resort: read as binary, replace bad chars
    warnings.append("⚠️ Encoding could not be detected — some characters may appear incorrect.")
    with open(file_path, "rb") as f:
        raw = f.read()
    return raw.decode("utf-8", errors="replace"), warnings


def _escape_xml(text: str) -> str:
    """Escape characters that break ReportLab's XML paragraph parser."""
    return (
        text
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def convert_text_to_pages(
    text_path: str,
    page_size: str = "A4",
) -> tuple[list[str], list[str]]:
    """
    Convert a text file to one or more single-page temp PDFs.

    Returns:
        (list_of_temp_pdf_paths, list_of_warning_strings)
    """
    warnings: list[str] = []

    # 1. Read content
    try:
        text, read_warnings = _read_text_safely(text_path)
        warnings.extend(read_warnings)
    except Exception as e:
        warnings.append(f"❌ Could not read file: {e}")
        text = f"[Error reading file: {Path(text_path).name}]\n{e}"

    # 2. Build PDF with ReportLab
    tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    tmp_path = tmp.name
    tmp.close()

    page_dims = PAGE_SIZES.get(page_size, A4)

    doc = SimpleDocTemplate(
        tmp_path,
        pagesize=page_dims,
        rightMargin=MARGIN_PT,
        leftMargin=MARGIN_PT,
        topMargin=MARGIN_PT,
        bottomMargin=MARGIN_PT,
    )

    body_style = ParagraphStyle(
        name="TextBody",
        fontName=FONT_FAMILY,
        fontSize=FONT_SIZE_PT,
        leading=LEADING_PT,
        alignment=TA_LEFT,
        textColor=HexColor("#000000"),
        wordWrap="CJK",  # Handles long lines without spaces
    )

    story = []
    lines = text.splitlines()
    for line in lines:
        escaped = _escape_xml(line)
        if escaped.strip():
            story.append(Paragraph(escaped, body_style))
        else:
            story.append(Spacer(1, LEADING_PT))

    if not story:
        story.append(Paragraph("[Empty file]", body_style))

    try:
        doc.build(story)
    except Exception as e:
        warnings.append(f"⚠️ PDF generation error: {e}")
        # Write a minimal fallback
        _write_error_pdf(tmp_path, str(e), page_dims)

    # 3. Split the multi-page PDF into individual page PDFs
    return _split_pdf_to_pages(tmp_path, cleanup_source=True), warnings


def _write_error_pdf(path: str, error_msg: str, page_dims) -> None:
    """Write a simple error-page PDF."""
    try:
        import fitz
        doc = fitz.open()
        pw, ph = page_dims
        page = doc.new_page(width=pw, height=ph)
        page.insert_text((72, 72), f"Error rendering text:\n{error_msg}", fontsize=12)
        doc.save(path)
        doc.close()
    except Exception:
        pass


def _split_pdf_to_pages(pdf_path: str, cleanup_source: bool = False) -> list[str]:
    """Split a multi-page PDF into individual single-page temp PDFs."""
    import fitz
    src = fitz.open(pdf_path)
    temp_paths: list[str] = []
    for i in range(len(src)):
        new_doc = fitz.open()
        new_doc.insert_pdf(src, from_page=i, to_page=i)
        tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
        tmp_path = tmp.name
        tmp.close()
        new_doc.save(tmp_path)
        new_doc.close()
        temp_paths.append(tmp_path)
    src.close()
    if cleanup_source:
        try:
            os.unlink(pdf_path)
        except Exception:
            pass
    return temp_paths
