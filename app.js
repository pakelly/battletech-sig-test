/* ── BattleTech Faction Signatures — Client App ── */

const APP_VERSION = '1.39.0';
const DEPLOY_TIME = '20261005.1448';

let DATA = null; // app-data.json
let xotlData = null; // xotl-rarity.json (lazy-loaded for Mode X)

// ── Xotl RAT Data ──
const XOTL_FACTION_MAP = {
  'Star League 2750': 'SL',
  'Capellan Confederation (House Liao)': 'CC',
  'Draconis Combine (House Kurita)': 'DC',
  'Federated Suns (House Davion)': 'FS',
  'Free Worlds League (House Marik)': 'FWL',
  'Lyran Commonwealth (House Steiner)': 'LC',
  'Free Rasalhague Republic': 'FRR',
  'St. Ives Compact': 'SIC',
  'Mercenary / Periphery General': 'MERC',
  'Magistracy Of Canopus': 'MOC',
  'Outworlds Alliance': 'OA',
  'Taurian Concordat': 'TC'
};

const XOTL_ERA_MAP = {
  2765: '2750',
  3028: '3028',
  3039: '3039',
  3049: '3050',
  3055: '3050',
  3058: '3057'
};

async function loadXotlData() {
  if (xotlData) return xotlData;
  const resp = await fetch('xotl-rarity.json?v=' + APP_VERSION);
  xotlData = await resp.json();
  return xotlData;
}

/**
 * Build a weights object from Xotl rarity data for a given chassis+era.
 * Returns { factionCode: weight } or null if no Xotl data for this era.
 */
function buildXotlWeights(chassisName, eraYear, xotl) {
  const xotlEra = XOTL_ERA_MAP[eraYear];
  if (!xotlEra) return null; // no Xotl coverage for this era

  // Find all mech entries matching this chassis
  // The 'variant' field in xotl data is the chassis name (e.g., 'Archer')
  // but sometimes it's a variant code (e.g., 'ARC-2R') or first word of multi-word name
  const matching = xotl.mechs.filter(m => resolveXotlChassis(m) === chassisName);
  if (matching.length === 0) return {};

  const weights = {};
  for (const mech of matching) {
    for (const [sectionName, eraData] of Object.entries(mech.sections || {})) {
      // Extract base faction name (before colon if present)
      const baseName = sectionName.includes(':')
        ? sectionName.split(':')[0].trim()
        : sectionName;
      const factionCode = XOTL_FACTION_MAP[baseName];
      if (!factionCode) continue;

      // Find the right column for this era
      const value = getXotlColumnValue(eraData, xotlEra);
      if (value == null) continue;

      // Take max across variants
      if (weights[factionCode] == null || value > weights[factionCode]) {
        weights[factionCode] = value;
      }
    }
  }
  return weights;
}

/**
 * Build per-faction probability weights for Mode X using MAX variant probability.
 * Chassis weight = xotlToProb(highest single variant Av) for each faction.
 * This prevents chassis with many common variants from dominating share-of-force.
 * Variant distribution within a chassis is computed separately for the detail view.
 */
function buildXotlProbWeights(chassisName, eraYear, xotl) {
  const xotlEra = XOTL_ERA_MAP[eraYear];
  if (!xotlEra) return null;
  const matching = xotl.mechs.filter(m => resolveXotlChassis(m) === chassisName);
  if (matching.length === 0) return {};
  const seen = new Set(); // deduplicate by variant code (split-name entries)
  const weights = {};
  for (const mech of matching) {
    const variantCode = xotlVariantCode(chassisName, mech);
    if (seen.has(variantCode)) continue; // skip duplicate
    seen.add(variantCode);
    for (const [sectionName, eraData] of Object.entries(mech.sections || {})) {
      const baseName = sectionName.includes(':') ? sectionName.split(':')[0].trim() : sectionName;
      const factionCode = XOTL_FACTION_MAP[baseName];
      if (!factionCode) continue;
      const value = getXotlColumnValue(eraData, xotlEra);
      if (value == null) continue;
      // Take max variant probability per faction, not sum
      const prob = xotlToProb(value);
      if (weights[factionCode] == null || prob > weights[factionCode]) {
        weights[factionCode] = prob;
      }
    }
  }
  return weights;
}

/**
 * Extract the variant code from a Xotl mech entry.
 * Xotl data has two field orderings:
 *   Normal:  variant="Archer" (chassis), name="ARC-2R" (code)
 *   Swapped: variant="ARC-2R" (code),  name="Archer" (chassis)
 * And split-name chassis where variant is the first word:
 *   variant="Phoenix", name="Hawk PXH-1" → chassis="Phoenix Hawk", code="PXH-1"
 */
function xotlVariantCode(chassisName, mech) {
  const variant = mech.variant || '';
  const name = mech.name || '';
  
  // Detect which field has the model code
  const varIsCode = /[-0-9]/.test(variant);
  const nameIsCode = /[-0-9]/.test(name);
  
  if (varIsCode && !nameIsCode) {
    // Swapped: variant field has the code
    return variant;
  }
  if (!varIsCode && !nameIsCode && name) {
    // Both are words — could be split-name or Wraith (name='TR1')
    // Try stripping chassis prefix words from name
    const chassisWords = (chassisName || '').toLowerCase().split(' ');
    const nameWords = name.split(' ');
    let idx = 0;
    while (idx < nameWords.length) {
      const nw = nameWords[idx].toLowerCase();
      const isChassisWord = chassisWords.some(cw => cw === nw || cw.includes(nw) || nw.includes(cw));
      const looksLikeCode = /[0-9]/.test(nw);
      if (isChassisWord && !looksLikeCode) {
        idx++;
      } else {
        break;
      }
    }
    let result = idx < nameWords.length ? nameWords.slice(idx).join(' ') : name;
    if (result.startsWith('(') && result.includes(')')) {
      result = result.split(')')[1].trim();
    }
    return result || name;
  }
  // Normal: name field has the code, strip chassis prefix
  const chassisWords = (chassisName || '').toLowerCase().split(' ');
  const nameWords = name.split(' ');
  let idx = 0;
  while (idx < nameWords.length) {
    const nw = nameWords[idx].toLowerCase();
    const isChassisWord = chassisWords.some(cw => cw === nw || cw.includes(nw) || nw.includes(cw));
    const looksLikeCode = /[0-9]/.test(nw);
    if (isChassisWord && !looksLikeCode) {
      idx++;
    } else {
      break;
    }
  }
  let result = idx < nameWords.length ? nameWords.slice(idx).join(' ') : name;
  if (result.startsWith('(') && result.includes(')')) {
    result = result.split(')')[1].trim();
  }
  return result || name;
}

/**
 * Resolve a Xotl mech entry to an app chassis name.
 * Uses modelPrefixes for variant-code entries, and direct name matching.
 */
function resolveXotlChassis(mech) {
  const variant = mech.variant;
  const name = mech.name || '';

  // Check for split-name chassis first: variant='Phoenix', name='Hawk PXH-1' → 'Phoenix Hawk'
  // This must happen BEFORE the single-word chassis check, because 'Phoenix' is also
  // a real chassis — but the Xotl entry is actually for 'Phoenix Hawk'.
  if (variant.length > 0 && variant[0] >= 'A' && variant[0] <= 'Z'
      && !variant.match(/^[A-Z]+-/) && !variant.match(/^[A-Z]+\d/)
      && name) {
    const nameFirst = name.split(' ')[0];
    if (nameFirst) {
      const combined = variant + ' ' + nameFirst;
      if (DATA.chassis && DATA.chassis[combined]) return combined;
      // Try partial match (e.g., 'Wolf Trap' matches 'Wolf Trap (Tora)')
      if (DATA.chassis) {
        const match = Object.keys(DATA.chassis).find(k => k.startsWith(combined));
        if (match) return match;
      }
    }
  }

  // If variant is already a known chassis name, use it
  if (DATA.chassis && DATA.chassis[variant]) return variant;

  // If name is a known chassis name (reversed entries: variant=code, name=chassis)
  if (DATA.chassis && DATA.chassis[name]) return name;

  // Try modelPrefixes lookup from both variant and name fields
  if (DATA.modelPrefixes) {
    // Try prefix from variant first (e.g., variant='ARC-2R' → prefix='ARC')
    const varPrefix = (variant.match(/^[A-Z]+/) || [])[0];
    if (varPrefix && DATA.modelPrefixes[varPrefix]) {
      return DATA.modelPrefixes[varPrefix];
    }
    // Try prefix from name (e.g., name='WFT-1' → prefix='WFT')
    const namePrefix = (name.match(/^[A-Z]+/) || [])[0];
    if (namePrefix && DATA.modelPrefixes[namePrefix]) {
      return DATA.modelPrefixes[namePrefix];
    }
  }

  return variant; // fallback
}

/**
 * Get the availability value from a Xotl section's era data for the target era.
 * Handles A/B vs C/D/F column variants.
 */
function getXotlColumnValue(eraData, xotlEra) {
  if (!eraData) return null;

  // Direct era column (e.g., '3028', '3039', '3050')
  if (eraData[xotlEra] != null) return eraData[xotlEra];

  // Star League: 'Regular' or 'Royal'
  if (xotlEra === '2750') {
    if (eraData['Regular'] != null) return eraData['Regular'];
    if (eraData['Royal'] != null) return eraData['Royal'];
    return null;
  }

  // A/B vs C/D/F columns (3050, 3057)
  const abKey = 'A/B (' + xotlEra + ')';
  const cdfKey = 'C/D/F (' + xotlEra + ')';
  if (eraData[abKey] != null) return eraData[abKey];
  if (eraData[cdfKey] != null) return eraData[cdfKey];

  return null;
}

/**
 * Get per-variant Xotl availability data for a specific chassis+faction+era.
 * Returns array of { variant, name, availability, tonnage } for all variants
 * of this chassis that have data for the given faction+era.
 */
function getXotlVariantData(chassisName, factionCode, eraYear, xotl) {
  xotl = xotl || xotlData;
  if (!xotl) return [];
  const xotlEra = XOTL_ERA_MAP[eraYear];
  if (!xotlEra) return [];

  // Reverse map: faction code → Xotl faction name(s)
  const xotlFactionNames = Object.entries(XOTL_FACTION_MAP)
    .filter(([_, code]) => code === factionCode)
    .map(([name, _]) => name);
  if (xotlFactionNames.length === 0) return [];

  const matching = xotl.mechs.filter(m => resolveXotlChassis(m) === chassisName);
  if (matching.length === 0) return [];

  const seen = new Set(); // deduplicate by variant code (split-name entries)
  const results = [];
  for (const mech of matching) {
    const variantCode = xotlVariantCode(chassisName, mech);
    if (seen.has(variantCode)) continue; // skip duplicate
    seen.add(variantCode);
    for (const [sectionName, eraData] of Object.entries(mech.sections || {})) {
      const baseName = sectionName.includes(':')
        ? sectionName.split(':')[0].trim()
        : sectionName;
      if (!xotlFactionNames.includes(baseName)) continue;

      const value = getXotlColumnValue(eraData, xotlEra);
      if (value == null) continue;

      results.push({
        variant: variantCode,
        name: mech.name,
        availability: value,
        tonnage: mech.tonnage
      });
    }
  }
  return results;
}

/**
 * Get cross-faction variant availability data for a chassis+era.
 * Returns a Map of { variantName: { factionCode: availability } }.
 * Only includes factions/variants that have data.
 */
function getXotlAllFactionVariantData(chassisName, eraYear, xotl) {
  xotl = xotl || xotlData;
  if (!xotl) return new Map();
  const xotlEra = XOTL_ERA_MAP[eraYear];
  if (!xotlEra) return new Map();

  const matching = xotl.mechs.filter(m => resolveXotlChassis(m) === chassisName);
  if (matching.length === 0) return new Map();

  const result = new Map(); // key: variant display name (mech.name), value: { factionCode: availability }
  for (const mech of matching) {
    const variantKey = xotlVariantCode(chassisName, mech) || mech.variant;
    if (!result.has(variantKey)) result.set(variantKey, {});
    const factionMap = result.get(variantKey);

    for (const [sectionName, eraData] of Object.entries(mech.sections || {})) {
      const baseName = sectionName.includes(':')
        ? sectionName.split(':')[0].trim()
        : sectionName;
      const factionCode = XOTL_FACTION_MAP[baseName];
      if (!factionCode) continue;

      const value = getXotlColumnValue(eraData, xotlEra);
      if (value == null) continue;

      // Take max if multiple entries for same faction (shouldn't happen, but guard)
      if (factionMap[factionCode] == null || value > factionMap[factionCode]) {
        factionMap[factionCode] = value;
      }
    }
  }
  return result;
}

// ── Faction Index Decoding ──
// app-data.json stores faction keys in eraData as numeric indices (string keys "0","1",...)
// referencing DATA.factionIndex. This saves ~3MB. Decode on load so all downstream code
// works with faction codes (DC, FS, etc.) transparently.

function decodeFactionWeights(indexedObj, factionIndex) {
  if (!indexedObj || !factionIndex) return indexedObj;
  const result = {};
  for (const [idx, val] of Object.entries(indexedObj)) {
    const code = factionIndex[idx];
    if (code !== undefined) {
      result[code] = val;
    } else {
      result[idx] = val; // fallback: already a faction code (shouldn't happen)
    }
  }
  return result;
}

function decodeFactionIndex(data) {
  if (!data.factionIndex || !data.eraData) return;
  const fi = data.factionIndex;
  for (const eraEntries of Object.values(data.eraData)) {
    for (const entry of Object.values(eraEntries)) {
      if (entry.w) entry.w = decodeFactionWeights(entry.w, fi);
      if (entry.mul) entry.mul = decodeFactionWeights(entry.mul, fi);
      if (entry.v) {
        for (const varData of Object.values(entry.v)) {
          if (varData.w) varData.w = decodeFactionWeights(varData.w, fi);
        }
      }
    }
  }
}

// ── Faction code aliases ──
const FACTION_ALIASES = {
  'dc': 'DC', 'draconis': 'DC', 'draconis combine': 'DC', 'kurita': 'DC',
  'fs': 'FS', 'fedsuns': 'FS', 'federated suns': 'FS', 'davion': 'FS',
  'fwl': 'FWL', 'free worlds': 'FWL', 'free worlds league': 'FWL', 'marik': 'FWL',
  'lc': 'LC', 'lyran': 'LC', 'lyran commonwealth': 'LC', 'lyran alliance': 'LC', 'steiner': 'LC',
  'la': 'LC', // Map LA (Lyran Alliance) to LC — Commonwealth is the canonical name
  'cc': 'CC', 'capellan': 'CC', 'capellan confederation': 'CC', 'liao': 'CC',
  'fc': 'FC', 'fedcom': 'FC', 'federated commonwealth': 'FC',
  'frr': 'FRR', 'rasalhague': 'FRR', 'free rasalhague republic': 'FRR',
  'cs': 'CS', 'comstar': 'CS',
  'wob': 'WOB', 'word of blake': 'WOB', 'wobblies': 'WOB',
  'cw': 'CW', 'clan wolf': 'CW', 'wolf': 'CW',
  'cjf': 'CJF', 'jade falcon': 'CJF', 'clan jade falcon': 'CJF',
  'cgb': 'CGB', 'ghost bear': 'CGB', 'clan ghost bear': 'CGB',
  'csj': 'CSJ', 'smoke jaguar': 'CSJ', 'clan smoke jaguar': 'CSJ',
  'chh': 'CHH', 'hells horses': 'CHH', "hell's horses": 'CHH', "clan hell's horses": 'CHH', 'clan hells horses': 'CHH',
  'cnc': 'CNC', 'nova cat': 'CNC', 'clan nova cat': 'CNC', 'spirit cats': 'CNC',
  'csv': 'CSV', 'steel viper': 'CSV', 'clan steel viper': 'CSV',
  'cds': 'CDS', 'diamond shark': 'CDS', 'sea fox': 'CDS', 'clan sea fox': 'CDS', 'clan diamond shark': 'CDS',
  'csr': 'CSR', 'snow raven': 'CSR', 'clan snow raven': 'CSR',
  'cbs': 'CBS', 'blood spirit': 'CBS',
  'cco': 'CCO', 'coyote': 'CCO',
  'cfm': 'CFM', 'fire mandrill': 'CFM',
  'cgs': 'CGS', 'goliath scorpion': 'CGS', 'clan goliath scorpion': 'CGS', 'scorpion empire': 'CGS', 'scorpion': 'CGS',
  'cih': 'CIH', 'ice hellion': 'CIH',
  'csa': 'CSA', 'star adder': 'CSA',
  'merc': 'MERC', 'mercenary': 'MERC', 'mercs': 'MERC',
  'tc': 'TC', 'taurian': 'TC', 'taurian concordat': 'TC',
  'mh': 'MH', 'marian': 'MH', 'marian hegemony': 'MH',
  'oa': 'OA', 'outworlds': 'OA', 'outworlds alliance': 'OA',
  'mc': 'MC', 'canopus': 'MC', 'magistracy': 'MC',
  'kh': 'KH', 'kell hounds': 'KH',
  'wd': 'WD', "wolf's dragoons": 'WD', 'dragoons': 'WD',
  'ros': 'ROS', 'republic': 'ROS', 'republic of the sphere': 'ROS',
  'sic': 'SIC', 'st. ives': 'SIC', 'st ives': 'SIC',
  'rd': 'RD', 'rasalhague dominion': 'RD', 'rassalhague dominion': 'RD', 'dominion': 'RD',
  'ra': 'RA', 'raven alliance': 'RA', 'clan raven alliance': 'RA',
  'sl': 'SL', 'star league': 'SL',
  'slr': 'SLR', 'star league royal': 'SLR',
  'th': 'TH', 'terran hegemony': 'TH',
  // Additional Clans
  'cwie': 'CWIE', 'clan wolf in exile': 'CWIE', 'wolf in exile': 'CWIE',
  'cwe': 'CWE', 'wolf empire': 'CWE',
  'csl': 'CSL', 'stone lion': 'CSL', 'clan stone lion': 'CSL',
  'ccc': 'CCC', 'cloud cobra': 'CCC', 'clan cloud cobra': 'CCC',
  'cb': 'CB', 'burrock': 'CB', 'clan burrock': 'CB',
  'cmg': 'CMG', 'mongoose': 'CMG', 'clan mongoose': 'CMG',
  'cwi': 'CWI', 'widowmaker': 'CWI', 'clan widowmaker': 'CWI',
  'cwov': 'CWOV', 'wolverine': 'CWOV', 'clan wolverine': 'CWOV',
  'soc': 'SOC', 'the society': 'SOC', 'society': 'SOC',
  'cir': 'CIR',
  // Scorpion Empire
  'se': 'SE', 'scorpion empire': 'SE',
  'cei': 'CEI', 'escorpion imperio': 'CEI',
  // Additional Periphery
  'moc': 'MOC', 'magistracy of canopus': 'MOC',
  'cdp': 'CDP', 'calderon protectorate': 'CDP',
  'fvc': 'FVC', 'filtvelt coalition': 'FVC', 'filtvelt': 'FVC',
  'rwr': 'RWR', 'rim worlds republic': 'RWR', 'rim worlds': 'RWR',
  'td': 'TD', 'tortuga dominions': 'TD', 'tortuga': 'TD',
  'gv': 'GV', 'greater valkyrate': 'GV', 'valkyrate': 'GV',
  // FWL breakup states
  'da': 'DA', 'duchy of andurien': 'DA', 'andurien': 'DA',
  'do': 'DO', 'duchy of oriente': 'DO',
  'dta': 'DTA', 'duchy of tamarind': 'DTA', 'tamarind': 'DTA',
  'msc': 'MSC', 'marik-stewart': 'MSC', 'marik-stewart commonwealth': 'MSC',
  'op': 'OP', 'oriente protectorate': 'OP',
  'rf': 'RF', 'regulan fiefs': 'RF', 'regulan': 'RF',
  'rcm': 'RCM', 'rim commonality': 'RCM',
  'pr': 'PR', 'principality of regulus': 'PR', 'regulus': 'PR',
  'mcm': 'MCM', 'marik commonwealth': 'MCM',
  // Other IS factions
  'ardc': 'ARDC', 'arc-royal': 'ARDC', 'arc-royal defense cordon': 'ARDC',
  'cm': 'CM', 'chaos march': 'CM',
  'stone': 'Stone', "stone's coalition": 'Stone',
  'rr': 'RR', 'republic remnant': 'RR',
  'slie': 'SLIE', 'star league in exile': 'SLIE',
  'sl3': 'SL3',
  'ban': 'BAN', 'bandit caste': 'BAN', 'bandits': 'BAN',
  'cp': 'CP', 'clan protectorate': 'CP',
  'pir': 'PIR', 'pirates': 'PIR',
  'pp': 'PP', 'pentagon powers': 'PP',
  'blord': 'BLORD', 'blessed order': 'BLORD',
  'por': 'PoR', 'principality of rasalhague': 'PoR',
  'ta': 'TA', 'terran alliance': 'TA',
  'tb': 'TB', 'the barrens': 'TB', 'barrens': 'TB',
  'uhc': 'UHC', 'united hindu collective': 'UHC',
  // General pools (use 'isgeneral'/'clangeneral'/'peripherygeneral' to get the pool factions directly;
  // 'is'/'clans'/'periphery' resolve to group shortcuts via resolveFactionGroup)
  'isgeneral': 'IS', 'inner sphere general': 'IS', 'is general': 'IS',
  'clangeneral': 'CLAN', 'clan general': 'CLAN',
  'peripherygeneral': 'Periphery', 'periphery general': 'Periphery',
};

// ── Unit Quality Rating Resolution ──
// MegaMek weights encode unit quality via [base, modifier]:
//   [8, "+"] → elite-skewed: A=8, B=7, C=6, D=5, F=4
//   [8, "-"] → garrison-skewed: F=8, D=7, C=6, B=5, A=4
//   [8, 0]   → flat across all tiers
//   { A: 7, B: 5, C: 4, D: 3 } → explicit per-level
// Rating indices: F=0, D=1, C=2, B=3, A=4 (IS) / PGC=0, Sol=1, SL=2, FL=3, K=4 (Clan)

const RATING_LEVELS = ['F', 'D', 'C', 'B', 'A'];
const RATING_INDEX = { F: 0, D: 1, C: 2, B: 3, A: 4 };
const NUM_LEVELS = 5;

// Map explicit Clan level names to tier indices
const CLAN_LEVEL_INDEX = {
  'PGC': 0, 'Provisional Garrison': 0,
  'Solahma': 1, 'Sol': 1,
  'Second Line': 2, 'SL': 2,
  'Front Line': 3, 'FL': 3,
  'Keshik': 4, 'K': 4
};

/**
 * Resolve a weight entry to a single numeric value for a given rating tier.
 * @param {Array|Object|number} entry - [base, mod], {level: weight}, or plain number
 * @param {number|null} ratingIdx - 0-4 tier index, or null for cross-tier average
 * @returns {number} resolved weight (may be fractional for averages)
 */
function resolveWeight(entry, ratingIdx) {
  if (typeof entry === 'number') return entry; // legacy plain number

  if (Array.isArray(entry)) {
    const [base, mod] = entry;
    if (mod === 0 || mod === '0' || !mod) {
      return base; // flat — same at all tiers
    }
    if (ratingIdx !== null && ratingIdx !== undefined) {
      // Resolve for specific tier
      let val;
      if (mod === '+') {
        val = base - (NUM_LEVELS - 1 - ratingIdx);
      } else { // '-'
        val = base - ratingIdx;
      }
      return Math.max(0, val);
    }
    // Cross-tier average (default)
    let sum = 0;
    for (let i = 0; i < NUM_LEVELS; i++) {
      let val;
      if (mod === '+') {
        val = base - (NUM_LEVELS - 1 - i);
      } else { // '-'
        val = base - i;
      }
      sum += Math.max(0, val);
    }
    return sum / NUM_LEVELS;
  }

  if (typeof entry === 'object' && entry !== null) {
    // Explicit per-level: { A: 7, B: 5, ... } or { Keshik: 4, "Front Line": 3, ... }
    if (ratingIdx !== null && ratingIdx !== undefined) {
      // Try IS level name first, then Clan level names
      const isLevel = RATING_LEVELS[ratingIdx];
      if (entry[isLevel] !== undefined) return entry[isLevel];
      // Try Clan level names for this index
      for (const [name, idx] of Object.entries(CLAN_LEVEL_INDEX)) {
        if (idx === ratingIdx && entry[name] !== undefined) return entry[name];
      }
      return 0; // tier not present = extinct
    }
    // Cross-tier average: average all level values, pad with zeros for missing levels
    const values = Object.values(entry);
    if (values.length === 0) return 0;
    // Pad to NUM_LEVELS (missing tiers = 0)
    const sum = values.reduce((a, b) => a + Math.max(0, b), 0);
    return sum / NUM_LEVELS;
  }

  return 0;
}

/**
 * Resolve all faction weights in a weights object.
 * @param {Object} weights - { factionCode: [base, mod] | {levels} | number }
 * @param {number|null} ratingIdx - tier index or null for average
 * @returns {Object} { factionCode: number }
 */
function resolveWeights(weights, ratingIdx) {
  const result = {};
  for (const [f, entry] of Object.entries(weights)) {
    result[f] = resolveWeight(entry, ratingIdx);
  }
  return result;
}

// ── Logarithmic Scale Conversion ──
// MegaMek availability ratings use a base-2 log scale: probability_weight = 2^(rating/2)
function toProb(rating) {
  if (rating <= 0) return 0;
  // Epsilon weights (sub-faction derived, < 0.1) should produce a vanishingly
  // small probability so they don't distort signature calculations.
  if (rating < 0.1) return 0.001;
  return Math.pow(2, rating / 2);
}

// ── Xotl Availability Conversion ──
// Xotl's 1-10 availability scale maps to actual D1000 table frequencies.
// Fitted from Xotl's published values (R²=0.9957):
//   Av 1 → 0.5%, Av 5 → 3.6%, Av 10 → 25%
// Clean formula: each +1 Av = 1.5x more likely, scaled to match the data.
//   freq = 0.00432 × 1.5^Av
// This replaces MegaMek's 2^(w/2) which overestimates by 100-300x.
function xotlToProb(av) {
  if (av <= 0) return 0;
  return 0.00432 * Math.pow(1.5, av);
}

/**
 * Convert a weight entry to probability space, correctly averaging across tiers.
 * When ratingIdx is null (cross-tier average), converts each tier to prob first,
 * then averages — avoiding Jensen's inequality distortion from averaging on
 * the log scale before converting (Jensen's inequality).
 * When ratingIdx is an array (multi-rating), averages only those tiers in prob space.
 */
function entryToProb(entry, ratingIdx) {
  if (Array.isArray(ratingIdx)) {
    // Multi-rating: average specified tiers in probability space
    let sum = 0;
    for (const idx of ratingIdx) {
      sum += toProb(resolveWeight(entry, idx));
    }
    return sum / ratingIdx.length;
  }
  if (ratingIdx !== null && ratingIdx !== undefined) {
    return toProb(resolveWeight(entry, ratingIdx));
  }
  // Cross-tier average in probability space
  let sum = 0;
  for (let i = 0; i < NUM_LEVELS; i++) {
    sum += toProb(resolveWeight(entry, i));
  }
  return sum / NUM_LEVELS;
}

// ── Weight Class Distribution ──
// MegaMek applies weight class distribution as table-level mixing, NOT per-chassis adjustment.
// Within a weight class, chassis compete on raw availability only.
// When showing all weight classes together, each chassis's weight is scaled by the
// faction's proportion for that weight class: faction_wcd[class] / sum(faction_wcd).
// When filtering to a single weight class, WCD mixing is skipped entirely.

const WCD_CLASS_INDEX = { Light: 0, Medium: 1, Heavy: 2, Assault: 3 };

/**
 * Get the weight class distribution for a faction in a given era.
 * Falls back through era years (closest earlier era).
 */
function getFactionWcd(factionCode, eraYear) {
  if (!DATA) return null;
  const wcd = DATA.factions[factionCode]?.wcd;
  if (!wcd) return null;
  
  // Exact match
  if (wcd[eraYear]) return wcd[eraYear];
  
  // Find closest earlier era
  const years = Object.keys(wcd).map(Number).sort((a, b) => a - b);
  let best = null;
  for (const y of years) {
    if (y <= eraYear) best = wcd[y];
  }
  return best;
}

/**
 * Get the WCD mixing factor for a chassis in a faction.
 * Returns the faction's proportion for this weight class: wcd[classIdx] / sum(wcd).
 * Returns 1 if no WCD data (faction inherits baseline, no adjustment needed in mixed view).
 */
function getWcdMixingFactor(factionCode, chassisClass, eraYear) {
  if (!chassisClass) return 1;
  const idx = WCD_CLASS_INDEX[chassisClass];
  if (idx === undefined) return 1;
  
  const wcd = getFactionWcd(factionCode, eraYear);
  if (!wcd) return 1;
  
  const total = wcd.reduce((a, b) => a + b, 0);
  if (total === 0) return 1;
  
  return wcd[idx] / total;
}

/**
 * Resolve quality rating to numeric weights per faction.
 * No weight class adjustment — ratings are relative within their weight class.
 * Returns { factionCode: resolvedRating }
 */
function computeResolvedWeights(rawWeights, ratingIdx) {
  const resolved = resolveWeights(rawWeights, ratingIdx);
  const result = {};
  
  for (const [f, rating] of Object.entries(resolved)) {
    result[f] = Math.max(0, rating);
  }
  
  return result;
}

// ── Query Parser ──

function parseQuery(queryStr) {
  const result = {
    factions: [],
    chassis: [],
    chassisOp: '=',    // '=' or '!='
    class: null,       // {op, values: []} or null
    spread: null,    // {op, val}
    span: null,
    avgWeight: null,
    weight: null,
    sig: null,
    tons: null,
    bv: [],          // [{op, val}] — multiple allowed (bv>1000 bv<1500)
    factionWeight: [],  // [{faction, op, val}]
    factionSig: [],   // [{faction, op, val}]
    factionProb: [],  // [{faction, op, val}]
    factionCmb: [],   // [{faction, op, val}]
    prob: null,       // {op, val} — biased weight (probability) filter
    combined: null,   // {op, val} — combined score filter
    year: null,
    era: null,
    rating: null,     // 'A'|'B'|'C'|'D'|'F' or null (cross-tier average)
    family: null,     // 'on' | 'off'
    industrial: null,  // 'show' | 'hide'
    type: null,        // {op, value} or null — 'omni' | 'battlemech'
    tech: null,        // {op, value} or null — 'clan' | 'is' | 'mixed'
    mode: 'B',
    sort: [],          // [{field, dir}]
    raw: queryStr,
    rawMatches: {}     // field → raw query substring that produced it (for chip removal)
  };

  if (!queryStr || !queryStr.trim()) return result;

  let q = queryStr.trim();

  // Extract sort clause first
  const sortMatch = q.match(/\bsort\s+by\s+(.+)$/i);
  if (sortMatch) {
    result.rawMatches.sort = sortMatch[0]; // capture raw sort fragment for chip removal
    q = q.slice(0, sortMatch.index).trim();
    const sortParts = sortMatch[1].split(',').map(s => s.trim());
    for (const part of sortParts) {
      const tokens = part.split(/\s+/);
      let field = tokens[0].toLowerCase();
      let dir = 'desc';
      
      // Handle "DC preference desc" or "DC sig desc" or "DC prob desc" -> field = DC-weight or DC-sig or DC-prob
      const SORT_METRICS = new Set(['preference', 'weight', 'sig', 'signature', 'dr', 'distinctiveness', 'prob', 'bw', 'cmb', 'combined']);
      if (tokens.length >= 2 && SORT_METRICS.has(tokens[1].toLowerCase())) {
        const factionCode = resolveFaction(tokens[0]);
        const rawMetric = tokens[1].toLowerCase();
        const metric = (rawMetric === 'preference' || rawMetric === 'weight') ? 'weight'
          : (rawMetric === 'prob' || rawMetric === 'bw') ? 'prob'
          : (rawMetric === 'cmb' || rawMetric === 'combined') ? 'cmb'
          : 'sig'; // dr/distinctiveness/sig/signature all map to sig
        if (factionCode) {
          field = factionCode + '-' + metric;
        } else {
          field = metric;
        }
        dir = (tokens[2] || 'desc').toLowerCase();
      } else {
        field = tokens[0].toLowerCase();
        // Handle faction-prefixed fields: fs-sig, dc-pref, dc-preference, dc-prob, dc-bw, dc-cmb, dc-combined
        const prefixMatch = field.match(/^([a-z]+)-(sig|signature|dr|distinctiveness|pref|preference|weight|prob|bw|cmb|combined)$/);
        if (prefixMatch) {
          const fCode = resolveFaction(prefixMatch[1]);
          const rawMetric = prefixMatch[2];
          const metric = (rawMetric.startsWith('pref') || rawMetric === 'weight') ? 'weight'
            : (rawMetric === 'prob' || rawMetric === 'bw') ? 'prob'
            : (rawMetric === 'cmb' || rawMetric === 'combined') ? 'cmb'
            : 'sig';
          if (fCode) {
            field = fCode + '-' + metric;
          }
        } else {
          field = field.replace('-', '');
          if (field === 'avgpref') field = 'avg-pref';
          if (field === 'avgweight') field = 'avg-weight';
        }
        dir = (tokens[1] || 'desc').toLowerCase();
      }
      
      result.sort.push({ field, dir: dir === 'asc' ? 'asc' : 'desc' });
    }
  }

  // Normalize NOT prefix: "NOT field=value" → "field!=value"
  q = q.replace(/\bNOT\s+(\w[\w-]*)\s*=/gi, '$1!=');

  // Auto-quote chassis names with parenthetical suffixes: chassis=Firestarter (Omni) → chassis="Firestarter (Omni)"
  if (DATA?.chassis) {
    q = q.replace(/\bchassis\s*(=|!=)\s*(?!")([\w][\w\s'-]*?)\s*(\([^)]+\))/gi, (full, op, name, paren) => {
      const candidate = (name.trim() + ' ' + paren).trim();
      if (DATA.chassis[candidate] || resolveChassis(candidate) !== candidate) {
        return 'chassis' + op + '"' + candidate + '"';
      }
      return full;
    });
  }

  // Auto-quote multi-word chassis names: chassis=King Crab → chassis="King Crab"
  // Greedy match: after chassis= (not already quoted/parenthesized), try 2-4 word combos
  // and see if they resolve to a known chassis before the regex parser splits on whitespace.
  if (DATA?.chassis) {
    q = q.replace(/\bchassis\s*(=|!=)\s*(?!["(])(\S+(?:\s+\S+){0,3})/gi, (full, op, val) => {
      // Try progressively shorter multi-word combos
      const words = val.split(/\s+/);
      for (let len = words.length; len >= 2; len--) {
        const candidate = words.slice(0, len).join(' ');
        const resolved = resolveChassis(candidate);
        if (resolved !== candidate || DATA.chassis[candidate]) {
          const remainder = words.slice(len).join(' ');
          return 'chassis' + op + '"' + candidate + '"' + (remainder ? ' ' + remainder : '');
        }
      }
      return full; // no multi-word match, leave as-is
    });
  }

  // Auto-quote multi-word faction names: faction=scorpion empire → faction="scorpion empire"
  q = q.replace(/\bfaction\s*(=|!=)\s*(?!["(])(\S+(?:\s+\S+){0,3})/gi, (full, op, val) => {
    const words = val.split(/\s+/);
    for (let len = words.length; len >= 2; len--) {
      const candidate = words.slice(0, len).join(' ');
      if (FACTION_ALIASES[candidate.toLowerCase()]) {
        const remainder = words.slice(len).join(' ');
        return 'faction' + op + '"' + candidate + '"' + (remainder ? ' ' + remainder : '');
      }
    }
    return full;
  });

  // Capture normalized query (after NOT→!=, auto-quoting, sort extraction)
  // Used by chip removal to find raw match text reliably
  result.normalizedQuery = q;

  // Parse individual field expressions
  // Tokenize: handle parenthesized OR groups
  const fieldRegex = /(\w[\w-]*)\s*(=|!=|>=|<=|>|<)\s*(\([^)]+\)|"[^"]+"|[^\s]+)/gi;
  let match;
  
  while ((match = fieldRegex.exec(q)) !== null) {
    const field = match[1].toLowerCase();
    const op = match[2];
    let value = match[3];
    const rawMatch = match[0]; // full matched substring for chip removal
    
    // Remove quotes
    value = value.replace(/^"|"$/g, '');
    
    switch (field) {
      case 'faction': {
        const factions = parseValueList(value);
        for (const f of factions) {
          const resolved = resolveFactionGroup(f);
          result.factions.push(...resolved);
        }
        // Deduplicate
        result.factions = [...new Set(result.factions)];
        break;
      }
      case 'chassis': {
        const chassis = parseValueList(value);
        result.chassis.push(...chassis);
        result.chassisOp = op;
        break;
      }
      case 'class': {
        const classes = parseValueList(value).map(v => v.toLowerCase());
        result.class = { op, values: classes };
        break;
      }
      case 'spread':
        result.spread = { op, val: parseFloat(value) };
        break;
      case 'span':
        result.span = { op, val: parseFloat(value) };
        break;
      case 'avg-pref':
      case 'avgpref':
      case 'avg-weight':
      case 'avgweight':
        result.avgWeight = { op, val: parseFloat(value) };
        break;
      case 'weight':
        result.weight = { op, val: parseFloat(value) };
        break;
      case 'sig':
      case 'signature':
      case 'dr':
      case 'distinctiveness':
        result.sig = { op, val: parseFloat(value) };
        break;
      case 'year':
        result.year = parseInt(value);
        break;
      case 'era':
        result.era = value;
        break;
      case 'family':
        result.family = value.toLowerCase();
        break;
      case 'industrial':
        result.industrial = value.toLowerCase();
        break;
      case 'type':
        result.type = { op, value: value.toLowerCase() };
        break;
      case 'tech':
        result.tech = { op, value: value.toLowerCase() };
        break;
      case 'role':
        result.role = { op, value: value.toLowerCase() };
        break;
      case 'mode':
        result.mode = value.toUpperCase();
        break;
      case 'rating':
        // Support single (rating=A) or multi (rating=(A OR B))
        const rVals = value.toUpperCase().split(/\s+OR\s+|\s*,\s*/).map(v => v.replace(/[()]/g, '').trim());
        const validRatings = rVals.filter(v => RATING_INDEX[v] !== undefined);
        if (validRatings.length === 1) {
          result.rating = validRatings[0];
        } else if (validRatings.length > 1) {
          result.rating = validRatings; // array signals multi-rating average
        }
        break;
      case 'tons':
      case 'tonnage':
        result.tons = { op, val: parseFloat(value) };
        break;
      case 'bv':
      case 'battlevalue':
        result.bv.push({ op, val: parseFloat(value) });
        break;
      case 'prob':
      case 'bw':
        result.prob = { op, val: parseFloat(value) };
        break;
      case 'cmb':
      case 'combined':
        result.combined = { op, val: parseFloat(value) };
        break;
      default: {
        // Handle faction-prefixed filters: DC-pref>8, FS-sig>5, DC-prob>3, DC-cmb>1.5, etc.
        const fpMatch = field.match(/^([a-z]+)-(pref|preference|weight|sig|signature|dr|distinctiveness|prob|bw|cmb|combined)$/);
        if (fpMatch) {
          const fCode = resolveFaction(fpMatch[1]);
          const metricKey = fpMatch[2];
          const metric = (metricKey.startsWith('pref') || metricKey.startsWith('w')) ? 'weight'
            : (metricKey === 'prob' || metricKey === 'bw') ? 'prob'
            : (metricKey === 'cmb' || metricKey === 'combined') ? 'cmb'
            : 'sig'; // dr/distinctiveness also → sig
          if (fCode) {
            const entry = { faction: fCode, op, val: parseFloat(value) };
            if (metric === 'weight') result.factionWeight.push(entry);
            else if (metric === 'prob') result.factionProb.push(entry);
            else if (metric === 'cmb') result.factionCmb.push(entry);
            else result.factionSig.push(entry);
          }
        }
        break;
      }
    }

    // Store raw match text for chip removal — map to canonical chip field names
    const canonicalField = (field === 'signature' || field === 'dr' || field === 'distinctiveness') ? 'sig'
      : (field === 'tonnage') ? 'tons'
      : (field === 'battlevalue') ? 'bv'
      : (field === 'bw') ? 'prob'
      : (field === 'avgpref' || field === 'avg-pref' || field === 'avgweight') ? 'avg-weight'
      : field.match(/^([a-z]+)-(pref|preference|weight)$/) ? field.replace(/-(pref|preference)$/, '-weight')
      : field.match(/^([a-z]+)-(signature|dr|distinctiveness)$/) ? field.replace(/-(signature|dr|distinctiveness)$/, '-sig')
      : field.match(/^([a-z]+)-(bw)$/) ? field.replace(/-(bw)$/, '-prob')
      : field;
    // For fields that can appear multiple times (bv, factionWeight, factionSig),
    // concatenate raw matches separated by space
    if (result.rawMatches[canonicalField]) {
      result.rawMatches[canonicalField] += ' ' + rawMatch;
    } else {
      result.rawMatches[canonicalField] = rawMatch;
    }
  }

  return result;
}

function parseValueList(value) {
  // Handle "(X OR Y OR Z)" and bare values
  // Only strip parens when they form a matching outer pair — preserves
  // legitimate parens in values like "Firestarter (Omni)"
  value = value.replace(/^\((.+)\)$/, '$1');
  return value.split(/\s+OR\s+/i).map(v => v.trim().replace(/^"|"$/g, ''));
}

function resolveFaction(name) {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  
  // Direct alias lookup
  if (FACTION_ALIASES[lower]) return FACTION_ALIASES[lower];
  
  // Check if it's already a valid faction code
  const upper = name.toUpperCase();
  if (DATA && DATA.factions[upper]) return upper;
  
  // Partial match on faction names
  if (DATA) {
    for (const [code, info] of Object.entries(DATA.factions)) {
      if (info.name.toLowerCase().includes(lower)) return code;
    }
  }
  
  return name.toUpperCase(); // fallback
}

function resolveFactionGroup(name) {
  const lower = name.toLowerCase().trim();
  
  // Check faction groups first
  if (lower === 'greathouses' || lower === 'great houses') {
    return DATA?.factionGroups?.GreatHouses || ['DC', 'FS', 'FWL', 'LC', 'CC'];
  }
  if (lower === 'clans') {
    return DATA?.factionGroups?.Clans || [];
  }
  if (lower === 'innersphere' || lower === 'inner sphere' || lower === 'is') {
    // All non-Clan, non-Periphery factions
    if (DATA?.factions) {
      return Object.entries(DATA.factions)
        .filter(([, info]) => info && !info.clan && !info.periphery)
        .map(([code]) => code);
    }
    return ['DC', 'FS', 'FWL', 'LC', 'CC', 'FC', 'FRR', 'CS', 'WOB', 'SIC', 'MERC', 'ROS'];
  }
  if (lower === 'invasionclans' || lower === 'invasion clans') {
    return ['CW', 'CJF', 'CGB', 'CSJ'];
  }
  if (lower === 'isclans' || lower === 'is clans' || lower === 'innersphereclans' || lower === 'inner sphere clans') {
    // Clans with significant Inner Sphere presence
    return DATA?.factionGroups?.ISClans || ['CW', 'CJF', 'CGB', 'CSJ', 'CHH', 'CNC', 'CDS', 'CSR', 'RD', 'RA', 'CWIE', 'CWE'];
  }
  if (lower === 'homeclans' || lower === 'home clans' || lower === 'homeworldclans' || lower === 'homeworld clans') {
    return DATA?.factionGroups?.HomeClans || ['CBS', 'CCO', 'CFM', 'CGS', 'CIH', 'CSA', 'CSV', 'CCC', 'CB', 'CMG', 'CWI', 'CWOV', 'CSL'];
  }
  if (lower === 'periphery') {
    return DATA?.factionGroups?.Periphery || [];
  }
  if (lower === 'fwlstates' || lower === 'fwl states' || lower === 'fwlbreakup' || lower === 'fwl breakup') {
    return DATA?.factionGroups?.FWLStates || ['DA', 'DO', 'DTA', 'MSC', 'OP', 'RF', 'RCM', 'PR', 'MCM'];
  }
  const resolved = resolveFaction(name);
  return resolved ? [resolved] : [];
}

// Chassis name alias map — built once from parenthetical naming convention
// e.g. "Thor (Summoner)" → aliases: "thor" → "Thor (Summoner)", "summoner" → "Thor (Summoner)"
// Stored on DATA object to survive eval/with scoping in tests.
function getChassisAliases() {
  if (DATA._chassisAliases) return DATA._chassisAliases;
  DATA._chassisAliases = {};
  if (!DATA?.chassis) return DATA._chassisAliases;
  for (const name of Object.keys(DATA.chassis)) {
    const match = name.match(/^(.+?)\s*\((.+)\)$/);
    if (match) {
      const primary = match[1].trim().toLowerCase();
      const alt = match[2].trim().toLowerCase();
      if (!DATA._chassisAliases[primary]) DATA._chassisAliases[primary] = name;
      if (!DATA._chassisAliases[alt]) DATA._chassisAliases[alt] = name;
    }
  }
  return DATA._chassisAliases;
}

function resolveChassis(name) {
  if (!name || !DATA) return name;
  const lower = name.toLowerCase().trim();
  
  // Exact match on full chassis name
  if (DATA.chassis[name]) return name;
  
  // Case-insensitive exact match on full chassis name
  for (const ch of Object.keys(DATA.chassis)) {
    if (ch.toLowerCase() === lower) return ch;
  }
  
  // Clan IS/Clan name aliases (exact match) — before model prefixes
  // so "Hel" → Loki Mk II (Hel) instead of HEL prefix → Helios
  const aliases = getChassisAliases();
  if (aliases[lower]) return aliases[lower];
  
  // Check model prefix aliases (e.g. AWS → Awesome, DRG → Dragon)
  const upper = name.toUpperCase();
  if (DATA.modelPrefixes[upper]) return DATA.modelPrefixes[upper];
  
  // startsWith: check aliases first (shorter, more specific matches),
  // then chassis names. This ensures "hel" → Loki Mk II (Hel) via alias
  // before "hel" → Helios via chassis name startsWith.
  for (const [alias, target] of Object.entries(aliases)) {
    if (alias.startsWith(lower)) return target;
  }
  
  for (const ch of Object.keys(DATA.chassis)) {
    if (ch.toLowerCase().startsWith(lower)) return ch;
  }
  
  // Fallback: includes match
  for (const ch of Object.keys(DATA.chassis)) {
    if (ch.toLowerCase().includes(lower)) return ch;
  }
  
  return name;
}

// ── Scoring Functions (all client-side) ──

function computeSpread(weights, scopedFactions) {
  const vals = scopedFactions.map(f => weights[f] || 0);
  return Math.max(...vals) - Math.min(...vals);
}

function computeSpan(weights, scopedFactions) {
  return scopedFactions.filter(f => (weights[f] || 0) > 0).length;
}

function computeAvgWeight(weights, scopedFactions) {
  const vals = scopedFactions.map(f => weights[f] || 0).filter(v => v > 0);
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/**
 * Compute BV range from in-scope variants.
 * Considers only variants that:
 *   - Have weight > 0 for at least one scoped faction
 *   - Are MUL-confirmed (in Mode B) for a scoped faction
 *   - Have intro year <= target year (if year filtering active)
 *   - Have BV data
 * Returns { bvMin, bvMax, bvList } or null if no BV data.
 */
function computeBVRange(variants, scopedFactions, mul, modeB, targetYear, chassisWeights) {
  if (!variants) return null;
  const bvValues = [];
  for (const [varName, varData] of Object.entries(variants)) {
    const vWeights = varData.w || varData;
    const bv = varData.bv;
    const intro = varData.intro;
    if (bv == null) continue;
    if (targetYear && intro && intro > targetYear) continue;
    // Check if any scoped faction has weight data for this variant.
    // Combined variant weights can be negative (meaning "less common than chassis
    // average") — a defined value still indicates the faction fields this variant.
    // The chassis-level hasAnyWeight check already confirmed positive availability.
    // Also accept variants when a scoped faction has chassis-level weight (e.g.
    // epsilon from sub-faction injection) even if the variant lacks per-faction data.
    const factions = scopedFactions.length > 0 ? scopedFactions : Object.keys(vWeights);
    const hasFaction = factions.some(f => {
      const raw = vWeights[f];
      if (raw !== undefined && raw !== null) return true;
      // Fallback: chassis-level weight exists for this faction (epsilon / sub-faction derived)
      if (chassisWeights && (chassisWeights[f] || 0) > 0) return true;
      return false;
    });
    if (!hasFaction) continue;
    bvValues.push(bv);
  }
  if (bvValues.length === 0) return null;
  return { bvMin: Math.min(...bvValues), bvMax: Math.max(...bvValues), bvList: bvValues };
}

/**
 * Check if a single variant's tech base matches the requested tech filter.
 * @param {string|null} variantTech - tech base of the variant (e.g., "Clan", "Inner Sphere", "Mixed")
/**
 * Get the user's custom role settings from localStorage, or null if none.
 * @returns {{ taxonomy: string[], overrides: Object, renames: Object } | null}
 */
function getUserRoles() {
  try {
    const stored = localStorage.getItem('bt-sig-roles');
    return stored ? JSON.parse(stored) : null;
  } catch { return null; }
}

/**
 * Resolve the display role for a specific variant.
 * Resolution order: user override → MUL data → rename mapping
 * @param {string} chassis - chassis name
 * @param {string} variant - variant name
 * @param {string|null} mulRole - role from app-data.json
 * @returns {string} resolved role name
 */
function resolveVariantRole(chassis, variant, mulRole) {
  const userRoles = getUserRoles();
  if (!userRoles) return mulRole || null;
  
  // Check per-variant override
  const key = chassis + ':' + variant;
  if (userRoles.overrides?.[key]) return userRoles.overrides[key];
  
  // Apply rename to MUL role
  let role = mulRole || null;
  if (role && userRoles.renames?.[role]) role = userRoles.renames[role];
  
  // Check if resolved role is in taxonomy; if not, map to None
  if (role && userRoles.taxonomy && !userRoles.taxonomy.includes(role)) role = 'None';
  
  return role;
}

/**
 * Resolve the display role for a chassis.
 * If variant data is available and user overrides exist, recompute from
 * resolved variant roles. Otherwise apply renames to the chassis metadata.
 * @param {string} chassis - chassis name
 * @param {string|null} mulRole - role from chassis metadata
 * @param {Object|null} variants - variant data { varName: { role, ... } } if available
 * @param {number|null} targetYear - filter variants by intro year
 * @returns {string} resolved role name
 */
function resolveChassisRole(chassis, mulRole, variants, targetYear) {
  const userRoles = getUserRoles();
  
  // If we have variant data, recompute from resolved variant roles
  // Only count variants that have weight data (actually fielded)
  if (variants && userRoles) {
    const roleCounts = {};
    for (const [vName, vData] of Object.entries(variants)) {
      // Skip variants with no weight data (not fielded by anyone in scope)
      if (!vData.w || Object.keys(vData.w).length === 0) continue;
      // Skip variants not yet introduced
      if (targetYear && vData.intro && vData.intro > targetYear) continue;
      const r = resolveVariantRole(chassis, vName, vData.role) || 'None';
      if (r !== 'None') roleCounts[r] = (roleCounts[r] || 0) + 1;
    }
    const sorted = Object.entries(roleCounts).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) return null;
    if (sorted.length === 1) return sorted[0][0];
    const total = sorted.reduce((s, e) => s + e[1], 0);
    if (sorted[0][1] / total > 0.5) return sorted[0][0];
    return sorted.slice(0, 2).map(e => e[0]).join('/');
  }
  
  // No variant data or no user roles — apply renames to chassis metadata
  if (!userRoles || !mulRole) return mulRole || null;
  const parts = mulRole.split('/');
  const resolved = parts.map(r => userRoles.renames?.[r] || r);
  return resolved.join('/');
}

/**
 * Show a role selection dropdown anchored to a variant role button.
 * @param {HTMLElement} btn - the .variant-role-btn element
 */
function showRoleDropdown(btn) {
  const dropdown = document.createElement('div');
  dropdown.className = 'role-dropdown';

  const taxonomy = getRoleTaxonomy();
  const currentRole = btn.dataset.role || '';

  for (const role of taxonomy) {
    const item = document.createElement('div');
    item.className = 'role-dropdown-item' + (role === currentRole ? ' role-dropdown-active' : '');
    item.textContent = role;
    item.addEventListener('click', () => {
      const chassis = btn.dataset.chassis;
      const variant = btn.dataset.variant;
      const roles = getOrInitUserRoles();
      if (role === 'None' || role === '') {
        delete roles.overrides[chassis + ':' + variant];
      } else {
        roles.overrides[chassis + ':' + variant] = role;
      }
      saveUserRoles(roles);
      variantRoleChanged = true;
      dropdown.remove();
      btn.textContent = role;
      btn.dataset.role = role;
    });
    dropdown.appendChild(item);
  }

  // Reset to MUL default option
  const resetItem = document.createElement('div');
  resetItem.className = 'role-dropdown-item role-dropdown-reset';
  resetItem.textContent = '↩ Reset to MUL default';
  resetItem.addEventListener('click', () => {
    const chassis = btn.dataset.chassis;
    const variant = btn.dataset.variant;
    const roles = getOrInitUserRoles();
    delete roles.overrides[chassis + ':' + variant];
    saveUserRoles(roles);
    variantRoleChanged = true;
    dropdown.remove();
    const eraData = DATA.eraData[String(currentEraYear)];
    const cData = eraData?.[chassis];
    const mulRole = cData?.v?.[variant]?.role || null;
    const resolved = resolveVariantRole(chassis, variant, mulRole);
    btn.textContent = resolved || 'None';
    btn.dataset.role = resolved || '';
  });
  dropdown.appendChild(resetItem);

  // Position near the button using fixed positioning
  const btnRect = btn.getBoundingClientRect();
  dropdown.style.top = (btnRect.bottom + 2) + 'px';
  dropdown.style.left = btnRect.left + 'px';
  document.body.appendChild(dropdown);
  const dropRect = dropdown.getBoundingClientRect();
  if (dropRect.bottom > window.innerHeight) {
    dropdown.style.top = (btnRect.top - dropRect.height - 2) + 'px';
  }

  // Close on click outside
  const closeDropdown = (ev) => {
    if (!dropdown.contains(ev.target) && ev.target !== btn) {
      dropdown.remove();
      document.removeEventListener('click', closeDropdown);
    }
  };
  setTimeout(() => document.addEventListener('click', closeDropdown), 0);
}

/**
 * Get the active role taxonomy (user-customized or MUL defaults).
 * @returns {string[]}
 */
function getRoleTaxonomy() {
  const userRoles = getUserRoles();
  if (userRoles?.taxonomy) return userRoles.taxonomy;
  return ['Scout', 'Striker', 'Skirmisher', 'Juggernaut', 'Brawler', 'Missile Boat', 'Sniper', 'Ambusher', 'None'];
}

/**
 * @param {string} filterTech - parsed tech filter value: 'clan', 'is', or 'mixed'
 * @returns {boolean}
 */
function variantMatchesTech(variantTech, filterTech) {
  if (!variantTech) return false; // no tech data → can't confirm match
  const t = variantTech.toLowerCase();
  if (filterTech === 'clan') return t.includes('clan');
  if (filterTech === 'is') return t === 'inner sphere';
  if (filterTech === 'mixed') return t.includes('mixed');
  return false;
}

/**
 * Filter a variants object by tech base. Returns a new object containing
 * only variants whose tech matches the filter. Variants without explicit
 * tech data inherit the chassis-level tech (fallbackTech).
 * @param {Object} variants - { variantName: { w, bv, intro, tech } }
 * @param {string} filterTech - 'clan', 'is', or 'mixed'
 * @param {string|null} fallbackTech - chassis-level tech for variants missing tech
 * @param {boolean} [negate=false] - if true, keep variants that do NOT match
 * @returns {Object|null} filtered variants, or null if none match
 */
function filterVariantsByTech(variants, filterTech, fallbackTech, negate = false) {
  if (!variants) return variants; // no variants to filter
  // Only use fallback if the chassis has a single unambiguous tech base.
  // Aggregated values like "Inner Sphere/Mixed/Clan" are ambiguous —
  // we can't determine the variant's actual tech from them.
  const usableFallback = (fallbackTech && !fallbackTech.includes('/')) ? fallbackTech : null;
  const result = {};
  for (const [name, data] of Object.entries(variants)) {
    const tech = data.tech || usableFallback;
    const matches = variantMatchesTech(tech, filterTech);
    if (negate ? !matches : matches) {
      result[name] = data;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Compute signature score per faction: weight × max(0, z-score)
 * 
 * z-score = (weight - mean) / stddev across ALL factions in the era,
 * with non-fielding factions counted as 0. This captures both usage
 * intensity and exclusivity in a single statistically sound metric.
 * 
 * allFactionCodes: array of ALL faction codes in the era (for zero-padding)
 * Returns { factionCode: rawSigScore } for the requested factions.
 */
/**
 * Compute signature scores for a chassis across factions.
 * All computation stays in rating space (1-10 linear scale) to keep mid-weight
 * exclusive mechs visible. Probability space (2^(n/2)) was burying them under
 * high-weight common designs.
 * When wcdParams is provided (mixed-class view), ratings are scaled by each
 * faction's WCD mixing factor to reflect weight class preferences (e.g. Lyran
 * heavy bias boosts their heavies in sig rankings).
 *
 * @param {Object} weights - { factionCode: resolvedRating } (raw within-class ratings)
 * @param {Object} mulData - { factionCode: 1 } MUL confirmation flags
 * @param {string[]} factions - scoped factions to compute sig for
 * @param {string[]} allFactionCodes - all faction codes for z-score baseline
 * @param {Object|null} wcdParams - { chassisClass, eraYear } or null to skip WCD mixing
 */
function computeSignature(weights, mulData, factions, allFactionCodes, wcdParams, chassisTech, rawW, ratingIdx, isModeX) {
  const result = {};
  
  // Filter comparison pool by faction family MUL availability.
  // A faction family (IS, Clan, Periphery) is included in the z-score pool
  // if the chassis has MUL access in that family's general pool.
  // Factions outside included families are excluded entirely — their absence
  // is a technological boundary, not a meaningful choice.
  // Within included families, non-fielding factions count as 0 (a real choice).
  let compareFactions = allFactionCodes;
  {
    // Determine which faction families have MUL access to this chassis
    const isPool = DATA.factionIndex.indexOf('IS');
    const clanPool = DATA.factionIndex.indexOf('CLAN');
    const periPool = DATA.factionIndex.indexOf('Periphery');
    const hasIS = isPool >= 0 && mulData[DATA.factionIndex[isPool]];
    const hasClan = clanPool >= 0 && mulData[DATA.factionIndex[clanPool]];
    const hasPeri = periPool >= 0 && mulData[DATA.factionIndex[periPool]];

    // If at least one pool is identified, scope to those families
    // Include any faction that: belongs to an included family OR actually fields the chassis
    // Also exclude factions not active in the target era
    const eraYear = wcdParams?.eraYear;
    if (hasIS || hasClan || hasPeri) {
      compareFactions = allFactionCodes.filter(f => {
        // Exclude factions not active in this era
        if (eraYear && !isFactionActiveInYear(f, eraYear)) return false;
        // Always include factions that actually field the chassis (late-era tech sharing)
        if (weights[f] && weights[f] > 0) return true;
        // Include faction if their family pool has MUL access
        const fd = DATA.factions[f];
        if (!fd) return false;
        if (fd.clan) return hasClan;
        if (fd.periphery) return hasPeri;
        return hasIS; // default to IS family
      });
    } else if (eraYear) {
      // No general pool data (Mode A) — still filter by era activity
      compareFactions = allFactionCodes.filter(f => isFactionActiveInYear(f, eraYear));
    }
    // If no pool data and no era year, fall back to all factions
  }
  
  // Build effective weight array in probability space.
  // Signature uses 2^(rating/2) to reflect actual battlefield presence —
  // a rating-8 mech is 8× more likely than rating-2, not 4×.
  // This better captures "you'll see this mech and it'll be theirs."
  // In mixed-class view, scale by WCD mixing factor to reflect faction
  // weight class preferences (e.g. Lyran heavy bias boosts their heavies).
  const allWeights = compareFactions.map(f => {
    const rating = (mulData[f] && weights[f]) ? weights[f] : 0;
    if (rating <= 0) return 0;
    const prob = isModeX ? xotlToProb(rating) : (rawW?.[f] ? entryToProb(rawW[f], ratingIdx) : toProb(rating));
    if (wcdParams) {
      const mixFactor = getWcdMixingFactor(f, wcdParams.chassisClass, wcdParams.eraYear);
      return prob * mixFactor;
    }
    return prob;
  });
  
  const n = allWeights.length;
  if (n === 0) { for (const f of factions) result[f] = 0; return result; }
  
  const mean = allWeights.reduce((a, b) => a + b, 0) / n;
  const variance = allWeights.reduce((s, w) => s + (w - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);
  
  for (const f of factions) {
    const rating = (mulData[f] && weights[f]) ? weights[f] : 0;
    if (rating <= 0 || stddev === 0) { result[f] = 0; continue; }
    const prob = isModeX ? xotlToProb(rating) : (rawW?.[f] ? entryToProb(rawW[f], ratingIdx) : toProb(rating));
    let w;
    if (wcdParams) {
      const mixFactor = getWcdMixingFactor(f, wcdParams.chassisClass, wcdParams.eraYear);
      w = prob * mixFactor;
    } else {
      w = prob;
    }
    const z = (w - mean) / stddev;
    result[f] = Math.max(0, z);
  }
  return result;
}

/**
 * Jenks Natural Breaks classification.
 * Finds breakpoints in sorted data that minimize within-class variance.
 * Returns array of (numClasses - 1) breakpoint values.
 */
function jenksBreaks(sortedValues, numClasses) {
  const n = sortedValues.length;
  if (n <= numClasses) {
    // Fewer values than classes — each value is its own class
    return sortedValues.slice(0, n - 1);
  }

  // GVF (Goodness of Variance Fit) based Jenks implementation
  // Build matrices for sum of squared deviations
  const lower = Array.from({ length: n + 1 }, () => new Float64Array(numClasses + 1));
  const variance = Array.from({ length: n + 1 }, () => new Float64Array(numClasses + 1).fill(Infinity));

  for (let i = 1; i <= numClasses; i++) {
    lower[1][i] = 1;
    variance[1][i] = 0;
  }

  for (let l = 2; l <= n; l++) {
    let sum = 0, sumSq = 0;
    for (let m = 1; m <= l; m++) {
      const idx = l - m; // 0-based index into sortedValues
      const val = sortedValues[idx];
      sum += val;
      sumSq += val * val;
      const w = m; // count of values in this range
      const iv = sumSq - (sum * sum) / w;

      if (idx > 0) {
        for (let j = 2; j <= numClasses; j++) {
          const test = variance[idx][j - 1] + iv;
          if (test < variance[l][j]) {
            lower[l][j] = idx + 1;
            variance[l][j] = test;
          }
        }
      }
    }
    lower[l][1] = 1;
    variance[l][1] = sumSq - (sum * sum) / l;
  }

  // Extract break indices
  const breaks = [];
  let k = n;
  for (let j = numClasses; j >= 2; j--) {
    const breakIdx = lower[k][j] - 1; // 0-based
    breaks.unshift(sortedValues[breakIdx]);
    k = lower[k][j] - 1;
  }
  return breaks;
}

function assignTierFromBreaks(value, breaks) {
  if (breaks.length === 0) return 1;
  // breaks sorted ascending: [b0, b1, b2, b3] for 5 classes
  // value >= b3 → tier 1 (highest)
  // value >= b2 → tier 2
  // value >= b1 → tier 3
  // value >= b0 → tier 4
  // else → tier 5
  for (let i = breaks.length - 1; i >= 0; i--) {
    if (value >= breaks[i]) return breaks.length - i;
  }
  return breaks.length + 1;
}

function compareOp(value, op, threshold) {
  switch (op) {
    case '>': return value > threshold;
    case '<': return value < threshold;
    case '>=': return value >= threshold;
    case '<=': return value <= threshold;
    case '=': return value === threshold;
    case '!=': return value !== threshold;
    default: return true;
  }
}

// ── Get era year from target year ──

function getEraYear(targetYear) {
  if (!DATA) return null;
  const eraYears = DATA.eras.map(e => e.year).sort((a, b) => a - b);
  let best = eraYears[0];
  for (const ey of eraYears) {
    if (ey <= targetYear) best = ey;
    else break;
  }
  return best;
}

// ── Get chassis data for an era (with family merging) ──

function getChassisForEra(eraYear, familyMode) {
  if (!DATA || !DATA.eraData[eraYear]) return {};
  const eraData = DATA.eraData[eraYear];
  
  if (familyMode === 'off') return eraData;
  
  // Merge families (only enabled ones)
  const merged = {};
  const familyMembers = {}; // groupName -> [chassisNames]
  const disabledFamilies = new Set(); // families explicitly disabled by user
  
  const chassisToFamily = {}; // chassisName -> groupName (reverse lookup)

  for (const fam of DATA.families) {
    if (!fam.enabled) {
      disabledFamilies.add(fam.groupName);
      continue; // skip disabled families
    }
    for (const ch of fam.chassis) {
      if (!familyMembers[fam.groupName]) familyMembers[fam.groupName] = [];
      familyMembers[fam.groupName].push(ch);
      chassisToFamily[ch] = fam.groupName;
    }
  }
  
  // Also collect ad-hoc families from eraData fam fields not already in familyMembers
  // (e.g. IIC families defined only in the raw data, not in DATA.families)
  for (const [chassisName, data] of Object.entries(eraData)) {
    const famName = data.fam;
    if (famName && !disabledFamilies.has(famName)) {
      if (!familyMembers[famName]) familyMembers[famName] = [];
      // Add if not already listed (explicit DATA.families entries may overlap)
      if (!familyMembers[famName].includes(chassisName)) {
        familyMembers[famName].push(chassisName);
      }
    }
  }
  
  const processedFamilies = new Set();
  
  for (const [chassisName, data] of Object.entries(eraData)) {
    const famName = data.fam || chassisToFamily[chassisName] || null;
    
    if (famName && !disabledFamilies.has(famName) && !processedFamilies.has(famName)) {
      processedFamilies.add(famName);
      const members = familyMembers[famName] || [chassisName];
      
      // Merge weights from all family members
      const mergedWeights = {};
      const mergedVariants = {};
      let hasMul = {};
      
      for (const member of members) {
        const memberData = eraData[member];
        if (!memberData) continue;
        
        for (const [f, w] of Object.entries(memberData.w || {})) {
          mergedWeights[f] = (mergedWeights[f] || 0) + w;
        }
        if (memberData.v) {
          Object.assign(mergedVariants, memberData.v);
        }
        if (memberData.mul) {
          for (const [f, v] of Object.entries(memberData.mul)) {
            hasMul[f] = 1;
          }
        }
      }
      
      // Collect metadata from family members
      const tonValues = [];
      const classValues = new Set();
      let introMin = null;
      let isIndustrial = false;
      const techValues = new Set();
      const roleValues = new Set();
      for (const member of members) {
        const m = DATA.chassis[member];
        if (!m) continue;
        if (m.tons != null) tonValues.push(m.tons);
        if (m.class) classValues.add(m.class);
        if (m.intro != null) introMin = introMin == null ? m.intro : Math.min(introMin, m.intro);
        if (m.industrial) isIndustrial = true;
        if (m.tech) techValues.add(m.tech);
        const resolvedRole = resolveChassisRole(member, m.role);
        if (resolvedRole) roleValues.add(resolvedRole);
      }
      const tonsMin = tonValues.length ? Math.min(...tonValues) : null;
      const tonsMax = tonValues.length ? Math.max(...tonValues) : null;

      // Use family group name as display name
      const displayName = famName.replace(/ Family$/, '');
      merged[displayName] = {
        w: mergedWeights,
        v: Object.keys(mergedVariants).length > 0 ? mergedVariants : undefined,
        mul: Object.keys(hasMul).length > 0 ? hasMul : undefined,
        fam: famName,
        _members: members,
        _meta: {
          tons: tonsMin,
          tonsMax: tonsMax,
          class: classValues.size === 1 ? [...classValues][0] : [...classValues].join('/'),
          intro: introMin,
          industrial: isIndustrial,
          tech: techValues.size === 1 ? [...techValues][0] : [...techValues].join('/'),
          role: roleValues.size === 1 ? [...roleValues][0] : roleValues.size > 1 ? [...roleValues].join('/') : null
        }
      };
    } else if (!famName || disabledFamilies.has(famName)) {
      // No family, or family is disabled — show individually
      merged[chassisName] = data;
    }
    // Skip if already processed as part of an enabled family
  }
  
  return merged;
}


// Helper to get unique factions from rows (for mech view)
function getAllFactionsFromRows(rows) {
  const factions = new Set();
  for (const row of rows) {
    for (const [f, w] of Object.entries(row.weights)) {
      if (w > 0) factions.add(f);
    }
  }
  return [...factions];
}

// ── Era Auto-Adjust ──

/**
 * Check if a faction is active in a given year using its yearsActive ranges.
 * Returns true if the year falls within any {start, end} range.
 * If end is omitted, faction is active from start onward.
 */
function isFactionActiveInYear(factionCode, year) {
  const info = DATA?.factions[factionCode];
  if (!info?.yearsActive || info.yearsActive.length === 0) return true; // no data = assume active
  return info.yearsActive.some(r => year >= r.start && (r.end == null || year <= r.end));
}

/**
 * Find the best era to auto-adjust to based on chassis and/or faction filters.
 * Returns { year, message } or null if no adjustment needed.
 * Only called when no year/era is explicitly set.
 */
function findAutoAdjustEra(chassisFilter, scopedFactions) {
  if (!DATA) return null;
  const eras = DATA.eras; // sorted by year

  const hasChassisFilter = chassisFilter.length > 0;
  const hasFactionFilter = scopedFactions.length > 0;
  if (!hasChassisFilter && !hasFactionFilter) return null;

  // Helper: check if a chassis exists in a given era
  function chassisExistsInEra(eraYear) {
    const eraData = DATA.eraData[String(eraYear)];
    if (!eraData) return false;
    return chassisFilter.some(cf => {
      const lower = cf.toLowerCase();
      return Object.keys(eraData).some(ch => ch.toLowerCase() === lower || ch.toLowerCase().includes(lower));
    });
  }

  // Helper: check if any scoped faction is active in a year
  function factionActiveInEra(eraYear) {
    return scopedFactions.some(f => isFactionActiveInYear(f, eraYear));
  }

  // Check if default era (3049) works
  const defaultWorks = (!hasChassisFilter || chassisExistsInEra(3049)) &&
                       (!hasFactionFilter || factionActiveInEra(3049));
  if (defaultWorks) return null;

  // Find best era where both conditions are met
  for (const era of eras) {
    const chassisOk = !hasChassisFilter || chassisExistsInEra(era.year);
    const factionOk = !hasFactionFilter || factionActiveInEra(era.year);
    if (chassisOk && factionOk) {
      // Build message
      let msg = '';
      if (hasChassisFilter && !hasFactionFilter) {
        msg = `📅 Showing ${era.year} — ${chassisFilter[0]} isn't available in the default era (3049)`;
      } else if (hasFactionFilter && !hasChassisFilter) {
        const fCode = scopedFactions[0];
        const fName = DATA.factions[fCode]?.name || fCode;
        const ranges = DATA.factions[fCode]?.yearsActive || [];
        const rangeStr = ranges.map(r => r.end ? `${r.start}–${r.end}` : `${r.start}+`).join(', ');
        msg = `📅 Showing ${era.year} — ${fName} is active ${rangeStr}`;
      } else {
        msg = `📅 Showing ${era.year} — best era for ${chassisFilter[0]} + ${DATA.factions[scopedFactions[0]]?.name || scopedFactions[0]}`;
      }
      return { year: era.year, message: msg };
    }
  }

  return null; // no era works for both — fall through to breadcrumbing
}

/**
 * Build a no-results diagnostic message with clickable suggestions.
 * Returns an HTML string, or null if no specific diagnostic applies.
 */
function buildNoResultsMessage(chassisFilter, scopedFactions, eraYear, parsed) {
  if (!DATA) return null;
  const parts = [];

  // Check chassis intro year
  if (chassisFilter.length > 0) {
    for (const cf of chassisFilter) {
      const resolved = resolveChassis(cf);
      const meta = DATA.chassis[resolved];
      if (meta?.intro && meta.intro > eraYear) {
        const bestEra = DATA.eras.find(e => e.year >= meta.intro)?.year || meta.intro;
        const suggestedQuery = parsed.raw.replace(/year=\d+/gi, '').trim() + ` year=${bestEra}`;
        parts.push(`<span class="no-results-hint">${escHtml(resolved)} wasn't introduced until ${meta.intro}. <a href="#" class="era-suggestion" data-query="${escHtml(suggestedQuery.trim())}">Try year=${bestEra}</a></span>`);
      }
    }
  }

  // Check faction active years
  if (scopedFactions.length > 0) {
    for (const fCode of scopedFactions) {
      const info = DATA.factions[fCode];
      if (!info?.yearsActive || info.yearsActive.length === 0) continue;
      if (!isFactionActiveInYear(fCode, eraYear)) {
        const ranges = info.yearsActive.map(r => r.end ? `${r.start}–${r.end}` : `${r.start}+`).join(', ');
        // Find first era in an active range
        const bestEra = DATA.eras.find(e => isFactionActiveInYear(fCode, e.year))?.year;
        const fName = info.name || fCode;
        if (bestEra) {
          const suggestedQuery = parsed.raw.replace(/year=\d+/gi, '').trim() + ` year=${bestEra}`;
          parts.push(`<span class="no-results-hint">${escHtml(fName)} doesn't exist in era ${eraYear}. They're active ${ranges}. <a href="#" class="era-suggestion" data-query="${escHtml(suggestedQuery.trim())}">Try year=${bestEra}</a></span>`);
        } else {
          parts.push(`<span class="no-results-hint">${escHtml(fName)} doesn't exist in era ${eraYear}. They're active ${ranges}.</span>`);
        }
      }
    }
  }

  if (parts.length > 0) return parts.join('<br>');
  return null; // generic fallback handled by caller
}

// ── View Routing ──

function determineView(parsed) {
  const hasFaction = parsed.factions.length > 0;
  const hasChassis = parsed.chassis.length > 0;
  
  if (hasChassis && !hasFaction) return 'mech';
  if (hasFaction && !hasChassis && parsed.factions.length === 1) return 'single-faction';
  if (hasFaction && !hasChassis) return 'faction-comparison';
  if (hasFaction && hasChassis) return 'mech-detail';
  return 'landing';
}

// ── Rendering ──

function getFactionLabel(code) {
  if (!DATA || !DATA.factions[code]) return code;
  return code; // Use short code in table headers
}

function getFactionFullName(code) {
  if (!DATA || !DATA.factions[code]) return code;
  return DATA.factions[code].name;
}

function heatClass(pref) {
  if (!pref || pref <= 0) return 'no-data';
  return 'heat-' + Math.round(Math.min(10, Math.max(1, pref)));
}

function bwFormat(bw) {
  if (!bw || bw <= 0) return '—';
  return (bw * 100).toFixed(0) + '%';
}

function bwHeatClass(bw) {
  if (!bw || bw <= 0) return 'no-data';
  // Both modes: biased weights are normalized shares [0, ~0.25], heavily skewed low.
  // log2 mapping [-8, 0] → [1, 10] to spread the distribution.
  const l = Math.log2(bw);
  const level = Math.round(1 + 9 * (l + 8) / 8);
  return 'cool-' + Math.max(1, Math.min(10, level));
}

function cmbHeatClass(cmb) {
  if (!cmb || cmb <= 0) return 'no-data';
  // Linear scale: map combined score from 0-2.0 to 1-10, using emerald green palette
  const level = Math.round(1 + 9 * (cmb / 2.0));
  return 'emerald-' + Math.max(1, Math.min(10, level));
}

function sigTierToHeat(tier) {
  // T1 (most iconic) = hottest, T5 = coolest
  const map = { 1: 'heat-10', 2: 'heat-8', 3: 'heat-6', 4: 'heat-3', 5: 'heat-1' };
  return map[tier] || 'no-data';
}

function renderFactionComparison(rows, scopedFactions, eraYear, query) {
  const container = document.getElementById('view-container');
  container.innerHTML = '';
  container.classList.remove('hidden');
  
  const eraLabel = DATA.eras.find(e => e.year === eraYear)?.label || `Era ${eraYear}`;
  const factionNames = scopedFactions.map(f => getFactionLabel(f)).join(' vs ');
  
  const title = document.createElement('div');
  title.className = 'view-title';
  title.textContent = `${factionNames} — ${eraLabel} (${rows.length} chassis)`;
  container.appendChild(title);

  if (rows.length === 0) {
    container.innerHTML += '<p style="color:var(--text-dim)">No results match your query.</p>';
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'data-table-wrapper';
  
  const table = document.createElement('table');
  table.className = 'data-table';
  
  // Header
  const thead = document.createElement('thead');
  const hasSig = rows.some(r => r.sig);
  const hasBV = rows.some(r => r.bvRange);
  let headerHTML = '<tr><th data-sort="name">Chassis</th><th data-sort="tonnage">Tons</th><th data-sort="role">Role</th>';
  if (hasBV) headerHTML += '<th data-sort="bv">BV</th>';
  // Split cell columns: DR | Prob in one cell per faction
  if (hasSig) {
    for (const f of scopedFactions) {
      headerHTML += `<th data-sort="${f}-sig" data-split="1" data-col-name="${getFactionLabel(f)} DR | Prob | Cmb" title="${getFactionFullName(f)} Distinctiveness | Probability | Combined">${getFactionLabel(f)} DR | Prob | Cmb</th>`;
    }
  }
  // Separate columns (hidden by default, available in column menu)
  if (hasSig) {
    for (const f of scopedFactions) {
      headerHTML += `<th data-sort="${f}-sig" title="${getFactionFullName(f)} Distinctiveness">${getFactionLabel(f)} DR</th>`;
    }
  }
  for (const f of scopedFactions) {
    headerHTML += `<th data-sort="${f}-weight" title="${getFactionFullName(f)}">${getFactionLabel(f)}</th>`;
  }
  for (const f of scopedFactions) {
    headerHTML += `<th data-sort="${f}-bw" title="${getFactionFullName(f)} Probability Weight">${getFactionLabel(f)} Prob</th>`;
  }
  for (const f of scopedFactions) {
    headerHTML += `<th data-sort="${f}-cmb" title="${getFactionFullName(f)} Combined Score">${getFactionLabel(f)} Cmb</th>`;
  }
  headerHTML += '<th data-sort="spread">Spread</th></tr>';
  thead.innerHTML = headerHTML;
  table.appendChild(thead);
  
  // Body — paginated
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  wrapper.appendChild(table);
  container.appendChild(wrapper);
  
  function renderPage(page) {
    const pageSize = getPageSize();
    const { pageRows, totalPages, page: safePage } = paginateRows(rows, page, pageSize);
    currentPage = safePage;
    
    tbody.innerHTML = '';
    for (const row of pageRows) {
      const tr = document.createElement('tr');
      let html = `<td class="chassis-name" style="cursor:pointer" data-chassis="${escAttr(row.name)}">${escHtml(row.name)}</td>`;
      html += `<td class="tonnage-col" style="cursor:pointer" data-chassis="${escAttr(row.name)}">${formatTonnage(row.meta)} <span class="class-badge class-${(row.meta.class || '').split('/')[0]}">${formatClass(row.meta)}</span></td>`;
      const displayRole = resolveChassisRole(row.name, row.meta.role, row.variants, currentEraYear) || '';
      html += `<td class="role-col" style="cursor:pointer" data-chassis="${escAttr(row.name)}">${escHtml(displayRole)}</td>`;
      if (hasBV) {
        if (row.bvRange) {
          const bvStr = row.bvRange.bvMin === row.bvRange.bvMax
            ? String(row.bvRange.bvMin)
            : `${row.bvRange.bvMin}–${row.bvRange.bvMax}`;
          html += `<td class="stat-col bv-col">${bvStr}</td>`;
        } else {
          html += '<td class="stat-col bv-col">—</td>';
        }
      }
      
      // Split cells: DR | Prob | Combined in one cell per faction
      if (hasSig) {
        for (const f of scopedFactions) {
          const sigVal = row.sig?.[f] || 0;
          const sigTier = row.sig?.[f + '_tier'] || 0;
          const hasWeight = (row.weights[f] || 0) > 0;
          const bw = row.biasedWeights?.[f] || 0;
          const cmb = row.combined?.[f] || 0;
          
          // Determine display mode from header state (default to mode 0: DR|Prob)
          const header = document.querySelector(`th[data-sort="${f.toUpperCase()}-sig"][data-split="1"]`);
          const splitState = header ? parseInt(header.dataset.splitState || '0') : 0;
          
          html += `<td class="faction-cell split-cell" data-chassis="${escAttr(row.name)}" data-faction="${f}">`;
          
          if (splitState === 2) {
            // Mode 2: Combined score (full cell)
            if (cmb > 0) {
              const cmbHeat = cmbHeatClass(cmb);
              html += `<div class="full-cell ${cmbHeat}">${cmb.toFixed(2)}</div>`;
            } else {
              html += '<div class="full-cell no-data">&mdash;</div>';
            }
          } else if (splitState === 1) {
            // Mode 1: Prob only (full cell)
            if (bw > 0) {
              const bwCls = bwHeatClass(bw);
              html += `<div class="full-cell ${bwCls}">${bwFormat(bw)}</div>`;
            } else {
              html += '<div class="full-cell no-data">&mdash;</div>';
            }
          } else {
            // Mode 0: DR | Prob | Cmb split (default)
            html += '<div class="split-cell-inner">';
            
            // Left: DR (sig score)
            if (sigVal > 0) {
              const sigHeat = sigTierToHeat(sigTier);
              html += `<div class="split-half ${sigHeat}">${sigVal.toFixed(1)}</div>`;
            } else if (hasWeight) {
              html += '<div class="split-half heat-1">0</div>';
            } else {
              html += '<div class="split-half no-data">&mdash;</div>';
            }
            
            html += '<div class="split-divider"></div>';
            
            // Middle: Prob (biased weight)
            if (bw > 0) {
              const bwCls = bwHeatClass(bw);
              html += `<div class="split-half ${bwCls}">${bwFormat(bw)}</div>`;
            } else {
              html += '<div class="split-half no-data">&mdash;</div>';
            }
            
            html += '<div class="split-divider"></div>';
            
            // Right: Cmb (combined score)
            if (cmb > 0) {
              const cmbHeat = cmbHeatClass(cmb);
              html += `<div class="split-half ${cmbHeat}">${cmb.toFixed(2)}</div>`;
            } else {
              html += '<div class="split-half no-data">&mdash;</div>';
            }
            
            html += '</div>';
          }
          
          html += '</div></td>';
        }
      }

      // Separate DR columns (hidden by default)
      if (hasSig) {
        for (const f of scopedFactions) {
          const sigVal = row.sig?.[f] || 0;
          const sigTier = row.sig?.[f + '_tier'] || 0;
          const hasWeight = (row.weights[f] || 0) > 0;
          if (sigVal > 0) {
            const sigHeat = sigTierToHeat(sigTier);
            html += `<td class="faction-cell ${sigHeat}" data-chassis="${escAttr(row.name)}" data-faction="${f}">`;
            html += `<span class="pref-value">DR${sigTier}</span>`;
            html += `<span class="sig-raw">${sigVal.toFixed(1)}</span>`;
            html += '</td>';
          } else if (hasWeight) {
            html += `<td class="faction-cell heat-1" data-chassis="${escAttr(row.name)}" data-faction="${f}">`;
            html += `<span class="pref-value">DR5</span>`;
            html += '</td>';
          } else {
            html += `<td class="faction-cell no-data" data-chassis="${escAttr(row.name)}" data-faction="${f}">—</td>`;
          }
        }
      }

      for (const f of scopedFactions) {
        const w = row.weights[f] || 0;
        const cls = w > 0 ? heatClass(w) : 'no-data';
        
        if (w > 0) {
          html += `<td class="faction-cell ${cls}" data-chassis="${escAttr(row.name)}" data-faction="${f}">`;
          html += `<span class="pref-value">${w.toFixed(1)}</span>`;
          if (hasSig && row.sig?.[f] > 0) {
            const tier = row.sig?.[f + '_tier'] || 0;
            html += `<span class="sig-value">DR${tier}</span>`;
          }
          html += '</td>';
        } else {
          html += `<td class="faction-cell no-data" data-chassis="${escAttr(row.name)}" data-faction="${f}">—</td>`;
        }
      }
      for (const f of scopedFactions) {
        const bw = row.biasedWeights?.[f] || 0;
        if (bw > 0) {
          const bwCls = bwHeatClass(bw);
          html += `<td class="faction-cell ${bwCls}" data-chassis="${escAttr(row.name)}" data-faction="${f}">`;
          html += `<span class="pref-value">${bwFormat(bw)}</span>`;
          html += '</td>';
        } else {
          html += `<td class="faction-cell no-data" data-chassis="${escAttr(row.name)}" data-faction="${f}">—</td>`;
        }
      }
      for (const f of scopedFactions) {
        const cmb = row.combined?.[f] || 0;
        if (cmb > 0) {
          const cmbCls = cmbHeatClass(cmb);
          html += `<td class="faction-cell ${cmbCls}" data-chassis="${escAttr(row.name)}" data-faction="${f}">`;
          html += `<span class="pref-value">${cmb.toFixed(2)}</span>`;
          html += '</td>';
        } else {
          html += `<td class="faction-cell no-data" data-chassis="${escAttr(row.name)}" data-faction="${f}">—</td>`;
        }
      }
      html += `<td class="stat-col">${row.spread.toFixed(1)}</td>`;
      
      tr.innerHTML = html;
      tbody.appendChild(tr);
    }
    
    renderPagination(container, rows.length, safePage, totalPages, renderPage);
    applyColVisibility();
  }
  
  renderPage(currentPage);
  
  // Click handler for faction cells
  table.addEventListener('click', handleCellClick);
  
  // Sortable headers
  thead.addEventListener('click', (e) => {
    const th = e.target.closest('th');
    if (!th || !th.dataset.sort) return;
    handleHeaderSort(th, rows, scopedFactions, eraYear, query);
  });

  // Restore sort indicators from query
  if (query && query.sort && query.sort.length > 0) {
    const primarySort = query.sort[0];
    const secondarySort = query.sort[1];
    thead.querySelectorAll('th').forEach(th => {
      const matchesPrimary = th.dataset.sort === primarySort.field;
      // For split cells, also match if the primary sort is the prob or cmb field for this faction
      const isSplitProbSort = th.dataset.split && primarySort.field.endsWith('-prob') &&
        th.dataset.sort === primarySort.field.replace(/-prob$/, '-sig');
      const isSplitCmbSort = th.dataset.split && primarySort.field.endsWith('-cmb') &&
        th.dataset.sort === primarySort.field.replace(/-cmb$/, '-sig');
      
      if (matchesPrimary || isSplitProbSort || isSplitCmbSort) {
        th.classList.add(primarySort.dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
        if (th.dataset.split) {
          const isSigPrimary = primarySort.field.endsWith('-sig');
          const isCmbPrimary = primarySort.field.endsWith('-cmb');
          const fCode = th.dataset.sort.replace(/-(sig|dr|signature|distinctiveness)$/, '');
          const fLabel = getFactionLabel(fCode);
          if (isCmbPrimary) {
            th.textContent = `${fLabel} DR | Prob | Cmb\u25BC`;
            th.dataset.splitState = '2';
          } else if (isSigPrimary) {
            th.textContent = `${fLabel} DR\u25BC | Prob | Cmb`;
            th.dataset.splitState = '0';
          } else {
            th.textContent = `${fLabel} DR | Prob\u25BC | Cmb`;
            th.dataset.splitState = '1';
          }
        }
      }
    });
  }

  updateColVisibility();
  applyColOrder();
}

function xotlAvailClass(val) {
  if (val == null) return 'na';
  if (val <= 3) return 'rare';
  if (val <= 6) return 'uncommon';
  return 'common';
}

function renderMechView(rows, eraYear, chassisName) {
  const container = document.getElementById('view-container');
  container.innerHTML = '';
  container.classList.remove('hidden');
  
  if (rows.length === 0) {
    container.innerHTML = '<p style="color:var(--text-dim)">No chassis found matching your query.</p>';
    return;
  }

  // Check Mode X
  const parsed = parseQuery(document.getElementById('query-bar')?.value || '');
  const isModeX = parsed.mode === 'X';

  for (const row of rows) {
    const meta = row.meta;
    
    const section = document.createElement('div');
    section.style.marginBottom = '2rem';
    
    section.innerHTML = `
      <div class="mech-view-title">${escHtml(row.name)}</div>
      <div class="mech-view-meta">${formatTonnage(meta)} ${formatClass(meta)} — Intro: ${meta.intro || 'Unknown'} — ${meta.tech || ''}</div>
    `;
    
    if (isModeX) {
      // Mode X: Faction | Availability | Variants
      const factionWeights = Object.entries(row.weights)
        .filter(([f, w]) => w > 0)
        .sort((a, b) => b[1] - a[1]);
      
      // Count total Xotl variants for this chassis (across all factions)
      const allVariantData = getXotlAllFactionVariantData(row.name, eraYear);
      const totalVariantCount = allVariantData.size;
      
      const table = document.createElement('table');
      table.className = 'data-table';
      table.innerHTML = `<thead><tr><th>Faction</th><th>Availability</th><th>Variants</th></tr></thead>`;
      
      const tbody = document.createElement('tbody');
      for (const [f, w] of factionWeights) {
        const fName = getFactionFullName(f);
        const avail = Math.round(w);
        const availCls = xotlAvailClass(w);
        
        // Count variants available for this faction
        const factionVariants = getXotlVariantData(row.name, f, eraYear);
        const variantStr = totalVariantCount > 0
          ? `${factionVariants.length}/${totalVariantCount}`
          : '—';
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td style="cursor:pointer" data-chassis="${escAttr(row.name)}" data-faction="${f}"><strong>${escHtml(f)}</strong> <span style="color:var(--text-dim)">${escHtml(fName)}</span></td>
          <td class="faction-cell ${availCls}" data-chassis="${escAttr(row.name)}" data-faction="${f}"><span class="pref-value">${avail}</span></td>
          <td class="stat-col">${variantStr}</td>
        `;
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      section.appendChild(table);
      container.appendChild(section);
      
      table.addEventListener('click', handleCellClick);
    } else {
      // Mode A/B: original MegaMek view
      const hasSig = row.sig && Object.values(row.sig).some(v => typeof v === 'number' && v > 0);
      const factionWeights = Object.entries(row.weights)
        .filter(([f, w]) => w > 0)
        .sort((a, b) => {
          if (hasSig) return (row.sig?.[b[0]] || 0) - (row.sig?.[a[0]] || 0);
          return b[1] - a[1];
        });
      
      const table = document.createElement('table');
      table.className = 'data-table';
      table.innerHTML = `<thead><tr><th>Faction</th>${hasSig ? '<th>DR</th>' : ''}<th>Prob</th><th>Weight</th></tr></thead>`;
      
      const tbody = document.createElement('tbody');
      for (const [f, w] of factionWeights) {
        const fName = getFactionFullName(f);
        
        // DR cell
        let drCell = '';
        if (hasSig) {
          const sigVal = row.sig?.[f] || 0;
          const sigTier = row.sig?.[f + '_tier'] || 0;
          if (sigVal > 0) {
            const sigHeat = sigTierToHeat(sigTier);
            drCell = `<td class="faction-cell ${sigHeat}" data-chassis="${escAttr(row.name)}" data-faction="${f}"><span class="pref-value">DR${sigTier}</span><span class="sig-raw">${sigVal.toFixed(1)}</span></td>`;
          } else {
            drCell = `<td class="faction-cell heat-1" data-chassis="${escAttr(row.name)}" data-faction="${f}"><span class="pref-value">DR5</span></td>`;
          }
        }

        // Prob cell
        const bw = row.biasedWeights?.[f] || 0;
        let probCell;
        if (bw > 0) {
          const bwCls = bwHeatClass(bw);
          probCell = `<td class="faction-cell ${bwCls}" data-chassis="${escAttr(row.name)}" data-faction="${f}"><span class="pref-value">${bwFormat(bw)}</span></td>`;
        } else {
          probCell = `<td class="faction-cell no-data">—</td>`;
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td style="cursor:pointer" data-chassis="${escAttr(row.name)}" data-faction="${f}"><strong>${escHtml(f)}</strong> <span style="color:var(--text-dim)">${escHtml(fName)}</span></td>
          ${drCell}
          ${probCell}
          <td class="stat-col">${w.toFixed(1)}</td>
        `;
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      section.appendChild(table);
      container.appendChild(section);
      
      table.addEventListener('click', handleCellClick);
    }
  }

  updateColVisibility();
  applyColOrder();
}

// ── Variant Drill-down ──

/**
 * Compute variant distribution for a given faction.
 * Variant weights are log-scale offsets (can be negative — "less common than
 * chassis average"). A defined value means the faction fields that variant.
 * We convert to probability space via 2^(w/2) for proportional display.
 *
 * @param {Object} variants - { varName: { w: { faction: weight }, bv, intro } }
 * @param {string} faction - faction code to compute distribution for
 * @param {number|null} targetYear - filter out variants introduced after this year
 * @param {string} chassisName - chassis name for role resolution
 * @returns {{ sorted: [string, number][], variantBV: Object, variantIntro: Object, variantRoles: Object, total: number }}
 */
function computeVariantDistribution(variants, faction, targetYear, chassisName) {
  const variantProbs = {};
  const variantBV = {};
  const variantIntro = {};
  const variantRoles = {};
  let total = 0;

  for (const [varName, varData] of Object.entries(variants || {})) {
    const factionWeights = varData.w || varData;
    const rawW = factionWeights[faction];
    // A defined value (even negative) means the faction fields this variant
    if (rawW === undefined || rawW === null) continue;
    // Filter out variants introduced after the target year
    if (targetYear && varData.intro && varData.intro > targetYear) continue;
    const resolved = resolveWeight(rawW, null);
    // Convert log-scale offset to probability space for proportional display.
    // Unlike toProb(), don't clamp negatives to 0 — these are relative offsets,
    // not absolute ratings. 2^(w/2) is always positive for any finite w.
    const prob = Math.pow(2, resolved / 2);
    variantProbs[varName] = prob;
    total += prob;
    if (varData.bv != null) variantBV[varName] = varData.bv;
    if (varData.intro != null) variantIntro[varName] = varData.intro;
    variantRoles[varName] = resolveVariantRole(chassisName, varName, varData.role);
  }

  const sorted = Object.entries(variantProbs).sort((a, b) => b[1] - a[1]);
  return { sorted, variantBV, variantIntro, variantRoles, total };
}

// Get sub-faction data for a chassis+faction+era combination
function getSubFactionData(chassisNames, faction, eraYear) {
  if (!faction) return null;
  
  const eraData = DATA.eraData[String(eraYear)];
  if (!eraData) return null;
  
  let allSubFactionData = {};
  
  // Collect sub-faction data from all chassis names (handles families)
  for (const chassisName of chassisNames) {
    const chassisData = eraData[chassisName];
    if (chassisData && chassisData.sf && chassisData.sf[faction]) {
      // Merge sub-faction data from this chassis
      Object.assign(allSubFactionData, chassisData.sf[faction]);
    }
  }
  
  return Object.keys(allSubFactionData).length > 0 ? allSubFactionData : null;
}

/**
 * Mode X variant drill-down: shows Xotl variant availability and cross-faction comparison.
 */
function showVariantsXotl(chassisName, faction, eraYear, overlay, title, content) {
  const xotlEra = XOTL_ERA_MAP[eraYear];
  
  if (!xotlEra) {
    title.textContent = `${chassisName} — No Xotl Data`;
    content.innerHTML = '<div class="drilldown-section"><p class="drilldown-empty">No Xotl RAT data available for this era.</p></div>';
    overlay.classList.remove('hidden');
    return;
  }
  
  // Get all variant data across factions
  const allVariantData = getXotlAllFactionVariantData(chassisName, eraYear);
  
  if (allVariantData.size === 0) {
    title.textContent = `${chassisName} — No Xotl Data`;
    content.innerHTML = '<div class="drilldown-section"><p class="drilldown-empty">No Xotl RAT data available for this chassis.</p></div>';
    overlay.classList.remove('hidden');
    return;
  }
  
  if (!faction) {
    // No faction selected — show cross-faction comparison only
    title.textContent = `${chassisName} — Xotl Variant Availability (${eraYear})`;
    let html = '';
    
    // Cross-faction comparison table
    html += '<div class="drilldown-section"><h4 class="drilldown-section-title">Cross-Faction Variant Availability</h4>';
    
    // Collect all factions that have data for any variant
    const allFactions = new Set();
    for (const factionMap of allVariantData.values()) {
      for (const fCode of Object.keys(factionMap)) allFactions.add(fCode);
    }
    const sortedFactions = [...allFactions].sort();
    
    // Table header
    html += '<table class="data-table xotl-comparison-table"><thead><tr><th>Variant</th>';
    for (const fCode of sortedFactions) {
      html += `<th>${escHtml(fCode)}</th>`;
    }
    html += '</tr></thead><tbody>';
    
    // Sort variants by name
    const sortedVariants = [...allVariantData.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    
    for (const [variantName, factionMap] of sortedVariants) {
      html += `<tr><td><strong>${escHtml(variantName)}</strong></td>`;
      for (const fCode of sortedFactions) {
        const val = factionMap[fCode];
        if (val != null) {
          const cls = xotlAvailClass(val);
          html += `<td class="xotl-avail-cell ${cls}">${val}</td>`;
        } else {
          html += '<td class="xotl-avail-cell na">—</td>';
        }
      }
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    
    content.innerHTML = html;
    overlay.classList.remove('hidden');
    return;
  }
  
  // Faction-specific view
  title.textContent = `${chassisName} — ${getFactionFullName(faction)} (Xotl)`;
  let html = '';
  
  // Section 1: Variant Availability for this faction
  const factionVariants = getXotlVariantData(chassisName, faction, eraYear);
  
  if (factionVariants.length === 0) {
    html += `<div class="drilldown-section"><p class="drilldown-empty">${escHtml(getFactionFullName(faction))} does not field the ${escHtml(chassisName)} in Xotl's ${xotlEra} tables.</p></div>`;
  } else {
    // Section 1a: Variant Availability table (raw Av values)
    html += '<div class="drilldown-section"><h4 class="drilldown-section-title">Variant Availability</h4>';
    html += '<table class="data-table"><thead><tr><th>Variant</th><th>Availability</th><th>Tonnage</th></tr></thead><tbody>';
    
    // Sort by availability desc, then name
    const sorted = [...factionVariants].sort((a, b) => {
      if (b.availability !== a.availability) return b.availability - a.availability;
      return a.name.localeCompare(b.name);
    });
    
    for (const v of sorted) {
      const cls = xotlAvailClass(v.availability);
      html += `<tr><td><strong>${escHtml(v.variant)}</strong></td>`;
      html += `<td class="xotl-avail-cell ${cls}">${v.availability}</td>`;
      html += `<td class="stat-col">${v.tonnage || '—'}</td></tr>`;
    }
    html += '</tbody></table></div>';
    
    // Section 1b: Variant Distribution (probability-weighted bar chart)
    // Each variant's share = xotlToProb(Av) / sum(all variants' xotlToProb)
    const variantProbs = factionVariants.map(v => ({
      variant: v.variant,
      prob: xotlToProb(v.availability),
      tonnage: v.tonnage
    }));
    const probTotal = variantProbs.reduce((s, v) => s + v.prob, 0);
    
    if (variantProbs.length > 1 && probTotal > 0) {
      variantProbs.sort((a, b) => b.prob - a.prob);
      html += '<div class="drilldown-section"><h4 class="drilldown-section-title">Variants</h4>';
      for (const v of variantProbs) {
        const pct = (v.prob / probTotal * 100).toFixed(1);
        html += `
          <div class="variant-row">
            <span class="variant-name">${escHtml(v.variant)}</span>
            <div class="variant-bar-container">
              <div class="variant-bar" style="width:${pct}%"></div>
            </div>
            <span class="variant-pct">${pct}%</span>
          </div>
        `;
      }
      html += '</div>';
    }
  }
  
  // Section 2: Cross-Faction Comparison
  const allFactions = new Set();
  for (const factionMap of allVariantData.values()) {
    for (const fCode of Object.keys(factionMap)) allFactions.add(fCode);
  }
  const sortedFactions = [...allFactions].sort();
  
  // Highlight the selected faction column
  html += '<div class="drilldown-section"><h4 class="drilldown-section-title">Cross-Faction Comparison</h4>';
  html += '<table class="data-table xotl-comparison-table"><thead><tr><th>Variant</th>';
  for (const fCode of sortedFactions) {
    const highlight = fCode === faction ? ' style="background:var(--heat-3)"' : '';
    html += `<th${highlight}>${escHtml(fCode)}</th>`;
  }
  html += '</tr></thead><tbody>';
  
  const sortedVariants = [...allVariantData.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [variantName, factionMap] of sortedVariants) {
    html += `<tr><td><strong>${escHtml(variantName)}</strong></td>`;
    for (const fCode of sortedFactions) {
      const val = factionMap[fCode];
      if (val != null) {
        const cls = xotlAvailClass(val);
        const highlight = fCode === faction ? ` ${cls}` : cls;
        html += `<td class="xotl-avail-cell ${cls}">${val}</td>`;
      } else {
        html += '<td class="xotl-avail-cell na">—</td>';
      }
    }
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  
  content.innerHTML = html;
  overlay.classList.remove('hidden');
}

function showVariants(chassisName, faction, eraYear) {
  const overlay = document.getElementById('variant-overlay');
  const title = document.getElementById('variant-title');
  const content = document.getElementById('variant-content');
  
  // Find the chassis data
  const eraData = DATA.eraData[String(eraYear)];
  if (!eraData) return;
  
  // Respect global family mode from current query
  const bar = document.getElementById('query-bar');
  const currentQuery = parseQuery(bar?.value || '');
  const familiesGloballyOff = currentQuery.family === 'off';
  
  // Check if this is a family display name — if so, collect variants from ALL members
  let variants = null;
  let isFamily = false;
  
  for (const fam of DATA.families) {
    if (!familiesGloballyOff && fam.enabled &&
        (fam.groupName.replace(/ Family$/, '') === chassisName ||
        fam.groupName === chassisName)) {
      isFamily = true;
      for (const member of fam.chassis) {
        if (eraData[member]?.v) {
          variants = { ...(variants || {}), ...eraData[member].v };
        }
      }
      break;
    }
  }
  
  // If not a family, check direct chassis name
  if (!isFamily) {
    if (eraData[chassisName]?.v) {
      variants = eraData[chassisName].v;
    } else {
      // Check if it's a member of a family (fam field match)
      for (const [cn, data] of Object.entries(eraData)) {
        if (data.fam && data.fam.replace(/ Family$/, '') === chassisName) {
          if (data.v) {
            variants = { ...(variants || {}), ...data.v };
          }
        }
      }
    }
  }
  
  // Use exact year if specified, otherwise fall back to the era bucket year
  const targetYear = currentQuery.year || eraYear;
  
  // Mode X: Xotl RAT variant view
  const isModeX = currentQuery.mode === 'X';
  
  if (isModeX) {
    showVariantsXotl(chassisName, faction, eraYear, overlay, title, content);
    return;
  }
  
  // If no faction specified, show all variants with metadata only (no weight distribution)
  if (!faction) {
    title.textContent = `${chassisName} — All Variants (${eraYear})`;
    let html = '<div class="drilldown-section"><h4 class="drilldown-section-title">Variants</h4>';
    
    if (variants) {
      const variantList = Object.entries(variants)
        .filter(([vName, vData]) => {
          if (targetYear && vData.intro && vData.intro > targetYear) return false;
          return true;
        })
        .sort((a, b) => a[0].localeCompare(b[0]));
      
      for (const [vName, vData] of variantList) {
        const role = resolveVariantRole(chassisName, vName, vData.role) || '';
        const bvStr = vData.bv != null ? `<span class="variant-bv">BV ${vData.bv}</span>` : '';
        const introStr = vData.intro != null ? `<span class="variant-intro">${vData.intro}</span>` : '';
        const roleStr = `<span class="variant-role variant-role-btn" data-chassis="${escAttr(chassisName)}" data-variant="${escAttr(vName)}" data-role="${escAttr(role)}" title="Click to change role">${escHtml(role || 'None')}</span>`;
        const metaStr = `<span class="variant-meta">${roleStr}${bvStr}${introStr}</span>`;
        html += `<div class="variant-row"><span class="variant-name">${escHtml(vName)}</span>${metaStr}</div>`;
      }
      if (variantList.length === 0) {
        html += '<p class="drilldown-empty">No variants available in this era.</p>';
      }
    } else {
      html += '<p class="drilldown-empty">No variant data available.</p>';
    }
    html += '</div>';
    
    content.innerHTML = html;
    overlay.classList.remove('hidden');
    
    // Wire up role reassignment buttons
    content.querySelectorAll('.variant-role-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        content.querySelectorAll('.role-dropdown').forEach(d => d.remove());
        document.querySelectorAll('.role-dropdown').forEach(d => d.remove());
        showRoleDropdown(btn);
      });
    });
    return;
  }
  
  const { sorted, variantBV, variantIntro, variantRoles, total } = computeVariantDistribution(variants, faction, targetYear, chassisName);
  
  title.textContent = `${chassisName} — ${getFactionFullName(faction)}`;
  
  let html = '';

  // ── Rating Tiers Section ──
  // Find the raw weight entry for this faction (before resolving)
  // For families, collect entries from all members; show combined if mixed
  const rawEntries = [];
  const chassisNames = [];
  if (isFamily) {
    for (const fam of DATA.families) {
      if (fam.groupName.replace(/ Family$/, '') === chassisName || fam.groupName === chassisName) {
        for (const member of fam.chassis) {
          const memberData = eraData[member];
          if (memberData?.w?.[faction] !== undefined) {
            rawEntries.push({ name: member, entry: memberData.w[faction] });
            chassisNames.push(member);
          }
        }
        break;
      }
    }
  } else {
    const chData = eraData[chassisName];
    if (chData?.w?.[faction] !== undefined) {
      rawEntries.push({ name: chassisName, entry: chData.w[faction] });
      chassisNames.push(chassisName);
    }
  }

  const isClan = DATA.factions[faction]?.clan;
  const tierLabels = isClan
    ? ['PGC', 'Solahma', 'Second Line', 'Front Line', 'Keshik']
    : ['F (Garrison)', 'D', 'C', 'B', 'A (Elite)'];

  if (rawEntries.length === 0 && sorted.length === 0) {
    // Faction has no weight entry for this chassis at all
    html += `<div class="drilldown-section"><p class="drilldown-empty">${escHtml(getFactionFullName(faction))} does not field the ${escHtml(chassisName)} in this era.</p></div>`;
  }

  if (rawEntries.length > 0) {
    html += '<div class="drilldown-section"><h4 class="drilldown-section-title">Rating Tiers</h4>';

    for (const { name: entryName, entry } of rawEntries) {
      const showLabel = rawEntries.length > 1 ? `<span class="rating-chassis-label">${escHtml(entryName)}</span>` : '';

      if (Array.isArray(entry) && (entry[1] === 0 || entry[1] === '0' || !entry[1])) {
        // Flat — single line
        html += `<div class="rating-tier-row">${showLabel}
          <span class="rating-tier-label">All tiers</span>
          <div class="rating-tier-bar-container"><div class="rating-tier-bar" style="width:${entry[0] * 10}%"></div></div>
          <span class="rating-tier-value">${entry[0]}</span>
          <span class="rating-tier-mod">(flat)</span>
        </div>`;
      } else if (Array.isArray(entry)) {
        // + or - modifier — show all tiers top to bottom (A/Keshik first)
        const modLabel = entry[1] === '+' ? `${entry[0]}+` : `${entry[0]}−`;
        if (showLabel) html += `<div class="rating-chassis-header">${showLabel} <span class="rating-tier-mod">${modLabel}</span></div>`;
        else html += `<div class="rating-chassis-header"><span class="rating-tier-mod">${modLabel}</span></div>`;
        for (let i = NUM_LEVELS - 1; i >= 0; i--) {
          const val = resolveWeight(entry, i);
          html += `<div class="rating-tier-row">
            <span class="rating-tier-label">${tierLabels[i]}</span>
            <div class="rating-tier-bar-container"><div class="rating-tier-bar" style="width:${val * 10}%"></div></div>
            <span class="rating-tier-value">${val}</span>
          </div>`;
        }
        const avg = resolveWeight(entry, null);
        html += `<div class="rating-tier-row rating-tier-avg">
          <span class="rating-tier-label">Avg (default)</span>
          <div class="rating-tier-bar-container"></div>
          <span class="rating-tier-value">${avg.toFixed(1)}</span>
        </div>`;
      } else if (typeof entry === 'object' && entry !== null) {
        // Explicit per-level (Clan format)
        if (showLabel) html += `<div class="rating-chassis-header">${showLabel}</div>`;
        // Show levels from highest to lowest tier
        const levelEntries = Object.entries(entry);
        // Sort by tier index desc
        levelEntries.sort((a, b) => {
          const idxA = CLAN_LEVEL_INDEX[a[0]] ?? RATING_INDEX[a[0]] ?? -1;
          const idxB = CLAN_LEVEL_INDEX[b[0]] ?? RATING_INDEX[b[0]] ?? -1;
          return idxB - idxA;
        });
        for (const [levelName, val] of levelEntries) {
          html += `<div class="rating-tier-row">
            <span class="rating-tier-label">${escHtml(levelName)}</span>
            <div class="rating-tier-bar-container"><div class="rating-tier-bar" style="width:${val * 10}%"></div></div>
            <span class="rating-tier-value">${val}</span>
          </div>`;
        }
        const avg = resolveWeight(entry, null);
        html += `<div class="rating-tier-row rating-tier-avg">
          <span class="rating-tier-label">Avg (default)</span>
          <div class="rating-tier-bar-container"></div>
          <span class="rating-tier-value">${avg.toFixed(1)}</span>
        </div>`;
      } else if (typeof entry === 'number') {
        // Legacy plain number — flat
        html += `<div class="rating-tier-row">${showLabel}
          <span class="rating-tier-label">All tiers</span>
          <div class="rating-tier-bar-container"><div class="rating-tier-bar" style="width:${entry * 10}%"></div></div>
          <span class="rating-tier-value">${entry}</span>
          <span class="rating-tier-mod">(flat)</span>
        </div>`;
      }
    }
    html += '</div>';
  }

  // ── Weight Class Distribution Section ──
  const factionData = DATA.factions[faction];
  const wcdRaw = factionData?.wcd?.[String(eraYear)] || factionData?.wcd;
  // wcd can be keyed by era year or be a flat array (find closest era)
  let wcd = null;
  if (Array.isArray(wcdRaw)) {
    wcd = wcdRaw;
  } else if (wcdRaw && typeof wcdRaw === 'object') {
    // Find the closest era year <= current
    const years = Object.keys(wcdRaw).map(Number).sort((a, b) => a - b);
    for (const y of years) {
      if (y <= eraYear) wcd = wcdRaw[y];
    }
    if (!wcd && years.length > 0) wcd = wcdRaw[years[0]];
  }

  if (wcd && wcd.length === 4) {
    const wcdTotal = wcd.reduce((a, b) => a + b, 0);
    const classLabels = ['Light', 'Medium', 'Heavy', 'Assault'];
    // Determine which class this chassis belongs to
    let chassisClass = null;
    // Check all chassis names involved (family or single)
    for (const cn of chassisNames) {
      const meta = DATA.chassis[cn];
      if (meta?.class) { chassisClass = meta.class; break; }
    }

    html += `<div class="drilldown-section"><h4 class="drilldown-section-title">${escHtml(getFactionFullName(faction))} Force Composition</h4>`;
    for (let i = 0; i < 4; i++) {
      const pct = wcdTotal > 0 ? (wcd[i] / wcdTotal * 100) : 0;
      const isActive = chassisClass === classLabels[i];
      html += `<div class="wcd-row${isActive ? ' wcd-active' : ''}">
        <span class="wcd-label">${classLabels[i]}${isActive ? ' ◂' : ''}</span>
        <div class="wcd-bar-container"><div class="wcd-bar" style="width:${pct}%"></div></div>
        <span class="wcd-pct">${pct.toFixed(0)}%</span>
      </div>`;
    }
    html += '</div>';
  }

  // ── Variant Breakdown Section ──
  if (sorted.length > 0) {
    html += '<div class="drilldown-section"><h4 class="drilldown-section-title">Variants</h4>';
    for (const [varName, w] of sorted) {
      const pct = (w / total * 100).toFixed(1);
      const bvStr = variantBV[varName] != null ? `<span class="variant-bv">BV ${variantBV[varName]}</span>` : '';
      const introStr = variantIntro[varName] != null ? `<span class="variant-intro">${variantIntro[varName]}</span>` : '';
      const vRole = variantRoles[varName] || '';
      const roleStr = `<span class="variant-role variant-role-btn" data-chassis="${escAttr(chassisName)}" data-variant="${escAttr(varName)}" data-role="${escAttr(vRole)}" title="Click to change role">${escHtml(vRole || 'None')}</span>`;
      const metaStr = `<span class="variant-meta">${roleStr}${bvStr}${introStr}</span>`;
      html += `
        <div class="variant-row">
          <span class="variant-name">${escHtml(varName)}</span>
          ${metaStr}
          <div class="variant-bar-container">
            <div class="variant-bar" style="width:${pct}%"></div>
          </div>
          <span class="variant-pct">${pct}%</span>
        </div>
      `;
    }
    html += '</div>';
  }

  // ── Sub-Command Availability Section ──
  // Show sub-faction weights for this chassis+faction+era if they exist
  const subfactionData = getSubFactionData(chassisNames, faction, eraYear);
  if (subfactionData && Object.keys(subfactionData).length > 0) {
    html += '<div class="drilldown-section"><h4 class="drilldown-section-title">Sub-Command Availability</h4>';
    
    // Sort sub-factions by weight (highest first)
    const sortedSubFactions = Object.entries(subfactionData)
      .sort((a, b) => b[1] - a[1]);
    
    // Find max weight for bar scaling
    const maxWeight = Math.max(...Object.values(subfactionData));
    
    for (const [subFactionCode, weight] of sortedSubFactions) {
      const barWidth = maxWeight > 0 ? (weight / maxWeight * 100) : 0;
      const sfFullName = DATA.sfNames?.[subFactionCode] || '';
      const tooltipAttr = sfFullName ? ` title="${escAttr(sfFullName)}"` : '';
      html += `
        <div class="subfaction-row">
          <span class="subfaction-name"${tooltipAttr}>${escHtml(subFactionCode)}${sfFullName ? `<span class="subfaction-fullname">${escHtml(sfFullName)}</span>` : ''}</span>
          <div class="subfaction-bar-container">
            <div class="subfaction-bar" style="width:${barWidth}%"></div>
          </div>
          <span class="subfaction-weight">${weight}</span>
        </div>
      `;
    }
    html += '</div>';
  }
  
  content.innerHTML = html;
  overlay.classList.remove('hidden');

  // Wire up variant role reassignment buttons
  content.querySelectorAll('.variant-role-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.role-dropdown').forEach(d => d.remove());
      showRoleDropdown(btn);
    });
  });
}

function handleCellClick(e) {
  // Faction-specific drill-down (clicking a faction weight/sig cell)
  const factionCell = e.target.closest('[data-chassis][data-faction]');
  if (factionCell) {
    showVariants(factionCell.dataset.chassis, factionCell.dataset.faction, currentEraYear);
    return;
  }
  // Chassis-level drill-down (clicking name/tons/role/bv cells)
  const chassisCell = e.target.closest('[data-chassis]');
  if (chassisCell) {
    showVariants(chassisCell.dataset.chassis, null, currentEraYear);
    return;
  }
}

/**
 * Resolve sort spec for a header click. Split-cell columns (DR | Prob)
 * cycle through 4 states: DR desc → Prob desc → DR asc → Prob asc.
 * Regular columns toggle desc/asc.
 */
function resolveHeaderSort(th) {
  const field = th.dataset.sort;
  const isSplit = th.dataset.split;
  
  if (isSplit) {
    const fCode = field.replace(/-(sig|dr|signature|distinctiveness)$/, '');
    const fLabel = getFactionLabel(fCode);
    const probField = fCode + '-prob';
    const cmbField = fCode + '-cmb';
    
    // 3-state cycle: 0=DR desc, 1=Prob desc, 2=Cmb desc
    const state = parseInt(th.dataset.splitState || '-1');
    const nextState = (state + 1) % 3;
    th.dataset.splitState = nextState;
    
    const headers = [
      `${fLabel} DR\u25BC | Prob | Cmb`,
      `${fLabel} DR | Prob\u25BC | Cmb`,
      `${fLabel} DR | Prob | Cmb\u25BC`,
    ];
    th.textContent = headers[nextState];
    
    const specs = [
      [{ field, dir: 'desc' }, { field: probField, dir: 'desc' }],
      [{ field: probField, dir: 'desc' }, { field, dir: 'desc' }],
      [{ field: cmbField, dir: 'desc' }],
    ];
    return { sort: specs[nextState], dir: 'desc' };
  } else {
    // Regular column: simple desc/asc toggle
    // "Natural" columns (name, tonnage, bv) default to asc first; score columns default to desc
    const ascFirst = ['name', 'chassis', 'tonnage', 'tons', 'bv', 'battlevalue', 'class'].includes(field);
    const wasAsc = th.classList.contains('sorted-asc');
    const wasDesc = th.classList.contains('sorted-desc');
    let dir;
    if (!wasAsc && !wasDesc) {
      dir = ascFirst ? 'asc' : 'desc';
    } else {
      dir = wasDesc ? 'asc' : 'desc';
    }
    return { sort: [{ field, dir }], dir };
  }
}

function handleHeaderSort(th, rows, scopedFactions, eraYear, query) {
  // Clear sort indicators and split state on OTHER headers (not th itself — resolveHeaderSort reads it)
  th.closest('thead').querySelectorAll('th').forEach(h => {
    if (h !== th) {
      h.classList.remove('sorted-asc', 'sorted-desc');
      delete h.dataset.splitState;
      if (h.dataset.split) {
        const fCode = h.dataset.sort.replace(/-(sig|dr|signature|distinctiveness)$/, '');
        h.textContent = getFactionLabel(fCode) + ' DR | Prob | Cmb';
      }
    }
  });
  
  const { sort, dir } = resolveHeaderSort(th);
  // Now replace th's class with the new direction
  th.classList.remove('sorted-asc', 'sorted-desc');
  th.classList.add(dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
  
  // Update query sort
  const newQuery = { ...query, sort };
  
  // Re-sort and re-render
  const sorted = [...rows];
  sortRowsInPlace(sorted, sort);
  renderFactionComparison(sorted, scopedFactions, eraYear, newQuery);
}

// ── Auto-Suggest ──

const FIELD_NAMES = ['faction', 'chassis', 'class', 'type', 'tech', 'role', 'spread', 'sig', 'signature', 'dr', 'distinctiveness', 'weight', 'tons', 'tonnage', 'bv', 'prob', 'bw', 'cmb', 'combined', 'year', 'era', 'rating', 'family', 'industrial', 'mode', 'sort'];

function getSuggestions(text, cursorPos) {
  if (!DATA) return [];
  
  const beforeCursor = text.slice(0, cursorPos);
  const suggestions = [];
  
  // Check what we're completing
  const lastToken = beforeCursor.split(/\s+/).pop() || '';
  
  // Check for "field value" pattern (space-separated, no operator)
  // e.g. "chassis atl" → suggest chassis values matching "atl"
  const spaceMatch = beforeCursor.match(/^(\w[\w-]*)\s+(.+)$/);
  if (spaceMatch) {
    const field = spaceMatch[1].toLowerCase();
    const partial = spaceMatch[2].trim().toLowerCase();
    const VALUE_FIELD_SET = new Set(['faction', 'chassis', 'class', 'type', 'tech', 'role', 'year', 'era', 'rating', 'family', 'industrial', 'mode']);
    if (VALUE_FIELD_SET.has(field) && partial) {
      // Fake an eq match and fall through to value completion
      return getValueSuggestions(field, partial);
    }
  }

  // Sort context: "sort by <partial>" → suggest sortable fields without operators
  const sortByMatch = beforeCursor.match(/\bsort\s+by\s+(\S*)$/i);
  if (sortByMatch) {
    const partial = sortByMatch[1].toLowerCase();
    const sortableFields = ['spread', 'sig', 'dr', 'weight', 'tons', 'bv', 'name', 'role', 'class', 'type', 'tech', 'prob', 'cmb'];
    // Add faction-prefixed sort fields
    if (DATA) {
      for (const code of Object.keys(DATA.factions)) {
        sortableFields.push(code + '-sig');
        sortableFields.push(code + '-weight');
        sortableFields.push(code + '-prob');
        sortableFields.push(code + '-cmb');
      }
    }
    return sortableFields
      .filter(f => f.toLowerCase().startsWith(partial) && f.toLowerCase() !== partial)
      .slice(0, 10)
      .map(f => ({ text: f + ' desc', hint: 'sort' }));
  }

  // Field name completion
  const VALUE_FIELD_SET = new Set(['faction', 'chassis', 'class', 'type', 'tech', 'role', 'year', 'era', 'rating', 'family', 'industrial', 'mode']);
  const OPERATOR_FIELD_SET = new Set(['spread', 'sig', 'signature', 'dr', 'distinctiveness', 'weight', 'tons', 'tonnage', 'bv', 'battlevalue', 'prob', 'bw', 'cmb', 'combined']);

  if (!lastToken.includes('=') && !lastToken.includes('>') && !lastToken.includes('<')) {
    const lower = lastToken.toLowerCase();
    for (const field of FIELD_NAMES) {
      if (field.startsWith(lower) && field !== lower) {
        // Choose appropriate operator suffix
        if (VALUE_FIELD_SET.has(field)) {
          suggestions.push({ text: field + '=', hint: 'field' });
        } else if (OPERATOR_FIELD_SET.has(field)) {
          suggestions.push({ text: field + '>', hint: 'filter' });
        } else {
          suggestions.push({ text: field + '=', hint: 'field' });
        }
      }
    }
    // Faction-prefixed fields: dc-sig, fs-weight, etc.
    const fpMatch = lower.match(/^([a-z]+)-(s|si|sig|w|we|wei|weig|weigh|weight|p|pr|pro|prob)?$/);
    if (fpMatch && DATA) {
      const fCode = resolveFaction(fpMatch[1]);
      if (fCode && DATA.factions[fCode]) {
        const partial2 = fpMatch[2] || '';
        if ('dr'.startsWith(partial2) || 'sig'.startsWith(partial2)) suggestions.push({ text: fCode + '-dr>', hint: fCode + ' distinctiveness' });
        if ('weight'.startsWith(partial2)) suggestions.push({ text: fCode + '-weight>', hint: fCode + ' weight' });
        if ('prob'.startsWith(partial2)) suggestions.push({ text: fCode + '-prob>', hint: fCode + ' probability' });
      }
    }
    // Also suggest "sort by"
    if ('sort'.startsWith(lower)) {
      suggestions.push({ text: 'sort by ', hint: 'sorting' });
    }
    return suggestions.slice(0, 10);
  }
  
  // Value completion after =
  const eqMatch = lastToken.match(/^(\w[\w-]*)([=!<>]+)(.*)$/);
  if (eqMatch) {
    const [, field, op, partial] = eqMatch;
    const lower = (partial || '').toLowerCase().replace(/^\(/, '');
    return getValueSuggestions(field.toLowerCase(), lower);
  }
  
  return suggestions;
}

function getValueSuggestions(field, lower) {
  if (!DATA) return [];
  switch (field) {
    case 'faction': {
      const items = [
        { text: 'GreatHouses', hint: 'DC, FS, FWL, LC, CC' },
        { text: 'InnerSphere', hint: 'All IS factions (non-Clan, non-Periphery)' },
        { text: 'Clans', hint: 'All Clan factions' },
        { text: 'InvasionClans', hint: 'CW, CJF, CGB, CSJ' },
        { text: 'ISClans', hint: 'Clans in the IS (incl. CWIE, CWE, RD, RA)' },
        { text: 'HomeClans', hint: 'Homeworld Clans (incl. CCC, CB, CMG, CWI...)' },
        { text: 'Periphery', hint: 'TC, MH, OA, MC, MOC, CDP, FVC...' },
        { text: 'FWLStates', hint: 'FWL breakup: DA, DO, DTA, MSC, OP, RF, RCM, PR, MCM' },
      ];
      for (const [code, info] of Object.entries(DATA.factions)) {
        items.push({ text: code, hint: info.name });
      }
      return items.filter(i => i.text.toLowerCase().startsWith(lower) || i.hint.toLowerCase().includes(lower)).slice(0, 12);
    }
    case 'chassis': {
      // Union of all chassis across all eras so extinct chassis are still suggested
      const allNames = new Set();
      for (const eraKey of Object.keys(DATA.eraData)) {
        for (const name of Object.keys(DATA.eraData[eraKey])) {
          allNames.add(name);
        }
      }
      const names = [...allNames].sort();
      const results = names.filter(n => n.toLowerCase().includes(lower))
        .slice(0, 10)
        .map(n => {
          const meta = DATA.chassis[n];
          const hint = meta?.class || '';
          return { text: n, hint };
        });
      // Also suggest from aliases (Clan names, IS reporting names)
      if (results.length < 10) {
        const aliases = getChassisAliases();
        const seen = new Set(results.map(r => r.text));
        for (const [alias, target] of Object.entries(aliases)) {
          if (alias.includes(lower) && !seen.has(target)) {
            seen.add(target);
            results.push({ text: target, hint: `(${alias})` });
            if (results.length >= 12) break;
          }
        }
      }
      return results;
    }
    case 'class':
      return ['Light', 'Medium', 'Heavy', 'Assault']
        .filter(c => c.toLowerCase().startsWith(lower))
        .map(c => ({ text: c, hint: '' }));
    case 'era':
      return DATA.eras
        .filter((e, i, arr) => arr.findIndex(x => x.mulEra === e.mulEra) === i)
        .filter(e => e.mulEra.toLowerCase().includes(lower) || e.label.toLowerCase().includes(lower))
        .slice(0, 10)
        .map(e => ({ text: e.mulEra, hint: e.label }));
    case 'rating':
      return [
        { text: 'A', hint: 'Elite / Keshik' },
        { text: 'B', hint: 'Veteran / Front Line' },
        { text: 'C', hint: 'Regular / Second Line' },
        { text: 'D', hint: 'Green / Solahma' },
        { text: 'F', hint: 'Garrison / PGC' }
      ].filter(i => i.text.toLowerCase().startsWith(lower));
    case 'mode':
      return [{ text: 'A', hint: 'MegaMek Only' }, { text: 'B', hint: 'MegaMek × MUL' }, { text: 'X', hint: 'Xotl RAT' }];
    case 'family':
      return [{ text: 'on', hint: 'Merge families' }, { text: 'off', hint: 'Individual chassis' }];
    case 'type':
      return [{ text: 'omni', hint: 'OmniMechs only' }, { text: 'battlemech', hint: 'BattleMechs only' }]
        .filter(i => i.text.startsWith(lower));
    case 'tech':
      return [{ text: 'clan', hint: 'Clan tech' }, { text: 'is', hint: 'Inner Sphere' }, { text: 'mixed', hint: 'Mixed tech' }]
        .filter(i => i.text.startsWith(lower));
    case 'role':
      return getRoleTaxonomy()
        .map(r => ({ text: r.toLowerCase(), hint: r }))
        .filter(i => i.text.startsWith(lower));
    case 'industrial':
      return [{ text: 'show', hint: '' }, { text: 'hide', hint: '' }];
  }
  return [];
}

// ── Filter Chips ──

function renderChips(parsed) {
  const container = document.getElementById('filter-chips');
  container.innerHTML = '';
  
  const chips = [];
  
  if (parsed.factions.length > 0) {
    chips.push({ label: 'faction=' + parsed.factions.join(' OR '), field: 'faction' });
  }
  if (parsed.chassis.length > 0) {
    chips.push({ label: 'chassis=' + parsed.chassis.join(' OR '), field: 'chassis' });
  }
  if (parsed.class) chips.push({ label: 'class' + parsed.class.op + parsed.class.values.join(' OR '), field: 'class' });
  if (parsed.type) chips.push({ label: 'type' + parsed.type.op + parsed.type.value, field: 'type' });
  if (parsed.tech) chips.push({ label: 'tech' + parsed.tech.op + parsed.tech.value, field: 'tech' });
  if (parsed.role) chips.push({ label: 'role' + parsed.role.op + parsed.role.value, field: 'role' });
  if (parsed.spread) chips.push({ label: `spread${parsed.spread.op}${parsed.spread.val}`, field: 'spread' });
  if (parsed.span) chips.push({ label: `span${parsed.span.op}${parsed.span.val}`, field: 'span' });
  // avg-weight and span still parseable but no chip/column
  if (parsed.weight) chips.push({ label: `weight${parsed.weight.op}${parsed.weight.val}`, field: 'weight' });
  if (parsed.sig) chips.push({ label: `sig${parsed.sig.op}${parsed.sig.val}`, field: 'sig' });
  if (parsed.tons) chips.push({ label: `tons${parsed.tons.op}${parsed.tons.val}`, field: 'tons' });
  for (const bvCond of parsed.bv) {
    chips.push({ label: `bv${bvCond.op}${bvCond.val}`, field: 'bv' });
  }
  for (const fw of parsed.factionWeight) {
    chips.push({ label: `${fw.faction}-weight${fw.op}${fw.val}`, field: `${fw.faction.toLowerCase()}-weight` });
  }
  for (const fs of parsed.factionSig) {
    chips.push({ label: `${fs.faction}-sig${fs.op}${fs.val}`, field: `${fs.faction.toLowerCase()}-sig` });
  }
  if (parsed.prob) chips.push({ label: `prob${parsed.prob.op}${parsed.prob.val}`, field: 'prob' });
  for (const fp of parsed.factionProb) {
    chips.push({ label: `${fp.faction}-prob${fp.op}${fp.val}`, field: `${fp.faction.toLowerCase()}-prob` });
  }
  if (parsed.combined) chips.push({ label: `cmb${parsed.combined.op}${parsed.combined.val}`, field: 'cmb' });
  for (const fc of parsed.factionCmb) {
    chips.push({ label: `${fc.faction}-cmb${fc.op}${fc.val}`, field: `${fc.faction.toLowerCase()}-cmb` });
  }
  if (parsed.year) chips.push({ label: 'year=' + parsed.year, field: 'year' });
  if (parsed.era) chips.push({ label: 'era=' + parsed.era, field: 'era' });
  if (parsed.rating) {
    const rLabel = Array.isArray(parsed.rating) ? parsed.rating.join('+') : parsed.rating;
    chips.push({ label: 'rating=' + rLabel, field: 'rating' });
  }
  if (parsed.mode !== 'B') chips.push({ label: 'mode=' + parsed.mode, field: 'mode' });
  if (parsed.sort.length > 0) {
    chips.push({ label: 'sort by ' + parsed.sort.map(s => s.field + ' ' + s.dir).join(', '), field: 'sort' });
  }
  
  for (const chip of chips) {
    const el = document.createElement('span');
    el.className = 'chip';
    el.innerHTML = `${escHtml(chip.label)} <span class="chip-remove" data-field="${chip.field}">×</span>`;
    container.appendChild(el);
  }
}

function removeFieldFromQuery(field) {
  const bar = document.getElementById('query-bar');
  // Re-parse to get the normalized query and raw match for this field
  const parsed = parseQuery(bar.value);
  const raw = parsed.rawMatches[field];
  if (!raw) {
    // Field already removed or not found — nothing to do
    return;
  }
  // Remove the raw match from the normalized query (which the parser already cleaned up)
  let q = parsed.normalizedQuery || bar.value;
  // Re-add sort clause if it exists and we're not removing sort
  if (field !== 'sort' && parsed.rawMatches.sort) {
    q = q + ' ' + parsed.rawMatches.sort;
  }
  const idx = q.indexOf(raw);
  if (idx !== -1) {
    q = (q.slice(0, idx) + q.slice(idx + raw.length)).replace(/\s+/g, ' ').trim();
  }
  bar.value = q;
  runQuery();
}

// ── HTML Helpers ──

function formatTonnage(meta) {
  const t = meta.tons;
  const tMax = meta.tonsMax;
  const cls = meta.class || '';
  if (t == null) return '?t';
  if (tMax != null && tMax !== t) {
    return `${t}-${tMax}t`;
  }
  return `${t}t`;
}

function formatClass(meta) {
  return meta.class || '';
}

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(s) {
  return escHtml(s);
}

// ── Main Execution ──

let currentEraYear = 3049;
let currentMode = 'B'; // 'A', 'B', or 'X' — set by runQuery, used by render helpers
let currentPage = 0;
let variantRoleChanged = false; // track if a role was reassigned in the drill-down overlay
const PAGE_SIZES = [25, 50, 100, 0]; // 0 = all
const PAGE_SIZE_KEY = 'bt-sig-page-size';

function getPageSize() {
  const saved = localStorage.getItem(PAGE_SIZE_KEY);
  return saved ? parseInt(saved) : 50;
}

function setPageSize(size) {
  localStorage.setItem(PAGE_SIZE_KEY, String(size));
}

function paginateRows(rows, page, pageSize) {
  if (!pageSize || pageSize <= 0) return { pageRows: rows, totalPages: 1, page: 0 };
  const totalPages = Math.ceil(rows.length / pageSize);
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * pageSize;
  return { pageRows: rows.slice(start, start + pageSize), totalPages, page: safePage };
}

function renderPagination(container, totalRows, currentPg, totalPages, onPageChange) {
  const pageSize = getPageSize();
  
  // Remove existing pagination bar if present
  const existing = container.querySelector('.pagination-bar');
  if (existing) existing.remove();
  
  if (totalRows <= 25) return; // No pagination needed for small results
  
  const bar = document.createElement('div');
  bar.className = 'pagination-bar';
  
  // Page size selector
  let html = '<span class="page-size-select">Show: ';
  for (const size of PAGE_SIZES) {
    const label = size === 0 ? 'All' : String(size);
    const active = (size === pageSize) || (size === 0 && pageSize === 0);
    html += `<button class="page-size-btn${active ? ' active' : ''}" data-size="${size}">${label}</button>`;
  }
  html += '</span>';
  
  // Page info + nav
  if (pageSize > 0 && totalPages > 1) {
    const start = currentPg * pageSize + 1;
    const end = Math.min((currentPg + 1) * pageSize, totalRows);
    html += `<span class="page-info">${start}–${end} of ${totalRows}</span>`;
    html += `<span class="page-nav">`;
    html += `<button class="page-btn" data-page="0" ${currentPg === 0 ? 'disabled' : ''}>«</button>`;
    html += `<button class="page-btn" data-page="${currentPg - 1}" ${currentPg === 0 ? 'disabled' : ''}>‹</button>`;
    html += `<button class="page-btn" data-page="${currentPg + 1}" ${currentPg >= totalPages - 1 ? 'disabled' : ''}>›</button>`;
    html += `<button class="page-btn" data-page="${totalPages - 1}" ${currentPg >= totalPages - 1 ? 'disabled' : ''}>»</button>`;
    html += `</span>`;
  } else {
    html += `<span class="page-info">${totalRows} results</span>`;
  }
  
  bar.innerHTML = html;
  container.appendChild(bar);
  
  // Event handlers
  bar.addEventListener('click', (e) => {
    const sizeBtn = e.target.closest('.page-size-btn');
    if (sizeBtn) {
      const newSize = parseInt(sizeBtn.dataset.size);
      setPageSize(newSize);
      currentPage = 0;
      onPageChange(0);
      return;
    }
    const pageBtn = e.target.closest('.page-btn');
    if (pageBtn && !pageBtn.disabled) {
      const newPage = parseInt(pageBtn.dataset.page);
      currentPage = newPage;
      onPageChange(newPage);
    }
  });
}

async function runQuery() {
  currentPage = 0; // Reset pagination on new query
  const bar = document.getElementById('query-bar');
  const queryStr = bar.value.trim();
  
  const landing = document.getElementById('landing');
  const viewContainer = document.getElementById('view-container');
  const statusText = document.getElementById('status-text');
  const modeIndicator = document.getElementById('mode-indicator');
  
  const columnLegend = document.getElementById('column-legend');
  
  if (!queryStr) {
    landing.style.display = '';
    viewContainer.classList.add('hidden');
    document.getElementById('col-vis-bar').classList.add('hidden');
    if (columnLegend) columnLegend.classList.add('hidden');
    document.getElementById('filter-chips').innerHTML = '';
    statusText.textContent = '';
    return;
  }
  
  const parsed = parseQuery(queryStr);
  
  // Lazy-load Xotl data if Mode X is active
  if (parsed.mode === 'X' && !xotlData) {
    statusText.textContent = 'Loading Xotl RAT data…';
    try {
      await loadXotlData();
    } catch (e) {
      statusText.textContent = 'Error loading Xotl data: ' + e.message;
      return;
    }
    statusText.textContent = '';
  }
  
  landing.style.display = 'none';
  if (columnLegend) columnLegend.classList.remove('hidden');
  
  renderChips(parsed);
  
  // Update mode indicator
  modeIndicator.textContent = parsed.mode === 'A' ? 'Mode A (MegaMek Only)' : parsed.mode === 'X' ? 'Mode X (Xotl RAT)' : 'Mode B (MegaMek × MUL)';
  
  // Determine era
  let eraYear = null;
  let eraExplicit = false; // true if user explicitly set year or era
  let eraAdjustMsg = null; // auto-adjust info message
  if (parsed.year) {
    eraYear = getEraYear(parsed.year);
    eraExplicit = true;
  } else if (parsed.era) {
    const eraEntry = DATA.eras.find(e => 
      e.mulEra?.toLowerCase() === parsed.era.toLowerCase() ||
      e.label.toLowerCase().includes(parsed.era.toLowerCase())
    );
    if (eraEntry) eraYear = eraEntry.year;
    eraExplicit = true;
  }
  
  const scopedFactions = parsed.factions;
  const chassisFilter = parsed.chassis.map(c => resolveChassis(c));
  
  if (!eraYear) {
    // No explicit era — try auto-adjust based on filters
    const autoAdj = findAutoAdjustEra(chassisFilter, scopedFactions);
    if (autoAdj) {
      eraYear = autoAdj.year;
      eraAdjustMsg = autoAdj.message;
    } else {
      eraYear = 3049;
    }
  }
  currentEraYear = eraYear;
  currentMode = parsed.mode || 'B';
  
  const familyMode = parsed.family || 'off';
  const modeB = parsed.mode !== 'A' && parsed.mode !== 'X';
  const hideIndustrial = parsed.industrial !== 'show'; // hidden by default
  
  const chassisData = getChassisForEra(String(eraYear), familyMode);
  
  // Resolve unit quality rating indices (same for all chassis)
  let ratingIdx = null;
  let multiRatingIdxs = null;
  let probRatingIdx = null; // for entryToProb: null=all tiers, number=single, array=multi
  if (Array.isArray(parsed.rating)) {
    multiRatingIdxs = parsed.rating.map(r => RATING_INDEX[r]);
    probRatingIdx = multiRatingIdxs;
  } else if (parsed.rating) {
    ratingIdx = RATING_INDEX[parsed.rating];
    probRatingIdx = ratingIdx;
  }

  // Build rows
  const rows = [];
  for (let [chassisName, data] of Object.entries(chassisData)) {
    // Chassis filter
    if (chassisFilter.length > 0) {
      const matches = chassisFilter.some(cf => {
        const lower = cf.toLowerCase();
        return chassisName.toLowerCase() === lower || chassisName.toLowerCase().includes(lower);
      });
      if (parsed.chassisOp === '!=') {
        if (matches) continue;  // Exclude matching chassis
      } else {
        if (!matches) continue; // Include only matching chassis
      }
    }
    
    const meta = data._meta || DATA.chassis[chassisName] || {};
    
    if (parsed.class) {
      const metaClasses = meta.class ? meta.class.toLowerCase().split('/').map(c => c.trim()) : [];
      const matchesClass = metaClasses.some(c => parsed.class.values.includes(c));
      if (parsed.class.op === '!=') {
        if (matchesClass) continue;  // Exclude matching classes
      } else {
        if (!matchesClass) continue; // Include only matching classes
        if (metaClasses.length === 0) continue;
      }
    }
    
    // Hide incomplete chassis (no tonnage data) unless user opted in
    if (!getShowIncomplete() && meta.tons == null) continue;
    if (hideIndustrial && meta.industrial) continue;
    if (/\bLAM\b/.test(chassisName)) continue; // LAMs always hidden for now
    if (parsed.type) {
      const typeVal = parsed.type.value;
      const typeNeg = parsed.type.op === '!=';
      let typeMatch = false;
      if (typeVal === 'omni') typeMatch = !!meta.omni;
      else if (typeVal === 'battlemech') typeMatch = !meta.omni && !meta.industrial;
      if (typeNeg ? typeMatch : !typeMatch) continue;
    }
    if (parsed.tech) {
      // Variant-level tech filtering: only include variants whose tech matches,
      // and skip the chassis entirely if no variants pass.
      const techVal = parsed.tech.value;
      const techNeg = parsed.tech.op === '!=';
      if (data.v) {
        const filtered = filterVariantsByTech(data.v, techVal, meta.tech, techNeg);
        if (!filtered) continue; // no variants match → skip chassis
        data = { ...data, v: filtered }; // replace variants with filtered set
      } else {
        // No variant data — fall back to chassis-level tech check
        const matches = variantMatchesTech(meta.tech, techVal);
        if (techNeg ? matches : !matches) continue;
      }
    }
    if (parsed.role) {
      // Variant-level role filtering with OR and negation support
      // Parse OR values: "trooper" or "(trooper or scout)" or "(trooper or direct fire)"
      const roleRaw = parsed.role.value.replace(/^\(|\)$/g, '');
      const roleValues = roleRaw.split(/\s+or\s+/i).map(r => r.trim().toLowerCase());
      const roleNeg = parsed.role.op === '!=';
      
      if (data.v) {
        const filtered = {};
        let anyMatch = false;
        for (const [vName, vData] of Object.entries(data.v)) {
          const vRole = (resolveVariantRole(chassisName, vName, vData.role) || '').toLowerCase();
          const matches = roleValues.includes(vRole) || (roleValues.includes('none') && !vRole);
          if (roleNeg ? !matches : matches) {
            filtered[vName] = vData;
            anyMatch = true;
          }
        }
        if (!anyMatch) continue;
        data = { ...data, v: filtered };
      } else {
        const cRole = (resolveChassisRole(chassisName, meta.role, data.v, currentEraYear) || '').toLowerCase();
        // For chassis-level, check if any role component matches any filter value
        const cRoleParts = cRole.split('/').map(r => r.trim());
        const matches = cRoleParts.some(r => roleValues.includes(r)) || (roleValues.includes('none') && !cRole);
        if (roleNeg ? matches : !matches) continue;
      }
    }
    if (parsed.year && meta.intro && meta.intro > parsed.year) continue;
    if (parsed.tons) {
      // For families with a tonnage range, use the range for filtering
      const tMin = meta.tons;
      const tMax = meta.tonsMax || meta.tons;
      if (tMin != null) {
        // Range-aware: match if any tonnage in [min,max] could satisfy the filter
        const op = parsed.tons.op;
        const val = parsed.tons.val;
        let passes;
        if (op === '=' || op === '==') {
          // tons=60 matches if 60 is within [min, max]
          passes = val >= tMin && val <= tMax;
        } else if (op === '!=') {
          // tons!=60 matches if the range isn't exactly [60, 60]
          passes = tMin !== val || tMax !== val;
        } else {
          // For >, >=, <, <=: match if either endpoint satisfies
          passes = compareOp(tMin, op, val) || compareOp(tMax, op, val);
        }
        if (!passes) continue;
      }
    }
    
    // Resolve unit quality rating (no WCD adjustment — that's applied at display level)
    // Support single rating (string → index), multi-rating (array → average those tiers), or null (all-tier average)
    let ratingIdx = null;
    let multiRatingIdxs = null;
    let probRatingIdx = null; // for entryToProb: null=all tiers, number=single, array=multi
    if (Array.isArray(parsed.rating)) {
      multiRatingIdxs = parsed.rating.map(r => RATING_INDEX[r]);
      probRatingIdx = multiRatingIdxs;
    } else if (parsed.rating) {
      ratingIdx = RATING_INDEX[parsed.rating];
      probRatingIdx = ratingIdx;
    }
    let weights;
    if (multiRatingIdxs) {
      // Average across specified tiers
      const perTier = multiRatingIdxs.map(idx => computeResolvedWeights(data.w, idx));
      weights = {};
      const allKeys = new Set(perTier.flatMap(t => Object.keys(t)));
      for (const f of allKeys) {
        weights[f] = perTier.reduce((sum, t) => sum + (t[f] || 0), 0) / multiRatingIdxs.length;
      }
    } else {
      weights = computeResolvedWeights(data.w, ratingIdx);
    }
    // Mode X: replace MegaMek weights with Xotl RAT availability values
    let xotlProbWeights = null;
    if (parsed.mode === 'X') {
      const xotlW = buildXotlWeights(chassisName, eraYear, xotlData);
      if (xotlW === null) {
        // No Xotl coverage for this era — empty weights (all N/A)
        weights = {};
      } else {
        weights = xotlW;
        // Also compute sum-of-variant probs for share-of-force
        xotlProbWeights = buildXotlProbWeights(chassisName, eraYear, xotlData);
      }
    }
    if (modeB) {
      for (const f of Object.keys(weights)) {
        if (data.mul && !data.mul[f]) {
          // Don't zero factions that have sub-faction data — sub-commands field
          // this chassis even if the parent isn't MUL-listed (epsilon weight case)
          if (data.sf && data.sf[f]) continue;
          weights[f] = 0;
        } else if (!data.mul) {
          // No MUL data at all for this chassis — in Mode B, keep MegaMek data as-is
          // (permissive: no MUL data = no filter)
        }
      }
    }
    
    const activeFactions = scopedFactions.length > 0 ? scopedFactions : Object.keys(weights).filter(f => weights[f] > 0);
    const spread = scopedFactions.length > 1 ? computeSpread(weights, scopedFactions) : 0;
    const span = computeSpan(weights, activeFactions);
    const avgWeight = computeAvgWeight(weights, activeFactions);
    
    // Filters
    if (parsed.spread && !compareOp(spread, parsed.spread.op, parsed.spread.val)) continue;
    if (parsed.span && !compareOp(span, parsed.span.op, parsed.span.val)) continue;
    if (parsed.avgWeight && !compareOp(avgWeight, parsed.avgWeight.op, parsed.avgWeight.val)) continue;
    if (parsed.weight) {
      const checkFactions = scopedFactions.length > 0 ? scopedFactions : Object.keys(weights);
      const anyPass = checkFactions.some(f => compareOp(weights[f] || 0, parsed.weight.op, parsed.weight.val));
      if (!anyPass) continue;
    }
    
    // Faction-specific weight filter
    if (parsed.factionWeight.length > 0) {
      if (!parsed.factionWeight.every(fw => compareOp(weights[fw.faction] || 0, fw.op, fw.val))) continue;
    }
    
    const hasAnyWeight = (scopedFactions.length > 0 ? scopedFactions : Object.keys(weights)).some(f => (weights[f] || 0) > 0);
    if (!hasAnyWeight) continue;
    
    // Compute BV range from in-scope variants
    const bvRange = computeBVRange(data.v, scopedFactions, data.mul, modeB, parsed.year, weights);
    
    // Skip chassis with no BV data (IndustrialMechs, obscure designs without MUL entries)
    if (!bvRange) continue;
    
    // BV filter: chassis passes if any single in-scope variant satisfies ALL bv conditions
    if (parsed.bv.length > 0) {
      // Check if any individual BV value in the range satisfies all conditions
      const bvPass = bvRange.bvList.some(bv =>
        parsed.bv.every(cond => compareOp(bv, cond.op, cond.val))
      );
      if (!bvPass) continue;
    }
    
    rows.push({
      name: chassisName,
      meta,
      weights,
      rawW: data.w,  // raw entries with modifiers, for prob-space computation
      xotlProbWeights,  // Mode X: sum-of-variant probs for share-of-force
      spread,
      span,
      avgWeight,
      sig: null,
      bvRange,
      variants: data.v,
      mul: data.mul,
      family: data.fam,
      members: data._members
    });
  }
  
  // Compute global signature scores (weight × z-score)
  // Signature ALWAYS uses WCD mixing — even in single-class view — because sig
  // answers "how much does this mech belong to this faction?" which includes
  // weight class preferences (e.g. Lyran heavy bias boosts their heavy sigs).
  const allFactionCodes = Object.keys(DATA.factions);
  // Compute sig for scoped factions, or ALL fielding factions if none scoped
  const sigFactions = scopedFactions.length > 0 ? scopedFactions : null;
  {
    for (const row of rows) {
      const wcdParams = { chassisClass: row.meta?.class, eraYear };
      const factions = sigFactions || Object.keys(row.weights).filter(f => (row.weights[f] || 0) > 0);
      if (factions.length === 0) continue;
      row.sig = computeSignature(row.weights, row.mul || {}, factions, allFactionCodes, wcdParams, row.meta?.tech, row.rawW, probRatingIdx, parsed.mode === 'X');
    }
    
    // Compute tiers using GLOBAL Jenks Natural Breaks across all displayed factions.
    // This ensures a sig score of 8.0 is the same tier regardless of faction,
    // making cross-faction tier comparison meaningful.
    {
      const allSigValues = [];
      // Collect all sig values — from scoped factions, or all factions with sig data
      for (const row of rows) {
        if (!row.sig) continue;
        const factions = sigFactions || Object.keys(row.sig).filter(k => !k.includes('_') && row.sig[k] > 0);
        for (const f of factions) {
          const v = row.sig[f] || 0;
          if (v > 0) allSigValues.push(v);
        }
      }
      allSigValues.sort((a, b) => a - b);
      // Log-transform before Jenks to handle exponential sig distribution.
      // Finds natural breaks in log space, then maps breaks back to raw space.
      const logValues = allSigValues.map(v => Math.log2(v));
      const logBreaks = logValues.length > 0 ? jenksBreaks(logValues, 5) : [];
      const breaks = logBreaks.map(b => Math.pow(2, b));
      for (const row of rows) {
        if (!row.sig) continue;
        const factions = sigFactions || Object.keys(row.sig).filter(k => !k.includes('_') && row.sig[k] > 0);
        for (const f of factions) {
          const v = row.sig[f] || 0;
          if (v > 0) {
            row.sig[f + '_tier'] = assignTierFromBreaks(v, breaks);
          }
        }
      }
    }
  }
  
  // Compute biased weights (probability-space weight × WCD mixing factor)
  // Mode X: uses sum-of-variant xotlToProb (not max-Av) for share-of-force
  const isModeX = parsed.mode === 'X';
  for (const row of rows) {
    row.biasedWeights = {};
    if (isModeX && row.xotlProbWeights) {
      // Mode X: use pre-computed sum of variant probabilities × WCD
      for (const f of Object.keys(row.xotlProbWeights)) {
        const prob = row.xotlProbWeights[f];
        if (prob <= 0) { row.biasedWeights[f] = 0; continue; }
        const mixFactor = getWcdMixingFactor(f, row.meta?.class, eraYear);
        row.biasedWeights[f] = prob * mixFactor;
      }
    } else {
      for (const f of Object.keys(row.weights)) {
        const w = row.weights[f];
        if (w <= 0) { row.biasedWeights[f] = 0; continue; }
        const prob = row.rawW?.[f] ? entryToProb(row.rawW[f], probRatingIdx) : toProb(w);
        const mixFactor = getWcdMixingFactor(f, row.meta?.class, eraYear);
        row.biasedWeights[f] = prob * mixFactor;
      }
    }
  }
  
  // Normalize biased weights per faction to [0, 1] range (share-of-force).
  // Both modes: xotlToProb produces actual frequency fractions (0.005–0.25),
  // MegaMek's toProb produces probability-space weights (1.4–32).
  // Normalizing per faction makes prob = share-of-force in both modes,
  // which is the correct interpretation regardless of data source.
  {
    const factionSumBw = {};
    for (const row of rows) {
      for (const [f, bw] of Object.entries(row.biasedWeights)) {
        factionSumBw[f] = (factionSumBw[f] || 0) + bw;
      }
    }
    for (const row of rows) {
      for (const f of Object.keys(row.biasedWeights)) {
        const sum = factionSumBw[f] || 1;
        row.biasedWeights[f] = sum > 0 ? row.biasedWeights[f] / sum : 0;
      }
    }
  }
  
  // Compute combined scores (min-max normalized DR + Prob within result set)
  // Combo = norm_dr + norm_prob, range [0, 2.0]
  // Both DR and prob are min-max normalized within the current filtered result set.
  // This ensures the equivalence property: medium+medium = high+low = low+high.
  // Edge case: if all values equal (no range), norm = 0.5 (neutral).
  {
    // Find min/max per faction across all rows
    const factionDrRange = {};
    const factionProbRange = {};
    for (const row of rows) {
      for (const f of Object.keys(row.weights)) {
        const dr = row.sig?.[f] || 0;
        const bw = row.biasedWeights?.[f] || 0;
        if (!factionDrRange[f]) factionDrRange[f] = { min: Infinity, max: -Infinity };
        if (!factionProbRange[f]) factionProbRange[f] = { min: Infinity, max: -Infinity };
        if (dr < factionDrRange[f].min) factionDrRange[f].min = dr;
        if (dr > factionDrRange[f].max) factionDrRange[f].max = dr;
        if (bw < factionProbRange[f].min) factionProbRange[f].min = bw;
        if (bw > factionProbRange[f].max) factionProbRange[f].max = bw;
      }
    }
    for (const row of rows) {
      row.combined = {};
      for (const f of Object.keys(row.weights)) {
        const dr = row.sig?.[f] || 0;
        const bw = row.biasedWeights?.[f] || 0;
        const drRange = factionDrRange[f];
        const probRange = factionProbRange[f];
        const drSpan = drRange.max - drRange.min;
        const probSpan = probRange.max - probRange.min;
        const normDr = drSpan > 0 ? (dr - drRange.min) / drSpan : 0.5;
        const normProb = probSpan > 0 ? (bw - probRange.min) / probSpan : 0.5;
        row.combined[f] = normDr + normProb;
      }
    }
  }
  
  // Apply post-computation filters (sig)
  if (parsed.sig || parsed.factionSig.length > 0) {
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      if (parsed.sig) {
        if (!row.sig) { rows.splice(i, 1); continue; }
        const sf = scopedFactions.length > 0 ? scopedFactions : Object.keys(row.sig);
        if (!sf.some(f => compareOp(row.sig[f] || 0, parsed.sig.op, parsed.sig.val))) {
          rows.splice(i, 1); continue;
        }
      }
      if (parsed.factionSig.length > 0) {
        if (!row.sig) { rows.splice(i, 1); continue; }
        if (!parsed.factionSig.every(fs => compareOp(row.sig[fs.faction] || 0, fs.op, fs.val))) {
          rows.splice(i, 1); continue;
        }
      }
    }
  }

  // Apply post-computation filters (prob / biased weight)
  if (parsed.prob || parsed.factionProb.length > 0) {
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      if (parsed.prob) {
        const bw = row.biasedWeights || {};
        const sf = scopedFactions.length > 0 ? scopedFactions : Object.keys(bw);
        if (!sf.some(f => compareOp(bw[f] || 0, parsed.prob.op, parsed.prob.val))) {
          rows.splice(i, 1); continue;
        }
      }
      if (parsed.factionProb.length > 0) {
        const bw = row.biasedWeights || {};
        if (!parsed.factionProb.every(fp => compareOp(bw[fp.faction] || 0, fp.op, fp.val))) {
          rows.splice(i, 1); continue;
        }
      }
    }
  }
  
  // Apply post-computation filters (combined score)
  if (parsed.combined || parsed.factionCmb.length > 0) {
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      if (parsed.combined) {
        const cmb = row.combined || {};
        const sf = scopedFactions.length > 0 ? scopedFactions : Object.keys(cmb);
        if (!sf.some(f => compareOp(cmb[f] || 0, parsed.combined.op, parsed.combined.val))) {
          rows.splice(i, 1); continue;
        }
      }
      if (parsed.factionCmb.length > 0) {
        const cmb = row.combined || {};
        if (!parsed.factionCmb.every(fc => compareOp(cmb[fc.faction] || 0, fc.op, fc.val))) {
          rows.splice(i, 1); continue;
        }
      }
    }
  }
  
  // Sort
  if (parsed.sort.length > 0) {
    sortRowsInPlace(rows, parsed.sort);
  } else if (scopedFactions.length === 1) {
    const f = scopedFactions[0];
    rows.sort((a, b) => (b.weights[f] || 0) - (a.weights[f] || 0));
  } else if (scopedFactions.length > 1) {
    rows.sort((a, b) => b.spread - a.spread);
  } else {
    rows.sort((a, b) => {
      const maxA = Math.max(0, ...Object.values(a.weights));
      const maxB = Math.max(0, ...Object.values(b.weights));
      return maxB - maxA;
    });
  }
  
  statusText.textContent = `${rows.length} chassis | Era: ${eraYear}`;
  
  // Show era auto-adjust message if applicable
  let eraInfoEl = document.getElementById('era-adjust-info');
  if (!eraInfoEl) {
    eraInfoEl = document.createElement('div');
    eraInfoEl.id = 'era-adjust-info';
    viewContainer.parentNode.insertBefore(eraInfoEl, viewContainer);
  }
  if (eraAdjustMsg) {
    eraInfoEl.innerHTML = `<p class="era-adjust-msg">${eraAdjustMsg}</p>`;
    eraInfoEl.style.display = '';
  } else {
    eraInfoEl.innerHTML = '';
    eraInfoEl.style.display = 'none';
  }
  
  // No-results breadcrumbing
  if (rows.length === 0) {
    const diagnostic = buildNoResultsMessage(chassisFilter, scopedFactions, eraYear, parsed);
    const container = viewContainer;
    container.classList.remove('hidden');
    if (diagnostic) {
      container.innerHTML = `<div class="no-results-diagnostic"><p style="color:var(--text-dim);margin-bottom:0.5rem">No chassis found matching your query.</p>${diagnostic}</div>`;
    } else {
      container.innerHTML = '<p style="color:var(--text-dim)">No results — your filters matched no chassis. Try removing some filters.</p>';
    }
    // Wire up clickable era suggestions
    container.querySelectorAll('.era-suggestion').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const q = link.dataset.query;
        if (q) {
          document.getElementById('query-bar').value = q;
          runQuery();
        }
      });
    });
    return;
  }
  
  // View routing
  const view = determineView(parsed);
  
  switch (view) {
    case 'single-faction':
    case 'faction-comparison':
    case 'mech-detail':
      renderFactionComparison(rows, scopedFactions, eraYear, parsed);
      break;
    case 'mech':
      renderMechView(rows, eraYear);
      break;
    default:
      renderFactionComparison(rows, scopedFactions.length > 0 ? scopedFactions : getAllFactionsFromRows(rows).slice(0, 8), eraYear, parsed);
  }
}

function sortRowsInPlace(rows, sortSpec) {
  rows.sort((a, b) => {
    for (const { field, dir } of sortSpec) {
      let va, vb;
      if (field === 'spread') {
        va = a.spread; vb = b.spread;
      } else if (field === 'span') {
        va = a.span; vb = b.span;
      } else if (field === 'avgpref' || field === 'avg-pref' || field === 'avgweight' || field === 'avg-weight') {
        va = a.avgWeight; vb = b.avgWeight;
      } else if (field === 'weight') {
        va = Math.max(0, ...Object.values(a.weights));
        vb = Math.max(0, ...Object.values(b.weights));
      } else if (field === 'name' || field === 'chassis') {
        const cmp = dir === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
        if (cmp !== 0) return cmp;
        continue;
      } else if (field === 'role') {
        const ra = resolveChassisRole(a.name, a.meta.role, a.variants, currentEraYear) || 'zzz';
        const rb = resolveChassisRole(b.name, b.meta.role, b.variants, currentEraYear) || 'zzz';
        const cmp = dir === 'asc' ? ra.localeCompare(rb) : rb.localeCompare(ra);
        if (cmp !== 0) return cmp;
        continue;
      } else if (field === 'class') {
        const classOrder = { light: 0, medium: 1, heavy: 2, assault: 3 };
        const ca = classOrder[(a.meta.class || '').toLowerCase()] ?? 99;
        const cb = classOrder[(b.meta.class || '').toLowerCase()] ?? 99;
        const diff = dir === 'asc' ? (ca - cb) : (cb - ca);
        if (diff !== 0) return diff;
        continue;
      } else if (field === 'type') {
        // omni < battlemech < industrial (alphabetical happens to work for these)
        const ta = a.meta.omni ? 'omni' : a.meta.industrial ? 'industrial' : 'battlemech';
        const tb = b.meta.omni ? 'omni' : b.meta.industrial ? 'industrial' : 'battlemech';
        const cmp = dir === 'asc' ? ta.localeCompare(tb) : tb.localeCompare(ta);
        if (cmp !== 0) return cmp;
        continue;
      } else if (field === 'tech') {
        const ta = (a.meta.tech || 'zzz').toLowerCase();
        const tb = (b.meta.tech || 'zzz').toLowerCase();
        const cmp = dir === 'asc' ? ta.localeCompare(tb) : tb.localeCompare(ta);
        if (cmp !== 0) return cmp;
        continue;
      } else if (field === 'tonnage' || field === 'tons') {
        va = a.meta.tons || 0; vb = b.meta.tons || 0;
      } else if (field === 'bv' || field === 'battlevalue') {
        // asc sorts by bvMin (cheapest first), desc sorts by bvMax (biggest first)
        if (dir === 'asc') {
          va = a.bvRange?.bvMin || 0; vb = b.bvRange?.bvMin || 0;
        } else {
          va = a.bvRange?.bvMax || 0; vb = b.bvRange?.bvMax || 0;
        }
      } else if (field.endsWith('-bw') || field.endsWith('-prob')) {
        const fCode = field.replace(/-(bw|prob)$/, '').toUpperCase();
        va = a.biasedWeights?.[fCode] || 0;
        vb = b.biasedWeights?.[fCode] || 0;
      } else if (field === 'bw' || field === 'prob') {
        va = a.biasedWeights ? Math.max(0, ...Object.values(a.biasedWeights)) : 0;
        vb = b.biasedWeights ? Math.max(0, ...Object.values(b.biasedWeights)) : 0;
      } else if (field.endsWith('-weight')) {
        const fCode = field.replace('-weight', '').toUpperCase();
        va = a.weights?.[fCode] || 0;
        vb = b.weights?.[fCode] || 0;
      } else if (field.endsWith('-sig') || field.endsWith('-signature') || field.endsWith('-dr') || field.endsWith('-distinctiveness')) {
        const fCode = field.replace(/-(sig(nature)?|dr|distinctiveness)$/, '').toUpperCase();
        // Fielded but sig=0 gets a tiny positive value to sort above not-fielded
        va = a.sig?.[fCode] || ((a.weights?.[fCode] || 0) > 0 ? 1e-9 : 0);
        vb = b.sig?.[fCode] || ((b.weights?.[fCode] || 0) > 0 ? 1e-9 : 0);
      } else if (field === 'sig' || field === 'signature' || field === 'dr' || field === 'distinctiveness') {
        va = a.sig ? Math.max(0, ...Object.values(a.sig)) : 0;
        vb = b.sig ? Math.max(0, ...Object.values(b.sig)) : 0;
      } else if (field.endsWith('-cmb') || field.endsWith('-combined')) {
        const fCode = field.replace(/-(cmb|combined)$/, '').toUpperCase();
        va = a.combined?.[fCode] || 0;
        vb = b.combined?.[fCode] || 0;
      } else if (field === 'cmb' || field === 'combined') {
        va = a.combined ? Math.max(0, ...Object.values(a.combined)) : 0;
        vb = b.combined ? Math.max(0, ...Object.values(b.combined)) : 0;
      } else {
        continue;
      }
      const diff = dir === 'asc' ? (va - vb) : (vb - va);
      if (diff !== 0) return diff;
    }
    return 0;
  });
}

// ── Initialization ──

async function init() {
  try {
    const resp = await fetch('app-data.json?v=' + APP_VERSION);
    DATA = await resp.json();
    decodeFactionIndex(DATA); // expand numeric faction indices back to codes
    // alias cache resets automatically (stored on DATA object)
    applyFamilyOverridesToData(); // apply user's saved family preferences
    
    // Show version + data info
    {
      const parts = ['v' + APP_VERSION + (DEPLOY_TIME !== 'dev' ? ' · ' + DEPLOY_TIME : '')];
      if (DATA._meta?.generated) {
        const d = new Date(DATA._meta.generated);
        parts.push('Data: ' + d.toISOString().slice(0, 10).replace(/-/g, ''));
      }
      if (DATA._meta?.description) {
        parts.push(DATA._meta.description);
      }
      document.getElementById('deploy-stamp').textContent = parts.join(' • ');
    }
    // Hide loading overlay
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) loadingOverlay.classList.add('hidden');
  } catch (err) {
    console.error('Failed to load app-data.json:', err);
    document.getElementById('status-text').textContent = 'Error loading data!';
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) loadingOverlay.classList.add('hidden');
    return;
  }
  
  const bar = document.getElementById('query-bar');
  const suggestBox = document.getElementById('suggest-box');
  const resetBtn = document.getElementById('reset-btn');
  let suggestIndex = -1;
  
  // Reset button — clear query and return to landing
  function updateResetBtn() {
    resetBtn.classList.toggle('hidden', !bar.value.trim());
  }
  resetBtn.addEventListener('click', () => {
    bar.value = '';
    updateResetBtn();
    runQuery(); // triggers landing page display
    history.replaceState(null, '', location.pathname);
    bar.focus();
  });
  
  // Chip removal — delegated listener attached once, not re-attached per renderChips call
  document.getElementById('filter-chips').addEventListener('click', (e) => {
    const remove = e.target.closest('.chip-remove');
    if (!remove) return;
    const field = remove.dataset.field;
    removeFieldFromQuery(field);
  });
  
  // Debounced query execution
  let queryTimeout = null;
  bar.addEventListener('input', () => {
    updateResetBtn();
    clearTimeout(queryTimeout);
    queryTimeout = setTimeout(() => {
      // Show suggestions
      const suggestions = getSuggestions(bar.value, bar.selectionStart);
      renderSuggestions(suggestions);
    }, 150);
  });
  
  bar.addEventListener('keydown', (e) => {
    const items = suggestBox.querySelectorAll('.suggest-item');
    
    if (e.key === 'Enter') {
      if (suggestIndex >= 0 && items[suggestIndex]) {
        e.preventDefault();
        applySuggestion(items[suggestIndex].dataset.text);
      } else {
        e.preventDefault();
        suggestBox.classList.add('hidden');
        runQuery();
      }
      return;
    }
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      suggestIndex = Math.min(suggestIndex + 1, items.length - 1);
      updateSuggestHighlight(items);
      return;
    }
    
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      suggestIndex = Math.max(suggestIndex - 1, -1);
      updateSuggestHighlight(items);
      return;
    }
    
    if (e.key === 'Tab' && items.length > 0) {
      e.preventDefault();
      const idx = suggestIndex >= 0 ? suggestIndex : 0;
      if (items[idx]) applySuggestion(items[idx].dataset.text);
      return;
    }
    
    if (e.key === 'Escape') {
      suggestBox.classList.add('hidden');
      suggestIndex = -1;
    }
  });
  
  function renderSuggestions(suggestions) {
    suggestIndex = -1;
    if (suggestions.length === 0) {
      suggestBox.classList.add('hidden');
      return;
    }
    
    suggestBox.innerHTML = '';
    for (const s of suggestions) {
      const div = document.createElement('div');
      div.className = 'suggest-item';
      div.dataset.text = s.text;
      div.innerHTML = `${escHtml(s.text)}${s.hint ? `<span class="hint">${escHtml(s.hint)}</span>` : ''}`;
      div.addEventListener('click', () => applySuggestion(s.text));
      suggestBox.appendChild(div);
    }
    suggestBox.classList.remove('hidden');
  }
  
  function applySuggestion(text) {
    const value = bar.value;
    const cursor = bar.selectionStart;
    const before = value.slice(0, cursor);
    const after = value.slice(cursor);
    
    // Find the last token before cursor
    const lastSpace = before.lastIndexOf(' ');
    const lastEq = Math.max(before.lastIndexOf('='), before.lastIndexOf('('));
    const replaceFrom = Math.max(lastSpace, lastEq) + 1;
    
    bar.value = before.slice(0, replaceFrom) + text + (after.startsWith(' ') ? after : ' ' + after);
    bar.selectionStart = bar.selectionEnd = replaceFrom + text.length + (text.endsWith('=') || text.endsWith(' ') ? 0 : 1);
    bar.focus();
    suggestBox.classList.add('hidden');
    suggestIndex = -1;
  }
  
  function updateSuggestHighlight(items) {
    items.forEach((item, i) => {
      item.classList.toggle('active', i === suggestIndex);
    });
  }
  
  // Example query buttons
  document.querySelectorAll('.example-query').forEach(btn => {
    btn.addEventListener('click', () => {
      bar.value = btn.dataset.query;
      updateResetBtn();
      runQuery();
    });
  });
  
  // Close variant overlay — only re-run query if a role was changed
  document.getElementById('variant-close').addEventListener('click', () => {
    document.getElementById('variant-overlay').classList.add('hidden');
    if (variantRoleChanged) { variantRoleChanged = false; runQuery(); }
  });
  document.getElementById('variant-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      e.currentTarget.classList.add('hidden');
      if (variantRoleChanged) { variantRoleChanged = false; runQuery(); }
    }
  });
  
  // Title click = reset to home
  document.querySelector('header h1').addEventListener('click', () => {
    bar.value = '';
    updateResetBtn();
    runQuery();
    history.replaceState(null, '', location.pathname);
    bar.focus();
  });

  // ── Settings Panel ──
  initSettings();

  // ── Help Panel ──
  initHelp();

  // ── Column Visibility ──
  initColVisibility();
  initColOrder();

  // ── Quick Filter Insert ──
  initQuickFilter();

  // Check URL hash for initial query
  if (location.hash) {
    bar.value = decodeURIComponent(location.hash.slice(1));
    updateResetBtn();
    runQuery();
  }
}

// ── Family overrides (persisted in localStorage) ──
// Structure: { "Dragon Family": { enabled: true, chassis: ["Dragon", "Grand Dragon"] }, ... }
// Only stores overrides — missing entries use DATA.families defaults.

const INCOMPLETE_STORAGE_KEY = 'bt-sig-show-incomplete';

function getShowIncomplete() {
  try { return localStorage.getItem(INCOMPLETE_STORAGE_KEY) === 'true'; }
  catch { return false; }
}

const FAMILY_STORAGE_KEY = 'bt-sig-family-overrides';

function loadFamilyOverrides() {
  try {
    return JSON.parse(localStorage.getItem(FAMILY_STORAGE_KEY) || '{}');
  } catch { return {}; }
}

function saveFamilyOverrides(overrides) {
  localStorage.setItem(FAMILY_STORAGE_KEY, JSON.stringify(overrides));
}

function getEffectiveFamilies() {
  if (!DATA || !DATA.families) return [];
  const overrides = loadFamilyOverrides();
  return DATA.families.map(fam => {
    const ov = overrides[fam.groupName];
    return {
      groupName: fam.groupName,
      chassis: ov?.chassis || fam.chassis,
      enabled: ov?.hasOwnProperty('enabled') ? ov.enabled : fam.enabled,
      isOverridden: !!ov
    };
  }).concat(
    // User-created families (not in DATA.families)
    Object.entries(overrides)
      .filter(([name]) => !DATA.families.some(f => f.groupName === name))
      .map(([name, ov]) => ({
        groupName: name,
        chassis: ov.chassis || [],
        enabled: ov.enabled !== false,
        isOverridden: true,
        isCustom: true
      }))
  );
}

function initSettings() {
  const overlay = document.getElementById('settings-overlay');

  // Open/close
  document.getElementById('settings-btn').addEventListener('click', () => {
    overlay.classList.remove('hidden');
    renderFamiliesList();
    renderRolesList();
  });
  document.getElementById('settings-close').addEventListener('click', () => {
    overlay.classList.add('hidden');
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.add('hidden');
  });

  // Global family toggle
  const globalToggle = document.getElementById('families-global-toggle');
  globalToggle.addEventListener('change', () => {
    const bar = document.getElementById('query-bar');
    const current = bar.value.replace(/\bfamily=(on|off)\b/g, '').replace(/\s+/g, ' ').trim();
    if (!globalToggle.checked) {
      // Insert before sort clause so it doesn't get swallowed
      const sortMatch = current.match(/^(.*?)(\s+sort\s+by\s+.+)$/i);
      if (sortMatch) {
        bar.value = (sortMatch[1].trim() + ' family=off' + sortMatch[2]).trim();
      } else {
        bar.value = (current + ' family=off').trim();
      }
    } else {
      bar.value = current;
    }
    runQuery();
    renderFamiliesList();
  });

  // Incomplete chassis toggle
  const incompleteToggle = document.getElementById('show-incomplete-toggle');
  incompleteToggle.checked = getShowIncomplete();
  incompleteToggle.addEventListener('change', () => {
    try { localStorage.setItem(INCOMPLETE_STORAGE_KEY, incompleteToggle.checked); }
    catch {}
    runQuery();
  });

  // Data mode radio
  document.querySelectorAll('input[name="data-mode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const bar = document.getElementById('query-bar');
      const current = bar.value.replace(/\bmode=[ABX]\b/g, '').replace(/\s+/g, ' ').trim();
      if (radio.value === 'A') {
        const sortMatch = current.match(/^(.*?)(\s+sort\s+by\s+.+)$/i);
        if (sortMatch) {
          bar.value = (sortMatch[1].trim() + ' mode=A' + sortMatch[2]).trim();
        } else {
          bar.value = (current + ' mode=A').trim();
        }
      } else if (radio.value === 'X') {
        const sortMatch = current.match(/^(.*?)(\s+sort\s+by\s+.+)$/i);
        if (sortMatch) {
          bar.value = (sortMatch[1].trim() + ' mode=X' + sortMatch[2]).trim();
        } else {
          bar.value = (current + ' mode=X').trim();
        }
      } else {
        bar.value = current;
      }
      runQuery();
    });
  });

  // Reset to defaults
  document.getElementById('reset-defaults-btn').addEventListener('click', () => {
    if (!confirm('Reset all preferences to defaults? This clears column visibility, family overrides, roles, and other saved settings.')) return;
    try {
      localStorage.removeItem(COL_VIS_KEY);
      localStorage.removeItem(FAMILY_STORAGE_KEY);
      localStorage.removeItem(INCOMPLETE_STORAGE_KEY);
      localStorage.removeItem(PAGE_SIZE_KEY);
      localStorage.removeItem('bt-sig-roles');
    } catch {}
    location.reload();
  });

  // ── Role CRUD ──
  initRolesCRUD();
}

const MUL_DEFAULT_ROLES = ['Scout', 'Striker', 'Skirmisher', 'Juggernaut', 'Brawler', 'Missile Boat', 'Sniper', 'Ambusher', 'None'];

function saveUserRoles(roles) {
  try { localStorage.setItem('bt-sig-roles', JSON.stringify(roles)); } catch {}
}

function getOrInitUserRoles() {
  const existing = getUserRoles();
  if (existing) return existing;
  return { taxonomy: [...MUL_DEFAULT_ROLES], overrides: {}, renames: {} };
}

function renderRolesList() {
  const container = document.getElementById('roles-list');
  if (!container) return;
  const roles = getOrInitUserRoles();
  container.innerHTML = '';

  for (const roleName of roles.taxonomy) {
    const isFixed = roleName === 'None';
    const div = document.createElement('div');
    div.className = 'role-item';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'role-name' + (isFixed ? ' role-fixed' : '');
    input.value = roleName;
    input.readOnly = isFixed;
    input.dataset.original = roleName;

    if (!isFixed) {
      input.addEventListener('change', () => {
        const newName = input.value.trim();
        if (!newName || newName === roleName) { input.value = roleName; return; }
        // Check for duplicates
        if (roles.taxonomy.includes(newName)) { input.value = roleName; return; }
        // Rename in taxonomy
        const idx = roles.taxonomy.indexOf(roleName);
        if (idx >= 0) roles.taxonomy[idx] = newName;
        // Update renames: find original MUL name that maps to this role
        // If roleName was itself a rename target, update the rename
        const existingRenameKey = Object.entries(roles.renames).find(([k, v]) => v === roleName);
        if (existingRenameKey) {
          roles.renames[existingRenameKey[0]] = newName;
        } else if (MUL_DEFAULT_ROLES.includes(roleName)) {
          roles.renames[roleName] = newName;
        }
        // Update any overrides pointing to old name
        for (const [k, v] of Object.entries(roles.overrides)) {
          if (v === roleName) roles.overrides[k] = newName;
        }
        saveUserRoles(roles);
        renderRolesList();
        runQuery();
      });
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'role-delete';
    deleteBtn.textContent = '×';
    deleteBtn.disabled = isFixed;
    deleteBtn.title = isFixed ? 'None cannot be deleted' : 'Delete role';

    if (!isFixed) {
      deleteBtn.addEventListener('click', () => {
        if (!confirm(`Delete role "${roleName}"? All variants with this role will be set to None.`)) return;
        // Remove from taxonomy
        roles.taxonomy = roles.taxonomy.filter(r => r !== roleName);
        // Move overrides pointing to this role to None
        for (const [k, v] of Object.entries(roles.overrides)) {
          if (v === roleName) roles.overrides[k] = 'None';
        }
        // Clean up renames pointing to this role
        for (const [k, v] of Object.entries(roles.renames)) {
          if (v === roleName) delete roles.renames[k];
        }
        saveUserRoles(roles);
        renderRolesList();
        runQuery();
      });
    }

    div.appendChild(input);
    div.appendChild(deleteBtn);
    container.appendChild(div);
  }
}

function initRolesCRUD() {
  // Add role button
  document.getElementById('role-add-btn')?.addEventListener('click', () => {
    const input = document.getElementById('role-add-input');
    const name = input.value.trim();
    if (!name) return;
    const roles = getOrInitUserRoles();
    if (roles.taxonomy.includes(name)) { input.value = ''; return; }
    // Insert before "None" (keep None last)
    const noneIdx = roles.taxonomy.indexOf('None');
    if (noneIdx >= 0) {
      roles.taxonomy.splice(noneIdx, 0, name);
    } else {
      roles.taxonomy.push(name);
    }
    saveUserRoles(roles);
    input.value = '';
    renderRolesList();
  });

  // Enter key in add input
  document.getElementById('role-add-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('role-add-btn')?.click();
    }
  });

  // Reset roles button
  // Export roles to JSON file
  document.getElementById('export-roles-btn')?.addEventListener('click', () => {
    const roles = getOrInitUserRoles();
    const blob = new Blob([JSON.stringify(roles, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bt-sig-roles.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // Import roles from JSON file
  const importFileInput = document.getElementById('import-roles-file');
  document.getElementById('import-roles-btn')?.addEventListener('click', () => {
    importFileInput?.click();
  });
  importFileInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const roles = JSON.parse(reader.result);
        if (!roles.taxonomy || !Array.isArray(roles.taxonomy)) {
          alert('Invalid roles file — missing taxonomy array');
          return;
        }
        saveUserRoles(roles);
        renderRolesList();
        runQuery();
      } catch (err) {
        alert('Failed to parse roles file: ' + err.message);
      }
    };
    reader.readAsText(file);
    importFileInput.value = ''; // reset so same file can be re-imported
  });

  document.getElementById('reset-roles-btn')?.addEventListener('click', () => {
    if (!confirm('Reset all role names and assignments to MUL defaults?')) return;
    try { localStorage.removeItem('bt-sig-roles'); } catch {}
    renderRolesList();
    runQuery();
  });

  // Render initial list when settings open
  const origOpen = document.getElementById('settings-btn');
  if (origOpen) {
    const origHandler = origOpen.onclick;
    origOpen.addEventListener('click', () => renderRolesList());
  }
}

function initHelp() {
  const overlay = document.getElementById('help-overlay');
  if (!overlay) return;

  // Column legend expand/collapse
  const legendHeader = document.getElementById('legend-header');
  const legendToggle = document.getElementById('legend-toggle');
  const legendBody = document.getElementById('legend-body');
  if (legendHeader && legendToggle && legendBody) {
    const savedState = localStorage.getItem('bt-sig-legend-expanded');
    // Default to expanded
    if (savedState === '0') {
      legendBody.classList.add('hidden');
      legendToggle.classList.remove('expanded');
    }
    legendHeader.addEventListener('click', () => {
      const isHidden = legendBody.classList.toggle('hidden');
      legendToggle.classList.toggle('expanded', !isHidden);
      localStorage.setItem('bt-sig-legend-expanded', isHidden ? '0' : '1');
    });
  }

  document.getElementById('help-btn').addEventListener('click', () => {
    overlay.classList.remove('hidden');
  });
  document.getElementById('help-close').addEventListener('click', () => {
    overlay.classList.add('hidden');
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.add('hidden');
  });

  // Help example queries — run query and close help
  overlay.querySelectorAll('.help-example-query').forEach(btn => {
    btn.addEventListener('click', () => {
      const bar = document.getElementById('query-bar');
      bar.value = btn.dataset.query;
      overlay.classList.add('hidden');
      runQuery();
    });
  });
}

function renderFamiliesList() {
  const container = document.getElementById('families-list');
  if (!DATA || !DATA.families) {
    container.innerHTML = '<p style="color:var(--text-dim)">Loading...</p>';
    return;
  }

  const globalOn = document.getElementById('families-global-toggle').checked;
  const families = getEffectiveFamilies();

  let html = '';
  for (const fam of families) {
    const displayName = fam.groupName.replace(/ Family$/, '');
    const membersStr = fam.chassis.join(', ');
    html += `<div class="family-item" style="opacity:${globalOn ? 1 : 0.4}">
      <label class="family-toggle">
        <input type="checkbox" class="family-enable-cb" data-family="${fam.groupName}" ${fam.enabled ? 'checked' : ''} ${globalOn ? '' : 'disabled'}>
      </label>
      <div class="family-info">
        <span class="family-name">${fam.isCustom ? '<span class="family-badge family-badge-user" title="User-created">USER</span>' : '<span class="family-badge family-badge-system" title="System-defined">SYS</span>'} ${displayName}${fam.isOverridden ? ' ✎' : ''}</span>
        <span class="family-members">${membersStr}</span>
      </div>
      <button class="family-edit-btn" data-family="${fam.groupName}" title="Edit family" ${globalOn ? '' : 'disabled'}>✎</button>
    </div>`;
  }
  html += `<button id="add-family-btn" class="add-family-btn" ${globalOn ? '' : 'disabled'}>+ Add Family</button>`;
  container.innerHTML = html;

  // Wire up per-family toggle
  container.querySelectorAll('.family-enable-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const overrides = loadFamilyOverrides();
      const name = cb.dataset.family;
      if (!overrides[name]) overrides[name] = {};
      overrides[name].enabled = cb.checked;
      saveFamilyOverrides(overrides);
      applyFamilyOverridesToData();
      runQuery();
    });
  });

  // Wire up edit buttons
  container.querySelectorAll('.family-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => openFamilyEditor(btn.dataset.family));
  });

  // Wire up add button
  const addBtn = container.querySelector('#add-family-btn');
  if (addBtn) addBtn.addEventListener('click', () => openFamilyEditor(null));
}

function openFamilyEditor(familyName) {
  const families = getEffectiveFamilies();
  const fam = familyName ? families.find(f => f.groupName === familyName) : null;

  const name = fam ? fam.groupName.replace(/ Family$/, '') : '';
  const members = fam ? fam.chassis.join(', ') : '';

  const dialog = document.createElement('div');
  dialog.className = 'family-editor-overlay';
  dialog.innerHTML = `
    <div class="family-editor">
      <h4>${fam ? 'Edit' : 'New'} Family</h4>
      <label>Name:<input type="text" id="fed-name" value="${name}" placeholder="e.g. Dragon"></label>
      <label>Chassis (comma-separated):<input type="text" id="fed-members" value="${members}" placeholder="e.g. Dragon, Grand Dragon, Dragon II"></label>
      <div class="fed-actions">
        ${fam ? '<button id="fed-delete" class="fed-delete">Delete</button>' : '<span></span>'}
        ${fam?.isOverridden ? '<button id="fed-reset" class="fed-reset">Reset to Default</button>' : '<span></span>'}
        <button id="fed-cancel">Cancel</button>
        <button id="fed-save" class="fed-save">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);

  dialog.querySelector('#fed-cancel').addEventListener('click', () => dialog.remove());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.remove(); });

  // Autocomplete for chassis members field
  const fedMembers = dialog.querySelector('#fed-members');
  const suggestDiv = document.createElement('div');
  suggestDiv.className = 'fed-suggest hidden';
  fedMembers.parentNode.style.position = 'relative';
  fedMembers.parentNode.appendChild(suggestDiv);
  let fedSuggestIdx = -1;

  function getFedSuggestions() {
    if (!DATA) return [];
    const val = fedMembers.value;
    const cursor = fedMembers.selectionStart;
    const before = val.slice(0, cursor);
    const lastComma = before.lastIndexOf(',');
    const partial = before.slice(lastComma + 1).trim().toLowerCase();
    if (!partial) return [];

    const allChassis = Object.keys(DATA.chassis).sort();
    const already = val.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    return allChassis
      .filter(c => c.toLowerCase().includes(partial) && !already.includes(c.toLowerCase()))
      .slice(0, 8);
  }

  function renderFedSuggestions(items) {
    fedSuggestIdx = -1;
    if (items.length === 0) { suggestDiv.classList.add('hidden'); return; }
    suggestDiv.innerHTML = '';
    for (const name of items) {
      const div = document.createElement('div');
      div.className = 'suggest-item';
      div.textContent = name;
      div.addEventListener('click', () => applyFedSuggestion(name));
      suggestDiv.appendChild(div);
    }
    suggestDiv.classList.remove('hidden');
  }

  function applyFedSuggestion(name) {
    const val = fedMembers.value;
    const cursor = fedMembers.selectionStart;
    const before = val.slice(0, cursor);
    const after = val.slice(cursor);
    const lastComma = before.lastIndexOf(',');
    const prefix = lastComma >= 0 ? before.slice(0, lastComma + 1) + ' ' : '';
    const afterTrimmed = after.replace(/^[^,]*/, '');
    fedMembers.value = prefix + name + (afterTrimmed.startsWith(',') ? afterTrimmed : ', ' + afterTrimmed.replace(/^,?\s*/, ''));
    // Clean trailing comma/space
    fedMembers.value = fedMembers.value.replace(/,\s*$/, '');
    suggestDiv.classList.add('hidden');
    fedSuggestIdx = -1;
    fedMembers.focus();
  }

  fedMembers.addEventListener('input', () => {
    renderFedSuggestions(getFedSuggestions());
  });

  fedMembers.addEventListener('keydown', (e) => {
    const items = suggestDiv.querySelectorAll('.suggest-item');
    if (e.key === 'ArrowDown' && items.length) {
      e.preventDefault();
      fedSuggestIdx = Math.min(fedSuggestIdx + 1, items.length - 1);
      items.forEach((it, i) => it.classList.toggle('active', i === fedSuggestIdx));
    } else if (e.key === 'ArrowUp' && items.length) {
      e.preventDefault();
      fedSuggestIdx = Math.max(fedSuggestIdx - 1, -1);
      items.forEach((it, i) => it.classList.toggle('active', i === fedSuggestIdx));
    } else if (e.key === 'Tab' && items.length > 0) {
      e.preventDefault();
      const idx = fedSuggestIdx >= 0 ? fedSuggestIdx : 0;
      if (items[idx]) applyFedSuggestion(items[idx].textContent);
    } else if (e.key === 'Enter' && fedSuggestIdx >= 0 && items[fedSuggestIdx]) {
      e.preventDefault();
      applyFedSuggestion(items[fedSuggestIdx].textContent);
    } else if (e.key === 'Escape') {
      suggestDiv.classList.add('hidden');
      fedSuggestIdx = -1;
    }
  });

  dialog.querySelector('#fed-save').addEventListener('click', () => {
    const newName = dialog.querySelector('#fed-name').value.trim();
    const newMembers = dialog.querySelector('#fed-members').value.split(',').map(s => s.trim()).filter(Boolean);
    if (!newName || newMembers.length === 0) return;

    const fullName = newName.endsWith(' Family') ? newName : newName + ' Family';
    const overrides = loadFamilyOverrides();

    // If renaming, remove old entry
    if (fam && fam.groupName !== fullName) {
      delete overrides[fam.groupName];
    }

    overrides[fullName] = {
      enabled: fam ? (overrides[fam.groupName]?.enabled ?? fam.enabled) : true,
      chassis: newMembers
    };
    saveFamilyOverrides(overrides);
    applyFamilyOverridesToData();
    dialog.remove();
    renderFamiliesList();
    runQuery();
  });

  const deleteBtn = dialog.querySelector('#fed-delete');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      const overrides = loadFamilyOverrides();
      if (fam.isCustom) {
        delete overrides[fam.groupName];
      } else {
        // Can't delete a built-in — disable it instead
        overrides[fam.groupName] = { enabled: false, chassis: fam.chassis };
      }
      saveFamilyOverrides(overrides);
      applyFamilyOverridesToData();
      dialog.remove();
      renderFamiliesList();
      runQuery();
    });
  }

  const resetBtn = dialog.querySelector('#fed-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      const overrides = loadFamilyOverrides();
      delete overrides[fam.groupName];
      saveFamilyOverrides(overrides);
      applyFamilyOverridesToData();
      dialog.remove();
      renderFamiliesList();
      runQuery();
    });
  }
}

// ── Column Visibility ──

const COL_VIS_KEY = 'bt-sig-col-visibility';
const COL_ORDER_KEY = 'bt-sig-col-order';

function loadColVisibility() {
  try { return JSON.parse(localStorage.getItem(COL_VIS_KEY) || '{}'); } catch { return {}; }
}

function saveColVisibility(state) {
  localStorage.setItem(COL_VIS_KEY, JSON.stringify(state));
}

function initColVisibility() {
  const toggle = document.getElementById('col-vis-toggle');
  const menu = document.getElementById('col-vis-menu');

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    // Close the order menu if open
    document.getElementById('col-order-menu')?.classList.add('hidden');
    menu.classList.toggle('hidden');
  });

  // Close on click-outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#col-vis-bar')) {
      menu.classList.add('hidden');
    }
  });
}

/**
 * Called after any table render. Reads headers from the rendered table,
 * builds the checkbox menu, and applies stored visibility.
 */
/** Stable column name for visibility state — uses data-col-name if set, else textContent */
function getColName(th) {
  return th.dataset.colName || th.textContent.trim();
}

function updateColVisibility() {
  const bar = document.getElementById('col-vis-bar');
  const menu = document.getElementById('col-vis-menu');
  const table = document.querySelector('#view-container .data-table');

  if (!table) {
    bar.classList.add('hidden');
    return;
  }

  const headers = table.querySelectorAll('thead th');
  if (headers.length === 0) {
    bar.classList.add('hidden');
    return;
  }

  bar.classList.remove('hidden');
  const state = loadColVisibility();

  menu.innerHTML = '';
  headers.forEach((th, idx) => {
    const name = getColName(th);
    if (!name) return;

    // Chassis column (index 0) is always visible
    const isLocked = idx === 0;
    const isVisible = isLocked || (state[name] !== undefined ? state[name] !== false : !isDefaultHidden(name));

    const label = document.createElement('label');
    label.className = 'col-vis-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = isVisible;
    cb.disabled = isLocked;
    cb.dataset.colIdx = idx;
    cb.dataset.colName = name;

    cb.addEventListener('change', () => {
      const s = loadColVisibility();
      s[name] = cb.checked;
      saveColVisibility(s);
      applyColVisibility();
    });

    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + name));
    menu.appendChild(label);
  });

  applyColVisibility();
}

function isDefaultHidden(name) {
  // Split cell ("DC DR | Prob | Cmb") is visible by default
  if (name.endsWith(' DR | Prob | Cmb')) return false;
  // Legacy split cell name ("DC DR | Prob") — also visible
  if (name.endsWith(' DR | Prob')) return false;
  // Separate DR column ("DC DR") — hidden, superseded by split cell
  if (name.endsWith(' DR')) return true;
  // Separate Prob column ("DC Prob") — hidden, superseded by split cell
  if (name.endsWith(' Prob')) return true;
  // Separate Combined column ("FS Combined") — hidden, superseded by split cell
  if (name.endsWith(' Cmb')) return true;
  // Weight column (faction code like "DC") — hidden
  const isWeightCol = DATA?.factions?.[name];
  if (isWeightCol) return true;
  // Spread — hidden
  if (name === 'Spread') return true;
  return false;
}

function applyColVisibility() {
  const table = document.querySelector('#view-container .data-table');
  if (!table) return;

  const state = loadColVisibility();
  const headers = table.querySelectorAll('thead th');

  // Pre-compute visibility array for all columns
  const colVisible = [];
  headers.forEach((th, idx) => {
    const name = getColName(th);
    const isLocked = idx === 0;
    const visible = isLocked || (state[name] !== undefined ? state[name] !== false : !isDefaultHidden(name));
    colVisible.push(visible);
    th.style.display = visible ? '' : 'none';
  });

  // Single pass over rows (instead of one querySelectorAll per column)
  const rows = table.querySelectorAll('tbody tr');
  for (const tr of rows) {
    const cells = tr.children;
    for (let idx = 0; idx < cells.length && idx < colVisible.length; idx++) {
      cells[idx].style.display = colVisible[idx] ? '' : 'none';
    }
  }
}

// ── Column Order ──

function loadColOrder() {
  try { return JSON.parse(localStorage.getItem(COL_ORDER_KEY) || '[]'); } catch { return []; }
}

function saveColOrder(order) {
  localStorage.setItem(COL_ORDER_KEY, JSON.stringify(order));
}

/**
 * Compute column index mapping from saved order.
 * @param {string[]} cols - current column names in DOM order
 * @param {string[]|null} savedOrder - saved column name order
 * @returns {number[]} - array where result[newPos] = originalIndex
 */
function computeColOrder(cols, savedOrder) {
  if (!cols.length) return [];
  if (!savedOrder || !savedOrder.length) return cols.map((_, i) => i);
  
  const nameToIdx = new Map();
  cols.forEach((name, idx) => nameToIdx.set(name, idx));
  
  const result = [0]; // Chassis (idx 0) always first
  const placed = new Set([0]);
  
  // Place columns in saved order (skip Chassis and unknown columns)
  for (const name of savedOrder) {
    const idx = nameToIdx.get(name);
    if (idx !== undefined && idx !== 0 && !placed.has(idx)) {
      result.push(idx);
      placed.add(idx);
    }
  }
  
  // Append remaining columns not in saved order
  for (let i = 1; i < cols.length; i++) {
    if (!placed.has(i)) result.push(i);
  }
  
  return result;
}

function applyColOrder() {
  const table = document.querySelector('#view-container .data-table');
  if (!table) return;
  
  const thead = table.querySelector('thead');
  const headers = Array.from(thead.querySelectorAll('th'));
  if (headers.length <= 1) return;
  
  // Get visible column names in current DOM order
  const colNames = headers.map(th => getColName(th));
  const savedOrder = loadColOrder();
  const order = computeColOrder(colNames, savedOrder);
  
  // Check if already in correct order
  const isIdentity = order.every((idx, pos) => idx === pos);
  if (isIdentity) return;
  
  // Reorder header cells
  const headerRow = thead.querySelector('tr');
  const orderedHeaders = order.map(idx => headers[idx]);
  orderedHeaders.forEach(th => headerRow.appendChild(th));
  
  // Reorder body cells
  const rows = table.querySelectorAll('tbody tr');
  for (const tr of rows) {
    const cells = Array.from(tr.children);
    const orderedCells = order.map(idx => cells[idx]);
    orderedCells.forEach(td => tr.appendChild(td));
  }
}

function initColOrder() {
  const toggle = document.getElementById('col-order-toggle');
  const menu = document.getElementById('col-order-menu');
  if (!toggle || !menu) return;
  
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    // Close the visibility menu if open
    document.getElementById('col-vis-menu')?.classList.add('hidden');
    menu.classList.toggle('hidden');
    if (!menu.classList.contains('hidden')) renderColOrderMenu();
  });
  
  // Close on click-outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#col-order-menu') && !e.target.closest('#col-order-toggle')) {
      menu.classList.add('hidden');
    }
  });
}

function renderColOrderMenu() {
  const menu = document.getElementById('col-order-menu');
  if (!menu) return;
  
  const table = document.querySelector('#view-container .data-table');
  if (!table) return;
  
  const headers = Array.from(table.querySelectorAll('thead th'));
  // Only show visible columns
  const visibleCols = [];
  headers.forEach((th, idx) => {
    if (th.style.display !== 'none') {
      visibleCols.push({ name: getColName(th), idx });
    }
  });
  
  menu.innerHTML = '';
  
  visibleCols.forEach((col, pos) => {
    const row = document.createElement('div');
    row.className = 'col-order-item';
    
    const label = document.createElement('span');
    label.className = 'col-order-label';
    label.textContent = col.name;
    
    const btnGroup = document.createElement('span');
    btnGroup.className = 'col-order-btns';
    
    if (pos > 1) { // Can't move above Chassis (pos 0), so first moveable is pos 1
      const upBtn = document.createElement('button');
      upBtn.className = 'col-order-btn';
      upBtn.textContent = '\u25B2';
      upBtn.title = 'Move up';
      upBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        moveCol(visibleCols, pos, -1);
      });
      btnGroup.appendChild(upBtn);
    }
    
    if (pos > 0 && pos < visibleCols.length - 1) {
      const downBtn = document.createElement('button');
      downBtn.className = 'col-order-btn';
      downBtn.textContent = '\u25BC';
      downBtn.title = 'Move down';
      downBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        moveCol(visibleCols, pos, 1);
      });
      btnGroup.appendChild(downBtn);
    }
    
    row.appendChild(label);
    row.appendChild(btnGroup);
    menu.appendChild(row);
  });
  
  // Reset button
  const resetRow = document.createElement('div');
  resetRow.className = 'col-order-reset';
  const resetBtn = document.createElement('button');
  resetBtn.className = 'col-order-btn col-order-reset-btn';
  resetBtn.textContent = 'Reset order';
  resetBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    localStorage.removeItem(COL_ORDER_KEY);
    // Re-render by re-running the query
    runQuery();
    document.getElementById('col-order-menu')?.classList.add('hidden');
  });
  resetRow.appendChild(resetBtn);
  menu.appendChild(resetRow);
}

function moveCol(visibleCols, pos, direction) {
  const newPos = pos + direction;
  if (newPos < 1 || newPos >= visibleCols.length) return; // Can't move to pos 0 (Chassis)
  
  // Swap in the visible cols array
  const temp = visibleCols[pos];
  visibleCols[pos] = visibleCols[newPos];
  visibleCols[newPos] = temp;
  
  // Save the new order
  saveColOrder(visibleCols.map(c => c.name));
  
  // Apply and re-render menu
  applyColOrder();
  renderColOrderMenu();
}

// ── Quick Filter Insert ──

function initQuickFilter() {
  const qfInput = document.getElementById('quick-filter-input');
  const qfClear = document.getElementById('qf-clear');
  const qfInsert = document.getElementById('qf-insert');
  const qfSuggestBox = document.getElementById('qf-suggest-box');
  let qfSuggestIndex = -1;

  // Known field names that take = values (not sort, not numeric-operator fields used bare)
  const VALUE_FIELDS = new Set(['faction', 'chassis', 'class', 'type', 'tech', 'role', 'year', 'era', 'rating', 'family', 'industrial', 'mode']);
  const OPERATOR_FIELDS = new Set(['spread', 'sig', 'signature', 'dr', 'distinctiveness', 'weight', 'tons', 'tonnage']);

  function normalizeFilterText(raw) {
    // "sort by ..." → pass through
    if (/^\s*sort\s+by\s+/i.test(raw)) return raw;

    // "field value" with no operator → "field=value"
    // Match: known field name, whitespace, then a value (no =, >, <, ! present)
    const match = raw.match(/^(\w[\w-]*)\s+(.+)$/);
    if (match) {
      const field = match[1].toLowerCase();
      const value = match[2].trim();
      if (VALUE_FIELDS.has(field)) {
        return field + '=' + value;
      }
      if (OPERATOR_FIELDS.has(field)) {
        // If value starts with an operator, join directly: "spread >3" → "spread>3"
        if (/^[><=!]/.test(value)) return field + value;
        // If value is just a number, assume >: "spread 3" → "spread>3"
        if (/^\d/.test(value)) return field + '>' + value;
        return raw; // don't know what to do, pass through
      }
      // Check faction-prefixed fields: "dc-sig 3" → "dc-sig>3", "dc-weight 5" → "dc-weight>5"
      const prefixMatch = field.match(/^([a-z]+)-(sig|signature|pref|preference|weight)$/);
      if (prefixMatch) {
        if (/^[><=!]/.test(value)) return field + value;
        if (/^\d/.test(value)) return field + '>' + value;
      }
    }
    return raw;
  }

  function insertFilter() {
    const text = normalizeFilterText(qfInput.value.trim());
    if (!text) return;
    const bar = document.getElementById('query-bar');
    const current = bar.value.trim();
    // Insert before any trailing sort clause so "sort by ..." stays last
    const sortMatch = current.match(/^(.*?)(\s+sort\s+by\s+.+)$/i);
    if (sortMatch) {
      bar.value = sortMatch[1].trim() + ' ' + text + sortMatch[2];
    } else {
      bar.value = current ? current + ' ' + text : text;
    }
    qfInput.value = '';
    qfSuggestBox.classList.add('hidden');
    qfSuggestIndex = -1;
    document.getElementById('reset-btn').classList.toggle('hidden', !bar.value.trim());
    runQuery();
    qfInput.focus();
  }

  qfInsert.addEventListener('click', insertFilter);

  qfClear.addEventListener('click', () => {
    qfInput.value = '';
    qfSuggestBox.classList.add('hidden');
    qfSuggestIndex = -1;
    qfInput.focus();
  });

  // Autocomplete — reuse getSuggestions
  let qfTimeout = null;
  qfInput.addEventListener('input', () => {
    clearTimeout(qfTimeout);
    qfTimeout = setTimeout(() => {
      const suggestions = getSuggestions(qfInput.value, qfInput.selectionStart);
      renderQfSuggestions(suggestions);
    }, 150);
  });

  qfInput.addEventListener('keydown', (e) => {
    const items = qfSuggestBox.querySelectorAll('.suggest-item');

    if (e.key === 'Enter') {
      if (qfSuggestIndex >= 0 && items[qfSuggestIndex]) {
        e.preventDefault();
        applyQfSuggestion(items[qfSuggestIndex].dataset.text);
      } else {
        e.preventDefault();
        insertFilter();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      qfSuggestIndex = Math.min(qfSuggestIndex + 1, items.length - 1);
      updateQfHighlight(items);
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      qfSuggestIndex = Math.max(qfSuggestIndex - 1, -1);
      updateQfHighlight(items);
      return;
    }

    if (e.key === 'Tab' && items.length > 0) {
      e.preventDefault();
      const idx = qfSuggestIndex >= 0 ? qfSuggestIndex : 0;
      if (items[idx]) applyQfSuggestion(items[idx].dataset.text);
      return;
    }

    if (e.key === 'Escape') {
      qfSuggestBox.classList.add('hidden');
      qfSuggestIndex = -1;
    }
  });

  function renderQfSuggestions(suggestions) {
    qfSuggestIndex = -1;
    if (suggestions.length === 0) {
      qfSuggestBox.classList.add('hidden');
      return;
    }
    qfSuggestBox.innerHTML = '';
    for (const s of suggestions) {
      const div = document.createElement('div');
      div.className = 'suggest-item';
      div.dataset.text = s.text;
      div.innerHTML = `${escHtml(s.text)}${s.hint ? `<span class="hint">${escHtml(s.hint)}</span>` : ''}`;
      div.addEventListener('click', () => applyQfSuggestion(s.text));
      qfSuggestBox.appendChild(div);
    }
    qfSuggestBox.classList.remove('hidden');
  }

  function applyQfSuggestion(text) {
    const value = qfInput.value;
    const cursor = qfInput.selectionStart;
    const before = value.slice(0, cursor);
    const after = value.slice(cursor);

    const lastSpace = before.lastIndexOf(' ');
    const lastEq = Math.max(before.lastIndexOf('='), before.lastIndexOf('('));
    const replaceFrom = Math.max(lastSpace, lastEq) + 1;

    qfInput.value = before.slice(0, replaceFrom) + text + (after.startsWith(' ') ? after : ' ' + after);
    qfInput.selectionStart = qfInput.selectionEnd = replaceFrom + text.length + (text.endsWith('=') || text.endsWith(' ') ? 0 : 1);
    qfInput.focus();
    qfSuggestBox.classList.add('hidden');
    qfSuggestIndex = -1;
  }

  function updateQfHighlight(items) {
    items.forEach((item, i) => {
      item.classList.toggle('active', i === qfSuggestIndex);
    });
  }
}

let _builtInFamilyNames = null; // set once at init

function applyFamilyOverridesToData() {
  if (!DATA) return;
  const overrides = loadFamilyOverrides();

  // Snapshot built-in family names on first call
  if (!_builtInFamilyNames) {
    _builtInFamilyNames = new Set(DATA.families.map(f => f.groupName));
  }

  // Remove custom families no longer in overrides (built-ins always kept)
  DATA.families = DATA.families.filter(fam =>
    _builtInFamilyNames.has(fam.groupName) || overrides[fam.groupName]
  );

  // Update DATA.families in place from defaults + overrides
  for (const fam of DATA.families) {
    const ov = overrides[fam.groupName];
    if (ov) {
      if (ov.hasOwnProperty('enabled')) fam.enabled = ov.enabled;
      if (ov.chassis) fam.chassis = ov.chassis;
    }
  }

  // Add custom families
  for (const [name, ov] of Object.entries(overrides)) {
    if (!DATA.families.some(f => f.groupName === name)) {
      DATA.families.push({
        groupName: name,
        chassis: ov.chassis || [],
        enabled: ov.enabled !== false
      });
    }
  }
}

// Update hash on query
const originalRunQuery = runQuery;
runQuery = function() {
  originalRunQuery();
  const bar = document.getElementById('query-bar');
  if (bar.value.trim()) {
    history.replaceState(null, '', '#' + encodeURIComponent(bar.value.trim()));
  } else {
    history.replaceState(null, '', location.pathname);
  }
};

document.addEventListener('DOMContentLoaded', init);
