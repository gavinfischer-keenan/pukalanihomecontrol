// ============================================================
// KNOWN ENTITIES SERVICE — Frequent Visitors feature
// Handles vessels + aircraft that meet the 3-day threshold or are manually pinned
//
// Track retention policy:
//   - Pinned entities:       unlimited
//   - Auto-detected (3+ days): 90 days
//   - All others:            7 days (handled by nightly prune)
//
// Exports: init(app, pool, express, multer, path, fs)
// ============================================================

const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

// In-memory session tracker: maps `vessel:338234631` → { sessionId, lastAt }
// Sessions expire (new UUID) if no position seen for > 30 minutes
const trackSessions = new Map();

function getOrCreateSession(key) {
  const now = Date.now();
  const existing = trackSessions.get(key);
  if (existing && (now - existing.lastAt) < 30 * 60 * 1000) {
    existing.lastAt = now;
    return existing.sessionId;
  }
  const sessionId = uuidv4();
  trackSessions.set(key, { sessionId, lastAt: now });
  return sessionId;
}

// ── IATA airport coordinates cache (used for flight route great-circle) ────
// Small set of key airports near Hawaii + major mainland US hubs
const AIRPORT_COORDS = {
  OGG: [20.8986, -156.4305], HNL: [21.3187, -157.9224],
  KOA: [19.7388, -156.0456], ITO: [19.7204, -155.0481],
  LIH: [21.9760, -159.3388], MKK: [21.1526, -157.0959],
  LAX: [33.9425, -118.4081], SFO: [37.6213, -122.3790],
  SEA: [47.4502, -122.3088], PDX: [45.5898, -122.5951],
  DEN: [39.8561, -104.6737], ORD: [41.9742, -87.9073],
  JFK: [40.6413, -73.7781],  ATL: [33.6407, -84.4277],
  PHX: [33.4373, -112.0078], LAS: [36.0840, -115.1537],
  ANC: [61.1744, -149.9982], NRT: [35.7720, 140.3929],
  SYD: [-33.9399, 151.1753], ICN: [37.4602, 126.4407],
  PEK: [40.0799, 116.6031],  HKG: [22.3080, 113.9185],
};

// ── Google Geocoding fallback for unknown IATA codes ─────────────────────────
// Called only when an airport IATA code is NOT in AIRPORT_COORDS above.
// Google Geocoding removed — using AIRPORT_COORDS hardcoded map only.
// If an airport is not in the map, coordinates will be null (route drawn without arc endpoints).

// ── Human-readable schedule label generator ──────────────────────────────
function buildDaysLabel(daysOfWeek) {
  if (!daysOfWeek || !daysOfWeek.length) return null;
  const names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const sorted = [...daysOfWeek].sort();
  const weekdays = [1,2,3,4,5];
  const weekend  = [0,6];
  const allDays  = [0,1,2,3,4,5,6];
  if (sorted.length === 7) return 'Every day';
  if (JSON.stringify(sorted) === JSON.stringify(weekdays)) return 'Weekdays only';
  if (JSON.stringify(sorted) === JSON.stringify(weekend)) return 'Weekends only';
  if (sorted.length >= 5) return 'Most days';
  if (sorted.length === 1) return `${names[sorted[0]]}s only`;
  if (sorted.length === 2) return `${names[sorted[0]]}s & ${names[sorted[1]]}s`;
  return sorted.map(d => names[d]).join(', ');
}

function buildTimeLabel(arrivalHour, departHour) {
  if (arrivalHour == null) return null;
  const ampm = h => h < 12 ? `${h || 12}am` : h === 12 ? '12pm' : `${h-12}pm`;
  if (departHour != null && Math.abs(departHour - arrivalHour) > 3) {
    const arrLabel = arrivalHour < 12 ? 'morning' : arrivalHour < 17 ? 'afternoon' : 'evening';
    const depLabel = departHour < 12 ? 'morning' : departHour < 17 ? 'afternoon' : 'evening';
    if (arrLabel !== depLabel) return `${arrLabel} arrival, ${depLabel} departure`;
  }
  const label = arrivalHour < 12 ? 'mornings' : arrivalHour < 17 ? 'afternoons' : 'evenings';
  return `Usually seen ${label}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRACK HISTORY RECORDING — call from vessel/aircraft polling loops
// ─────────────────────────────────────────────────────────────────────────────
async function recordTrackPoint(pool, entityType, identifier, lat, lon, altitude, speed, heading) {
  try {
    const sessionId = getOrCreateSession(`${entityType}:${identifier}`);
    await pool.query(
      `INSERT INTO entity_track_history
         (entity_type, identifier, track_session, lat, lon, altitude, speed, heading, recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
      [entityType, identifier, sessionId, lat, lon, altitude || null, speed || null, heading || null]
    );
  } catch {
    // Non-fatal
  }
}

// ── Schedule auto-analysis ────────────────────────────────────────────────────
async function analyzeSchedules(pool) {
  console.log('[known-entities] Running schedule analysis...');
  try {
    // Vessels
    const vessels = await pool.query(
      `SELECT mmsi AS identifier, vessel_name AS name, seen_days
       FROM vessel_info WHERE auto_detected OR is_pinned`
    );
    for (const v of vessels.rows) {
      await analyzeEntitySchedule(pool, 'vessel', v.identifier);
    }
    // Aircraft
    const aircraft = await pool.query(
      `SELECT icao_hex AS identifier, seen_days
       FROM aircraft_info WHERE auto_detected OR is_pinned`
    );
    for (const a of aircraft.rows) {
      await analyzeEntitySchedule(pool, 'aircraft', a.identifier);
    }
    console.log(`[known-entities] Schedule analysis done (${vessels.rows.length} vessels, ${aircraft.rows.length} aircraft)`);
  } catch (err) {
    console.error('[known-entities] Schedule analysis error:', err.message);
  }
}

async function analyzeEntitySchedule(pool, entityType, identifier) {
  const sightingsTable = entityType === 'vessel' ? 'vessel_sightings' : 'aircraft_sightings';
  const idCol = entityType === 'vessel' ? 'mmsi' : 'icao_hex';

  const { rows } = await pool.query(
    `SELECT EXTRACT(DOW FROM seen_day)::int AS dow,
            EXTRACT(EPOCH FROM MIN(seen_day::timestamp))/3600 AS min_hour
     FROM ${sightingsTable}
     WHERE ${idCol} = $1
     GROUP BY dow ORDER BY COUNT(*) DESC`,
    [identifier]
  );
  if (rows.length < 2) return;

  const daysOfWeek = [...new Set(rows.map(r => r.dow))].sort();
  const daysLabel  = buildDaysLabel(daysOfWeek);
  const confidence = Math.min(1.0, rows.length / 10);

  // Get arrival/departure hour pattern from track history
  const hourRows = await pool.query(
    `SELECT EXTRACT(HOUR FROM recorded_at AT TIME ZONE 'Pacific/Honolulu')::int AS hr, COUNT(*) AS cnt
     FROM entity_track_history
     WHERE entity_type=$1 AND identifier=$2
       AND recorded_at > NOW() - INTERVAL '90 days'
     GROUP BY hr ORDER BY cnt DESC LIMIT 5`,
    [entityType, identifier]
  );

  let arrivalHour = null, departHour = null;
  if (hourRows.rows.length) {
    const sortedHours = hourRows.rows.map(r => r.hr).sort((a,b) => a-b);
    arrivalHour = sortedHours[0];
    if (sortedHours.length > 1) departHour = sortedHours[sortedHours.length - 1];
  }

  const timeLabel = buildTimeLabel(arrivalHour, departHour);

  await pool.query(
    `INSERT INTO entity_schedule
       (entity_type, identifier, source, days_of_week, days_label,
        arrival_hour, depart_hour, time_label, confidence, obs_count, updated_at)
     VALUES ($1,$2,'auto',$3,$4,$5,$6,$7,$8,$9,NOW())
     ON CONFLICT (entity_type, identifier) DO UPDATE SET
       days_of_week = EXCLUDED.days_of_week,
       days_label   = EXCLUDED.days_label,
       arrival_hour = EXCLUDED.arrival_hour,
       depart_hour  = EXCLUDED.depart_hour,
       time_label   = EXCLUDED.time_label,
       confidence   = EXCLUDED.confidence,
       obs_count    = EXCLUDED.obs_count,
       updated_at   = NOW()
       WHERE entity_schedule.source = 'auto'`,
    [entityType, identifier, daysOfWeek, daysLabel, arrivalHour, departHour, timeLabel, confidence, rows.length]
  );
}

// ── Nightly track prune ───────────────────────────────────────────────────────
async function pruneTrackHistory(pool) {
  try {
    // Unknown entities — keep 7 days
    const r1 = await pool.query(`
      DELETE FROM entity_track_history
      WHERE recorded_at < NOW() - INTERVAL '7 days'
        AND NOT EXISTS (
          SELECT 1 FROM vessel_info vi
          WHERE entity_track_history.entity_type='vessel'
            AND vi.mmsi = entity_track_history.identifier
            AND (vi.is_pinned OR vi.auto_detected)
        )
        AND NOT EXISTS (
          SELECT 1 FROM aircraft_info ai
          WHERE entity_track_history.entity_type='aircraft'
            AND ai.icao_hex = entity_track_history.identifier
            AND (ai.is_pinned OR ai.auto_detected)
        )
    `);
    // Auto-detected (not pinned) — keep 90 days
    const r2 = await pool.query(`
      DELETE FROM entity_track_history eth
      WHERE recorded_at < NOW() - INTERVAL '90 days'
        AND (
          EXISTS (
            SELECT 1 FROM vessel_info vi
            WHERE eth.entity_type='vessel' AND vi.mmsi=eth.identifier
              AND vi.auto_detected AND NOT vi.is_pinned
          )
          OR EXISTS (
            SELECT 1 FROM aircraft_info ai
            WHERE eth.entity_type='aircraft' AND ai.icao_hex=eth.identifier
              AND ai.auto_detected AND NOT ai.is_pinned
          )
        )
    `);
    console.log(`[known-entities] Track prune: removed ${r1.rowCount + r2.rowCount} old points`);
  } catch (err) {
    console.error('[known-entities] Prune error:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FLIGHT ROUTE LOOKUP — check cache, then OpenSky, then return
// ─────────────────────────────────────────────────────────────────────────────
async function lookupFlightRoute(pool, flightNumber) {
  // 1. Check DB cache
  const cached = await pool.query(
    `SELECT * FROM flight_routes WHERE flight_number = $1`, [flightNumber]
  );
  if (cached.rows.length) return cached.rows[0];

  // 2. Try OpenSky Network (free, no key, best-effort)
  try {
    const upper = flightNumber.toUpperCase();
    const resp = await axios.get(
      `https://opensky-network.org/api/routes?callsign=${upper}`,
      { timeout: 8000, headers: { 'User-Agent': 'pukalani-home/1.0' } }
    );
    const data = resp.data;
    if (data && data.origin && data.destination) {
      const origin  = data.origin.slice(1);  // ICAO → IATA approximation
      const dest    = data.destination.slice(1);
      // Resolve coordinates: hardcoded map first, Google geocoding as fallback
      let originCoords = AIRPORT_COORDS[origin] || null;
      let destCoords   = AIRPORT_COORDS[dest]   || null;

      const row = {
        flight_number: upper,
        airline_name:  data.operatorCallsign || null,
        origin_iata:   origin,
        dest_iata:     dest,
        origin_lat:    originCoords ? originCoords[0] : null,
        origin_lon:    originCoords ? originCoords[1] : null,
        dest_lat:      destCoords ? destCoords[0] : null,
        dest_lon:      destCoords ? destCoords[1] : null,
        source:        'opensky',
      };

      await pool.query(
        `INSERT INTO flight_routes (flight_number, airline_name, origin_iata, dest_iata,
           origin_lat, origin_lon, dest_lat, dest_lon, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (flight_number) DO NOTHING`,
        [row.flight_number, row.airline_name, row.origin_iata, row.dest_iata,
         row.origin_lat, row.origin_lon, row.dest_lat, row.dest_lon, row.source]
      );
      return row;
    }
  } catch {
    // OpenSky unavailable or no data — graceful
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// INIT — registers all routes on the Express app
// ─────────────────────────────────────────────────────────────────────────────
function init(app, pool, express, multerLib, pathMod, fsMod) {

  // ── Photo upload setup ──────────────────────────────────────────────────────
  const ENTITY_PHOTOS_DIR = '/opt/dashboard/uploads/entities';
  if (!fsMod.existsSync(ENTITY_PHOTOS_DIR)) fsMod.mkdirSync(ENTITY_PHOTOS_DIR, { recursive: true });

  const entityPhotoStorage = multerLib.diskStorage({
    destination: (req, file, cb) => {
      const dir = pathMod.join(ENTITY_PHOTOS_DIR, req.params.type, req.params.id);
      fsMod.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = pathMod.extname(file.originalname) || '.jpg';
      cb(null, `${Date.now()}${ext}`);
    },
  });
  const entityUpload = multerLib({
    storage: entityPhotoStorage,
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (file.mimetype.startsWith('image/')) cb(null, true);
      else cb(new Error('Images only'));
    },
  });

  app.use('/uploads/entities', express.static(ENTITY_PHOTOS_DIR));

  // ── Schedule background jobs ───────────────────────────────────────────────
  // Auto-promote vessels to auto_detected daily
  const promoteJob = async () => {
    try {
      await pool.query(`UPDATE vessel_info SET auto_detected=true WHERE seen_days>=3 AND auto_detected=false`);
      await pool.query(`UPDATE aircraft_info SET auto_detected=true WHERE seen_days>=3 AND auto_detected=false`);
    } catch {}
  };
  setInterval(promoteJob, 4 * 60 * 60 * 1000); // every 4 hours
  promoteJob(); // run immediately on startup

  // Schedule analysis daily at 03:00 HST
  const scheduleAnalysisJob = () => {
    const now  = new Date();
    const hst  = new Date(now.toLocaleString('en-US', { timeZone: 'Pacific/Honolulu' }));
    const ms   = ((3 - hst.getHours()) * 3600 + (0 - hst.getMinutes()) * 60 - hst.getSeconds()) * 1000;
    const wait = ms > 0 ? ms : ms + 86400000;
    setTimeout(async () => {
      await analyzeSchedules(pool);
      await pruneTrackHistory(pool);
      scheduleAnalysisJob(); // reschedule for next day
    }, wait);
  };
  scheduleAnalysisJob();

  // ── GET /api/known-entities ────────────────────────────────────────────────
  // Unified list of frequent vessels + aircraft for sidebar panel
  app.get('/api/known-entities', async (req, res) => {
    try {
      const { type } = req.query; // optional: ?type=vessel|aircraft

      const vessels = (!type || type === 'vessel') ? await pool.query(`
        SELECT
          'vessel'       AS entity_type,
          vi.mmsi        AS identifier,
          vi.vessel_name AS name,
          vi.friendly_name,
          vi.notes       AS description,
          vi.vessel_type,
          vi.is_pinned,
          vi.auto_detected,
          vi.seen_days,
          vi.first_seen,
          vi.last_seen,
          es.days_label,
          es.time_label,
          es.notes       AS schedule_notes,
          (SELECT COUNT(*) FROM entity_photos ep
           WHERE ep.entity_type='vessel' AND ep.identifier=vi.mmsi) AS photo_count,
          (SELECT filename FROM entity_photos ep
           WHERE ep.entity_type='vessel' AND ep.identifier=vi.mmsi
           ORDER BY display_order, id LIMIT 1) AS first_photo
        FROM vessel_info vi
        LEFT JOIN entity_schedule es ON es.entity_type='vessel' AND es.identifier=vi.mmsi
        WHERE vi.auto_detected OR vi.is_pinned
        ORDER BY vi.is_pinned DESC, vi.last_seen DESC NULLS LAST
      `) : { rows: [] };

      const aircraft = (!type || type === 'aircraft') ? await pool.query(`
        SELECT
          'aircraft'      AS entity_type,
          ai.icao_hex     AS identifier,
          COALESCE(ai.registration, ai.icao_hex) AS name,
          ai.friendly_name,
          COALESCE(ai.description, ai.notes) AS description,
          ai.aircraft_type AS vessel_type,
          ai.is_pinned,
          ai.auto_detected,
          ai.seen_days,
          ai.first_seen,
          ai.last_seen,
          es.days_label,
          es.time_label,
          es.notes        AS schedule_notes,
          (SELECT COUNT(*) FROM entity_photos ep
           WHERE ep.entity_type='aircraft' AND ep.identifier=ai.icao_hex) AS photo_count,
          (SELECT filename FROM entity_photos ep
           WHERE ep.entity_type='aircraft' AND ep.identifier=ai.icao_hex
           ORDER BY display_order, id LIMIT 1) AS first_photo
        FROM aircraft_info ai
        LEFT JOIN entity_schedule es ON es.entity_type='aircraft' AND es.identifier=ai.icao_hex
        WHERE ai.auto_detected OR ai.is_pinned
        ORDER BY ai.is_pinned DESC, ai.last_seen DESC NULLS LAST
      `) : { rows: [] };

      res.json([...vessels.rows, ...aircraft.rows]
        .sort((a, b) => {
          if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
          return new Date(b.last_seen || 0) - new Date(a.last_seen || 0);
        })
      );
    } catch (err) {
      console.error('[known-entities] list error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── PUT /api/vessel-info/:mmsi — update pin/friendly name/description ───────
  app.put('/api/vessel-info/:mmsi', express.json(), async (req, res) => {
    const { mmsi } = req.params;
    const { is_pinned, friendly_name, notes, vessel_name } = req.body;
    try {
      await pool.query(`
        INSERT INTO vessel_info (mmsi, vessel_name, is_pinned, friendly_name, notes, first_seen, last_seen)
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        ON CONFLICT (mmsi) DO UPDATE SET
          is_pinned    = COALESCE($3, vessel_info.is_pinned),
          friendly_name = COALESCE($4, vessel_info.friendly_name),
          notes        = COALESCE($5, vessel_info.notes),
          vessel_name  = COALESCE($2, vessel_info.vessel_name),
          updated_at   = NOW()
      `, [mmsi, vessel_name || null, is_pinned ?? null, friendly_name || null, notes || null]);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── PUT /api/aircraft-info/:icao — update pin/friendly name/description ─────
  app.put('/api/aircraft-info/:icao', express.json(), async (req, res) => {
    const icao = req.params.icao.toLowerCase();
    const { is_pinned, friendly_name, description, registration } = req.body;
    try {
      await pool.query(`
        INSERT INTO aircraft_info (icao_hex, registration, is_pinned, friendly_name, description, first_seen, last_seen)
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        ON CONFLICT (icao_hex) DO UPDATE SET
          is_pinned    = COALESCE($3, aircraft_info.is_pinned),
          friendly_name= COALESCE($4, aircraft_info.friendly_name),
          description  = COALESCE($5, aircraft_info.description),
          registration = COALESCE($2, aircraft_info.registration),
          updated_at   = NOW()
      `, [icao, registration || null, is_pinned ?? null, friendly_name || null, description || null]);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── PUT /api/entity-schedule/:type/:id — manual schedule override ─────────
  app.put('/api/entity-schedule/:type/:id', express.json(), async (req, res) => {
    const { type, id } = req.params;
    const { days_of_week, days_label, arrival_hour, depart_hour, time_label, notes } = req.body;
    try {
      await pool.query(`
        INSERT INTO entity_schedule
          (entity_type, identifier, source, days_of_week, days_label,
           arrival_hour, depart_hour, time_label, notes, updated_at)
        VALUES ($1,$2,'manual',$3,$4,$5,$6,$7,$8,NOW())
        ON CONFLICT (entity_type, identifier) DO UPDATE SET
          source       = 'manual',
          days_of_week = COALESCE($3, entity_schedule.days_of_week),
          days_label   = COALESCE($4, entity_schedule.days_label),
          arrival_hour = COALESCE($5, entity_schedule.arrival_hour),
          depart_hour  = COALESCE($6, entity_schedule.depart_hour),
          time_label   = COALESCE($7, entity_schedule.time_label),
          notes        = COALESCE($8, entity_schedule.notes),
          updated_at   = NOW()
      `, [type, id, days_of_week || null, days_label || null,
          arrival_hour ?? null, depart_hour ?? null, time_label || null, notes || null]);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/known-entities/:type/:id/track-history ──────────────────────
  app.get('/api/known-entities/:type/:id/track-history', async (req, res) => {
    const { type, id } = req.params;
    const days = Math.min(365, parseInt(req.query.days || '90'));
    try {
      const { rows } = await pool.query(`
        SELECT track_session::text AS session_id,
               ARRAY_AGG(ARRAY[lat, lon, EXTRACT(EPOCH FROM recorded_at)]
                         ORDER BY recorded_at) AS points,
               MIN(recorded_at)::date::text     AS track_date
        FROM entity_track_history
        WHERE entity_type = $1 AND identifier = $2
          AND recorded_at > NOW() - ($3 || ' days')::INTERVAL
        GROUP BY track_session
        HAVING COUNT(*) >= 5
        ORDER BY MIN(recorded_at) DESC
        LIMIT 200
      `, [type, id, days]);

      res.set('Cache-Control', 'public, max-age=3600');
      res.json({ type, id, days, sessions: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/known-entities/:type/:id — single entity detail ─────────────
  app.get('/api/known-entities/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    try {
      let entityRow = null;
      if (type === 'vessel') {
        const { rows } = await pool.query(
          `SELECT vi.*, es.days_label, es.time_label, es.notes AS schedule_notes,
                  es.days_of_week, es.arrival_hour, es.depart_hour, es.source AS schedule_source
           FROM vessel_info vi
           LEFT JOIN entity_schedule es ON es.entity_type='vessel' AND es.identifier=vi.mmsi
           WHERE vi.mmsi = $1`, [id]
        );
        entityRow = rows[0];
      } else {
        const { rows } = await pool.query(
          `SELECT ai.*, es.days_label, es.time_label, es.notes AS schedule_notes,
                  es.days_of_week, es.arrival_hour, es.depart_hour, es.source AS schedule_source
           FROM aircraft_info ai
           LEFT JOIN entity_schedule es ON es.entity_type='aircraft' AND es.identifier=ai.icao_hex
           WHERE ai.icao_hex = $1`, [id]
        );
        entityRow = rows[0];
      }
      if (!entityRow) return res.status(404).json({ error: 'Not found' });

      // Fetch photos
      const { rows: photos } = await pool.query(
        `SELECT id, filename, display_order, caption, uploaded_at
         FROM entity_photos
         WHERE entity_type=$1 AND identifier=$2
         ORDER BY display_order, id`,
        [type, id]
      );

      res.json({ ...entityRow, entity_type: type, photos });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/known-entities/:type/:id/photos — multi-photo upload ────────
  app.post('/api/known-entities/:type/:id/photos',
    entityUpload.single('photo'),
    async (req, res) => {
      const { type, id } = req.params;
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      try {
        const relativePath = req.file.filename;
        const { rows } = await pool.query(
          `INSERT INTO entity_photos (entity_type, identifier, filename, display_order)
           VALUES ($1, $2, $3,
             COALESCE((SELECT MAX(display_order)+1 FROM entity_photos
                       WHERE entity_type=$1 AND identifier=$2), 0))
           RETURNING id, filename, display_order`,
          [type, id, relativePath]
        );
        res.json({ ok: true, photo: rows[0] });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // ── DELETE /api/known-entities/:type/:id/photos/:photoId ─────────────────
  app.delete('/api/known-entities/:type/:id/photos/:photoId', async (req, res) => {
    const { type, id, photoId } = req.params;
    try {
      const { rows } = await pool.query(
        `DELETE FROM entity_photos WHERE id=$1 AND entity_type=$2 AND identifier=$3 RETURNING filename`,
        [photoId, type, id]
      );
      if (rows.length) {
        const filePath = pathMod.join(ENTITY_PHOTOS_DIR, type, id, rows[0].filename);
        try { fsMod.unlinkSync(filePath); } catch {}
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── PUT /api/known-entities/:type/:id/photos/reorder ─────────────────────
  app.put('/api/known-entities/:type/:id/photos/reorder', express.json(), async (req, res) => {
    const { type, id } = req.params;
    const { order } = req.body; // array of photo IDs in desired order
    try {
      for (let i = 0; i < order.length; i++) {
        await pool.query(
          `UPDATE entity_photos SET display_order=$1 WHERE id=$2 AND entity_type=$3 AND identifier=$4`,
          [i, order[i], type, id]
        );
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/flight-route/:flightNumber ───────────────────────────────────
  app.get('/api/flight-route/:flightNumber', async (req, res) => {
    const fn = req.params.flightNumber.toUpperCase().replace(/\s/g, '');
    try {
      const route = await lookupFlightRoute(pool, fn);
      if (!route) return res.status(404).json({ error: 'Route not found', flight_number: fn });
      res.set('Cache-Control', 'public, max-age=86400'); // 24h — routes are stable
      res.json(route);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/flight-route — manual route entry ───────────────────────────
  app.post('/api/flight-route', express.json(), async (req, res) => {
    const { flight_number, airline_name, origin_iata, dest_iata } = req.body;
    if (!flight_number || !origin_iata || !dest_iata) {
      return res.status(400).json({ error: 'flight_number, origin_iata, dest_iata required' });
    }
    const originCoords = AIRPORT_COORDS[origin_iata.toUpperCase()];
    const destCoords   = AIRPORT_COORDS[dest_iata.toUpperCase()];
    try {
      await pool.query(`
        INSERT INTO flight_routes (flight_number, airline_name, origin_iata, dest_iata,
          origin_lat, origin_lon, dest_lat, dest_lon, source)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual')
        ON CONFLICT (flight_number) DO UPDATE SET
          airline_name = COALESCE($2, flight_routes.airline_name),
          origin_iata  = $3, dest_iata = $4,
          origin_lat   = $5, origin_lon = $6,
          dest_lat     = $7, dest_lon   = $8,
          fetched_at   = NOW(), source = 'manual'
      `, [flight_number.toUpperCase(), airline_name || null, origin_iata.toUpperCase(), dest_iata.toUpperCase(),
          originCoords?.[0] || null, originCoords?.[1] || null,
          destCoords?.[0] || null, destCoords?.[1] || null]);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  console.log('[known-entities] Service initialized — routes registered');

  // ── Auto-fetch entity photos: 2 min after startup, then every 6 hours ──────
  setTimeout(() => {
    console.log('[photo-fetch] Starting initial auto-fetch for entities without photos...');
    autoFetchAllPhotos(pool).catch(e => console.error('[photo-fetch] startup error:', e.message));
  }, 2 * 60 * 1000);

  setInterval(() => {
    autoFetchAllPhotos(pool).catch(e => console.error('[photo-fetch] interval error:', e.message));
  }, 6 * 60 * 60 * 1000);

  return { recordTrackPoint };
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AUTO PHOTO FETCH — Google Custom Search + Cloud Vision validation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const fs_module  = require('fs');
const https_mod  = require('https');
const http_mod   = require('http');
const path_mod   = require('path');

// Vessel/aircraft type keywords for Vision API label matching
const VESSEL_LABELS  = new Set([
  'ship','boat','vessel','watercraft','container ship','cargo ship',
  'sailboat','ferry','yacht','cruise ship','tanker','barge',
  'fishing vessel','tugboat','patrol boat','speedboat','liner',
  'warship','submarine','aircraft carrier','catamaran'
]);
const AIRCRAFT_LABELS = new Set([
  'aircraft','airplane','plane','airliner','helicopter','jet',
  'propeller','aviation','airship','flight','warplane','biplane',
  'seaplane','glider','drone'
]);

// Download a URL to a local file path; returns true on success
async function downloadImage(url, destPath) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https_mod : http_mod;
    try {
      const req = mod.get(url, { timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; pukalanihome-bot/1.0)' }
      }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          downloadImage(res.headers.location, destPath).then(resolve);
          return;
        }
        if (res.statusCode !== 200) { resolve(false); return; }
        const ct = res.headers['content-type'] || '';
        if (!ct.startsWith('image/')) { resolve(false); return; }
        const ws = fs_module.createWriteStream(destPath);
        res.pipe(ws);
        ws.on('finish', () => resolve(true));
        ws.on('error',  () => resolve(false));
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    } catch(e) { resolve(false); }
  });
}

// Vision API validation — NOT USED.
// PSE is restricted to curated vessel/aircraft photo sites, so all returned images
// are already ships or planes. No external validation needed.
// Function kept as no-op so existing call sites don't break.
async function visionCheckImage(localPath, entityType) {
  // Curated sources (marinetraffic, airliners.net, planespotters, etc.) are trusted.
  // Return the domain as a pseudo-label array so callers get a truthy value.
  return ['curated_source_trusted'];
}

// Search Google Custom Search for images of an entity.
// PSE is pre-configured with curated vessel/aircraft photo sites:
//   marinetraffic.com, shipspotting.com, vesseltracker.com, fleetmon.com  (vessels)
//   airliners.net, planespotters.net, jetphotos.com                       (aircraft)
//   imgur.com                                                               (general)
// Results from these sites don't need Vision API validation — they ARE ships/planes.
async function searchEntityImages(entityType, identifier, name) {
  // No API key needed — use direct source APIs
  // Aircraft: api.planespotters.net (free JSON API)
  // Vessels:  shipspotting.com search scrape
  const UA = 'PukalaniMonitor/1.0 (+https://github.com/gavinfischer-keenan/pukalanihomecontrol)';
  const results = [];

  try {
    if (entityType === 'aircraft') {
      // name = registration (e.g. N85PF) from autoFetchAllPhotos query
      const reg = name.replace(/[^A-Z0-9-]/gi, '').toUpperCase();
      if (!reg) return [];
      const url = `https://api.planespotters.net/pub/photos/reg/${reg}`;
      const resp = await axios.get(url, {
        timeout: 10000,
        headers: { 'User-Agent': UA }
      });
      const photos = resp.data.photos || [];
      for (const p of photos.slice(0, 3)) {
        const imageUrl = p.thumbnail_large?.src || p.thumbnail?.src;
        if (imageUrl) {
          results.push({
            url: imageUrl,
            title: `${reg} — photo by ${p.photographer || 'planespotters.net'}`,
            domain: 'planespotters.net',
          });
        }
      }
      console.log(`[photo-search] ${reg} (aircraft) → ${results.length} images via planespotters.net`);

    } else if (entityType === 'vessel') {
      // Vessel: try shipspotting.com search
      const vesselName = name.replace(/[^\w\s-]/g, '').trim();
      const ssUrl = `https://www.shipspotting.com/photos/search/?searchQuery=${encodeURIComponent(vesselName)}`;
      try {
        const r = await axios.get(ssUrl, {
          timeout: 12000,
          headers: { 'User-Agent': UA, 'Accept': 'text/html' }
        });
        // Extract CDN image URLs from HTML
        const matches = (r.data.match(/https?:\/\/[^"' ]*(?:shipspotting\.com|ssphotos)[^"' ]*\.(?:jpg|jpeg|png)/gi) || []);
        const unique = [...new Set(matches)].filter(u => !u.includes('logo') && !u.includes('avatar'));
        for (const imgUrl of unique.slice(0, 3)) {
          results.push({ url: imgUrl, title: `${vesselName} — ShipSpotting.com`, domain: 'shipspotting.com' });
        }
      } catch(e2) { /* scrape failed */ }

      // If shipspotting found nothing, try marinetraffic photo URL by MMSI
      if (results.length === 0 && /^\d{9}$/.test(String(identifier))) {
        const mtUrl = `https://photos.marinetraffic.com/ais/showphoto.aspx?mmsi=${identifier}&size=thumb`;
        try {
          const r = await axios.get(mtUrl, { timeout: 8000, responseType: 'arraybuffer', headers: { 'User-Agent': UA }, maxRedirects: 5 });
          const ct = (r.headers['content-type'] || '');
          if (ct.includes('image/') && r.data.length > 5000) {
            results.push({ url: mtUrl, title: `${name} — MarineTraffic photo`, domain: 'marinetraffic.com', isDirectImage: true });
          }
        } catch(e3) { /* no MT photo */ }
      }
      console.log(`[photo-search] ${vesselName} (vessel) → ${results.length} images`);
    }
  } catch(err) {
    console.warn(`[photo-search] Error for "${name}":`, err.message);
  }
  return results;
}

// Store up to 3 validated images for an entity
async function fetchPhotosForEntity(db, entityType, identifier, name) {
  // Check if already has 3+ non-rejected photos
  const existing = await db.query(
    `SELECT COUNT(*) FROM entity_photos WHERE entity_type=$1 AND identifier=$2 AND status != 'rejected'`,
    [entityType, identifier]
  );
  if (parseInt(existing.rows[0].count) >= 3) {
    console.log(`[photo-fetch] ${name}: already has 3+ photos, skipping`);
    return;
  }

  const images = await searchEntityImages(entityType, identifier, name);
  if (!images.length) return;

  const dir = path_mod.join('/opt/dashboard/uploads/entities', entityType, identifier);
  fs_module.mkdirSync(dir, { recursive: true });

  let stored = 0;
  for (const img of images) {
    if (stored >= 3) break;

    // Check if this URL was already rejected
    const prev = await db.query(
      `SELECT status FROM entity_photos WHERE entity_type=$1 AND identifier=$2 AND original_url=$3`,
      [entityType, identifier, img.url]
    );
    if (prev.rows[0]?.status === 'rejected') continue;
    if (prev.rows.length > 0) { stored++; continue; } // already stored

    const ts      = Date.now();
    const tmpPath = path_mod.join(dir, `auto_${ts}.jpg`);

    const downloaded = await downloadImage(img.url, tmpPath);
    if (!downloaded) { fs_module.existsSync(tmpPath) && fs_module.unlinkSync(tmpPath); continue; }

    // Curated sources are trusted — no Vision API call needed
    const labels = ['curated_source', img.domain || 'unknown'];

    // Build a caption: "VESSEL NAME — source: marinetraffic.com"
    const caption = img.title
      ? `${img.title} [${img.domain || 'web'}]`
      : `Found on ${img.domain || 'web'}`;

    const displayOrder = 100 + stored; // after any manually uploaded photos
    await db.query(
      `INSERT INTO entity_photos
         (entity_type, identifier, filename, display_order, caption, status, source, vision_labels, original_url)
       VALUES ($1,$2,$3,$4,$5,'potential',$6,$7,$8)
       ON CONFLICT DO NOTHING`,
      [entityType, identifier, path_mod.basename(tmpPath), displayOrder,
       caption, 'google_image_search', JSON.stringify(labels), img.url]
    );
    console.log(`[photo-fetch] Stored potential photo ${stored+1}/3 for ${name}`);
    stored++;
  }
  if (stored > 0) console.log(`[photo-fetch] ${name}: ${stored} photo(s) stored (status=potential)`);
}

// Run for all entities that have no confirmed photos yet
async function autoFetchAllPhotos(db) {
  console.log('[photo-fetch] Starting auto-fetch for entities without photos...');
  try {
    const { rows } = await db.query(`
      SELECT v.mmsi AS identifier, 'vessel' AS entity_type,
             COALESCE(v.friendly_name, v.vessel_name) AS name
      FROM vessel_info v
      WHERE (v.auto_detected = true OR v.is_pinned = true)
        AND NOT EXISTS (
          SELECT 1 FROM entity_photos ep
          WHERE ep.entity_type = 'vessel' AND ep.identifier = v.mmsi::text
            AND ep.status != 'rejected'
        )
      UNION ALL
      SELECT a.icao_hex AS identifier, 'aircraft' AS entity_type,
             COALESCE(a.registration, a.icao_hex) AS name  -- registration needed for planespotters.net
      FROM aircraft_info a
      WHERE (a.auto_detected = true OR a.is_pinned = true)
        AND NOT EXISTS (
          SELECT 1 FROM entity_photos ep
          WHERE ep.entity_type = 'aircraft' AND ep.identifier = a.icao_hex
            AND ep.status != 'rejected'
        )
      LIMIT 50
    `);

    console.log(`[photo-fetch] ${rows.length} entities need photos`);
    for (let i = 0; i < rows.length; i++) {
      const { identifier, entity_type, name } = rows[i];
      await new Promise(r => setTimeout(r, i * 3000)); // 3s stagger — good citizen
      fetchPhotosForEntity(db, entity_type, identifier, name).catch(e =>
        console.warn(`[photo-fetch] Error for ${name}:`, e.message)
      );
    }
  } catch(e) {
    console.error('[photo-fetch] autoFetchAllPhotos error:', e.message);
  }


  // ── Photo confirm / reject ──────────────────────────────────────────────────
  // PUT /api/known-entities/:type/:id/photos/:photoId/confirm
  app.put('/api/known-entities/:type/:id/photos/:photoId/confirm', async (req, res) => {
    const { type, id, photoId } = req.params;
    try {
      await db.query(
        `UPDATE entity_photos SET status='confirmed' WHERE id=$1 AND entity_type=$2 AND identifier=$3`,
        [photoId, type, id]
      );
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // PUT /api/known-entities/:type/:id/photos/:photoId/reject
  app.put('/api/known-entities/:type/:id/photos/:photoId/reject', async (req, res) => {
    const { type, id, photoId } = req.params;
    try {
      // Mark rejected + delete the local file
      const row = await db.query(
        `UPDATE entity_photos SET status='rejected' WHERE id=$1 AND entity_type=$2 AND identifier=$3 RETURNING filename`,
        [photoId, type, id]
      );
      if (row.rows[0]?.filename) {
        const fp = require('path').join('/opt/dashboard/uploads/entities', type, id, row.rows[0].filename);
        require('fs').unlink(fp, () => {});
      }
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/known-entities/:type/:id/photos  (returns all non-rejected, status included)
  app.get('/api/known-entities/:type/:id/photos', async (req, res) => {
    const { type, id } = req.params;
    try {
      const { rows } = await db.query(
        `SELECT id, filename, display_order, caption, status, source, vision_labels, original_url, uploaded_at
         FROM entity_photos
         WHERE entity_type=$1 AND identifier=$2 AND status != 'rejected'
         ORDER BY display_order, uploaded_at`,
        [type, id]
      );
      const photos = rows.map(r => ({
        ...r,
        url: `/uploads/entities/${type}/${id}/${r.filename}`,
      }));
      res.json({ photos });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

}


module.exports = { init, recordTrackPoint };
