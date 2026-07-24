"""
Tests for pdf_maker/utils/file_utils.py
"""
import pytest

from pdf_maker.utils.file_utils import (
    get_file_type,
    get_file_icon,
    get_file_label,
    is_supported,
    format_file_size,
    safe_filename,
    get_dialog_filetypes,
)


# ---------------------------------------------------------------------------
# get_file_type
# ---------------------------------------------------------------------------

class TestGetFileType:
    def test_jpg_is_image(self):
        assert get_file_type("photo.jpg") == "image"

    def test_png_is_image(self):
        assert get_file_type("photo.png") == "image"

    def test_pdf_is_pdf(self):
        assert get_file_type("doc.pdf") == "pdf"

    def test_txt_is_text(self):
        assert get_file_type("readme.txt") == "text"

    def test_docx_is_word(self):
        assert get_file_type("report.docx") == "word"

    def test_glb_is_3d(self):
        assert get_file_type("model.glb") == "3d"

    def test_unknown_extension(self):
        assert get_file_type("data.xyz") == "unknown"

    def test_uppercase_extension(self):
        assert get_file_type("PHOTO.JPG") == "image"

    def test_full_path(self):
        assert get_file_type(r"C:\Users\user\Documents\photo.png") == "image"


# ---------------------------------------------------------------------------
# get_file_icon
# ---------------------------------------------------------------------------

class TestGetFileIcon:
    @pytest.mark.parametrize("ftype", ["image", "text", "word", "pdf", "3d", "unknown"])
    def test_returns_nonempty_string(self, ftype):
        icon = get_file_icon(ftype)
        assert isinstance(icon, str)
        assert len(icon) > 0

    def test_invalid_type_returns_unknown_icon(self):
        icon = get_file_icon("nonexistent_type")
        assert icon == get_file_icon("unknown")


# ---------------------------------------------------------------------------
# get_file_label
# ---------------------------------------------------------------------------

class TestGetFileLabel:
    @pytest.mark.parametrize("ftype", ["image", "text", "word", "pdf", "3d", "unknown"])
    def test_returns_string(self, ftype):
        label = get_file_label(ftype)
        assert isinstance(label, str)
        assert len(label) > 0

    def test_invalid_type_returns_string(self):
        label = get_file_label("nonexistent")
        assert isinstance(label, str)


# ---------------------------------------------------------------------------
# is_supported
# ---------------------------------------------------------------------------

class TestIsSupported:
    def test_jpg_is_supported(self):
        assert is_supported("image.jpg") is True

    def test_png_is_supported(self):
        assert is_supported("image.png") is True

    def test_pdf_is_supported(self):
        assert is_supported("doc.pdf") is True

    def test_xyz_not_supported(self):
        assert is_supported("data.xyz") is False

    def test_no_extension_not_supported(self):
        assert is_supported("noextension") is False


# ---------------------------------------------------------------------------
# format_file_size
# ---------------------------------------------------------------------------

class TestFormatFileSize:
    def test_bytes(self):
        assert format_file_size(500) == "500.0 B"

    def test_kilobytes(self):
        assert format_file_size(1024) == "1.0 KB"

    def test_megabytes(self):
        assert format_file_size(1024 * 1024) == "1.0 MB"

    def test_gigabytes(self):
        assert format_file_size(1024 * 1024 * 1024) == "1.0 GB"

    def test_zero_bytes(self):
        result = format_file_size(0)
        assert "B" in result

    def test_fractional_kb(self):
        result = format_file_size(512)
        assert "B" in result or "KB" in result


# ---------------------------------------------------------------------------
# safe_filename
# ---------------------------------------------------------------------------

class TestSafeFilename:
    def test_strips_backslash(self):
        assert "\\" not in safe_filename("a\\b")

    def test_strips_forward_slash(self):
        assert "/" not in safe_filename("a/b")

    def test_strips_colon(self):
        assert ":" not in safe_filename("a:b")

    def test_strips_asterisk(self):
        assert "*" not in safe_filename("a*b")

    def test_strips_question_mark(self):
        assert "?" not in safe_filename("a?b")

    def test_strips_double_quote(self):
        assert '"' not in safe_filename('a"b')

    def test_strips_angle_brackets(self):
        result = safe_filename("a<b>c")
        assert "<" not in result
        assert ">" not in result

    def test_strips_pipe(self):
        assert "|" not in safe_filename("a|b")

    def test_strips_whitespace_edges(self):
        result = safe_filename("  hello  ")
        assert result == result.strip()

    def test_clean_name_unchanged(self):
        assert safe_filename("my_file_name") == "my_file_name"


# ---------------------------------------------------------------------------
# get_dialog_filetypes
# ---------------------------------------------------------------------------

class TestGetDialogFiletypes:
    def test_returns_list(self):
        result = get_dialog_filetypes()
        assert isinstance(result, list)

    def test_all_tuples(self):
        for item in get_dialog_filetypes():
            assert isinstance(item, tuple)
            assert len(item) == 2

    def test_first_element_is_all_supported(self):
        filetypes = get_dialog_filetypes()
        assert filetypes[0][0] == "All Supported Files"

    def test_has_image_entry(self):
        labels = [t[0] for t in get_dialog_filetypes()]
        assert any("Image" in label for label in labels)

    def test_has_pdf_entry(self):
        labels = [t[0] for t in get_dialog_filetypes()]
        assert any("PDF" in label for label in labels)

    def test_nonempty_patterns(self):
        for label, pattern in get_dialog_filetypes():
            assert pattern  # not empty
