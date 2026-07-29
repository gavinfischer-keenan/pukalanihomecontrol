"""Tests for pdf_maker/converters/text_converter.py."""
import os
import sys
import pytest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from pdf_maker.converters.text_converter import (
    convert_text_to_pages,
    _read_text_safely,
    _escape_xml,
    _split_pdf_to_pages,
)


@pytest.fixture
def utf8_file(tmp_path):
    path = tmp_path / "utf8.txt"
    path.write_text("Hello world\nLine two\nLine three", encoding="utf-8")
    return str(path)


@pytest.fixture
def latin1_file(tmp_path):
    path = tmp_path / "latin1.txt"
    path.write_bytes("Résumé café naïve".encode("latin-1"))
    return str(path)


@pytest.fixture
def empty_file(tmp_path):
    path = tmp_path / "empty.txt"
    path.write_text("", encoding="utf-8")
    return str(path)


@pytest.fixture
def long_file(tmp_path):
    path = tmp_path / "long.txt"
    path.write_text("\n".join(f"Line {i}: some content here that fills the page" for i in range(500)), encoding="utf-8")
    return str(path)


@pytest.fixture
def sample_multi_page_pdf(tmp_path):
    import fitz
    doc = fitz.open()
    for i in range(5):
        page = doc.new_page(width=595, height=842)
        page.insert_text((50, 50), f"Page {i+1}")
    path = str(tmp_path / "multi.pdf")
    doc.save(path)
    doc.close()
    return path


class TestReadTextSafely:
    def test_utf8(self, utf8_file):
        text, warnings = _read_text_safely(utf8_file)
        assert "Hello world" in text
        assert len(warnings) == 0

    def test_latin1_fallback(self, latin1_file):
        text, warnings = _read_text_safely(latin1_file)
        assert "sum" in text  # Part of Résumé
        assert len(warnings) == 0  # latin-1 succeeds without warning

    def test_binary_fallback(self, tmp_path):
        """Bytes that succeed with latin-1 fallback should still read correctly."""
        path = tmp_path / "binary.txt"
        path.write_bytes(b"\x80\x81\x82 hello \xff")
        text, warnings = _read_text_safely(str(path))
        assert "hello" in text
        # latin-1 accepts all byte values, so it may succeed without warning
        # The important thing is that the content is readable
        assert len(text) > 0


class TestEscapeXml:
    def test_ampersand(self):
        assert _escape_xml("A & B") == "A &amp; B"

    def test_angle_brackets(self):
        assert _escape_xml("<html>") == "&lt;html&gt;"

    def test_quotes(self):
        assert '&quot;' in _escape_xml('say "hello"')

    def test_apostrophe(self):
        assert "&#39;" in _escape_xml("it's")

    def test_clean_string(self):
        assert _escape_xml("hello world") == "hello world"


class TestConvertTextToPages:
    def test_simple_text(self, utf8_file):
        pages, warnings = convert_text_to_pages(utf8_file)
        assert len(pages) >= 1
        for p in pages:
            assert os.path.isfile(p)

    def test_empty_file(self, empty_file):
        pages, warnings = convert_text_to_pages(empty_file)
        assert len(pages) >= 1  # Should still produce at least one page

    def test_long_text_multi_page(self, long_file):
        pages, warnings = convert_text_to_pages(long_file)
        assert len(pages) > 1  # 500 lines should produce multiple pages

    def test_letter_size(self, utf8_file):
        pages, warnings = convert_text_to_pages(utf8_file, page_size="Letter")
        assert len(pages) >= 1


class TestSplitPdfToPages:
    def test_split_multi_page(self, sample_multi_page_pdf):
        pages = _split_pdf_to_pages(sample_multi_page_pdf, cleanup_source=False)
        assert len(pages) == 5
        for p in pages:
            assert os.path.isfile(p)

    def test_split_with_cleanup(self, sample_multi_page_pdf):
        pages = _split_pdf_to_pages(sample_multi_page_pdf, cleanup_source=True)
        assert len(pages) == 5
        assert not os.path.isfile(sample_multi_page_pdf)  # Source should be deleted

    def test_split_single_page(self, tmp_path):
        import fitz
        doc = fitz.open()
        doc.new_page(width=595, height=842)
        path = str(tmp_path / "single.pdf")
        doc.save(path)
        doc.close()
        pages = _split_pdf_to_pages(path)
        assert len(pages) == 1
