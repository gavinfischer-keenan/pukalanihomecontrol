"""
Tests for pure functions in pdf_maker/converters/pdf_builder.py
"""
import pytest
from PIL import Image

from pdf_maker.converters.pdf_builder import (
    PageItem,
    _page_dims,
    _format_page_number,
    _hex_to_fitz_color,
    _render_image_to_pil,
    render_page_preview,
)


# ---------------------------------------------------------------------------
# _page_dims
# ---------------------------------------------------------------------------

class TestPageDims:
    def test_a4_portrait(self):
        assert _page_dims(False, "A4") == pytest.approx((595.28, 841.89))

    def test_a4_landscape(self):
        assert _page_dims(True, "A4") == pytest.approx((841.89, 595.28))

    def test_letter_portrait(self):
        assert _page_dims(False, "Letter") == pytest.approx((612.0, 792.0))

    def test_letter_landscape(self):
        assert _page_dims(True, "Letter") == pytest.approx((792.0, 612.0))


# ---------------------------------------------------------------------------
# _format_page_number
# ---------------------------------------------------------------------------

class TestFormatPageNumber:
    def test_format_plain(self):
        assert _format_page_number(3, 10, "plain") == "3"

    def test_format_dashes(self):
        assert _format_page_number(3, 10, "dashes") == "\u2014 3 \u2014"

    def test_format_page_x(self):
        assert _format_page_number(3, 10, "page_x") == "Page 3"

    def test_format_page_x_of_y(self):
        assert _format_page_number(3, 10, "page_x_of_y") == "Page 3 of 10"

    def test_format_unknown_style_returns_plain(self):
        # Unknown style should fall through to the default str(page_num)
        assert _format_page_number(7, 20, "bogus_style") == "7"

    def test_format_first_page(self):
        assert _format_page_number(1, 1, "page_x_of_y") == "Page 1 of 1"


# ---------------------------------------------------------------------------
# _hex_to_fitz_color
# ---------------------------------------------------------------------------

class TestHexToFitzColor:
    def test_black(self):
        r, g, b = _hex_to_fitz_color("#000000")
        assert r == pytest.approx(0.0)
        assert g == pytest.approx(0.0)
        assert b == pytest.approx(0.0)

    def test_white(self):
        r, g, b = _hex_to_fitz_color("#ffffff")
        assert r == pytest.approx(1.0, abs=0.01)
        assert g == pytest.approx(1.0, abs=0.01)
        assert b == pytest.approx(1.0, abs=0.01)

    def test_red(self):
        r, g, b = _hex_to_fitz_color("#ff0000")
        assert r == pytest.approx(1.0, abs=0.01)
        assert g == pytest.approx(0.0, abs=0.01)
        assert b == pytest.approx(0.0, abs=0.01)

    def test_returns_tuple_of_three_floats(self):
        result = _hex_to_fitz_color("#1a2b3c")
        assert len(result) == 3
        for component in result:
            assert 0.0 <= component <= 1.0


# ---------------------------------------------------------------------------
# PageItem dataclass
# ---------------------------------------------------------------------------

class TestPageItemDefaults:
    def test_is_image_for_image_type(self, dummy_png):
        item = PageItem(
            id="t1", source_file=dummy_png,
            source_type="image", converted_pdf=""
        )
        assert item.is_image is True

    def test_is_image_for_3d_type(self, dummy_png):
        item = PageItem(
            id="t2", source_file=dummy_png,
            source_type="3d", converted_pdf=""
        )
        assert item.is_image is True

    def test_is_not_image_for_pdf_type(self, dummy_png):
        item = PageItem(
            id="t3", source_file=dummy_png,
            source_type="pdf", converted_pdf=""
        )
        assert item.is_image is False

    def test_default_image_rotation(self, dummy_png):
        item = PageItem(
            id="t4", source_file=dummy_png,
            source_type="image", converted_pdf=""
        )
        assert item.image_rotation == 0

    def test_default_image_scale(self, dummy_png):
        item = PageItem(
            id="t5", source_file=dummy_png,
            source_type="image", converted_pdf=""
        )
        assert item.image_scale == pytest.approx(1.0)

    def test_default_page_landscape(self, dummy_png):
        item = PageItem(
            id="t6", source_file=dummy_png,
            source_type="image", converted_pdf=""
        )
        assert item.page_landscape is False

    def test_display_name_auto_set(self, dummy_png):
        from pathlib import Path
        item = PageItem(
            id="t7", source_file=dummy_png,
            source_type="image", converted_pdf=""
        )
        assert item.display_name == Path(dummy_png).name


# ---------------------------------------------------------------------------
# _render_image_to_pil
# ---------------------------------------------------------------------------

class TestRenderImageToPil:
    def test_output_size_matches_requested(self, dummy_png):
        item = PageItem(
            id="r1", source_file=dummy_png,
            source_type="image", converted_pdf=""
        )
        pw_px, ph_px = 595, 841
        result = _render_image_to_pil(item, pw_px, ph_px)
        assert isinstance(result, Image.Image)
        assert result.size == (pw_px, ph_px)

    def test_rotation_90_swaps_dimensions_within_range(self, dummy_png):
        """
        When the source image is 100×80 and we rotate 90°, the image after
        rotation is 80×100.  The page canvas stays the same size (595×841),
        but the *source* image aspect ratio is effectively transposed so the
        scaling logic fills the canvas differently.  We just verify the
        function returns a PIL Image of the requested canvas size.
        """
        item = PageItem(
            id="r2", source_file=dummy_png,
            source_type="image", converted_pdf="",
            image_rotation=90,
        )
        pw_px, ph_px = 595, 841
        result = _render_image_to_pil(item, pw_px, ph_px)
        assert isinstance(result, Image.Image)
        # Canvas size unchanged regardless of image rotation
        assert result.size == (pw_px, ph_px)

    def test_returns_rgb_image(self, dummy_png):
        item = PageItem(
            id="r3", source_file=dummy_png,
            source_type="image", converted_pdf=""
        )
        result = _render_image_to_pil(item, 400, 600)
        assert result.mode == "RGB"


# ---------------------------------------------------------------------------
# render_page_preview
# ---------------------------------------------------------------------------

class TestRenderPagePreview:
    def test_returns_bytes_starting_with_png_header(self, dummy_png):
        item = PageItem(
            id="p1", source_file=dummy_png,
            source_type="image", converted_pdf=""
        )
        result = render_page_preview(item, zoom=0.5, page_size="A4")
        assert isinstance(result, bytes)
        assert result[:4] == b"\x89PNG"

    def test_with_page_numbers_returns_bytes(self, dummy_png):
        item = PageItem(
            id="p2", source_file=dummy_png,
            source_type="image", converted_pdf=""
        )
        pn_settings = {
            "enabled": True,
            "style": "plain",
            "position": "bottom",
            "alignment": "center",
            "font": "Helvetica",
            "font_size": 10,
            "offset_from_edge": 20,
            "offset_from_side": 50,
            "color": "#000000",
        }
        result = render_page_preview(
            item, zoom=0.5, page_size="A4",
            page_number_settings=pn_settings,
            page_num=1, total_pages=5,
        )
        assert result is not None
        assert isinstance(result, bytes)
        assert len(result) > 0

    def test_small_zoom(self, dummy_png):
        """Very small zoom should still return valid PNG bytes."""
        item = PageItem(
            id="p3", source_file=dummy_png,
            source_type="image", converted_pdf=""
        )
        result = render_page_preview(item, zoom=0.1, page_size="A4")
        assert result is not None
        assert result[:4] == b"\x89PNG"
