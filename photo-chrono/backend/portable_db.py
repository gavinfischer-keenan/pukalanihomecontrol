import sqlite3
import json
import uuid
import hashlib
import os
from datetime import datetime
from pathlib import Path

def get_db(db_path):
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    return con

def init_portable(db_path):
    con = get_db(db_path)
    con.executescript("""
    CREATE TABLE IF NOT EXISTS collection (
        id TEXT PRIMARY KEY,
        subject_name TEXT,
        subject_sex TEXT,
        birth_year INTEGER,
        birth_month INTEGER,
        birth_day INTEGER,
        created_at TEXT,
        updated_at TEXT,
        last_run_session TEXT,
        notes TEXT
    );
    CREATE TABLE IF NOT EXISTS photos (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        original_filename TEXT,
        original_path TEXT,
        source_type TEXT,
        estimated_age REAL,
        age_locked BOOLEAN DEFAULT FALSE,
        date_year INTEGER,
        date_month INTEGER,
        date_day INTEGER,
        date_source TEXT,
        date_locked BOOLEAN DEFAULT FALSE,
        subject_match_score REAL,
        subject_confirmed BOOLEAN,
        subject_excluded BOOLEAN DEFAULT FALSE,
        sort_order REAL,
        face_count INTEGER DEFAULT 0,
        faces_json TEXT,
        file_hash TEXT,
        file_size INTEGER,
        added_at TEXT,
        updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS photo_people (
        id TEXT PRIMARY KEY,
        photo_id TEXT REFERENCES photos(id),
        person_name TEXT,
        person_id TEXT,
        face_bbox TEXT,
        face_embedding BLOB,
        estimated_age REAL,
        match_score REAL,
        is_subject BOOLEAN DEFAULT FALSE,
        confirmed BOOLEAN DEFAULT FALSE,
        added_at TEXT
    );
    CREATE TABLE IF NOT EXISTS known_people (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT,
        photo_count INTEGER DEFAULT 0,
        year_first_seen INTEGER,
        year_last_seen INTEGER
    );
    CREATE TABLE IF NOT EXISTS reference_faces (
        id TEXT PRIMARY KEY,
        person_id TEXT,
        person_name TEXT,
        photo_id TEXT,
        face_idx INTEGER,
        embedding BLOB,
        estimated_age REAL,
        known_year INTEGER,
        enrolled_at TEXT
    );
    CREATE TABLE IF NOT EXISTS run_history (
        id TEXT PRIMARY KEY,
        run_type TEXT,
        server_session_id TEXT,
        started_at TEXT,
        finished_at TEXT,
        photos_processed INTEGER,
        photos_matched INTEGER,
        model_name TEXT,
        notes TEXT
    );
    """)
    con.commit()
    return con

def get_file_hash_and_size(filepath):
    try:
        size = os.path.getsize(filepath)
        h = hashlib.sha256()
        with open(filepath, 'rb') as f:
            while chunk := f.read(8192):
                h.update(chunk)
        return h.hexdigest(), size
    except Exception:
        return None, None

def write_portable(server_session_id, output_path):
    import db
    db_path = os.path.join(output_path, '.photo-chrono.db')
    con = init_portable(db_path)
    
    session = db.get_session(server_session_id)
    if not session:
        return
    
    now = datetime.now().isoformat()
    
    # 1. Update/Create Collection
    coll = con.execute("SELECT * FROM collection LIMIT 1").fetchone()
    if not coll:
        con.execute("""
            INSERT INTO collection (
                id, subject_name, subject_sex, birth_year, birth_month, birth_day,
                created_at, updated_at, last_run_session
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            str(uuid.uuid4()), session.get('subject_name'), session.get('subject_sex'),
            session.get('birth_year'), session.get('birth_month'), session.get('birth_day'),
            now, now, server_session_id
        ))
    else:
        con.execute("""
            UPDATE collection SET 
                subject_name=?, subject_sex=?, birth_year=?, birth_month=?, birth_day=?,
                updated_at=?, last_run_session=?
        """, (
            session.get('subject_name'), session.get('subject_sex'),
            session.get('birth_year'), session.get('birth_month'), session.get('birth_day'),
            now, server_session_id
        ))
    
    # Create known person for subject if not exists
    subject_person = con.execute("SELECT * FROM known_people WHERE name=?", (session.get('subject_name'),)).fetchone()
    if not subject_person:
        subject_id = str(uuid.uuid4())
        con.execute("""
            INSERT INTO known_people (id, name, created_at, updated_at)
            VALUES (?, ?, ?, ?)
        """, (subject_id, session.get('subject_name'), now, now))
    else:
        subject_id = subject_person['id']
    
    # 2. Photos
    matched_photos = db.get_matched_photos(server_session_id)
    for p in matched_photos:
        # get file hash and size from the output file
        out_file = os.path.join(output_path, p['output_filename']) if p.get('output_filename') else None
        f_hash, f_size = None, None
        if out_file and os.path.exists(out_file):
            f_hash, f_size = get_file_hash_and_size(out_file)
            
        orig_filename = os.path.basename(p.get('file_path', ''))
        date_year = p.get('date_hint_year') or p.get('estimated_year')
        subject_confirmed = p.get('user_confirmed') == 'yes' or bool(p.get('validated'))
        
        # Check if exists
        exist = con.execute("SELECT id FROM photos WHERE id=?", (p['id'],)).fetchone()
        if not exist:
            con.execute("""
                INSERT INTO photos (
                    id, filename, original_filename, original_path, source_type,
                    estimated_age, age_locked, date_year, date_month, date_locked,
                    subject_match_score, subject_confirmed, sort_order, face_count,
                    file_hash, file_size, added_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                p['id'], p.get('output_filename'), orig_filename, p.get('file_path'), 'gdrive',
                p.get('estimated_age'), False, date_year, p.get('date_hint_month'), p.get('date_locked'),
                p.get('match_score'), subject_confirmed, p.get('estimated_age'), p.get('face_count'),
                f_hash, f_size, now, now
            ))
        else:
            con.execute("""
                UPDATE photos SET
                    filename=?, original_filename=?, original_path=?,
                    estimated_age=?, date_year=?, date_month=?, date_locked=?,
                    subject_match_score=?, subject_confirmed=?, sort_order=?, face_count=?,
                    file_hash=?, file_size=?, updated_at=?
                WHERE id=?
            """, (
                p.get('output_filename'), orig_filename, p.get('file_path'),
                p.get('estimated_age'), date_year, p.get('date_hint_month'), p.get('date_locked'),
                p.get('match_score'), subject_confirmed, p.get('estimated_age'), p.get('face_count'),
                f_hash, f_size, now, p['id']
            ))

    # 3. Reference Faces
    embeddings = db.get_embeddings(server_session_id)
    for emb in embeddings:
        # Check if already in reference faces
        exist = con.execute("SELECT id FROM reference_faces WHERE photo_id=? AND face_idx=?", (emb['photo_id'], emb['face_idx'])).fetchone()
        if not exist:
            con.execute("""
                INSERT INTO reference_faces (
                    id, person_id, person_name, photo_id, face_idx, embedding, estimated_age, enrolled_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                str(uuid.uuid4()), subject_id, session.get('subject_name'), emb['photo_id'], emb['face_idx'],
                emb['embedding'], emb.get('age_estimate'), now
            ))
            
    # 4. Run history
    con.execute("""
        INSERT INTO run_history (
            id, run_type, server_session_id, started_at, finished_at,
            photos_processed, photos_matched, model_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        str(uuid.uuid4()), 'export', server_session_id, session.get('created_at'), now,
        session.get('processed_photos'), session.get('matched_photos'), session.get('model_name')
    ))

    con.commit()
    con.close()

def read_portable(db_path):
    if not os.path.exists(db_path):
        return None
        
    con = get_db(db_path)
    coll = con.execute("SELECT * FROM collection LIMIT 1").fetchone()
    if not coll:
        con.close()
        return None
        
    ref_count = con.execute("SELECT COUNT(*) FROM reference_faces").fetchone()[0]
    photo_count = con.execute("SELECT COUNT(*) FROM photos").fetchone()[0]
    known = con.execute("SELECT * FROM known_people").fetchall()
    
    res = {
        "collection": dict(coll),
        "reference_face_count": ref_count,
        "photo_count": photo_count,
        "known_people": [dict(k) for k in known]
    }
    con.close()
    return res

def import_reference_faces(portable_db_path, server_session_id):
    if not os.path.exists(portable_db_path):
        return 0
        
    import db
    
    con = get_db(portable_db_path)
    faces = con.execute("SELECT * FROM reference_faces").fetchall()
    
    count = 0
    server_con = db.get_db()
    for f in faces:
        # Check if already exists in server DB
        exist = server_con.execute("SELECT id FROM embeddings WHERE session_id=? AND photo_id=? AND face_idx=?", 
            (server_session_id, f['photo_id'], f['face_idx'])).fetchone()
        
        if not exist:
            db.save_embedding(
                server_session_id, 
                f['photo_id'], 
                f['face_idx'], 
                f['embedding'], 
                f['estimated_age'], 
                is_anchor=True
            )
            count += 1
    server_con.close()
    con.close()
    return count
