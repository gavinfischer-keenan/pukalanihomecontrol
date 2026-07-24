"""
PDF Handler
===========
Imports pages from existing PDF files into individual single-page temp PDFs.
Handles corrupt PDFs gracefully with error pages.
"""

import os
import tempfile
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF


def get_pdf_page_count(pdf_path: str) -> int:
    """Return the number of pages in a PDF (0 if unreadable)."""
    try:
        doc = fitz.open(pdf_path)
        count = len(doc)
        doc.close()
        return count
    except Exception:
        return 0


def convert_pdf_to_pages(
    pdf_path: str,
    page_size: str = "A4",  # Reserved for future scaling option
) -> tuple[list[str], list[str]]:
    """
    Import all pages from an existing PDF into individual single-page temp PDFs.

    Returns:
        (list_of_temp_pdf_paths, list_of_warning_strings)
    """
    warnings: list[str] = []

    try:
        src_doc = fitz.open(pdf_path)
    except Exception as e:
        warnings.append(f"❌ Cannot open PDF: {e}")
        # Return an error page
        err_path = _make_error_page(f"Cannot open PDF:\n{Path(pdf_path).name}\n\n{e}")
        return [err_path], warnings

    if len(src_doc) == 0:
        warnings.append("⚠️ PDF has no pages.")
        src_doc.close()
        err_path = _make_error_page(f"PDF has no pages:\n{Path(pdf_path).name}")
        return [err_path], warnings

    temp_paths: list[str] = []
    for i in range(len(src_doc)):
        try:
            new_doc = fitz.open()
            new_doc.insert_pdf(src_doc, from_page=i, to_page=i)
            tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
            tmp_path = tmp.name
            tmp.close()
            new_doc.save(tmp_path)
            new_doc.close()
            temp_paths.append(tmp_path)
        except Exception as e:
            warnings.append(f"⚠️ Page {i + 1} could not be extracted: {e}")
            err_path = _make_error_page(f"Page {i + 1} extraction failed:\n{e}")
            temp_paths.append(err_path)

    src_doc.close()
    return temp_paths, warnings


def _make_error_page(message: str, page_size: str = "A4") -> str:
    """Create a single-page error PDF and return its temp path."""
    dims = {"A4": (595.28, 841.89), "Letter": (612.0, 792.0)}
    pw, ph = dims.get(page_size, dims["A4"])
    doc = fitz.open()
    page = doc.new_page(width=pw, height=ph)
    # Draw a light red background strip
    page.draw_rect(fitz.Rect(36, 36, pw - 36, 120), color=(0.9, 0.2, 0.2), fill=(1, 0.9, 0.9))
    page.insert_text(
        (50, 70), "⚠ Import Error", fontsize=14, color=(0.7, 0, 0)
    )
    page.insert_text(
        (50, 100), message, fontsize=10, color=(0.3, 0.0, 0.0)
    )
    tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    tmp_path = tmp.name
    tmp.close()
    doc.save(tmp_path)
    doc.close()
    return tmp_path
