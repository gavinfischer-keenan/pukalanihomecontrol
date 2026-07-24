"""
InsightFace pipeline wrapper for Photo Chronologizer.
Optimized for CT114 (4 cores, 4GB RAM).
"""
import cv2
import numpy as np
import io
import re
import threading
from pathlib import Path
from PIL import Image, ImageOps
from functools import lru_cache

_app = None
_lock = threading.Lock()
MODEL_NAME = "buffalo_sc"

RERUN_FILENAME_RE = re.compile(r'^\d{3}_[~=!]?\d{4}_')

# Pre-compute max image dimension for processing (smaller = faster detection)
_DETECT_SIZE = (640, 640)
_MAX_IMAGE_DIM = 1280  # Resize images larger than this before face detection


def get_face_app():
    global _app
    if _app is None:
        with _lock:
            if _app is None:
                from insightface.app import FaceAnalysis
                _app = FaceAnalysis(name=MODEL_NAME, providers=["CPUExecutionProvider"])
                _app.prepare(ctx_id=0, det_size=_DETECT_SIZE)
    return _app


def _load_image(path: str, max_dim=_MAX_IMAGE_DIM):
    """Load image with EXIF correction and optional downscale for faster processing.
    Returns (cv2_image, inverse_scale) where inverse_scale maps coords back to original."""
    try:
        img_pil = Image.open(path)
        img_pil = ImageOps.exif_transpose(img_pil)
        img_pil = img_pil.convert("RGB")
        
        # Downscale large images for faster face detection
        w, h = img_pil.size
        inv_scale = 1.0
        if max_dim and max(w, h) > max_dim:
            scale = max_dim / max(w, h)
            inv_scale = 1.0 / scale
            new_w, new_h = int(w * scale), int(h * scale)
            img_pil = img_pil.resize((new_w, new_h), Image.BILINEAR)
        
        return cv2.cvtColor(np.array(img_pil), cv2.COLOR_RGB2BGR), inv_scale
    except Exception:
        return None, 1.0


def _load_image_full(path: str):
    """Load image at full resolution (for face crops and thumbnails)."""
    try:
        img_pil = Image.open(path)
        img_pil = ImageOps.exif_transpose(img_pil)
        return img_pil.convert("RGB")
    except Exception:
        return None


def detect_faces(path: str) -> list:
    """Returns list of face dicts: {idx, bbox, embedding(bytes), age, score}
    Bounding boxes are always in original image coordinates."""
    app = get_face_app()
    img, inv_scale = _load_image(path)
    if img is None:
        return []
    try:
        faces = app.get(img)
    except Exception:
        return []
    result = []
    for i, face in enumerate(faces):
        # Scale bbox back to original image coordinates
        bbox = [int(v * inv_scale) for v in face.bbox.tolist()]
        emb = face.normed_embedding.astype(np.float32)
        age = int(face.age) if hasattr(face, "age") and face.age is not None else -1
        score = float(face.det_score) if hasattr(face, "det_score") else 1.0
        result.append({"idx": i, "bbox": bbox, "embedding": emb.tobytes(), "age": age, "score": score})
    return result


def embedding_from_bytes(b: bytes) -> np.ndarray:
    return np.frombuffer(b, dtype=np.float32)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Optimized cosine similarity — inputs are already normalized by InsightFace."""
    return float(np.dot(a, b))


def compute_reference(embedding_rows: list) -> np.ndarray:
    """Average all embeddings into a single normalized reference vector."""
    vecs = [embedding_from_bytes(r["embedding"]) for r in embedding_rows]
    if not vecs:
        return None
    ref = np.mean(vecs, axis=0)
    norm = np.linalg.norm(ref)
    return ref / norm if norm > 0 else ref


def build_enhanced_reference(enrollment_rows: list, anchor_rows: list) -> np.ndarray:
    """
    Build reference from both manual enrollments and validated-photo anchors.
    Anchors are weighted 2× to reflect high confidence.
    """
    vecs = [embedding_from_bytes(r["embedding"]) for r in enrollment_rows]
    # Anchors weighted 2×
    for r in anchor_rows:
        emb = embedding_from_bytes(r["embedding"])
        vecs.extend([emb, emb])
    if not vecs:
        return None
    ref = np.mean(vecs, axis=0)
    norm = np.linalg.norm(ref)
    return ref / norm if norm > 0 else ref


def match_photo(path: str, reference: np.ndarray,
                threshold_match=0.45, threshold_uncertain=0.35,
                single_face_auto_match=True):
    """Returns (match_status, best_score, best_age, best_face_idx, face_count)"""
    faces = detect_faces(path)
    if not faces:
        return "no_match", 0.0, -1, -1, 0
    best_score, best_age, best_idx = 0.0, -1, -1
    for face in faces:
        emb = embedding_from_bytes(face["embedding"])
        sim = cosine_similarity(emb, reference)
        if sim > best_score:
            best_score, best_age, best_idx = sim, face["age"], face["idx"]

    face_count = len(faces)

    # Single-face auto-match: if only one face in the photo and similarity
    # is above a low floor (0.15), assume it's the target. This catches
    # solo portraits that may have lower similarity due to age/angle variance.
    if single_face_auto_match and face_count == 1 and best_score >= 0.15:
        return "matched", best_score, best_age, best_idx, face_count

    if best_score >= threshold_match:
        return "matched", best_score, best_age, best_idx, face_count
    elif best_score >= threshold_uncertain:
        return "uncertain", best_score, best_age, best_idx, face_count
    else:
        return "no_match", best_score, best_age, best_idx, face_count


def make_thumbnail(path: str, max_size=800) -> bytes:
    try:
        img = Image.open(path)
        img = ImageOps.exif_transpose(img)
        img.thumbnail((max_size, max_size), Image.LANCZOS)
        buf = io.BytesIO()
        img.convert("RGB").save(buf, format="JPEG", quality=80)
        return buf.getvalue()
    except Exception:
        return b""


def make_face_crop(path: str, bbox: list, padding=0.35) -> bytes:
    """Padded face crop as JPEG bytes — used for enrollment confirmation modal."""
    try:
        img = Image.open(path)
        img = ImageOps.exif_transpose(img)
        w, h = img.size
        x1, y1, x2, y2 = bbox
        pw = int((x2 - x1) * padding)
        ph = int((y2 - y1) * padding)
        x1 = max(0, x1 - pw); y1 = max(0, y1 - ph)
        x2 = min(w, x2 + pw); y2 = min(h, y2 + ph)
        crop = img.crop((x1, y1, x2, y2))
        crop.thumbnail((480, 480), Image.LANCZOS)
        buf = io.BytesIO()
        crop.convert("RGB").save(buf, format="JPEG", quality=88)
        return buf.getvalue()
    except Exception:
        return b""


def detect_rerun_pattern(folder_path: str) -> dict:
    """
    Scan a folder and detect if it looks like a prior run's output.
    Returns {is_rerun, confidence, sample_files, model_hint}
    """
    try:
        p = Path(folder_path)
        if not p.exists():
            return {"is_rerun": False, "confidence": 0, "sample_files": []}
        files = [f.name for f in p.iterdir() if f.is_file()]
        if not files:
            return {"is_rerun": False, "confidence": 0, "sample_files": []}
        matches = [f for f in files if RERUN_FILENAME_RE.match(f)]
        confidence = len(matches) / len(files)
        samples = matches[:5]
        return {
            "is_rerun": confidence > 0.3,
            "confidence": round(confidence, 2),
            "sample_files": samples,
            "total_files": len(files),
            "matched_pattern": len(matches),
        }
    except Exception as e:
        return {"is_rerun": False, "confidence": 0, "error": str(e), "sample_files": []}
