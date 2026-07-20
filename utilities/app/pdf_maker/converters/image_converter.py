"""
Image Converter
===============
Converts image files (JPG, PNG, GIF, BMP, TIFF, WebP) into single-page
or multi-page (for animated GIFs) temp PDF files.

Each converted page becomes an independent single-page PDF in the temp dir.
"""

import io
import os
import tempfile
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF
from PIL import Image, ImageOps

# Standard page dimensions in points (1 pt = 1/72 inch)
PAGE_SIZES = {
    "A4":     (595.28, 841.89),
    "Letter": (612.0,  792.0),
}
MARGIN_PT = 36  # 0.5 inch margin on each side


def _apply_exif_orientation(img: Image.Image) -> Image.Image:
    """Correct image orientation using EXIF metadata."""
    try:
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass
    return img


def _pil_image_to_pdf_page(img: Image.Image, page_size: str = "A4") -> str:
    """
    Render a PIL Image onto a new single-page PDF.
    Returns the path to the temp PDF file.
    """
    pw, ph = PAGE_SIZES.get(page_size, PAGE_SIZES["A4"])

    # Flatten alpha channels (fitz doesn't like alpha PNGs on all platforms)
    if img.mode in ("RGBA", "LA", "P"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "P":
            img = img.convert("RGBA")
        if img.has_transparency_data or img.mode in ("RGBA", "LA"):
            background.paste(img, mask=img.split()[-1] if img.mode in ("RGBA", "LA") else None)
        else:
            background.paste(img)
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")

    img_w, img_h = img.size
    avail_w = pw - 2 * MARGIN_PT
    avail_h = ph - 2 * MARGIN_PT

    scale = min(avail_w / img_w, avail_h / img_h, 1.0)  # Never upscale beyond natural size
    scaled_w = img_w * scale
    scaled_h = img_h * scale

    x_offset = (pw - scaled_w) / 2
    y_offset = (ph - scaled_h) / 2

    # Convert PIL → bytes for fitz
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    img_bytes = buf.getvalue()

    doc = fitz.open()
    page = doc.new_page(width=pw, height=ph)
    rect = fitz.Rect(x_offset, y_offset, x_offset + scaled_w, y_offset + scaled_h)
    page.insert_image(rect, stream=img_bytes)

    tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    tmp_path = tmp.name
    tmp.close()
    doc.save(tmp_path)
    doc.close()
    return tmp_path


def convert_image_to_pages(
    image_path: str,
    page_size: str = "A4",
    gif_all_frames: bool = True,
) -> list[str]:
    """
    Convert an image file to one or more single-page temp PDFs.

    For animated GIFs each frame becomes its own page (if gif_all_frames=True).
    Returns a list of temp PDF paths.
    Raises ValueError on unrecoverable error.
    """
    try:
        img = Image.open(image_path)
    except Exception as e:
        raise ValueError(f"Cannot open image '{Path(image_path).name}': {e}") from e

    img = _apply_exif_orientation(img)

    # Collect frames (handles GIF animation transparently)
    frames: list[Image.Image] = []
    try:
        while True:
            frames.append(img.copy().convert("RGB"))
            if not gif_all_frames:
                break
            img.seek(img.tell() + 1)
    except EOFError:
        pass
    except AttributeError:
        # Non-animated image
        frames = [img.convert("RGB")]

    if not frames:
        frames = [img.convert("RGB")]

    result: list[str] = []
    for frame in frames:
        pdf_path = _pil_image_to_pdf_page(frame, page_size)
        result.append(pdf_path)

    return result
