import os
import shutil
import tempfile
import zipfile
from pathlib import Path
from parser import parse_export
from writers import OutputManager

def convert_health_export(xml_path: Path) -> Path:
    """
    Given the path to an export.xml file, parse it and return a path to a zip file containing CSVs.
    Note: xml_path should be inside a temporary directory that can be used for processing.
    """
    export_folder = xml_path.parent
    
    # Initialize OutputManager (will create export_folder / "converted")
    output_manager = OutputManager(export_folder)
    
    # Run the parser
    # parse_export expects export_folder to contain export.xml
    stats = parse_export(export_folder, output_manager)
    
    # Close writers and write summary
    output_manager.close_and_write_summary()
    
    # Zip the contents of the "converted" folder
    converted_dir = export_folder / "converted"
    zip_path = export_folder / "apple_health_csv_export.zip"
    
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(converted_dir):
            for file in files:
                file_path = Path(root) / file
                # Add file to zip without the absolute path
                zf.write(file_path, file_path.relative_to(converted_dir))
                
    return zip_path
