"""
PDF Compressor
==============
Standalone module — no UI dependencies.

Provides four compression levels mirroring common industry tools:
  light      — non-destructive (stream compression, dedup, metadata strip)
  standard   — Adobe free / Apple Quartz equivalent (150 DPI, JPEG 75%)
  aggressive — maximum lossy (96 DPI, JPEG 50%, strip annotations)
  grayscale  — destructive colour removal (120 DPI, JPEG 65%, B&W)

Public API
----------
  COMPRESSION_LEVELS   : dict[str, dict]   — all level configs
  compress_pdf(...)    -> CompressionResult
  CompressionResult    : dataclass

Adding a new level
------------------
Add one entry to COMPRESSION_LEVELS. Nothing else needs changing.
"""

from __future__ import annotations

import io
import os
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional


# ---------------------------------------------------------------------------
# Level registry — the single source of truth for all compression strategies
# ---------------------------------------------------------------------------

COMPRESSION_LEVELS: dict[str, dict] = {
    "light": {
        "label":       "Light — Non-destructive",
        "description": (
            "Removes duplicate objects, compresses streams, strips metadata "
            "and embedded thumbnails. Zero image resampling — no quality loss."
        ),
        "destructive":   False,
        "warning":       None,
        "max_image_dpi": None,    # no resampling
        "jpeg_quality":  None,    # no re-encoding
        "grayscale":     False,
        "strip_annots":  False,
        "flatten_forms": False,
    },
    "standard": {
        "label":       "Standard — Adobe Free / Apple Quartz",
        "description": (
            "Images downsampled to 150 DPI and re-encoded at JPEG 75%. "
            "Imperceptible quality loss for screen viewing and A4/Letter printing."
        ),
        "destructive":   False,
        "warning":       (
            "Note: 150 DPI is optimised for screen and A4/Letter printing. "
            "For large-format printing (A1/A2 posters) use Light instead."
        ),
        "max_image_dpi": 150,
        "jpeg_quality":  75,
        "grayscale":     False,
        "strip_annots":  False,
        "flatten_forms": False,
    },
    "aggressive": {
        "label":       "Aggressive — Maximum Size Reduction",
        "description": (
            "Images at 96 DPI / JPEG 50%. Visible quality loss on photos. "
            "Annotations and form fields are removed. Good for email sharing."
        ),
        "destructive":   True,
        "warning":       (
            "⚠️  Destructive: Visible image quality loss. "
            "Annotations and interactive form fields will be permanently removed."
        ),
        "max_image_dpi": 96,
        "jpeg_quality":  50,
        "grayscale":     False,
        "strip_annots":  True,
        "flatten_forms": True,
    },
    "grayscale": {
        "label":       "Grayscale — Smallest Possible",
        "description": (
            "Converts all colour images to greyscale (120 DPI / JPEG 65%). "
            "Colour information is permanently and irreversibly removed."
        ),
        "destructive":   True,
        "warning":       (
            "🔴  Destructive: Colour information is permanently removed. "
            "This cannot be undone."
        ),
        "max_image_dpi": 120,
        "jpeg_quality":  65,
        "grayscale":     True,
        "strip_annots":  True,
        "flatten_forms": True,
    },
}


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------

@dataclass
class CompressionResult:
    success:      bool
    input_bytes:  int   = 0
    output_bytes: int   = 0
    savings_pct:  float = 0.0
    error:        str   = ""

    @property
    def input_kb(self) -> float:
        return self.input_bytes / 1024

    @property
    def output_kb(self) -> float:
        return self.output_bytes / 1024

    @property
    def input_mb(self) -> float:
        return self.input_bytes / (1024 * 1024)

    @property
    def output_mb(self) -> float:
        return self.output_bytes / (1024 * 1024)

    def size_label(self, n_bytes: int) -> str:
        """Human-readable size string."""
        if n_bytes >= 1_048_576:
            return f"{n_bytes / 1_048_576:.2f} MB"
        if n_bytes >= 1024:
            return f"{n_bytes / 1024:.1f} KB"
        return f"{n_bytes} B"

    @property
    def input_label(self) -> str:
        return self.size_label(self.input_bytes)

    @property
    def output_label(self) -> str:
        return self.size_label(self.output_bytes)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _get_image_dpi(img_dict: dict, page_width_pt: float, page_height_pt: float) -> float:
    """
    Estimate the effective DPI of an image on a page.
    Falls back to 150 if dimensions are unavailable.
    """
    try:
        w_px = img_dict.get("width",  0)
        h_px = img_dict.get("height", 0)
        if w_px > 0 and page_width_pt > 0:
            return (w_px / page_width_pt) * 72.0   # 1 pt = 1/72 inch
    except Exception:
        pass
    return 150.0


def _resample_image(
    img_bytes: bytes,
    img_ext:   str,
    jpeg_quality:  int,
    max_dpi:       Optional[int],
    current_dpi:   float,
    grayscale:     bool,
) -> Optional[bytes]:
    """
    Re-encode a single image using PIL.

    Returns new JPEG bytes, or None if re-encoding failed / not worth it.
    """
    try:
        from PIL import Image

        img = Image.open(io.BytesIO(img_bytes))
        original_mode = img.mode

        # Convert RGBA / P to RGB for JPEG
        if img.mode in ("RGBA", "P", "LA"):
            bg = Image.new("RGB", img.size, (255, 255, 255))
            if img.mode in ("RGBA", "LA"):
                bg.paste(img, mask=img.split()[-1])
            else:
                bg.paste(img)
            img = bg
        elif img.mode not in ("RGB", "L", "CMYK"):
            img = img.convert("RGB")

        # Downsample if DPI exceeds target
        if max_dpi and current_dpi > max_dpi:
            scale = max_dpi / current_dpi
            new_w = max(1, int(img.width  * scale))
            new_h = max(1, int(img.height * scale))
            img = img.resize((new_w, new_h), Image.LANCZOS)

        # Grayscale conversion
        if grayscale and img.mode != "L":
            img = img.convert("L")

        # Encode as JPEG
        buf = io.BytesIO()
        save_mode = img.mode
        if save_mode == "CMYK":
            # JPEG supports CMYK
            img.save(buf, format="JPEG", quality=jpeg_quality, optimize=True)
        elif save_mode == "L":
            img.save(buf, format="JPEG", quality=jpeg_quality, optimize=True)
        else:
            img = img.convert("RGB")
            img.save(buf, format="JPEG", quality=jpeg_quality, optimize=True)

        return buf.getvalue()

    except Exception as e:
        print(f"[Compressor] Image re-encode failed: {e}")
        return None


# ---------------------------------------------------------------------------
# Core compression function
# ---------------------------------------------------------------------------

def compress_pdf(
    input_path:  str,
    output_path: str,
    level_id:    str,
    progress_cb: Optional[Callable[[str, float], None]] = None,
) -> CompressionResult:
    """
    Compress a PDF file.

    Parameters
    ----------
    input_path  : Path to the source PDF.
    output_path : Path to write the compressed PDF (may equal input_path).
    level_id    : One of the keys in COMPRESSION_LEVELS.
    progress_cb : Optional callable(message: str, fraction: float).
                  fraction is 0.0 → 1.0.

    Returns
    -------
    CompressionResult
    """
    import fitz  # PyMuPDF

    def _progress(msg: str, frac: float) -> None:
        if progress_cb:
            try:
                progress_cb(msg, frac)
            except Exception:
                pass

    # ------------------------------------------------------------------
    # Validate
    # ------------------------------------------------------------------
    if level_id not in COMPRESSION_LEVELS:
        return CompressionResult(
            success=False,
            error=f"Unknown compression level: '{level_id}'. "
                  f"Valid levels: {list(COMPRESSION_LEVELS.keys())}",
        )

    cfg = COMPRESSION_LEVELS[level_id]
    input_path  = str(input_path)
    output_path = str(output_path)

    if not os.path.isfile(input_path):
        return CompressionResult(success=False, error=f"File not found: {input_path}")

    input_bytes = os.path.getsize(input_path)

    # ------------------------------------------------------------------
    # Work in a temp file so we never corrupt the original on failure
    # ------------------------------------------------------------------
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".pdf")
    os.close(tmp_fd)

    try:
        _progress("Opening PDF…", 0.02)
        doc = fitz.open(input_path)
        n_pages = doc.page_count

        # ----------------------------------------------------------
        # Strip metadata / XMP
        # ----------------------------------------------------------
        _progress("Stripping metadata…", 0.05)
        try:
            doc.set_metadata({})          # clear info dict
            doc.del_xml_metadata()        # remove XMP stream
        except Exception:
            pass

        # ----------------------------------------------------------
        # Remove thumbnails from every page
        # ----------------------------------------------------------
        _progress("Removing thumbnails…", 0.08)
        try:
            for page in doc:
                # Thumbnail xobject key is /Thumb in the page dict
                xref = page.xref
                try:
                    doc.xref_set_key(xref, "Thumb", "null")
                except Exception:
                    pass
        except Exception:
            pass

        # ----------------------------------------------------------
        # Strip annotations (aggressive / grayscale only)
        # ----------------------------------------------------------
        if cfg["strip_annots"]:
            _progress("Removing annotations…", 0.10)
            for page in doc:
                try:
                    for annot in page.annots():
                        page.delete_annot(annot)
                except Exception:
                    pass

        # ----------------------------------------------------------
        # Flatten form fields (aggressive / grayscale only)
        # ----------------------------------------------------------
        if cfg["flatten_forms"]:
            _progress("Flattening forms…", 0.12)
            try:
                # bake() flattens widgets to static content
                doc.bake(annots=False, widgets=True)
            except Exception:
                pass

        # ----------------------------------------------------------
        # Image resampling (standard / aggressive / grayscale)
        # ----------------------------------------------------------
        max_dpi      = cfg["max_image_dpi"]
        jpeg_quality = cfg["jpeg_quality"]
        do_grayscale = cfg["grayscale"]

        if max_dpi or do_grayscale:
            _progress("Resampling images…", 0.15)
            total_images = 0
            done_images  = 0

            # Count total images first for progress
            for page in doc:
                try:
                    total_images += len(doc.get_page_images(page.number, full=True))
                except Exception:
                    pass

            if total_images == 0:
                total_images = 1  # avoid div-by-zero

            for page_idx, page in enumerate(doc):
                pw_pt = page.rect.width
                ph_pt = page.rect.height

                try:
                    img_list = doc.get_page_images(page.number, full=True)
                except Exception:
                    img_list = []

                for img_info in img_list:
                    xref  = img_info[0]
                    w_px  = img_info[2]
                    h_px  = img_info[3]

                    # Estimate current DPI
                    current_dpi = (w_px / pw_pt) * 72.0 if pw_pt > 0 else 150.0

                    # Skip if already within target DPI and not grayscale
                    if (not do_grayscale
                            and max_dpi
                            and current_dpi <= max_dpi * 1.05):  # 5% tolerance
                        done_images += 1
                        continue

                    try:
                        raw = doc.extract_image(xref)
                        if not raw:
                            done_images += 1
                            continue

                        img_bytes = raw["image"]
                        img_ext   = raw.get("ext", "png")

                        # Skip masks and very small images
                        if w_px * h_px < 100:
                            done_images += 1
                            continue

                        new_bytes = _resample_image(
                            img_bytes, img_ext,
                            jpeg_quality=jpeg_quality or 75,
                            max_dpi=max_dpi,
                            current_dpi=current_dpi,
                            grayscale=do_grayscale,
                        )

                        if new_bytes and len(new_bytes) < len(img_bytes):
                            # Replace image stream in the PDF
                            doc.update_stream(xref, new_bytes)
                            # Update colorspace and filter metadata
                            try:
                                colorspace = (
                                    "/DeviceGray" if do_grayscale else "/DeviceRGB"
                                )
                                doc.xref_set_key(xref, "ColorSpace", colorspace)
                                doc.xref_set_key(xref, "Filter", "/DCTDecode")
                                # Update dimensions if downsampled
                                from PIL import Image as PilImage
                                with PilImage.open(io.BytesIO(new_bytes)) as chk:
                                    doc.xref_set_key(xref, "Width",  str(chk.width))
                                    doc.xref_set_key(xref, "Height", str(chk.height))
                            except Exception:
                                pass

                    except Exception as e:
                        print(f"[Compressor] xref {xref}: {e}")

                    done_images += 1
                    frac = 0.15 + 0.65 * (done_images / total_images)
                    _progress(
                        f"Resampling images… {done_images}/{total_images}",
                        min(frac, 0.80),
                    )

        # ----------------------------------------------------------
        # Subset fonts
        # ----------------------------------------------------------
        _progress("Subsetting fonts…", 0.82)
        try:
            doc.subset_fonts(fallback=True)
        except Exception:
            pass

        # ----------------------------------------------------------
        # Save with maximum stream compression
        # ----------------------------------------------------------
        _progress("Saving compressed PDF…", 0.90)
        doc.save(
            tmp_path,
            garbage=4,            # remove unused/duplicate objects
            deflate=True,         # compress content streams
            deflate_images=True,  # compress image streams
            deflate_fonts=True,   # compress font streams
            clean=True,           # sanitise content streams
            pretty=False,
        )
        doc.close()

        # ----------------------------------------------------------
        # Move temp file to output path
        # ----------------------------------------------------------
        _progress("Finalising…", 0.97)
        # Ensure output dir exists
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        shutil.move(tmp_path, output_path)
        tmp_path = None  # consumed

        output_bytes = os.path.getsize(output_path)
        savings_pct  = (
            100.0 * (input_bytes - output_bytes) / input_bytes
            if input_bytes > 0 else 0.0
        )

        _progress("Done.", 1.0)
        return CompressionResult(
            success=True,
            input_bytes=input_bytes,
            output_bytes=output_bytes,
            savings_pct=round(savings_pct, 1),
        )

    except Exception as e:
        import traceback
        err = f"{e}\n{traceback.format_exc()}"
        print(f"[Compressor] Failed: {err}")
        return CompressionResult(success=False, error=str(e))

    finally:
        # Clean up temp file if something went wrong before the move
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Convenience: suggest output path
# ---------------------------------------------------------------------------

def suggest_output_path(input_path: str) -> str:
    """Return a default output path: <stem>_compressed.<ext>."""
    p = Path(input_path)
    return str(p.with_stem(p.stem + "_compressed"))
