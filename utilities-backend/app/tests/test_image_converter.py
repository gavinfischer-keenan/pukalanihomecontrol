"""Tests for pdf_maker/converters/image_converter.py."""
import os
import sys
import io
import pytest
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent.parent))

from pdf_maker.converters.image_converter import (
    convert_image_to_pages,
    _apply_exif_orientation,
    _pil_image_to_pdf_page,
    PAGE_SIZES,
    MARGIN_PT,
)


@pytest.fixture
def jpg_image(tmp_path):
    img = Image.new('RGB', (800, 600), color='red')
    path = str(tmp_path / 'test.jpg')
    img.save(path, 'JPEG')
    return path


@pytest.fixture
def png_image(tmp_path):
    img = Image.new('RGBA', (400, 300), color=(0, 128, 255, 200))
    path = str(tmp_path / 'test.png')
    img.save(path, 'PNG')
    return path


@pytest.fixture
def gif_animated(tmp_path):
    """Create a multi-frame animated GIF."""
    frames = []
    for color in [(255,0,0), (0,255,0), (0,0,255)]:
        frames.append(Image.new('RGB', (100, 100), color=color))
    path = str(tmp_path / 'animated.gif')
    frames[0].save(
        path, save_all=True, append_images=frames[1:],
        loop=0, duration=[100, 100, 100]
    )
    return path


@pytest.fixture
def gif_static(tmp_path):
    img = Image.new('RGB', (100, 100), color='yellow')
    path = str(tmp_path / 'static.gif')
    img.save(path, 'GIF')
    return path


@pytest.fixture
def palette_image(tmp_path):
    img = Image.new('P', (100, 100))
    path = str(tmp_path / 'palette.png')
    img.save(path, 'PNG')
    return path


class TestConvertImageToPages:
    def test_jpg_single_page(self, jpg_image):
        pages = convert_image_to_pages(jpg_image)
        assert len(pages) == 1
        assert os.path.isfile(pages[0])
        assert pages[0].endswith('.pdf')

    def test_png_rgba(self, png_image):
        pages = convert_image_to_pages(png_image)
        assert len(pages) == 1
        assert os.path.isfile(pages[0])

    def test_palette_mode(self, palette_image):
        pages = convert_image_to_pages(palette_image)
        assert len(pages) == 1
        assert os.path.isfile(pages[0])

    def test_animated_gif_all_frames(self, gif_animated):
        pages = convert_image_to_pages(gif_animated, gif_all_frames=True)
        # Animated GIF should produce at least 1 page; ideally 3 frames
        assert len(pages) >= 1
        for p in pages:
            assert os.path.isfile(p)

    def test_animated_gif_first_only(self, gif_animated):
        pages = convert_image_to_pages(gif_animated, gif_all_frames=False)
        assert len(pages) == 1

    def test_static_gif(self, gif_static):
        pages = convert_image_to_pages(gif_static)
        assert len(pages) == 1

    def test_nonexistent_file(self):
        with pytest.raises(ValueError, match="Cannot open image"):
            convert_image_to_pages("/nonexistent/image.jpg")

    def test_letter_page_size(self, jpg_image):
        pages = convert_image_to_pages(jpg_image, page_size="Letter")
        assert len(pages) == 1
        assert os.path.isfile(pages[0])


class TestPilImageToPdfPage:
    def test_creates_pdf(self):
        img = Image.new('RGB', (200, 150), color='blue')
        pdf_path = _pil_image_to_pdf_page(img, page_size="A4")
        assert os.path.isfile(pdf_path)
        import fitz
        doc = fitz.open(pdf_path)
        assert len(doc) == 1
        page = doc[0]
        assert abs(page.rect.width - 595.28) < 1
        doc.close()
        os.unlink(pdf_path)

    def test_rgba_flattened(self):
        img = Image.new('RGBA', (100, 100), color=(255, 0, 0, 128))
        pdf_path = _pil_image_to_pdf_page(img)
        assert os.path.isfile(pdf_path)
        os.unlink(pdf_path)

    def test_la_mode(self):
        img = Image.new('LA', (100, 100))
        pdf_path = _pil_image_to_pdf_page(img)
        assert os.path.isfile(pdf_path)
        os.unlink(pdf_path)


class TestExifOrientation:
    def test_no_exif(self):
        img = Image.new('RGB', (100, 100), color='red')
        result = _apply_exif_orientation(img)
        assert result.size == (100, 100)

    def test_handles_exception(self):
        # Should not crash on non-JPEG images
        img = Image.new('L', (50, 50))
        result = _apply_exif_orientation(img)
        assert result is not None


class TestPageSizes:
    def test_a4_defined(self):
        assert "A4" in PAGE_SIZES
        assert PAGE_SIZES["A4"] == (595.28, 841.89)

    def test_letter_defined(self):
        assert "Letter" in PAGE_SIZES

    def test_margin(self):
        assert MARGIN_PT == 36
