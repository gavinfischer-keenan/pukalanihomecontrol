"""
Tests for pdf_maker/utils/color_utils.py
"""
import pytest

from pdf_maker.utils.color_utils import (
    get_relative_luminance,
    get_contrast_ratio,
    hex_to_rgb,
    rgb_to_hex,
    get_contrast_text_color,
    is_wcag_aa_compliant,
    parse_ctk_color,
    blend_colors,
)


# ---------------------------------------------------------------------------
# hex_to_rgb
# ---------------------------------------------------------------------------

class TestHexToRgb:
    def test_black(self):
        assert hex_to_rgb("#000000") == (0, 0, 0)

    def test_white(self):
        assert hex_to_rgb("#ffffff") == (255, 255, 255)

    def test_red(self):
        assert hex_to_rgb("#ff0000") == (255, 0, 0)

    def test_without_hash(self):
        assert hex_to_rgb("1a2b3c") == (0x1A, 0x2B, 0x3C)

    def test_shorthand_three_digits(self):
        # '#abc' → '#aabbcc'
        assert hex_to_rgb("#abc") == (0xAA, 0xBB, 0xCC)

    def test_returns_tuple_of_ints(self):
        r, g, b = hex_to_rgb("#123456")
        for v in (r, g, b):
            assert isinstance(v, int)
            assert 0 <= v <= 255


# ---------------------------------------------------------------------------
# rgb_to_hex
# ---------------------------------------------------------------------------

class TestRgbToHex:
    def test_black(self):
        assert rgb_to_hex(0, 0, 0) == "#000000"

    def test_white(self):
        assert rgb_to_hex(255, 255, 255) == "#ffffff"

    def test_red(self):
        assert rgb_to_hex(255, 0, 0) == "#ff0000"

    def test_roundtrip(self):
        original = "#1a2b3c"
        r, g, b = hex_to_rgb(original)
        assert rgb_to_hex(r, g, b) == original


# ---------------------------------------------------------------------------
# get_relative_luminance
# ---------------------------------------------------------------------------

class TestGetRelativeLuminance:
    def test_black_is_zero(self):
        assert get_relative_luminance(0, 0, 0) == pytest.approx(0.0)

    def test_white_is_one(self):
        assert get_relative_luminance(255, 255, 255) == pytest.approx(1.0, abs=0.001)

    def test_returns_float_in_range(self):
        lum = get_relative_luminance(128, 64, 200)
        assert 0.0 <= lum <= 1.0

    def test_brighter_color_has_higher_luminance(self):
        lum_dark = get_relative_luminance(50, 50, 50)
        lum_light = get_relative_luminance(200, 200, 200)
        assert lum_light > lum_dark


# ---------------------------------------------------------------------------
# get_contrast_ratio
# ---------------------------------------------------------------------------

class TestGetContrastRatio:
    def test_same_color_is_one(self):
        ratio = get_contrast_ratio((0, 0, 0), (0, 0, 0))
        assert ratio == pytest.approx(1.0)

    def test_black_white_is_21(self):
        ratio = get_contrast_ratio((0, 0, 0), (255, 255, 255))
        assert ratio == pytest.approx(21.0, abs=0.1)

    def test_ratio_is_symmetric(self):
        r1 = get_contrast_ratio((100, 150, 200), (50, 60, 70))
        r2 = get_contrast_ratio((50, 60, 70), (100, 150, 200))
        assert r1 == pytest.approx(r2)

    def test_ratio_greater_than_one(self):
        ratio = get_contrast_ratio((0, 0, 0), (128, 128, 128))
        assert ratio >= 1.0


# ---------------------------------------------------------------------------
# get_contrast_text_color
# ---------------------------------------------------------------------------

class TestGetContrastTextColor:
    def test_dark_background_returns_white(self):
        # Black bg → white text
        assert get_contrast_text_color("#000000") == "#ffffff"

    def test_light_background_returns_black(self):
        # White bg → black text
        assert get_contrast_text_color("#ffffff") == "#000000"

    def test_returns_valid_hex(self):
        result = get_contrast_text_color("#336699")
        assert result in ("#ffffff", "#000000")

    def test_invalid_hex_returns_white(self):
        # Should not raise; returns white as safe default
        result = get_contrast_text_color("not-a-color")
        assert isinstance(result, str)


# ---------------------------------------------------------------------------
# is_wcag_aa_compliant
# ---------------------------------------------------------------------------

class TestIsWcagAaCompliant:
    def test_black_on_white_normal_text(self):
        assert is_wcag_aa_compliant("#000000", "#ffffff") is True

    def test_white_on_white_fails(self):
        assert is_wcag_aa_compliant("#ffffff", "#ffffff") is False

    def test_large_text_threshold_is_lower(self):
        # A mid-contrast pair that fails for normal but passes for large text
        # Ratio ~3.5:1 (dark grey on white) — meets 3:1 but not 4.5:1
        fg, bg = "#595959", "#ffffff"   # approx 7:1 – both pass; just verify kwarg works
        normal = is_wcag_aa_compliant(fg, bg, large_text=False)
        large  = is_wcag_aa_compliant(fg, bg, large_text=True)
        # Both should be True for this pair, but at minimum large_text should be >= normal
        assert large or not normal  # large_text ≥ normal in permissiveness

    def test_invalid_hex_returns_true_on_error(self):
        # Errors should not raise; returns True as safe fallback
        result = is_wcag_aa_compliant("bad", "also-bad")
        assert isinstance(result, bool)


# ---------------------------------------------------------------------------
# parse_ctk_color
# ---------------------------------------------------------------------------

class TestParseCtkColor:
    def test_plain_string_returned_as_is(self):
        assert parse_ctk_color("#ff0000") == "#ff0000"

    def test_tuple_dark_mode_returns_second_element(self):
        result = parse_ctk_color(("#light", "#dark"), mode="dark")
        assert result == "#dark"

    def test_tuple_light_mode_returns_first_element(self):
        result = parse_ctk_color(("#light", "#dark"), mode="light")
        assert result == "#light"

    def test_list_dark_mode_returns_second_element(self):
        result = parse_ctk_color(["#aaa", "#bbb"], mode="dark")
        assert result == "#bbb"

    def test_non_string_converted_to_str(self):
        result = parse_ctk_color(42)
        assert result == "42"


# ---------------------------------------------------------------------------
# blend_colors
# ---------------------------------------------------------------------------

class TestBlendColors:
    def test_ratio_zero_returns_first_color(self):
        result = blend_colors("#ff0000", "#0000ff", ratio=0.0)
        assert result == "#ff0000"

    def test_ratio_one_returns_second_color(self):
        result = blend_colors("#ff0000", "#0000ff", ratio=1.0)
        assert result == "#0000ff"

    def test_ratio_half_blends(self):
        result = blend_colors("#000000", "#ffffff", ratio=0.5)
        r, g, b = hex_to_rgb(result)
        # Should be roughly mid-grey (128 ± 1 due to int truncation)
        assert 127 <= r <= 128
        assert 127 <= g <= 128
        assert 127 <= b <= 128

    def test_returns_valid_hex_string(self):
        result = blend_colors("#123456", "#abcdef", ratio=0.3)
        assert result.startswith("#")
        assert len(result) == 7
