"""Tests for pdf_maker/converters/pdf_handler.py."""
import os
import sys
import pytest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from pdf_maker.converters.pdf_handler import (
    get_pdf_page_count,
    convert_pdf_to_pages,
    _make_error_page,
)


@pytest.fixture
def single_page_pdf(tmp_path):
    import fitz
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((50, 50), "Single page")
    path = str(tmp_path / "single.pdf")
    doc.save(path)
    doc.close()
    return path


@pytest.fixture
def multi_page_pdf(tmp_path):
    import fitz
    doc = fitz.open()
    for i in range(4):
        page = doc.new_page(width=595, height=842)
        page.insert_text((50, 50), f"Page {i+1}")
    path = str(tmp_path / "multi.pdf")
    doc.save(path)
    doc.close()
    return path


@pytest.fixture
def empty_pdf(tmp_path):
    """Create a minimal PDF file that fitz can open but reports 0 pages."""
    # PyMuPDF won't save 0-page PDFs, so write a minimal valid-header PDF
    # that fitz can open but has no renderable pages
    path = str(tmp_path / "empty.pdf")
    # Minimal PDF structure with no pages
    content = b"%PDF-1.0\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\nxref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \ntrailer<</Size 3/Root 1 0 R>>\nstartxref\n109\n%%EOF"
    with open(path, 'wb') as f:
        f.write(content)
    return path


class TestGetPdfPageCount:
    def test_single_page(self, single_page_pdf):
        assert get_pdf_page_count(single_page_pdf) == 1

    def test_multi_page(self, multi_page_pdf):
        assert get_pdf_page_count(multi_page_pdf) == 4

    def test_empty_pdf(self, empty_pdf):
        assert get_pdf_page_count(empty_pdf) == 0

    def test_nonexistent_file(self):
        assert get_pdf_page_count("/nonexistent/file.pdf") == 0

    def test_corrupt_file(self, tmp_path):
        path = str(tmp_path / "corrupt.pdf")
        Path(path).write_text("not a pdf")
        assert get_pdf_page_count(path) == 0


class TestConvertPdfToPages:
    def test_single_page_split(self, single_page_pdf):
        pages, warnings = convert_pdf_to_pages(single_page_pdf)
        assert len(pages) == 1
        assert os.path.isfile(pages[0])
        assert len(warnings) == 0

    def test_multi_page_split(self, multi_page_pdf):
        pages, warnings = convert_pdf_to_pages(multi_page_pdf)
        assert len(pages) == 4
        for p in pages:
            assert os.path.isfile(p)

    def test_empty_pdf(self, empty_pdf):
        pages, warnings = convert_pdf_to_pages(empty_pdf)
        assert len(pages) == 1  # Error page
        assert len(warnings) > 0
        assert "no pages" in warnings[0].lower()

    def test_corrupt_pdf(self, tmp_path):
        path = str(tmp_path / "corrupt.pdf")
        Path(path).write_text("not a pdf")
        pages, warnings = convert_pdf_to_pages(path)
        assert len(pages) == 1  # Error page
        assert len(warnings) > 0

    def test_nonexistent_pdf(self):
        pages, warnings = convert_pdf_to_pages("/nonexistent/file.pdf")
        assert len(pages) == 1  # Error page
        assert len(warnings) > 0


class TestMakeErrorPage:
    def test_creates_pdf(self):
        path = _make_error_page("Test error message")
        assert os.path.isfile(path)
        import fitz
        doc = fitz.open(path)
        assert len(doc) == 1
        doc.close()
        os.unlink(path)

    def test_a4_dimensions(self):
        path = _make_error_page("Test", page_size="A4")
        import fitz
        doc = fitz.open(path)
        page = doc[0]
        assert abs(page.rect.width - 595.28) < 1
        doc.close()
        os.unlink(path)

    def test_letter_dimensions(self):
        path = _make_error_page("Test", page_size="Letter")
        import fitz
        doc = fitz.open(path)
        page = doc[0]
        assert abs(page.rect.width - 612.0) < 1
        doc.close()
        os.unlink(path)
