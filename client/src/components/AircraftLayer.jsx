import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';

// ─── Altitude color scale (matches tar1090 exactly) ─────────────────────────
const ALT_STOPS = [
  [0,     [255, 50,  50 ]],
  [2000,  [255, 120, 0  ]],
  [5000,  [255, 220, 0  ]],
  [10000, [0,   220, 0  ]],
  [18000, [0,   210, 210]],
  [30000, [0,   100, 255]],
  [40000, [160, 0,   255]],
];

function interpolateColor(val, stops) {
  const clamped = Math.max(stops[0][0], Math.min(stops[stops.length-1][0], val));
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i];
    const [b, cb] = stops[i+1];
    if (clamped >= a && clamped <= b) {
      const t = (clamped - a) / (b - a);
      return `rgb(${Math.round(ca[0]+(cb[0]-ca[0])*t)},${Math.round(ca[1]+(cb[1]-ca[1])*t)},${Math.round(ca[2]+(cb[2]-ca[2])*t)})`;
    }
  }
  return '#ffffff';
}

export function altColor(alt) {
  if (alt === null || alt === undefined || alt === 'ground') return '#aaaaaa';
  const n = typeof alt === 'string' ? parseFloat(alt) : alt;
  if (isNaN(n)) return '#aaaaaa';
  return interpolateColor(n, ALT_STOPS);
}

// ─── Aircraft type classification ────────────────────────────────────────────
// Uses ADS-B `category` field (A1–C7) and ICAO type code prefix
// Category codes: https://gpsd.gitlab.io/gpsd/AIVDM.html (ADS-B emitter category)
//   A1=Light, A2=Small, A3=Large, A4=High vortex large, A5=Heavy
//   A6=High performance, A7=Rotorcraft
//   B1=Glider, B2=Lighter-than-air, B3=Parachutist, B4=Ultralight, B6=UAV, B7=Space
//   C1=Ground emergency, C2=Ground service, C3=Fixed obstacle

export function classifyAircraft(ac) {
  const cat  = (ac.category || '').toUpperCase();
  const type = (ac.t || '').toUpperCase();

  // ── Exact ICAO type code lookups (highest priority) ────────────────────
  const ICAO_MAP = {
    // 4-engine turboprop military transport
    'C130': 'c130', 'C30J': 'c130', 'C160': 'c130',
    // 4-engine jet military transport
    'C17':  'strato', 'C5':   'strato', 'C141': 'strato',
    // 4-engine tanker/jet
    'K35R': 'strato', 'KC10': 'strato', 'B707': 'strato', 'E3':  'strato', 'E8': 'strato',
    // Bombers
    'B52':  'b1b_lancer', 'B1':  'b1b_lancer', 'B1B': 'b1b_lancer', 'B2': 'b1b_lancer',
    // Fighters
    'F15':  'md_f15', 'F16': 'md_f15', 'F22':  'md_f15', 'F35': 'md_f15',
    'F18':  'md_f15', 'F14': 'md_f15', 'F117': 'md_f15', 'T38': 'md_f15',
    // Maritime patrol
    'P3': 'c130', 'P8': 'jet_2',
    // Embraer KC-390
    'E390': 'e390',
    // Military helos (detailed shapes)
    'AS32': 'dauphin', 'AS3B': 'dauphin', 'PUMA': 'dauphin',
    
    // Light Singles (Common)
    'C172': 'light_single', 'C152': 'light_single', 'C182': 'light_single', 'C206': 'light_single', 'C208': 'light_single',
    'SR22': 'light_single', 'P28A': 'light_single', 'PA28': 'light_single', 'DA40': 'light_single', 'RV8': 'light_single',
    
    // Light/Medium Twins (Common)
    'PA31': 'light_twin', 'C441': 'light_twin', 'C421': 'light_twin', 'C414': 'light_twin', 'PA34': 'light_twin',
    'PA44': 'light_twin', 'BE20': 'light_twin', 'B350': 'light_twin', 'BE9L': 'light_twin', 'E120': 'light_twin',
    'DHC6': 'light_twin', 'AT72': 'light_twin', 'Q400': 'light_twin', 'DH8D': 'light_twin',
    
    // 4-engine jets
    'A388': 'jet_4', 'A380': 'jet_4', 'A343': 'jet_4', 'A345': 'jet_4', 'A346': 'jet_4', 
    'B744': 'jet_4', 'B748': 'jet_4', 'B742': 'jet_4', 'IL96': 'jet_4',
  };
  if (ICAO_MAP[type]) return ICAO_MAP[type];

  // ── Prefix matches ───────────────────────────────────────────
  if (type.startsWith('C130')) return 'c130';
  if (type.startsWith('F1') && type.length <= 4) return 'md_f15'; // F16, F15 etc, not F100 narrowbody

  // ── Prefix matching for major jet families ──────────────────────
  // 4-engine prefix matching
  if (type.startsWith('B74') || type.startsWith('A38') || type.startsWith('A34')) return 'jet_4';
  
  // 2-engine prefix matching (virtually all other Boeings, Airbus, Embraer, Bombardier)
  if (type.startsWith('B73') || type.startsWith('B75') || type.startsWith('B76') || 
      type.startsWith('B77') || type.startsWith('B78') || type.startsWith('A31') || 
      type.startsWith('A32') || type.startsWith('A33') || type.startsWith('A35') || 
      type.startsWith('E17') || type.startsWith('E19') || type.startsWith('CRJ') ||
      type.startsWith('GLF') || type.startsWith('GLEX')) {
    return 'jet_2';
  }

  // ── ADS-B Category ───────────────────────────────────────────
  if (cat === 'A7' || type.startsWith('H') || type === 'GYRO' || type === 'R44' || type === 'R22')
    return 'helicopter';
  if (cat === 'B1' || type.startsWith('GL') || type.startsWith('GR'))
    return 'glider';
  if (cat === 'B2' || type.startsWith('BALL'))
    return 'balloon';
  if (cat === 'B4' || type.startsWith('UL'))
    return 'ultralight';
  if (cat === 'B6' || type.startsWith('UAV') || type.startsWith('DRONE'))
    return 'uav';
  if (cat === 'C1' || cat === 'C2' || cat === 'C3')
    return 'ground';
  if (cat === 'A6')
    return 'md_f15'; // ADS-B high-perf category
  if (cat === 'A1')
    return 'light_single';
  if (cat === 'A2')
    return 'light_twin';
  if (cat === 'A4' || cat === 'A5')
    return 'jet_2'; // Most heavies/large are 2-engine jets now
    
  // Default
  return 'jet_2'; // Generic 2-engine jet is a solid default
}

// ─── Special detailed SVGs ported directly from tar1090 ────────────────────
const SPECIAL_SVGS = {
  'c130': {
    viewBox: '-45 -50 730 587',
    path: 'M168.67 192c11 0 18.61-10.83 14.85-21.18-4.93-13.58-7.55-27.98-7.55-42.82s2.62-29.24 7.55-42.82C187.29 74.83 179.68 64 168.67 64h-17.73c-7.01 0-13.46 4.49-15.41 11.23C130.64 92.21 128 109.88 128 128c0 18.12 2.64 35.79 7.54 52.76 1.94 6.74 8.39 11.24 15.4 11.24h17.73zm-120.8-64c0-37.81 9.46-73.41 26.05-104.66C79.56 12.72 71.97 0 59.97 0H40.61c-6.27 0-12.13 3.59-14.73 9.31C8.22 48.13-1.31 91.41.15 137.12c1.24 38.89 10.78 75.94 26.53 109.73 2.62 5.63 8.41 9.14 14.61 9.14h18.87c12.02 0 19.6-12.74 13.94-23.37C57.43 201.39 47.87 165.84 47.87 128zM614.07 9.29C611.46 3.58 605.61 0 599.34 0h-19.43c-11.98 0-19.66 12.66-14.02 23.25 23.26 43.67 32.56 95.83 21.53 150.66-4.16 20.72-11.49 40.35-21.26 58.57-5.72 10.68 1.8 23.52 13.91 23.52h19.24c6.27 0 12.13-3.58 14.73-9.29C630.57 210.48 640 170.36 640 128s-9.42-82.48-25.93-118.71zM489.06 64h-17.73c-11.01 0-18.61 10.83-14.86 21.18 4.93 13.58 7.55 27.98 7.55 42.82s-2.62 29.24-7.55 42.82c-3.76 10.35 3.85 21.18 14.86 21.18h17.73c7.01 0 13.46-4.49 15.41-11.24 4.9-16.97 7.53-34.64 7.53-52.76 0-18.12-2.64-35.79-7.54-52.76-1.94-6.75-8.39-11.24-15.4-11.24zM372.7 187.76C389.31 173.1 400 151.89 400 128c0-44.18-35.82-80-80.01-80-5.52 0-10.92.56-16.12 1.62a79.525 79.525 0 0 0-28.61 12.04c-21.28 14.38-35.27 38.72-35.27 66.34 0 23.86 10.83 44.86 27.4 59.52L143.98 483.68c-3.4 8.16.46 17.52 8.62 20.92l14.78 6.16c8.16 3.4 17.53-.46 20.93-8.62L245.26 368h149.47l56.96 134.15c3.4 8.16 12.77 12.02 20.93 8.62l14.78-6.16c8.16-3.4 12.01-12.77 8.62-20.92L372.7 187.76zM320 96c17.65 0 32 14.36 32 32s-14.36 32-32 32-32-14.36-32-32 14.35-32 32-32zm-54.35 224l47.84-112.66c2.19.18 4.28.66 6.51.66 2.23 0 4.33-.48 6.52-.66L374.35 320h-108.7z'
  },
  'md_f15': {
    viewBox: '-4 -3 32 32',
    path: 'M12.37 22.55s-.04.25.35 1.02v.32h.94v-.31s.28-.44.35-.95v1.08l.65 1.66 3.05.7s.95-1.14.49-1.48l-2.13-2.5-.01.59-1.02-1.2s.1-.64.09-1.6h2.72l2.6.53.92-1.54s.21-.68-.3-1L15.1 12s-.24-1.97-.78-3.5c0 0 .04-.76-.11-1.91h-1.12s.17-5.5-.82-7.72c-1 2.22-.83 7.72-.83 7.72h-1.11c-.16 1.15-.12 1.9-.12 1.9-.54 1.54-.77 3.5-.77 3.5l-6 5.88c-.5.32-.29 1-.29 1l.93 1.54 2.59-.54h2.73c-.03.97.09 1.61.09 1.61l-1.02 1.2-.01-.59-2.14 2.5c-.46.34.49 1.47.49 1.47l3.05-.69.65-1.66v-1.08c.07.5.35.95.35.95v.3h.95v-.31c.38-.77.35-1.02.35-1.02h.1z'
  },
  'strato': {
    viewBox: '0 0 32 32',
    path: 'M19.5 16.71l.21 6.3-1.83.28s-.2.01-.2.2l-.01.8 2.1.15.02.62s.11.35.25 0l.02-.62 2.1-.15-.02-.81s.03-.18-.17-.2c-.2 0-1.85-.27-1.85-.27l.22-6.3h4.49l5.4-.61-.04-.74s-.02-.3-.34-.3-4.66-.55-4.66-.55h-1.1s.12-.66-.01-1.02h-.6s-.12.44-.02 1.02h-.72s.1-.68 0-1.02h-.6s-.12.52 0 1.04h-.73s.13-.62 0-1.04h-.6s-.15.47 0 1.02l-.47-.23V9.95s-.4-2.32-.85 0v4.33l-.49.24h-5.93l-.5-.24V9.95c-.44-2.32-.84 0-.84 0v4.33l-.47.23c.14-.55 0-1.02 0-1.02h-.6c-.13.42 0 1.04 0 1.04h-.73c.12-.52 0-1.04 0-1.04h-.6c-.1.34 0 1.02 0 1.02H8.6c.1-.58-.02-1.02-.02-1.02H8c-.14.36-.02 1.03-.02 1.03l-1.1-.01s-4.34.56-4.65.56c-.32 0-.35.3-.35.3l-.04.73 5.41.6h4.49l.22 6.31s-1.65.26-1.85.28c-.2.01-.18.19-.18.19l-.02.8 2.1.16.02.62c.14.35.26 0 .26 0l.01-.62 2.1-.16v-.79c0-.19-.2-.2-.2-.2L12.35 23l.2-6.29h3.47z'
  },
  'b1b_lancer': {
    viewBox: '0 0 64 64',
    path: 'm 31.62,56.29 c -0.23,-0.11 -0.55,-0.86 -0.54,-1.56 l -7.58,2.71 c -0.17,-0.82 -0.12,-1.31 -0.01,-2.03 l 6.90,-6.31 c -0.23,-2.30 -0.51,-3.72 -1.19,-6.08 l -0.28,0.96 -1.13,0.01 -0.42,-1.31 -0.41,1.30 -1.23,-0.00 -0.50,-1.32 -0.21,-6.56 -18.70,1.18 c -0.24,-0.19 -0.38,-2.09 0.48,-3.21 L 26.26,28.95 C 28.75,24.52 29.87,18.91 30.59,9.77 L 29.53,10.42 30.71,8.40 c 0.30,-2.49 0.56,-4.45 1.29,-5.84 0.72,1.39 0.99,3.35 1.29,5.84 l 1.17,2.01 -1.05,-0.65 c 0.72,9.14 1.84,14.76 4.33,19.18 l 19.46,5.12 c 0.86,1.12 0.72,3.02 0.48,3.21 l -18.70,-1.18 -0.21,6.56 -0.50,1.32 -1.23,0.00 -0.41,-1.30 -0.42,1.31 -1.13,-0.01 -0.28,-0.96 c -0.68,2.36 -0.96,3.78 -1.19,6.08 l 6.90,6.31 c 0.10,0.72 0.15,1.22 -0.01,2.03 l -7.58,-2.71 c 0.01,0.70 -0.31,1.45 -0.54,1.56 l -0.37,0.63 z'
  },
  'e390': {
    viewBox: '-5 -5 175 167',
    path: 'M82.245.552C76.577.258 70.617 29.796 71.583 37.077c-1.005 2.09-1.497 4.03-2.178 6.313l-9.7 5.428.174-.677c1.94-.001 3.26-12.26 2.558-14.59-.124-.3-.118-1.086-.995-1.171H53.79c-.822.087-.942.82-1.08 1.193-1.047 2.612-.37 13.628 1.473 14.575.205 1.793 1.242-.228 1.206 3.08l-48.252 27c-1.22.519-5.173 6.398-4.699 9.612l65.35-18.075c.678 6.023 2.061 10.756 3.762 16.529.011 0 .04-.021.04-.005V104.1c-.356 10.104 1.165 18.468 6.18 30.667l-19.562 13.294c-1.52 1-1.89 4.028-1.49 6.287l24.391-5.857c.201 2.723.464 5.673 1.122 8.162.675-3.067.806-5.317 1.083-8.19l24.204 5.888c.13-2.126-.08-4.896-1.618-6.23L86.876 134.87c4.615-12.33 5.975-20.668 6.068-30.826L93 86.17c1.848-6.117 2.981-10.824 3.724-16.408l65.348 18.075c-.053-3.455-2.224-7.301-4.71-9.617l-48.244-26.994c-.19-3.07 1.082-.493 1.161-3.084 1.673-.836 2.55-11.042 1.44-14.57-.11-.634-.474-1.016-.994-1.193h-7.653c-.474.037-.803.253-1.039 1.196-.654 2.808.135 13.31 2.631 14.565l.193.694-9.7-5.428c-.632-2.071-1.28-4.32-2.132-6.237-.018-8.233-4.47-36.65-10.772-36.611z'
  },
  'dauphin': {
    viewBox: '-1 -2 34 34',
    path: 'M15.71 30.45v-.37s-.34 0-.37-.51l-.08-4.33-.05-.39h-2.77l.12 1.07-.28-.2-.32-2.98.3.18.02.3h2.83l-1.18-8.96-7.2 7.16-.45.07-.36-.39.11-.5 7.78-7.56s-.26-1.6-.29-3.71L5.9 1.6l-.04-.4.36-.34.49.08 6.88 7.04s-.11-2.01 1.05-4.8c0 0 .19-.47.38-1.14 0 0 .08-1 .99-1.05 0 0 .91-.12 1.07 1.03 0 0 .09.44.38 1.18 0 0 .82 1.33 1.12 4.96l7.25-7.2.4-.02.37.38-.1.48-7.94 7.72s0 2.02-.26 3.2c0 0 .2.1.39.04l7.96 8.03.02.42-.35.32-.47-.07-7.7-7.9-1.53 9.66h2.62l-.01-.46.25.17.33 2.96-.29-.2-.08-.87-3.03.02s-.06.23-.06.56l-.2 4.03s.04.46-.31.64v.36z'
  }
};

// ─── SVG shapes by aircraft class ────────────────────────────────────────────
// All shapes are on a -18..18 / -18..18 viewBox, rotated by heading in wrapper
export function makeAircraftSvg(ac_class, color, heading, isSelected, isMLAT) {
  const glowSel = `filter: drop-shadow(0 0 8px ${color});`;
  const glowNorm = `filter: drop-shadow(0 0 3px ${color}88);`;
  const glow = isSelected ? glowSel : glowNorm;
  const sel  = isSelected ? `stroke="#ffaa00" stroke-width="1.5"` : `stroke="black" stroke-width="0.8" paint-order="fill"`;
  const opacity = isMLAT ? '0.7' : '1';
  const rot = heading || 0;
  const wrap = (inner, w=36, h=36, vBox='-18 -18 36 36') =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vBox}" style="transform:rotate(${rot}deg); ${glow} opacity:${opacity};">${inner}</svg>`;

  if (SPECIAL_SVGS[ac_class]) {
    const special = SPECIAL_SVGS[ac_class];
    return wrap(
      `<path d="${special.path}" fill="${color}" ${sel}/>`,
      36, 36, special.viewBox
    );
  }

  switch (ac_class) {
    // ── Heavy widebody: thick swept wings, 2-engine pods ──────────────────
    case 'heavy':
      return wrap(
        `<polygon points="0,-14 2,-2 14,3 14,6 2,3 1,14 3,16 0,15 -3,16 -1,14 -2,3 -14,6 -14,3 -2,-2" fill="${color}" ${sel}/>`,
      );

    // ── High-performance (fighter): delta wing ────────────────────────────
    case 'highperf':
      return wrap(
        `<polygon points="0,-16 4,6 2,10 0,8 -2,10 -4,6" fill="${color}" ${sel}/>
         <polygon points="0,-2 10,8 6,8 0,5 -6,8 -10,8" fill="${color}" opacity="0.85"/>`,
      );

    // ── Light Single (straight wings, propeller nose, small body) ───────────
    case 'light_single':
      return wrap(
        `<polygon points="0,-8 1,-1 12,0 12,3 1,2 0,11 3,12 0,11 -3,12 0,11 -1,2 -12,3 -12,0 -1,-1" fill="${color}" ${sel}/>
         <circle cx="0" cy="-8" r="1.5" fill="${color}"/>`, // Propeller spinner
      );

    // ── Light Twin (straight wings, nacelles on wings) ──────────────────────
    case 'light_twin':
      return wrap(
        `<polygon points="0,-9 1,-1 4,0 4,-3 6,-3 6,0 14,0 14,3 6,3 6,5 4,5 4,2 1,2 0,12 4,13 0,12 -4,13 0,12 -1,2 -4,2 -4,5 -6,5 -6,3 -14,3 -14,0 -6,0 -6,-3 -4,-3 -4,0 -1,-1" fill="${color}" ${sel}/>`,
      );

    // ── 2-Engine Jet (swept wings, 2 engines) ────────────────────────────────
    case 'jet_2':
      return wrap(
        `<polygon points="0,-14 2,-3 6,0 6,-3 8,-3 8,1 15,6 15,8 8,5 8,7 6,7 6,4 2,2 1,14 4,16 0,15 -4,16 -1,14 -2,2 -6,4 -6,7 -8,7 -8,5 -15,8 -15,6 -8,1 -8,-3 -6,-3 -6,0 -2,-3" fill="${color}" ${sel}/>`,
      );

    // ── 4-Engine Jet (swept wings, 4 engines like B747/A380) ─────────────────
    case 'jet_4':
      return wrap(
        // The main fuselage and wing layout
        `<polygon points="0,-16 2,-3 5,-1 5,-4 7,-4 7,1 10,3 10,-1 12,-1 12,5 18,9 18,11 12,8 12,10 10,10 10,7 7,5 7,7 5,7 5,3 2,1 1,16 5,18 0,17 -5,18 -1,16 -2,1 -5,3 -5,7 -7,7 -7,5 -10,7 -10,10 -12,10 -12,8 -18,11 -18,9 -12,5 -12,-1 -10,-1 -10,3 -7,1 -7,-4 -5,-4 -5,-1 -2,-3" fill="${color}" ${sel}/>`,
      );

    // ── Helicopter: H-shape body + rotor disc ─────────────────────────────
    case 'helicopter':
      return wrap(
        // rotor disc (circle)
        `<circle cx="0" cy="0" r="13" fill="none" stroke="${color}" stroke-width="1.2" opacity="0.5"/>
         <line x1="-13" y1="0" x2="13" y2="0" stroke="${color}" stroke-width="1.5"/>
         <line x1="0" y1="-13" x2="0" y2="13" stroke="${color}" stroke-width="1.5"/>
         <circle cx="0" cy="0" r="3.5" fill="${color}" ${sel}/>
         <rect x="-2" y="4" width="4" height="9" rx="1" fill="${color}"/>`,
      );

    // ── Glider: long thin wings, no engine pods ────────────────────────────
    case 'glider':
      return wrap(
        `<polygon points="0,-14 1,-2 16,1 16,3 1,1 0,14 -1,1 -16,3 -16,1 -1,-2" fill="${color}" ${sel}/>`,
      );

    // ── Balloon / airship: round ───────────────────────────────────────────
    case 'balloon':
      return wrap(
        `<circle cx="0" cy="-2" r="10" fill="${color}" opacity="0.7" ${sel}/>
         <rect x="-3" y="7" width="6" height="5" rx="1" fill="${color}" opacity="0.9"/>
         <line x1="-3" y1="8" x2="-3" y2="7" stroke="${color}" stroke-width="1"/>
         <line x1="3" y1="8" x2="3" y2="7" stroke="${color}" stroke-width="1"/>`,
      );

    // ── Ultralight: simple hang-glider triangle ────────────────────────────
    case 'ultralight':
      return wrap(
        `<polygon points="0,-12 14,10 0,7 -14,10" fill="${color}" opacity="0.85" ${sel}/>
         <line x1="0" y1="-12" x2="0" y2="14" stroke="${color}" stroke-width="1.2"/>`,
      );

    // ── UAV / drone: X-frame quad ─────────────────────────────────────────
    case 'uav':
      return wrap(
        `<line x1="-12" y1="-12" x2="12" y2="12" stroke="${color}" stroke-width="2"/>
         <line x1="12" y1="-12" x2="-12" y2="12" stroke="${color}" stroke-width="2"/>
         <circle cx="0"   cy="0"   r="3"   fill="${color}"/>
         <circle cx="-12" cy="-12" r="4.5" fill="none" stroke="${color}" stroke-width="1.5"/>
         <circle cx="12"  cy="-12" r="4.5" fill="none" stroke="${color}" stroke-width="1.5"/>
         <circle cx="-12" cy="12"  r="4.5" fill="none" stroke="${color}" stroke-width="1.5"/>
         <circle cx="12"  cy="12"  r="4.5" fill="none" stroke="${color}" stroke-width="1.5"/>`,
      );

    // ── Ground vehicle: square/truck ───────────────────────────────────────
    case 'ground':
      return wrap(
        `<rect x="-8" y="-10" width="16" height="20" rx="2" fill="${color}" opacity="0.8" ${sel}/>
         <rect x="-5" y="-8"  width="10" height="8"  rx="1" fill="#000" opacity="0.35"/>`,
      );

    // ── Default generic fallback (simple jet) ─────────────────────────────
    case 'jet':
    default:
      return wrap(
        `<polygon points="0,-12 3,-2 10,4 7,5 0,2 -7,5 -10,4 -3,-2" fill="${color}" ${sel}/>
         <polygon points="0,2 2,10 0,8 -2,10" fill="${color}"/>`,
      );
  }
}

// ─── Label (matches tar1090 three-line format) ───────────────────────────────
function makeLabel(ac) {
  const reg      = (ac.r      || '').trim();
  const type     = (ac.t      || '').trim();
  const callsign = (ac.flight || '').trim();
  const primary  = reg || ac.hex || '?';
  const typeStr  = type || '?';

  const alt = ac.alt_baro != null ? Math.round(ac.alt_baro).toLocaleString() : '?';
  const spd = ac.gs       != null ? Math.round(ac.gs) : '?';
  const vr  = ac.baro_rate;
  const vrArrow = vr == null ? ' ' : vr > 100 ? '▲' : vr < -100 ? '▼' : ' ';

  let html = `<div class="ac-label-line">${primary} ${typeStr}</div>`;
  html    += `<div class="ac-label-line">${spd} kt ${vrArrow}${alt} ft</div>`;
  if (callsign && callsign !== primary) {
    html  += `<div class="ac-label-line">${callsign}</div>`;
  }
  return `<div class="ac-label">${html}</div>`;
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function AircraftLayer({ aircraft, selected, showLabels, onSelect }) {
  const map = useMap();
  const markersRef = useRef({});
  const labelsRef  = useRef({});

  useEffect(() => {
    const currentHexes = new Set(aircraft.map(a => a.hex));

    // Remove stale
    for (const hex of Object.keys(markersRef.current)) {
      if (!currentHexes.has(hex)) {
        map.removeLayer(markersRef.current[hex]);
        delete markersRef.current[hex];
        if (labelsRef.current[hex]) {
          map.removeLayer(labelsRef.current[hex]);
          delete labelsRef.current[hex];
        }
      }
    }

    // Update / create
    for (const ac of aircraft) {
      const { hex, lat, lon } = ac;
      if (!lat || !lon) continue;

      const isSelected = selected?.hex === hex || selected?.entity_id === hex;
      const isMLAT     = ac.type === 'mlat';
      const heading    = ac.track ?? ac.calc_track ?? 0;
      const color      = altColor(ac.alt_baro);
      const acClass    = classifyAircraft(ac);

      const iconHtml = makeAircraftSvg(acClass, color, heading, isSelected, isMLAT);
      const icon     = L.divIcon({ className: '', html: iconHtml, iconSize: [36, 36], iconAnchor: [18, 18] });

      if (markersRef.current[hex]) {
        markersRef.current[hex].setLatLng([lat, lon]).setIcon(icon);
        if (isSelected) markersRef.current[hex].setZIndexOffset(1000);
      } else {
        const marker = L.marker([lat, lon], { icon, zIndexOffset: isSelected ? 1000 : 0 });
        marker.on('click', () => onSelect({ ...ac, _type: 'aircraft' }));
        marker.addTo(map);
        markersRef.current[hex] = marker;
      }

      // Labels
      if (showLabels) {
        const labelHtml = makeLabel(ac);
        const labelIcon = L.divIcon({ className: '', html: labelHtml, iconSize: [0, 0], iconAnchor: [0, 0] });
        if (labelsRef.current[hex]) {
          labelsRef.current[hex].setLatLng([lat, lon]).setIcon(labelIcon);
        } else {
          const label = L.marker([lat, lon], { icon: labelIcon, interactive: false });
          label.addTo(map);
          labelsRef.current[hex] = label;
        }
      } else if (labelsRef.current[hex]) {
        map.removeLayer(labelsRef.current[hex]);
        delete labelsRef.current[hex];
      }
    }
  }, [aircraft, selected, showLabels, map, onSelect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      Object.values(markersRef.current).forEach(m => map.removeLayer(m));
      Object.values(labelsRef.current).forEach(m => map.removeLayer(m));
    };
  }, [map]);

  return null;
}
