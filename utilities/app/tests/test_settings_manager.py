"""
Tests for pdf_maker/settings_manager.py
"""
import json
import pytest
from pathlib import Path

from pdf_maker.settings_manager import SettingsManager, DEFAULT_SETTINGS


def _make_settings(tmp_path: Path) -> SettingsManager:
    """Helper: create a SettingsManager pointed at tmp_path."""
    mgr = SettingsManager.__new__(SettingsManager)
    mgr._settings_dir = tmp_path
    mgr._settings_file = tmp_path / "settings.json"
    mgr._settings = {}
    mgr.load()
    return mgr


# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

class TestDefaults:
    def test_defaults(self, tmp_path):
        mgr = _make_settings(tmp_path)
        for key in DEFAULT_SETTINGS:
            assert mgr.get(key) == DEFAULT_SETTINGS[key], f"Key '{key}' mismatch"

    def test_load_missing_file(self, tmp_path):
        """No file on disk → defaults are used."""
        mgr = _make_settings(tmp_path)
        assert mgr.get("page_size") == DEFAULT_SETTINGS["page_size"]


# ---------------------------------------------------------------------------
# get / set / set_many / reset
# ---------------------------------------------------------------------------

class TestGetSetResetOperations:
    def test_set_get(self, tmp_path):
        mgr = _make_settings(tmp_path)
        mgr.set("page_size", "Letter", auto_save=False)
        assert mgr.get("page_size") == "Letter"

    def test_set_many(self, tmp_path):
        mgr = _make_settings(tmp_path)
        mgr.set_many({"page_size": "Letter", "theme": "light"}, auto_save=False)
        assert mgr.get("page_size") == "Letter"
        assert mgr.get("theme") == "light"

    def test_reset(self, tmp_path):
        mgr = _make_settings(tmp_path)
        mgr.set("page_size", "Letter", auto_save=False)
        mgr.reset()
        assert mgr.get("page_size") == DEFAULT_SETTINGS["page_size"]

    def test_get_returns_default_for_unknown_key(self, tmp_path):
        mgr = _make_settings(tmp_path)
        assert mgr.get("nonexistent_key_xyz") is None


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

class TestPersistence:
    def test_save_load(self, tmp_path):
        mgr = _make_settings(tmp_path)
        mgr.set("page_size", "Letter")  # auto_save=True
        # New instance from same directory
        mgr2 = _make_settings(tmp_path)
        assert mgr2.get("page_size") == "Letter"

    def test_auto_save_false(self, tmp_path):
        mgr = _make_settings(tmp_path)
        mgr.set("page_size", "Letter", auto_save=False)
        # File should NOT be written yet
        assert not (tmp_path / "settings.json").exists()

    def test_load_corrupt_json(self, tmp_path):
        """Corrupt JSON on disk → falls back to defaults."""
        settings_file = tmp_path / "settings.json"
        settings_file.write_text("{ this is not valid json }", encoding="utf-8")
        mgr = _make_settings(tmp_path)
        assert mgr.get("page_size") == DEFAULT_SETTINGS["page_size"]


# ---------------------------------------------------------------------------
# get_page_number_settings
# ---------------------------------------------------------------------------

class TestPageNumberSettings:
    REQUIRED_KEYS = {
        "enabled", "position", "alignment", "font",
        "font_size", "offset_from_edge", "offset_from_side", "style", "color",
    }

    def test_get_page_number_settings(self, tmp_path):
        mgr = _make_settings(tmp_path)
        result = mgr.get_page_number_settings()
        assert isinstance(result, dict)
        assert self.REQUIRED_KEYS.issubset(result.keys()), (
            f"Missing keys: {self.REQUIRED_KEYS - result.keys()}"
        )

    def test_page_number_enabled_default_false(self, tmp_path):
        mgr = _make_settings(tmp_path)
        assert mgr.get_page_number_settings()["enabled"] is False


# ---------------------------------------------------------------------------
# output_folder property
# ---------------------------------------------------------------------------

class TestOutputFolderProperty:
    def test_output_folder_fallback(self, tmp_path):
        """Setting output_folder to a nonexistent path → property returns Documents."""
        mgr = _make_settings(tmp_path)
        mgr.set("output_folder", str(tmp_path / "nonexistent_xyz_12345"), auto_save=False)
        # The property should fall back to Documents (which is guaranteed to exist)
        result = mgr.output_folder
        assert Path(result).exists(), f"Fallback folder does not exist: {result}"

    def test_output_folder_valid_path(self, tmp_path):
        mgr = _make_settings(tmp_path)
        mgr.set("output_folder", str(tmp_path), auto_save=False)
        assert mgr.output_folder == str(tmp_path)
