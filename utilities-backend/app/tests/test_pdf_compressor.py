"""Tests for pdf_maker/converters/pdf_compressor.py — PDF Shrinker engine."""
import os
import sys
import io
import tempfile
import shutil
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

# Add app dir to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from pdf_maker.converters.pdf_compressor import (
    compress_pdf,
    CompressionResult,
    COMPRESSION_LEVELS,
    _resample_image,
)


@pytest.fixture
def sample_pdf(tmp_path):
    """Create a simple test PDF with an image."""
    import fitz
    from PIL import Image
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((50, 50), "Hello World", fontsize=24)
    # Add an image
    img = Image.new('RGB', (800, 600), color='red')
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    img_bytes = buf.getvalue()
    page.insert_image(fitz.Rect(50, 100, 500, 500), stream=img_bytes)
    path = str(tmp_path / "test.pdf")
    doc.save(path)
    doc.close()
    return path


@pytest.fixture
def text_only_pdf(tmp_path):
    """Create a PDF with only text (no images)."""
    import fitz
    doc = fitz.open()
    for i in range(3):
        page = doc.new_page(width=595, height=842)
        page.insert_text((50, 50), f"Page {i+1} content", fontsize=24)
    path = str(tmp_path / "text_only.pdf")
    doc.save(path)
    doc.close()
    return path


class TestCompressionResult:
    def test_properties(self):
        r = CompressionResult(success=True, input_bytes=10240, output_bytes=5120, savings_pct=50.0)
        assert r.input_kb == 10.0
        assert r.output_kb == 5.0
        assert abs(r.input_mb - 0.00976) < 0.001
        assert abs(r.output_mb - 0.00488) < 0.001

    def test_size_label_bytes(self):
        r = CompressionResult(success=True, input_bytes=500, output_bytes=200)
        assert r.size_label(500) == "500 B"

    def test_size_label_kb(self):
        r = CompressionResult(success=True, input_bytes=5000, output_bytes=2000)
        assert "KB" in r.size_label(5000)

    def test_size_label_mb(self):
        r = CompressionResult(success=True, input_bytes=5_000_000, output_bytes=2_000_000)
        assert "MB" in r.size_label(5_000_000)

    def test_input_output_labels(self):
        r = CompressionResult(success=True, input_bytes=2048, output_bytes=1024)
        assert "KB" in r.input_label
        assert "KB" in r.output_label

    def test_failure_result(self):
        r = CompressionResult(success=False, error="Something broke")
        assert not r.success
        assert r.error == "Something broke"


class TestCompressionLevels:
    def test_all_levels_defined(self):
        assert set(COMPRESSION_LEVELS.keys()) == {"light", "standard", "aggressive", "grayscale"}

    def test_light_non_destructive(self):
        cfg = COMPRESSION_LEVELS["light"]
        assert cfg["destructive"] is False
        assert cfg["max_image_dpi"] is None
        assert cfg["jpeg_quality"] is None

    def test_standard_dpi(self):
        cfg = COMPRESSION_LEVELS["standard"]
        assert cfg["max_image_dpi"] == 150
        assert cfg["jpeg_quality"] == 75

    def test_aggressive_strips(self):
        cfg = COMPRESSION_LEVELS["aggressive"]
        assert cfg["strip_annots"] is True
        assert cfg["flatten_forms"] is True
        assert cfg["max_image_dpi"] == 96

    def test_grayscale_converts(self):
        cfg = COMPRESSION_LEVELS["grayscale"]
        assert cfg["grayscale"] is True
        assert cfg["destructive"] is True


class TestCompressPdf:
    def test_invalid_level(self, tmp_path):
        result = compress_pdf("dummy.pdf", str(tmp_path / "out.pdf"), level_id="invalid")
        assert not result.success
        assert "Unknown compression level" in result.error

    def test_missing_file(self, tmp_path):
        result = compress_pdf("/nonexistent/file.pdf", str(tmp_path / "out.pdf"), level_id="light")
        assert not result.success
        assert "not found" in result.error.lower()

    def test_light_compression(self, sample_pdf, tmp_path):
        out = str(tmp_path / "compressed.pdf")
        result = compress_pdf(sample_pdf, out, level_id="light")
        assert result.success
        assert os.path.isfile(out)
        assert result.input_bytes > 0
        assert result.output_bytes > 0

    def test_standard_compression(self, sample_pdf, tmp_path):
        out = str(tmp_path / "compressed.pdf")
        result = compress_pdf(sample_pdf, out, level_id="standard")
        assert result.success
        assert os.path.isfile(out)

    def test_aggressive_compression(self, sample_pdf, tmp_path):
        out = str(tmp_path / "compressed.pdf")
        result = compress_pdf(sample_pdf, out, level_id="aggressive")
        assert result.success
        assert os.path.isfile(out)

    def test_grayscale_compression(self, sample_pdf, tmp_path):
        out = str(tmp_path / "compressed.pdf")
        result = compress_pdf(sample_pdf, out, level_id="grayscale")
        assert result.success
        assert os.path.isfile(out)

    def test_text_only_pdf(self, text_only_pdf, tmp_path):
        out = str(tmp_path / "compressed.pdf")
        result = compress_pdf(text_only_pdf, out, level_id="standard")
        assert result.success

    def test_progress_callback(self, sample_pdf, tmp_path):
        out = str(tmp_path / "compressed.pdf")
        messages = []
        def cb(msg, frac):
            messages.append((msg, frac))
        result = compress_pdf(sample_pdf, out, level_id="light", progress_cb=cb)
        assert result.success
        assert len(messages) > 0
        # Last message should be "Done." at 1.0
        assert messages[-1][1] == 1.0

    def test_savings_pct_calculated(self, sample_pdf, tmp_path):
        out = str(tmp_path / "compressed.pdf")
        result = compress_pdf(sample_pdf, out, level_id="standard")
        assert result.success
        assert isinstance(result.savings_pct, float)


class TestResampleImage:
    def test_rgb_image(self):
        from PIL import Image
        img = Image.new('RGB', (400, 300), color='blue')
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        result = _resample_image(buf.getvalue(), 'png', jpeg_quality=75, max_dpi=None, current_dpi=150, grayscale=False)
        assert result is not None
        assert len(result) > 0

    def test_rgba_image(self):
        from PIL import Image
        img = Image.new('RGBA', (200, 200), color=(255, 0, 0, 128))
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        result = _resample_image(buf.getvalue(), 'png', jpeg_quality=75, max_dpi=None, current_dpi=150, grayscale=False)
        assert result is not None

    def test_grayscale_conversion(self):
        from PIL import Image
        img = Image.new('RGB', (200, 200), color='green')
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        result = _resample_image(buf.getvalue(), 'png', jpeg_quality=75, max_dpi=None, current_dpi=150, grayscale=True)
        assert result is not None
        # Verify it's actually grayscale
        out_img = Image.open(io.BytesIO(result))
        assert out_img.mode == 'L'

    def test_downsampling(self):
        from PIL import Image
        img = Image.new('RGB', (1000, 1000), color='red')
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        result = _resample_image(buf.getvalue(), 'png', jpeg_quality=75, max_dpi=72, current_dpi=300, grayscale=False)
        assert result is not None
        out_img = Image.open(io.BytesIO(result))
        assert out_img.width < 1000  # Should be downsampled

    def test_invalid_image_returns_none(self):
        result = _resample_image(b'not an image', 'png', jpeg_quality=75, max_dpi=None, current_dpi=150, grayscale=False)
        assert result is None
