"""
Tests for AppController logic — no tkinter / GUI required.

We bypass add_files (which spawns threads) and instead manipulate
controller.pages / controller.current_index directly.
"""
import uuid
import pytest

from pdf_maker.converters.pdf_builder import PageItem
from pdf_maker.controller import (
    AppController,
    EVT_PAGE_SELECTED,
    EVT_PAGES_CHANGED,
    EVT_PAGE_ROTATED,
)
from pdf_maker.settings_manager import SettingsManager


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_settings(tmp_path):
    """Create a SettingsManager whose _settings_dir is redirected to tmp_path."""
    mgr = SettingsManager.__new__(SettingsManager)
    mgr._settings_dir = tmp_path
    mgr._settings_file = tmp_path / "settings.json"
    mgr._settings = {}
    mgr.load()
    return mgr


def _image_page(source_file: str, *, page_id: str = None) -> PageItem:
    return PageItem(
        id=page_id or str(uuid.uuid4()),
        source_file=source_file,
        source_type="image",
        converted_pdf="",
    )


def _pdf_page(source_file: str, *, page_id: str = None) -> PageItem:
    return PageItem(
        id=page_id or str(uuid.uuid4()),
        source_file=source_file,
        source_type="pdf",
        converted_pdf="",
    )


@pytest.fixture()
def ctrl(tmp_path, dummy_png):
    """Return an AppController with a temp SettingsManager."""
    return AppController(_make_settings(tmp_path))


# ---------------------------------------------------------------------------
# Initial state
# ---------------------------------------------------------------------------

class TestInitialState:
    def test_page_count_zero(self, ctrl):
        assert ctrl.page_count == 0

    def test_current_index_minus_one(self, ctrl):
        assert ctrl.current_index == -1

    def test_current_page_is_none(self, ctrl):
        assert ctrl.current_page is None


# ---------------------------------------------------------------------------
# select_page
# ---------------------------------------------------------------------------

class TestSelectPage:
    def test_select_page(self, ctrl, dummy_png):
        ctrl.pages.append(_image_page(dummy_png))
        ctrl.select_page(0)
        assert ctrl.current_index == 0

    def test_select_out_of_range_noop(self, ctrl, dummy_png):
        ctrl.pages.append(_image_page(dummy_png))
        ctrl.current_index = 0
        ctrl.select_page(99)  # no-op
        assert ctrl.current_index == 0


# ---------------------------------------------------------------------------
# rotate_page
# ---------------------------------------------------------------------------

class TestRotatePage:
    def test_rotate_image_page_sets_image_rotation(self, ctrl, dummy_png):
        page = _image_page(dummy_png)
        ctrl.pages.append(page)
        ctrl.rotate_page(0, 90)
        assert page.image_rotation == 90
        assert page.rotation == 0  # unchanged

    def test_rotate_nonimage_page_sets_rotation(self, ctrl, dummy_png):
        page = _pdf_page(dummy_png)
        ctrl.pages.append(page)
        ctrl.rotate_page(0, 90)
        assert page.rotation == 90
        assert page.image_rotation == 0  # unchanged

    def test_rotate_wraps_360(self, ctrl, dummy_png):
        page = _image_page(dummy_png)
        ctrl.pages.append(page)
        ctrl.rotate_page(0, 450)  # 450 % 360 == 90
        assert page.image_rotation == 90


# ---------------------------------------------------------------------------
# rotate_all_pages
# ---------------------------------------------------------------------------

class TestRotateAllPages:
    def test_rotate_all_pages(self, ctrl, dummy_png):
        img = _image_page(dummy_png)
        pdf = _pdf_page(dummy_png)
        ctrl.pages.extend([img, pdf])
        ctrl.rotate_all_pages(180)
        assert img.image_rotation == 180
        assert img.rotation == 0
        assert pdf.rotation == 180
        assert pdf.image_rotation == 0


# ---------------------------------------------------------------------------
# move_page_up / move_page_down
# ---------------------------------------------------------------------------

class TestMovePages:
    def test_move_page_up(self, ctrl, dummy_png):
        a = _image_page(dummy_png, page_id="a")
        b = _image_page(dummy_png, page_id="b")
        ctrl.pages.extend([a, b])
        ctrl.current_index = 1
        ctrl.move_page_up(1)
        assert ctrl.pages[0].id == "b"
        assert ctrl.pages[1].id == "a"
        assert ctrl.current_index == 0

    def test_move_page_down(self, ctrl, dummy_png):
        a = _image_page(dummy_png, page_id="a")
        b = _image_page(dummy_png, page_id="b")
        ctrl.pages.extend([a, b])
        ctrl.current_index = 0
        ctrl.move_page_down(0)
        assert ctrl.pages[0].id == "b"
        assert ctrl.pages[1].id == "a"
        assert ctrl.current_index == 1

    def test_move_page_up_at_start_noop(self, ctrl, dummy_png):
        page = _image_page(dummy_png, page_id="only")
        ctrl.pages.append(page)
        ctrl.current_index = 0
        ctrl.move_page_up(0)
        assert ctrl.pages[0].id == "only"
        assert ctrl.current_index == 0

    def test_move_page_down_at_end_noop(self, ctrl, dummy_png):
        page = _image_page(dummy_png, page_id="only")
        ctrl.pages.append(page)
        ctrl.current_index = 0
        ctrl.move_page_down(0)
        assert ctrl.pages[0].id == "only"
        assert ctrl.current_index == 0


# ---------------------------------------------------------------------------
# remove_page
# ---------------------------------------------------------------------------

class TestRemovePage:
    def test_remove_only_page(self, ctrl, dummy_png):
        ctrl.pages.append(_image_page(dummy_png))
        ctrl.current_index = 0
        ctrl.remove_page(0)
        assert ctrl.page_count == 0
        assert ctrl.current_index == -1

    def test_remove_page_clamps_index(self, ctrl, dummy_png):
        for _ in range(3):
            ctrl.pages.append(_image_page(dummy_png))
        ctrl.current_index = 2
        ctrl.remove_page(2)
        # Should clamp to last valid index (1)
        assert ctrl.current_index == 1

    def test_remove_out_of_range_noop(self, ctrl, dummy_png):
        ctrl.pages.append(_image_page(dummy_png))
        ctrl.remove_page(99)
        assert ctrl.page_count == 1


# ---------------------------------------------------------------------------
# set_page_landscape / toggle_page_landscape / set_all_landscape
# ---------------------------------------------------------------------------

class TestLandscape:
    def test_set_page_landscape(self, ctrl, dummy_png):
        page = _image_page(dummy_png)
        ctrl.pages.append(page)
        ctrl.set_page_landscape(0, True)
        assert page.page_landscape is True

    def test_toggle_page_landscape(self, ctrl, dummy_png):
        page = _image_page(dummy_png)
        ctrl.pages.append(page)
        assert page.page_landscape is False
        ctrl.toggle_page_landscape(0)
        assert page.page_landscape is True
        ctrl.toggle_page_landscape(0)
        assert page.page_landscape is False

    def test_set_all_landscape(self, ctrl, dummy_png):
        for _ in range(3):
            ctrl.pages.append(_image_page(dummy_png))
        ctrl.set_all_landscape(True)
        assert all(p.page_landscape for p in ctrl.pages)


# ---------------------------------------------------------------------------
# resize_image
# ---------------------------------------------------------------------------

class TestResizeImage:
    def test_resize_image_scale(self, ctrl, dummy_png):
        page = _image_page(dummy_png)
        ctrl.pages.append(page)
        ctrl.resize_image(0, 2.5)
        assert page.image_scale == pytest.approx(2.5)

    def test_resize_image_clamps_min(self, ctrl, dummy_png):
        page = _image_page(dummy_png)
        ctrl.pages.append(page)
        ctrl.resize_image(0, -1)
        assert page.image_scale == pytest.approx(0.05)

    def test_resize_image_clamps_max(self, ctrl, dummy_png):
        page = _image_page(dummy_png)
        ctrl.pages.append(page)
        ctrl.resize_image(0, 99)
        assert page.image_scale == pytest.approx(10.0)

    def test_resize_image_nonimage_ignored(self, ctrl, dummy_png):
        page = _pdf_page(dummy_png)
        ctrl.pages.append(page)
        ctrl.resize_image(0, 2.0)
        assert page.image_scale == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# Event bus
# ---------------------------------------------------------------------------

class TestEventBus:
    def test_event_fired_on_select(self, ctrl, dummy_png):
        ctrl.pages.append(_image_page(dummy_png))
        received = []
        ctrl.on(EVT_PAGE_SELECTED, lambda data: received.append(data))
        ctrl.select_page(0)
        assert received == [0]

    def test_event_fired_on_pages_changed(self, ctrl, dummy_png):
        ctrl.pages.append(_image_page(dummy_png))
        received = []
        ctrl.on(EVT_PAGES_CHANGED, lambda data: received.append(data))
        ctrl.remove_page(0)
        assert len(received) == 1

    def test_event_fired_on_rotate(self, ctrl, dummy_png):
        ctrl.pages.append(_image_page(dummy_png))
        received = []
        ctrl.on(EVT_PAGE_ROTATED, lambda data: received.append(data))
        ctrl.rotate_page(0, 90)
        assert received == [0]

    def test_multiple_listeners_all_called(self, ctrl, dummy_png):
        ctrl.pages.append(_image_page(dummy_png))
        calls = []
        ctrl.on(EVT_PAGE_SELECTED, lambda _: calls.append("a"))
        ctrl.on(EVT_PAGE_SELECTED, lambda _: calls.append("b"))
        ctrl.select_page(0)
        assert "a" in calls and "b" in calls


# ---------------------------------------------------------------------------
# page_count property
# ---------------------------------------------------------------------------

class TestPageCountProperty:
    def test_page_count(self, ctrl, dummy_png):
        for _ in range(3):
            ctrl.pages.append(_image_page(dummy_png))
        assert ctrl.page_count == 3

    def test_current_page_returns_correct_item(self, ctrl, dummy_png):
        a = _image_page(dummy_png, page_id="alpha")
        b = _image_page(dummy_png, page_id="beta")
        ctrl.pages.extend([a, b])
        ctrl.current_index = 1
        assert ctrl.current_page.id == "beta"
