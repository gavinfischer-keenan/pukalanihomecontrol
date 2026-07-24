"""
File Utilities
==============
File type detection, icons, and dialog filter definitions.
"""

from pathlib import Path

# ---------------------------------------------------------------------------
# Supported file type registry
# ---------------------------------------------------------------------------

SUPPORTED_EXTENSIONS: dict[str, list[str]] = {
    "image": [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".tif", ".webp"],
    "text":  [".txt"],
    "word":  [".doc", ".docx"],
    "pdf":   [".pdf"],
    "3d":    [".gltf", ".glb", ".obj", ".stl", ".fbx"],
}

# Flat lookup: extension → type
_EXT_TO_TYPE: dict[str, str] = {
    ext: ftype
    for ftype, exts in SUPPORTED_EXTENSIONS.items()
    for ext in exts
}

FILE_TYPE_ICONS: dict[str, str] = {
    "image":   "🖼",
    "text":    "📋",
    "word":    "📄",
    "pdf":     "📕",
    "3d":      "🎲",
    "unknown": "📎",
}

FILE_TYPE_LABELS: dict[str, str] = {
    "image":   "Image",
    "text":    "Text Document",
    "word":    "Word Document",
    "pdf":     "PDF",
    "3d":      "3D Model",
    "unknown": "Unknown",
}


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

def get_file_type(file_path: str) -> str:
    """Determine file type category from extension. Returns 'unknown' if not matched."""
    ext = Path(file_path).suffix.lower()
    return _EXT_TO_TYPE.get(ext, "unknown")


def get_file_icon(file_type: str) -> str:
    """Return the emoji icon for a file type."""
    return FILE_TYPE_ICONS.get(file_type, FILE_TYPE_ICONS["unknown"])


def get_file_label(file_type: str) -> str:
    """Return a human-readable label for a file type."""
    return FILE_TYPE_LABELS.get(file_type, "Unknown")


def is_supported(file_path: str) -> bool:
    """Return True if the file extension is explicitly supported."""
    return get_file_type(file_path) != "unknown"


def get_dialog_filetypes() -> list[tuple[str, str]]:
    """Return the filetypes list for a tkinter/CTk file dialog."""
    image_exts   = " ".join(f"*{e}" for e in SUPPORTED_EXTENSIONS["image"])
    word_exts    = " ".join(f"*{e}" for e in SUPPORTED_EXTENSIONS["word"])
    pdf_exts     = " ".join(f"*{e}" for e in SUPPORTED_EXTENSIONS["pdf"])
    text_exts    = " ".join(f"*{e}" for e in SUPPORTED_EXTENSIONS["text"])
    three_d_exts = " ".join(f"*{e}" for e in SUPPORTED_EXTENSIONS["3d"])
    all_exts     = " ".join(
        f"*{e}"
        for exts in SUPPORTED_EXTENSIONS.values()
        for e in exts
    )
    return [
        ("All Supported Files", all_exts),
        ("Image Files",         image_exts),
        ("PDF Files",           pdf_exts),
        ("Word Documents",      word_exts),
        ("Text Files",          text_exts),
        ("3D Files",            three_d_exts),
        ("All Files",           "*.*"),
    ]


def format_file_size(size_bytes: int) -> str:
    """Format file size in human-readable form."""
    for unit in ["B", "KB", "MB", "GB"]:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"


def safe_filename(name: str) -> str:
    """Strip characters not safe for filenames."""
    invalid = r'\/:*?"<>|'
    for ch in invalid:
        name = name.replace(ch, "_")
    return name.strip()
