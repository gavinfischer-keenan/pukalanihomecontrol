"""
Color Utilities
===============
WCAG-compliant color contrast checking for accessible UI rendering.
"""


def get_relative_luminance(r: int, g: int, b: int) -> float:
    """Calculate relative luminance of an sRGB color (0-255 per channel)."""
    def linearize(c: float) -> float:
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)


def get_contrast_ratio(rgb1: tuple[int, int, int], rgb2: tuple[int, int, int]) -> float:
    """Calculate the WCAG contrast ratio between two RGB colors."""
    l1 = get_relative_luminance(*rgb1)
    l2 = get_relative_luminance(*rgb2)
    lighter, darker = max(l1, l2), min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    """Convert a hex color string (e.g. '#1a2b3c' or '1a2b3c') to RGB tuple."""
    hex_color = hex_color.lstrip("#")
    if len(hex_color) == 3:
        hex_color = "".join(c * 2 for c in hex_color)
    return (
        int(hex_color[0:2], 16),
        int(hex_color[2:4], 16),
        int(hex_color[4:6], 16),
    )


def rgb_to_hex(r: int, g: int, b: int) -> str:
    """Convert RGB values to hex color string."""
    return f"#{r:02x}{g:02x}{b:02x}"


def get_contrast_text_color(bg_hex: str) -> str:
    """
    Return '#ffffff' or '#000000' — whichever gives better contrast against bg_hex.
    Uses WCAG relative luminance threshold.
    """
    try:
        rgb = hex_to_rgb(bg_hex)
        luminance = get_relative_luminance(*rgb)
        # Threshold ~0.179 is the midpoint for 4.5:1 contrast against both white and black
        return "#ffffff" if luminance < 0.179 else "#000000"
    except Exception:
        return "#ffffff"


def is_wcag_aa_compliant(fg_hex: str, bg_hex: str, large_text: bool = False) -> bool:
    """
    Check if the foreground/background pair meets WCAG AA contrast requirements.
    - Normal text: 4.5:1
    - Large text (18pt+ or 14pt+ bold): 3:1
    """
    try:
        ratio = get_contrast_ratio(hex_to_rgb(fg_hex), hex_to_rgb(bg_hex))
        threshold = 3.0 if large_text else 4.5
        return ratio >= threshold
    except Exception:
        return True  # Don't block on error


def parse_ctk_color(color, mode: str = "dark") -> str:
    """
    Extract a single hex color string from a CTk color value.
    CTk colors may be a string '#xxxxxx' or a tuple ('#light_color', '#dark_color').
    """
    if isinstance(color, (list, tuple)):
        if mode == "dark" and len(color) > 1:
            return color[1]
        return color[0]
    return str(color)


def blend_colors(hex1: str, hex2: str, ratio: float = 0.5) -> str:
    """Blend two hex colors together. ratio=0 → hex1, ratio=1 → hex2."""
    r1, g1, b1 = hex_to_rgb(hex1)
    r2, g2, b2 = hex_to_rgb(hex2)
    r = int(r1 + (r2 - r1) * ratio)
    g = int(g1 + (g2 - g1) * ratio)
    b = int(b1 + (b2 - b1) * ratio)
    return rgb_to_hex(r, g, b)
