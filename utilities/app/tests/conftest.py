"""
Shared fixtures for the PDF Maker test suite.
"""
import pytest
from pathlib import Path
from PIL import Image


@pytest.fixture()
def tmp_dir(tmp_path):
    """Return the pytest tmp_path as a convenience alias."""
    return tmp_path


@pytest.fixture()
def dummy_png(tmp_path):
    """Create a 100x80 red RGB PNG and return its path as a string."""
    path = tmp_path / "dummy.png"
    Image.new("RGB", (100, 80), (255, 0, 0)).save(str(path))
    return str(path)


@pytest.fixture()
def dummy_settings(tmp_path, monkeypatch):
    """Return a SettingsManager whose _settings_dir is redirected to tmp_path."""
    from pdf_maker.settings_manager import SettingsManager

    mgr = SettingsManager.__new__(SettingsManager)
    mgr._settings_dir = tmp_path
    mgr._settings_file = tmp_path / "settings.json"
    mgr._settings = {}
    mgr.load()
    return mgr


@pytest.fixture()
def make_page_item(dummy_png):
    """
    Factory fixture.  Returns a callable that creates a PageItem with sensible
    defaults; callers can override any field via keyword arguments.
    """
    from pdf_maker.converters.pdf_builder import PageItem

    def _factory(**kwargs):
        defaults = dict(
            source_file=dummy_png,
            source_type="image",
            converted_pdf="",
            id="test-1",
        )
        defaults.update(kwargs)
        return PageItem(**defaults)

    return _factory
