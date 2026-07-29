"""Tests for pdf_maker/converters/gltf_converter.py."""
import os
import sys
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent))

from pdf_maker.converters.gltf_converter import (
    is_3d_available,
    convert_3d_to_pages,
)


class TestIs3dAvailable:
    def test_returns_tuple(self):
        result = is_3d_available()
        assert isinstance(result, tuple)
        assert len(result) == 2
        assert isinstance(result[0], bool)
        assert isinstance(result[1], str)

    def test_available_or_not(self):
        available, msg = is_3d_available()
        if available:
            assert "available" in msg.lower()
        else:
            assert "not installed" in msg.lower() or "import" in msg.lower()


class TestConvert3dToPages:
    def test_unavailable_returns_error_page(self):
        """When 3D libs are not installed, should return an error page."""
        with patch('pdf_maker.converters.gltf_converter.is_3d_available',
                   return_value=(False, 'Not installed')):
            pages, warnings = convert_3d_to_pages("/fake/model.gltf")
            assert len(pages) == 1
            assert os.path.isfile(pages[0])
            assert len(warnings) > 0

    def test_nonexistent_file_with_libs(self):
        """If 3D libs are available but file doesn't exist, should error gracefully."""
        available, _ = is_3d_available()
        if not available:
            pytest.skip("3D rendering libraries not installed")
        pages, warnings = convert_3d_to_pages("/nonexistent/model.glb")
        assert len(pages) >= 1  # Error page
        assert len(warnings) > 0

    def test_returns_correct_structure(self):
        """Whether available or not, should return (list, list)."""
        with patch('pdf_maker.converters.gltf_converter.is_3d_available',
                   return_value=(False, 'Not installed')):
            pages, warnings = convert_3d_to_pages("/fake/model.obj")
            assert isinstance(pages, list)
            assert isinstance(warnings, list)
