import os
import shutil
import tempfile
import zipfile
from pathlib import Path
from fastapi.testclient import TestClient
import pytest

# We need to import the app to test it
import sys
sys.path.insert(0, "/opt/utilities/app")
try:
    from main import app
except ImportError:
    app = None

# A very basic synthetic export.xml to test the parser
SYNTHETIC_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<HealthData locale="en_US">
 <ExportDate value="2023-10-01 12:00:00 -0400"/>
 <Me HKCharacteristicTypeIdentifierBiologicalSex="HKBiologicalSexMale" HKCharacteristicTypeIdentifierBloodType="HKBloodTypeAPositive"/>
 <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Health" sourceVersion="16.3.1" unit="lb" creationDate="2023-01-01 08:00:00 -0400" startDate="2023-01-01 08:00:00 -0400" endDate="2023-01-01 08:00:00 -0400" value="180.0"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" sourceVersion="16.3.1" device="&lt;&lt;HKDevice: 0x283b92580&gt;, name:iPhone, manufacturer:Apple Inc., model:iPhone, hardware:iPhone13,4, software:16.3.1&gt;" unit="count" creationDate="2023-01-01 09:00:00 -0400" startDate="2023-01-01 09:00:00 -0400" endDate="2023-01-01 09:10:00 -0400" value="500"/>
</HealthData>
"""

@pytest.fixture
def temp_export_xml():
    temp_dir = Path(tempfile.mkdtemp())
    xml_path = temp_dir / "export.xml"
    xml_path.write_bytes(SYNTHETIC_XML)
    yield xml_path
    shutil.rmtree(temp_dir)

@pytest.fixture
def temp_export_zip(temp_export_xml):
    zip_path = temp_export_xml.parent / "export.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.write(temp_export_xml, arcname="export.xml")
    return zip_path

def test_convert_health_export_logic(temp_export_xml):
    from health_converter import convert_health_export
    zip_path = convert_health_export(temp_export_xml)
    assert zip_path.exists()
    assert zip_path.suffix == ".zip"
    
    # Check zip contents
    with zipfile.ZipFile(zip_path, "r") as zf:
        names = zf.namelist()
        assert "BodyMass.csv" in names
        assert "StepCount.csv" in names
        assert "_summary.csv" in names

@pytest.mark.skipif(app is None, reason="main app not found")
def test_endpoint_with_xml(temp_export_xml):
    client = TestClient(app)
    with open(temp_export_xml, "rb") as f:
        response = client.post(
            "/api/healthconverter/convert",
            files={"file": ("export.xml", f, "text/xml")}
        )
    assert response.status_code == 200
    assert response.headers["content-type"] in ("application/zip", "application/x-zip-compressed")

@pytest.mark.skipif(app is None, reason="main app not found")
def test_endpoint_with_zip(temp_export_zip):
    client = TestClient(app)
    with open(temp_export_zip, "rb") as f:
        response = client.post(
            "/api/healthconverter/convert",
            files={"file": ("export.zip", f, "application/zip")}
        )
    assert response.status_code == 200
    assert response.headers["content-type"] in ("application/zip", "application/x-zip-compressed")
