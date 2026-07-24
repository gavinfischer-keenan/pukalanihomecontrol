"""
GLTF / 3D File Converter
========================
Converts 3D model files (GLTF, GLB, OBJ, STL, FBX) to a rendered image
and then embeds it in a single-page PDF.

This module is OPTIONAL. If trimesh or pyrender are not installed, the
function returns a friendly error page instead of crashing.

Installation (optional):
    pip install trimesh pyrender numpy
"""

import os
import tempfile
from pathlib import Path


def is_3d_available() -> tuple[bool, str]:
    """Check whether the 3D rendering stack is available."""
    try:
        import trimesh  # noqa: F401
        import pyrender  # noqa: F401
        import numpy    # noqa: F401
        return True, "3D rendering available (trimesh + pyrender)."
    except ImportError as e:
        return False, (
            f"3D rendering libraries not installed ({e}). "
            "To enable 3D file support, run:\n"
            "  pip install trimesh pyrender numpy"
        )


def convert_3d_to_pages(
    model_path: str,
    page_size: str = "A4",
    image_width: int = 1024,
    image_height: int = 1024,
) -> tuple[list[str], list[str]]:
    """
    Render a 3D model file to a PNG image and embed it in a single-page PDF.

    Returns:
        (list_of_temp_pdf_paths, list_of_warning_strings)
    """
    warnings: list[str] = []
    available, msg = is_3d_available()

    if not available:
        warnings.append(f"⚠️ {msg}")
        from .pdf_handler import _make_error_page
        err_path = _make_error_page(
            f"3D rendering not available.\n\n"
            f"File: {Path(model_path).name}\n\n"
            f"To enable 3D support, install:\n"
            f"  pip install trimesh pyrender numpy"
        )
        return [err_path], warnings

    try:
        import numpy as np
        import trimesh
        import pyrender
        from PIL import Image

        # ---------------------------------------------------------------- #
        # Load the 3D model
        # ---------------------------------------------------------------- #
        try:
            scene_or_mesh = trimesh.load(model_path, force="scene")
        except Exception as e:
            raise RuntimeError(f"Could not load 3D model: {e}") from e

        # Convert to pyrender scene
        if isinstance(scene_or_mesh, trimesh.Scene):
            scene = pyrender.Scene.from_trimesh_scene(scene_or_mesh)
        else:
            mesh = pyrender.Mesh.from_trimesh(scene_or_mesh)
            scene = pyrender.Scene()
            scene.add(mesh)

        # ---------------------------------------------------------------- #
        # Auto-position camera to frame the model
        # ---------------------------------------------------------------- #
        bounds = scene_or_mesh.bounds if hasattr(scene_or_mesh, "bounds") else None
        if bounds is not None:
            center = (bounds[0] + bounds[1]) / 2
            extent = np.linalg.norm(bounds[1] - bounds[0])
        else:
            center = np.array([0, 0, 0])
            extent = 2.0

        camera = pyrender.PerspectiveCamera(yfov=np.pi / 4.0, aspectRatio=1.0)
        camera_pose = np.eye(4)
        camera_pose[:3, 3] = center + np.array([0, 0, extent * 1.5])
        scene.add(camera, pose=camera_pose)

        # Add lights
        light = pyrender.DirectionalLight(color=np.ones(3), intensity=3.0)
        scene.add(light, pose=camera_pose)
        light2 = pyrender.DirectionalLight(color=np.ones(3), intensity=1.5)
        l2_pose = np.eye(4)
        l2_pose[:3, 3] = center + np.array([-extent, extent, extent])
        scene.add(light2, pose=l2_pose)

        # ---------------------------------------------------------------- #
        # Render to image
        # ---------------------------------------------------------------- #
        renderer = pyrender.OffscreenRenderer(image_width, image_height)
        color, _depth = renderer.render(scene)
        renderer.delete()

        img = Image.fromarray(color)
        tmp_img = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
        img.save(tmp_img.name)
        tmp_img.close()

        # ---------------------------------------------------------------- #
        # Convert image to PDF page
        # ---------------------------------------------------------------- #
        from .image_converter import convert_image_to_pages
        pages, img_warnings = convert_image_to_pages(tmp_img.name, page_size)
        warnings.extend(img_warnings)

        try:
            os.unlink(tmp_img.name)
        except Exception:
            pass

        warnings.append(
            f"ℹ️ 3D model '{Path(model_path).name}' rendered as a static image."
        )
        return pages, warnings

    except Exception as e:
        warnings.append(f"❌ 3D rendering failed: {e}")
        from .pdf_handler import _make_error_page
        err_path = _make_error_page(
            f"3D rendering failed for:\n{Path(model_path).name}\n\n{e}"
        )
        return [err_path], warnings
