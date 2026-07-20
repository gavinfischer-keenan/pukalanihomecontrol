"""
Application Controller
======================
Central state management and event bus for PDF Maker.
All UI panels share a single instance of this class.
"""

import os
import tempfile
import threading
import uuid
import dataclasses
from pathlib import Path
from typing import Callable, Optional

from .settings_manager import SettingsManager
from .converters.pdf_builder import PageItem, build_pdf, render_page_preview
from .utils.file_utils import get_file_type


# ---------------------------------------------------------------------------
# Event names (used by all UI panels to subscribe/publish)
# ---------------------------------------------------------------------------
EVT_PAGES_CHANGED    = "pages_changed"
EVT_PAGE_SELECTED    = "page_selected"
EVT_PAGE_ROTATED     = "page_rotated"
EVT_PAGE_LANDSCAPE   = "page_landscape"
EVT_PROGRESS         = "progress"
EVT_STATUS           = "status"
EVT_RESET            = "reset"
EVT_WARNINGS         = "warnings"
EVT_MODE_CHANGED     = "mode_changed"
EVT_APPLY_CROP       = "apply_crop"


class AppController:
    """
    Central application controller.

    Holds all document state and dispatches events to UI listeners.
    UI panels register listeners via `on(event, callback)`.
    """

    def __init__(self, settings: SettingsManager):
        self.settings:       SettingsManager    = settings
        self.pages:          list[PageItem]     = []
        self.current_index:  int                = -1
        self.editor_mode:    str                = "resize"  # "resize" | "crop"
        self._listeners:     dict[str, list[Callable]] = {}
        self._temp_dir:      str                = tempfile.mkdtemp(prefix="pdfmaker_")
        self._lock                              = threading.Lock()
        
        # Single-level undo for page actions (resize, crop)
        self._last_action_index: int | None = None
        self._last_action_state: PageItem | None = None

    # ------------------------------------------------------------------ #
    # Event bus
    # ------------------------------------------------------------------ #

    def on(self, event: str, callback: Callable) -> None:
        """Register a listener for an event."""
        self._listeners.setdefault(event, []).append(callback)

    def emit(self, event: str, data=None) -> None:
        """Fire all listeners for an event."""
        for cb in self._listeners.get(event, []):
            try:
                cb(data)
            except Exception as e:
                print(f"[AppController] Listener error on '{event}': {e}")

    # ------------------------------------------------------------------ #
    # File adding
    # ------------------------------------------------------------------ #

    def add_files(
        self,
        file_paths: list[str],
        done_callback: Optional[Callable] = None,
        import_progress_callback: Optional[Callable] = None,
    ) -> None:
        """
        Convert and add files in a background thread.

        import_progress_callback(current, total, filename) fires for each file
        so the UI can show a progress bar.
        """
        def _worker():
            all_warnings: list[str] = []
            new_pages:    list[PageItem] = []
            total = len(file_paths)

            for i, fpath in enumerate(file_paths):
                fname = Path(fpath).name
                # Notify progress BEFORE processing so bar starts at 0
                if import_progress_callback:
                    import_progress_callback(i, total, fname)
                self.emit(EVT_STATUS, f"Converting {fname}…")

                ftype = get_file_type(fpath)
                try:
                    pages, warnings = self._convert_file(fpath, ftype)
                    all_warnings.extend(warnings)
                    new_pages.extend(pages)
                except Exception as e:
                    import traceback
                    detail = traceback.format_exc()
                    print(f"[Controller] Error converting {fname}:\n{detail}")
                    all_warnings.append(f"❌ Failed: '{fname}': {e}")

            # Update state once (lock protects the list)
            with self._lock:
                self.pages.extend(new_pages)
                if self.current_index < 0 and self.pages:
                    self.current_index = 0

            # Signal completion progress (fires done callback in UI)
            if import_progress_callback:
                import_progress_callback(total, total, "")

            # Emit UI events — the UI panels must schedule these on the main thread
            self.emit(EVT_PAGES_CHANGED, None)
            if all_warnings:
                self.emit(EVT_WARNINGS, all_warnings)
            self.emit(EVT_STATUS, f"Ready — {len(self.pages)} page(s)")

            if done_callback:
                done_callback(new_pages, all_warnings)

        threading.Thread(target=_worker, daemon=True).start()


    def _convert_file(self, fpath: str, ftype: str) -> tuple[list[PageItem], list[str]]:
        """Dispatch to the appropriate converter and wrap results in PageItems."""
        page_size = self.settings.get("page_size", "A4")

        if ftype == "image":
            from .converters.image_converter import convert_image_to_pages
            temp_pdfs = convert_image_to_pages(fpath, page_size)
            return self._wrap(fpath, ftype, temp_pdfs, [])

        elif ftype == "text":
            from .converters.text_converter import convert_text_to_pages
            temp_pdfs, warnings = convert_text_to_pages(fpath, page_size)
            return self._wrap(fpath, ftype, temp_pdfs, warnings)

        elif ftype == "word":
            from .converters.docx_converter import convert_docx_to_pages
            temp_pdfs, warnings = convert_docx_to_pages(fpath, page_size)
            return self._wrap(fpath, ftype, temp_pdfs, warnings)

        elif ftype == "pdf":
            from .converters.pdf_handler import convert_pdf_to_pages
            temp_pdfs, warnings = convert_pdf_to_pages(fpath, page_size)
            return self._wrap(fpath, ftype, temp_pdfs, warnings)

        elif ftype == "3d":
            from .converters.gltf_converter import convert_3d_to_pages
            temp_pdfs, warnings = convert_3d_to_pages(fpath, page_size)
            return self._wrap(fpath, ftype, temp_pdfs, warnings)

        else:
            from .converters.image_converter import convert_image_to_pages
            try:
                temp_pdfs = convert_image_to_pages(fpath, page_size)
                warnings  = [f"ℹ️ '{Path(fpath).name}' treated as image (unknown type)."]
                return self._wrap(fpath, "unknown", temp_pdfs, warnings)
            except Exception as e:
                from .converters.pdf_handler import _make_error_page
                err   = _make_error_page(f"Unsupported file:\n{Path(fpath).name}\n\n{e}")
                warns = [f"❌ Could not import '{Path(fpath).name}': {e}"]
                return self._wrap(fpath, "unknown", [err], warns)

    @staticmethod
    def _wrap(
        source_file: str,
        source_type: str,
        temp_pdfs:   list[str],
        warnings:    list[str],
    ) -> tuple[list[PageItem], list[str]]:
        fname = Path(source_file).name
        items = []
        for i, pdf_path in enumerate(temp_pdfs):
            label = fname if len(temp_pdfs) == 1 else f"{fname} (p.{i + 1})"
            items.append(PageItem(
                id=str(uuid.uuid4()),
                source_file=source_file,
                source_type=source_type,
                converted_pdf=pdf_path,
                rotation=0,
                display_name=label,
                warnings=warnings if i == 0 else [],
            ))
        return items, warnings

    # ------------------------------------------------------------------ #
    # Page manipulation
    # ------------------------------------------------------------------ #

    def select_page(self, index: int) -> None:
        if 0 <= index < len(self.pages):
            self.current_index = index
            self.emit(EVT_PAGE_SELECTED, index)

    def remove_page(self, index: int) -> None:
        if 0 <= index < len(self.pages):
            self.pages.pop(index)
            if self.current_index >= len(self.pages):
                self.current_index = len(self.pages) - 1
            self.emit(EVT_PAGES_CHANGED, None)

    def move_page_up(self, index: int) -> None:
        if index > 0:
            self.pages[index], self.pages[index - 1] = (
                self.pages[index - 1], self.pages[index]
            )
            self.current_index = index - 1
            self.emit(EVT_PAGES_CHANGED, None)
            self.emit(EVT_PAGE_SELECTED, self.current_index)

    def move_page_down(self, index: int) -> None:
        if index < len(self.pages) - 1:
            self.pages[index], self.pages[index + 1] = (
                self.pages[index + 1], self.pages[index]
            )
            self.current_index = index + 1
            self.emit(EVT_PAGES_CHANGED, None)
            self.emit(EVT_PAGE_SELECTED, self.current_index)

    def rotate_page(self, index: int, degrees: int) -> None:
        """
        Rotate a page.
        - For IMAGE pages: rotates only the image content (page stays portrait/landscape).
        - For non-image pages: rotates the whole page (PDF-level set_rotation).
        """
        if 0 <= index < len(self.pages):
            page = self.pages[index]
            if page.is_image:
                page.image_rotation = degrees % 360
            else:
                page.rotation = degrees % 360
            self.emit(EVT_PAGE_ROTATED, index)

    def rotate_all_pages(self, degrees: int) -> None:
        """Rotate all pages (image_rotation for images, rotation for others)."""
        for page in self.pages:
            if page.is_image:
                page.image_rotation = degrees % 360
            else:
                page.rotation = degrees % 360
        self.emit(EVT_PAGES_CHANGED, None)

    def set_page_landscape(self, index: int, landscape: bool) -> None:
        """Toggle portrait / landscape for a single page (image pages only)."""
        if 0 <= index < len(self.pages):
            self.pages[index].page_landscape = landscape
            self.emit(EVT_PAGE_ROTATED, index)   # Reuses PAGE_ROTATED to trigger re-render

    def toggle_page_landscape(self, index: int) -> None:
        """Toggle the orientation of a single page."""
        if 0 <= index < len(self.pages):
            self.pages[index].page_landscape = not self.pages[index].page_landscape
            self.emit(EVT_PAGE_ROTATED, index)

    def set_all_landscape(self, landscape: bool) -> None:
        """Set all pages to portrait or landscape."""
        for page in self.pages:
            page.page_landscape = landscape
        self.emit(EVT_PAGES_CHANGED, None)

    def resize_image(self, index: int, scale: float,
                     offset_x: float = 0.0, offset_y: float = 0.0) -> None:
        """
        Resize an image page by setting image_scale.
        scale=1.0 means fill page edge-to-edge.
        offset_x/y shift the image from centre (in points).
        """
        if 0 <= index < len(self.pages):
            page = self.pages[index]
            if page.is_image:
                self._save_undo_state(index)
                page.image_scale    = max(0.05, min(10.0, scale))
                page.image_offset_x = offset_x
                page.image_offset_y = offset_y
                self.emit(EVT_PAGE_ROTATED, index)  # trigger preview re-render

    def set_image_crop(self, index: int, crop: tuple[float, float, float, float] | None) -> None:
        """Set the crop box (left, top, right, bottom percentages) for an image page."""
        if 0 <= index < len(self.pages):
            page = self.pages[index]
            if page.is_image:
                self._save_undo_state(index)
                page.image_crop = crop
                self.emit(EVT_PAGE_ROTATED, index)

    def _save_undo_state(self, index: int) -> None:
        """Save the state of a page before an action so it can be undone."""
        if 0 <= index < len(self.pages):
            self._last_action_index = index
            self._last_action_state = dataclasses.replace(self.pages[index])

    def undo_last_action(self) -> None:
        """Restore the last saved page state."""
        idx = self._last_action_index
        if idx is not None and 0 <= idx < len(self.pages):
            # Only restore if the ID matches (in case pages were moved/deleted)
            if self.pages[idx].id == self._last_action_state.id:
                self.pages[idx] = dataclasses.replace(self._last_action_state)
                # Clear undo state so it can't be repeatedly triggered
                self._last_action_index = None
                self._last_action_state = None
                self.emit(EVT_PAGE_ROTATED, idx)
                self.emit(EVT_PAGES_CHANGED, None)

    def set_editor_mode(self, mode: str) -> None:
        """Set mode ('resize' or 'crop') and notify."""
        if mode in ("resize", "crop") and self.editor_mode != mode:
            self.editor_mode = mode
            self.emit(EVT_MODE_CHANGED, mode)



    # ------------------------------------------------------------------ #
    # Save
    # ------------------------------------------------------------------ #

    def save_pdf(
        self,
        output_path:       str,
        progress_callback: Optional[Callable] = None,
        done_callback:     Optional[Callable] = None,
        jpeg_quality:      int = 95,
    ) -> None:
        pages_snapshot = list(self.pages)
        pn_settings    = self.settings.get_page_number_settings()
        _quality       = jpeg_quality

        def _worker():
            success, error = build_pdf(
                pages=pages_snapshot,
                output_path=output_path,
                page_number_settings=pn_settings,
                progress_callback=progress_callback,
                jpeg_quality=_quality,
            )
            if done_callback:
                done_callback(success, error, output_path)

        threading.Thread(target=_worker, daemon=True).start()

    # ------------------------------------------------------------------ #
    # Preview
    # ------------------------------------------------------------------ #

    def render_page(self, index: int, zoom: float = 1.0) -> Optional[bytes]:
        if 0 <= index < len(self.pages):
            return render_page_preview(self.pages[index], zoom)
        return None

    # ------------------------------------------------------------------ #
    # Reset & cleanup
    # ------------------------------------------------------------------ #

    def reset(self) -> None:
        self.pages.clear()
        self.current_index = -1
        self.settings.reset()
        self.emit(EVT_RESET, None)

    def cleanup(self) -> None:
        import shutil
        try:
            shutil.rmtree(self._temp_dir, ignore_errors=True)
        except Exception:
            pass
        for page in self.pages:
            try:
                if os.path.exists(page.converted_pdf):
                    os.unlink(page.converted_pdf)
            except Exception:
                pass

    # ------------------------------------------------------------------ #
    # Properties
    # ------------------------------------------------------------------ #

    @property
    def page_count(self) -> int:
        return len(self.pages)

    @property
    def current_page(self) -> Optional[PageItem]:
        if 0 <= self.current_index < len(self.pages):
            return self.pages[self.current_index]
        return None
