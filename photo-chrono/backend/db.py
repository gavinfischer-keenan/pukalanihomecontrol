import sqlite3, json, uuid, os
from datetime import datetime
from pathlib import Path

DB_PATH = Path(__file__).parent / "session.db"

def get_db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con

def init_db():
    con = get_db()
    con.executescript("""
    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT,
        subject_name TEXT,
        subject_sex TEXT DEFAULT 'unknown',
        birth_year INTEGER,
        birth_month INTEGER,
        birth_day INTEGER,
        source_path TEXT,
        output_path TEXT,
        status TEXT DEFAULT 'setup',
        created_at TEXT,
        total_photos INTEGER DEFAULT 0,
        processed_photos INTEGER DEFAULT 0,
        matched_photos INTEGER DEFAULT 0,
        uncertain_photos INTEGER DEFAULT 0,
        age_bias INTEGER DEFAULT 0,
        model_name TEXT DEFAULT 'buffalo_sc',
        sim_match REAL DEFAULT 0.45,
        sim_uncertain REAL DEFAULT 0.35,
        is_rerun BOOLEAN DEFAULT FALSE,
        prior_session_id TEXT
    );
    CREATE TABLE IF NOT EXISTS photo_files (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        file_path TEXT,
        rel_path TEXT,
        status TEXT DEFAULT 'pending',
        match_status TEXT,
        match_score REAL,
        estimated_age INTEGER,
        estimated_year INTEGER,
        date_hint_year INTEGER,
        date_hint_month INTEGER,
        date_hint_approx INTEGER DEFAULT 0,
        date_locked BOOLEAN DEFAULT FALSE,
        age_override INTEGER,
        user_confirmed TEXT,
        validated BOOLEAN DEFAULT FALSE,
        output_filename TEXT,
        face_count INTEGER DEFAULT 0,
        user_hint TEXT,
        hint_direction TEXT,
        age_adjustment_hint INTEGER DEFAULT 0,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
    CREATE TABLE IF NOT EXISTS embeddings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        photo_id TEXT,
        face_idx INTEGER,
        embedding BLOB,
        age_estimate INTEGER,
        enrolled_at TEXT,
        is_anchor BOOLEAN DEFAULT FALSE,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_photos_session ON photo_files(session_id);
    CREATE INDEX IF NOT EXISTS idx_photos_status ON photo_files(session_id, status);
    CREATE INDEX IF NOT EXISTS idx_embeddings_session ON embeddings(session_id);
    """)
    con.commit()
    _migrate(con)
    con.close()

def _migrate(con):
    """Add any missing columns to existing tables (safe to run repeatedly)."""
    def _add_col(table, col, defn):
        existing = {r[1] for r in con.execute(f"PRAGMA table_info({table})").fetchall()}
        if col not in existing:
            con.execute(f"ALTER TABLE {table} ADD COLUMN {col} {defn}")

    _add_col("photo_files", "validated",          "BOOLEAN DEFAULT FALSE")
    _add_col("photo_files", "date_locked",         "BOOLEAN DEFAULT FALSE")
    _add_col("photo_files", "user_hint",           "TEXT")
    _add_col("photo_files", "hint_direction",      "TEXT")
    _add_col("photo_files", "age_adjustment_hint", "INTEGER DEFAULT 0")
    _add_col("photo_files", "faces_cache",         "TEXT")
    _add_col("photo_files", "matched_face_idx",    "INTEGER")
    _add_col("sessions",    "subject_sex",         "TEXT DEFAULT 'unknown'")
    _add_col("sessions",    "model_name",          "TEXT DEFAULT 'buffalo_sc'")
    _add_col("sessions",    "sim_match",           "REAL DEFAULT 0.45")
    _add_col("sessions",    "sim_uncertain",       "REAL DEFAULT 0.35")
    _add_col("sessions",    "is_rerun",            "BOOLEAN DEFAULT FALSE")
    _add_col("sessions",    "prior_session_id",    "TEXT")
    _add_col("sessions",    "config",              "TEXT")
    _add_col("embeddings",  "is_anchor",           "BOOLEAN DEFAULT FALSE")
    con.commit()

# ── Sessions ──────────────────────────────────────────────────────────────────
def create_session(name, subject_name, subject_sex, birth_year, birth_month, birth_day,
                   source_path, output_path,
                   model_name='buffalo_sc', sim_match=0.45, sim_uncertain=0.35,
                   is_rerun=False, prior_session_id=None):
    sid = str(uuid.uuid4())[:8]
    con = get_db()
    con.execute("""
        INSERT INTO sessions (id, name, subject_name, subject_sex,
                              birth_year, birth_month, birth_day,
                              source_path, output_path, created_at,
                              model_name, sim_match, sim_uncertain,
                              is_rerun, prior_session_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (sid, name, subject_name, subject_sex,
          birth_year, birth_month, birth_day,
          source_path, output_path, datetime.now().isoformat(),
          model_name, sim_match, sim_uncertain, is_rerun, prior_session_id))
    con.commit()
    con.close()
    return sid

def get_session(sid):
    con = get_db()
    row = con.execute("SELECT * FROM sessions WHERE id=?", (sid,)).fetchone()
    con.close()
    return dict(row) if row else None

def list_sessions():
    con = get_db()
    rows = con.execute("SELECT * FROM sessions ORDER BY created_at DESC").fetchall()
    con.close()
    return [dict(r) for r in rows]

def update_session(sid, **kwargs):
    if not kwargs: return
    sets = ", ".join(f"{k}=?" for k in kwargs)
    vals = list(kwargs.values()) + [sid]
    con = get_db()
    con.execute(f"UPDATE sessions SET {sets} WHERE id=?", vals)
    con.commit()
    con.close()

# ── Photo files ───────────────────────────────────────────────────────────────
def upsert_photos(session_id, file_list):
    """file_list: list of (abs_path, rel_path)"""
    con = get_db()
    con.executemany("""
        INSERT OR IGNORE INTO photo_files (id, session_id, file_path, rel_path)
        VALUES (?, ?, ?, ?)
    """, [(str(uuid.uuid4())[:8], session_id, fp, rp) for fp, rp in file_list])
    count = con.execute("SELECT COUNT(*) FROM photo_files WHERE session_id=?", (session_id,)).fetchone()[0]
    con.execute("UPDATE sessions SET total_photos=? WHERE id=?", (count, session_id))
    con.commit()
    con.close()
    return count

def get_pending_photos(session_id, batch=20):
    con = get_db()
    rows = con.execute("""
        SELECT * FROM photo_files
        WHERE session_id=? AND status='pending' AND (validated IS NULL OR validated=FALSE)
        LIMIT ?
    """, (session_id, batch)).fetchall()
    con.close()
    return [dict(r) for r in rows]

def get_random_samples(session_id, n=8):
    con = get_db()
    rows = con.execute("""
        SELECT * FROM photo_files WHERE session_id=?
        ORDER BY RANDOM() LIMIT ?
    """, (session_id, n)).fetchall()
    con.close()
    return [dict(r) for r in rows]

def get_samples_by_age_buckets(session_id):
    """For re-run calibration: one photo from each age bucket."""
    buckets = [(0,15), (15,25), (25,40), (40,65)]
    con = get_db()
    results = []
    for lo, hi in buckets:
        row = con.execute("""
            SELECT * FROM photo_files
            WHERE session_id=? AND estimated_age>=? AND estimated_age<?
            ORDER BY RANDOM() LIMIT 1
        """, (session_id, lo, hi)).fetchone()
        if row:
            results.append(dict(row))
    # Fill remaining with random if buckets had no matches
    if len(results) < 4:
        extra = con.execute("""
            SELECT * FROM photo_files WHERE session_id=? ORDER BY RANDOM() LIMIT ?
        """, (session_id, 8 - len(results))).fetchall()
        results.extend([dict(r) for r in extra])
    con.close()
    return results[:8]

def update_photo(photo_id, **kwargs):
    if not kwargs: return
    sets = ", ".join(f"{k}=?" for k in kwargs)
    vals = list(kwargs.values()) + [photo_id]
    con = get_db()
    con.execute(f"UPDATE photo_files SET {sets} WHERE id=?", vals)
    con.commit()
    con.close()

def get_uncertain_photos(session_id, limit=50):
    con = get_db()
    rows = con.execute("""
        SELECT * FROM photo_files
        WHERE session_id=? AND match_status='uncertain' AND user_confirmed IS NULL
        ORDER BY match_score DESC LIMIT ?
    """, (session_id, limit)).fetchall()
    con.close()
    return [dict(r) for r in rows]

def get_no_face_photos(session_id, limit=50):
    """Photos where face detection found zero faces — need manual date assignment."""
    con = get_db()
    rows = con.execute("""
        SELECT * FROM photo_files
        WHERE session_id=? AND match_status='no_match' AND face_count=0
              AND user_confirmed IS NULL AND status='processed'
        ORDER BY rel_path ASC LIMIT ?
    """, (session_id, limit)).fetchall()
    con.close()
    return [dict(r) for r in rows]

def get_matched_photos(session_id):
    """All matched/confirmed photos ordered chronologically."""
    con = get_db()
    rows = con.execute("""
        SELECT * FROM photo_files
        WHERE session_id=? AND (match_status='matched' OR user_confirmed='yes' OR validated=TRUE)
        ORDER BY
            COALESCE(age_override, estimated_age, 999) ASC,
            COALESCE(date_hint_year, estimated_year, 9999) ASC,
            COALESCE(date_hint_month, 1) ASC
    """, (session_id,)).fetchall()
    con.close()
    return [dict(r) for r in rows]

def get_strip_window(session_id, center_id, window=10):
    """Return photos in chronological order ±window from center photo."""
    all_photos = get_matched_photos(session_id)
    ids = [p["id"] for p in all_photos]
    try:
        ci = ids.index(center_id)
    except ValueError:
        ci = 0
    lo = max(0, ci - window)
    hi = min(len(all_photos), ci + window + 1)
    return {
        "photos": all_photos[lo:hi],
        "center_idx": ci - lo,
        "total": len(all_photos),
        "global_idx": ci,
    }

def get_validated_photos(session_id):
    con = get_db()
    rows = con.execute("""
        SELECT * FROM photo_files WHERE session_id=? AND validated=TRUE
    """, (session_id,)).fetchall()
    con.close()
    return [dict(r) for r in rows]

def save_hint(photo_id, user_hint, hint_direction, nudge_years=4):
    """
    Save a user hint for a photo.
    hint_direction: 'older' | 'younger' | 'confident' | None
    nudge_years: how many years to add/subtract from estimated_age on re-run
    """
    if hint_direction == 'older':
        adj = nudge_years
    elif hint_direction == 'younger':
        adj = -nudge_years
    else:
        adj = 0
    update_photo(photo_id, user_hint=user_hint, hint_direction=hint_direction, age_adjustment_hint=adj)

def get_hinted_photos(session_id):
    """Return photos that have user hints — used during re-run to apply nudges."""
    con = get_db()
    rows = con.execute("""
        SELECT * FROM photo_files
        WHERE session_id=? AND hint_direction IS NOT NULL AND hint_direction != ''
    """, (session_id,)).fetchall()
    con.close()
    return [dict(r) for r in rows]

def increment_counters(session_id, processed=0, matched=0, uncertain=0):
    con = get_db()
    con.execute("""
        UPDATE sessions SET
            processed_photos = processed_photos + ?,
            matched_photos = matched_photos + ?,
            uncertain_photos = uncertain_photos + ?
        WHERE id=?
    """, (processed, matched, uncertain, session_id))
    con.commit()
    con.close()

# ── Embeddings ────────────────────────────────────────────────────────────────
def save_embedding(session_id, photo_id, face_idx, embedding_bytes, age_estimate, is_anchor=False):
    con = get_db()
    con.execute("""
        INSERT INTO embeddings (session_id, photo_id, face_idx, embedding, age_estimate, enrolled_at, is_anchor)
        VALUES (?,?,?,?,?,?,?)
    """, (session_id, photo_id, face_idx, embedding_bytes, age_estimate,
          datetime.now().isoformat(), is_anchor))
    con.commit()
    con.close()

def get_embeddings(session_id):
    con = get_db()
    rows = con.execute("SELECT * FROM embeddings WHERE session_id=?", (session_id,)).fetchall()
    con.close()
    return [dict(r) for r in rows]

def count_embeddings(session_id):
    con = get_db()
    n = con.execute("SELECT COUNT(*) FROM embeddings WHERE session_id=?", (session_id,)).fetchone()[0]
    con.close()
    return n

def import_anchors_from_session(new_sid, prior_sid):
    """Copy validated photo embeddings from prior session as anchors in new session."""
    con = get_db()
    # Get embeddings for validated photos from the prior session
    rows = con.execute("""
        SELECT e.* FROM embeddings e
        JOIN photo_files p ON p.id = e.photo_id
        WHERE e.session_id=? AND p.validated=TRUE
    """, (prior_sid,)).fetchall()
    count = 0
    for row in rows:
        con.execute("""
            INSERT INTO embeddings (session_id, photo_id, face_idx, embedding, age_estimate, enrolled_at, is_anchor)
            VALUES (?,?,?,?,?,?,TRUE)
        """, (new_sid, row["photo_id"], row["face_idx"], row["embedding"],
              row["age_estimate"], datetime.now().isoformat()))
        count += 1
    con.commit()
    con.close()
    return count

def get_sessions_by_output_path(output_path):
    """Find sessions that wrote to a given path (for re-run linking)."""
    con = get_db()
    rows = con.execute("""
        SELECT * FROM sessions WHERE output_path=? AND status='done' ORDER BY created_at DESC
    """, (output_path,)).fetchall()
    con.close()
    return [dict(r) for r in rows]
