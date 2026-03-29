'use strict';
// ============================================================
// constants.js
// ROM addresses, game constants, tile/sprite name tables
// Taken from QDKEdit.h and QDKEdit.cpp (fillTileNames, fillSpriteNames)
// ============================================================

// --- ROM Bank and Table Addresses ---
// All values are ROM file offsets (not GB bus addresses)
const C = {
  ROMBANK_1:    0x05,
  ROMBANK_POS_2: 0x25FF,  // ROM file addr of bank-slot-2 bank number
  ROMBANK_POS_3: 0x2606,  // ROM file addr of bank-slot-3 bank number
  COMPARE_POS_1: 0x25FC,  // Bank boundary: levels 0..(limit1-1) in bank slot 1
  COMPARE_POS_2: 0x2603,  // Bank boundary: levels limit1..(limit2-1) in bank slot 2

  POINTER_TABLE:        0x14000,  // 256 x 2-byte LE level pointers
  SUBTILESET_TABLE:     0x30EEB,  // 2 bytes per tileset: sub-offsets for set-specific tile data
  SGB_SYSTEM_PAL:       0x786F0,  // LZSS-compressed SGB palette data (0x1000 bytes uncompressed)
  PAL_ARCADE:           0x30F9A,  // Palette indices for arcade levels 0-3 (6 bytes each)
  PAL_TABLE:            0x6093B,  // Palette indices for levels 4-104 (6 bytes each, 1 byte used)
  TILE_INDEX_TABLE:     0x60E5,   // 255 x 2-byte pointers to tile metadata
  ADDITIONAL_TILES_TABLE: 0x30E55, // Supporting-tile dependency table
  ELEVATOR_TABLE:       0x30F77,

  MAX_LEVEL_ID: 256,
  LAST_LEVEL:   105,   // Levels 0-104 are valid
  MAX_TILESETS: 0x22,  // 34 tilesets

  // Level dimension constants
  SMALL_W: 32, SMALL_H: 18,  // Small level: 32×18 tiles
  LARGE_W: 32, LARGE_H: 28,  // Large level: 32×28 tiles
  SMALL_TILEMAP_SIZE: 0x240,  // 32*18 = 576 bytes
  LARGE_TILEMAP_SIZE: 0x380,  // 32*28 = 896 bytes

  // RAM base addresses used for sprite/switch positioning in save format
  SPRITE_RAM_BASE: 0xDA75,
  TILE_RAM_BASE:   0xD44D,

  VRAM_TILES:   0x50,   // Max tile graphics (80)
  VRAM_SPRITES: 0x100,  // Max sprite graphics (256)

  MAX_SPRITES: 0x1B,  // Max sprites per level (27)
};

// -------------------------------------------------------
// IS_SPRITE[id] — which tile IDs are treated as sprites
// Taken from the isSprite[] array in QDKEdit.cpp
// -------------------------------------------------------
const IS_SPRITE = new Uint8Array(256);
[
  0x3A,
  0x44, 0x47, 0x48,
  0x4D, 0x4E, 0x4F, 0x50,
  0x54, 0x57, 0x58, 0x5A, 0x5C, 0x5E,
  0x64,
  0x6E,
  0x70, 0x72,
  0x7A, 0x7C, 0x7F,
  0x80, 0x84, 0x86, 0x88, 0x8A, 0x8E,
  0x90, 0x92, 0x94, 0x96, 0x98, 0x9A, 0x9D,
  0xA2, 0xA4, 0xA6, 0xA8, 0xAA, 0xAC, 0xAE,
  0xB0, 0xB6, 0xB8, 0xBA, 0xBE,
  0xC0, 0xC2, 0xC6, 0xC8, 0xCA, 0xCC,
].forEach(id => IS_SPRITE[id] = 1);

// -------------------------------------------------------
// TILE_NAMES — human-readable names for tile IDs 0x00-0xFF
// Taken from QDKEdit::fillTileNames()
// -------------------------------------------------------
const TILE_NAMES = {
  0x00: 'I-tile',              0x01: 'ground',             0x02: 'ground',
  0x03: 'ice',                 0x04: 'dissolving ground',  0x05: 'spikes',
  0x06: 'ground',              0x07: 'ladder',             0x08: 'climbing pole',
  0x09: 'conveyor left',       0x0A: 'conveyor right',     0x0B: 'ground',
  0x0C: 'board track',         0x0D: 'board track',        0x0E: 'board track',
  0x0F: 'board track',         0x10: 'board track',        0x11: 'board track',
  0x12: 'board track',         0x13: 'board track',        0x14: 'board track',
  0x15: 'board track',         0x16: 'board track',        0x17: 'board track',
  0x18: 'spring board',        0x19: '0x19 ???',           0x1A: 'on-off switch',
  0x1B: 'board track bumper',  0x1C: 'ground',             0x1D: 'high wire',
  0x1E: 'high wire angled up', 0x1F: 'high wire angled down',
  0x20: 'DK switch',           0x21: 'conveyor left end',  0x22: 'conveyor right end',
  0x23: 'structure support',   0x24: 'elevator bottom (unused)', 0x25: 'mushroom - do not use',
  0x26: 'spikes #2',           0x27: 'ground',             0x28: 'ground off-center',
  0x29: 'shutter',             0x2A: 'retractable ground', 0x2B: 'hanging spike',
  0x2C: 'moving ladder',       0x2D: 'dissolving ground (enemy)', 0x2E: '3-pos switch',
  0x2F: 'pole tip',            0x30: 'pole',               0x31: 'waves',
  0x32: 'current right',       0x33: 'current left',       0x34: 'conveyor (fake)',
  0x35: 'current up',          0x36: 'water',              0x37: 'water fall',
  0x38: '0x38 ???',            0x39: 'elevator top (unused)', 0x3A: 'sprite (DK)',
  0x3B: 'ground off-center',   0x3C: '0x3C ???',           0x3D: '0x3D ???',
  0x3E: '0x3E ???',            0x3F: '0x3F ???',
  0x40: 'plant spitting left', 0x41: 'plant spitting right', 0x42: 'poisonous water',
  0x43: 'falling ground block',0x44: 'sprite (DK)',        0x45: '2-UP heart',
  0x46: '0x46 ???',            0x47: 'sprite (crushing stone)', 0x48: 'sprite (octopus)',
  0x49: 'broken ladder',       0x4A: 'sparking pole tip',  0x4B: 'fake exit',
  0x4C: 'ground with ghost?',  0x4D: 'sprite (squid)',     0x4E: 'sprite (fish)',
  0x4F: 'sprite (bat)',        0x50: 'sprite (walrus)',    0x51: 'winning ladder',
  0x52: 'ground same as 0x4C?',0x53: 'umbrella',           0x54: 'sprite (board)',
  0x55: 'ground',              0x56: 'smashable block',    0x57: 'sprite (hammer)',
  0x58: 'sprite (skull)',      0x59: 'ground off-center+ladder', 0x5A: 'sprite (crab)',
  0x5B: '0x5B ???',            0x5C: 'sprite (oil flames)', 0x5D: 'spring board',
  0x5E: 'sprite (DK)',         0x5F: 'ground off-center+ladder',
  0x60: 'X-tile',              0x61: 'liana right',        0x62: 'X-tile',
  0x63: 'liana right bottom',  0x64: 'sprite (enemy)',     0x65: 'hat',
  0x66: 'X-tile',              0x67: "bird's nest",        0x68: 'cannon left',
  0x69: 'cannon right',        0x6A: 'cannon left up',     0x6B: 'cannon up (left)',
  0x6C: 'cannon right up',     0x6D: 'cannon up (right)',  0x6E: 'sprite (DK)',
  0x6F: 'ground',              0x70: 'elevator up - bottom', 0x71: 'elevator up - top',
  0x72: 'elevator down - bottom', 0x73: 'elevator down - top', 0x74: '0x74 ???',
  0x75: 'placeable block',     0x76: 'placeable ladder (broken)', 0x77: 'placeable spring board',
  0x78: 'placeable ? (broken)', 0x79: 'exit',              0x7A: 'sprite (DK)',
  0x7B: 'elevator track',      0x7C: 'sprite (flame)',     0x7D: 'winning tile',
  0x7E: '0x7E ???',            0x7F: 'sprite (Mario)',
  0x80: 'sprite (friend)',     0x81: 'ground off-center',  0x82: '0x82 ???',
  0x83: 'ground off-center',   0x84: 'sprite (platform)',  0x85: 'ground off-center',
  0x86: 'sprite (enemy)',      0x87: 'ground off-center',  0x88: 'sprite (knight)',
  0x89: 'ground off-center+ladder', 0x8A: 'sprite (DK)',  0x8B: 'ground off-center+ladder',
  0x8C: 'X-tile',              0x8D: 'ground off-center+ladder', 0x8E: 'sprite (wind)',
  0x8F: 'ground off-center+ladder', 0x90: 'sprite (DK)',  0x91: 'ground off-center+ladder',
  0x92: 'sprite (DK)',         0x93: 'ground off-center+ladder', 0x94: 'sprite (monkey)',
  0x95: 'ground off-center+ladder', 0x96: 'sprite (icicle)', 0x97: 'ground off-center+ladder',
  0x98: 'sprite (enemy)',      0x99: 'ground off-center+ladder', 0x9A: 'sprite (DK)',
  0x9B: 'ground off-center+ladder', 0x9C: '0x9C ???',     0x9D: 'sprite (fruit)',
  0x9E: 'key',                 0x9F: 'ground off-center+ladder',
  0xA0: '0xA0 ???',            0xA1: 'ground off-center+ladder', 0xA2: 'sprite (frog)',
  0xA3: 'ground off-center+ladder', 0xA4: 'sprite (DK)',  0xA5: 'liana left',
  0xA6: 'sprite (DK)',         0xA7: 'liana left end',     0xA8: 'sprite (DK Jr)',
  0xA9: 'oil drum',            0xAA: 'sprite (DK)',        0xAB: '1-UP heart',
  0xAC: 'sprite (enemy)',      0xAD: 'water',              0xAE: 'sprite (trash)',
  0xAF: 'handbag',             0xB0: 'sprite (block)',     0xB1: '3-UP heart',
  0xB2: 'cannon #2 right',     0xB3: 'cannon #2 left',     0xB4: 'turret left',
  0xB5: 'turret right',        0xB6: 'sprite (klaptrap)',  0xB7: 'ground off-center',
  0xB8: 'sprite (key)',        0xB9: "bird's nest (switchable)", 0xBA: 'sprite (oil can)',
  0xBB: 'expanding ground',    0xBC: 'expanding ladder',   0xBD: 'placeable block (broken)',
  0xBE: 'sprite (DK)',         0xBF: 'mushroom - do not use',
  0xC0: 'sprite (Panser)',     0xC1: 'ground off-center+ladder', 0xC2: 'sprite (Pauline)',
  0xC3: 'ground off-center+ladder', 0xC4: 'super hammer', 0xC5: 'ground off-center+ladder',
  0xC6: 'sprite (DK Jr)',      0xC7: 'ground off-center+ladder', 0xC8: 'sprite (monkey)',
  0xC9: 'ground off-center+ladder', 0xCA: 'sprite (DK Jr)', 0xCB: 'ground off-center+ladder',
  0xCC: 'sprite (DK)',
};
// 0xCD-0xFC = background tiles
for (let i = 0xCD; i <= 0xFC; i++) TILE_NAMES[i] = 'background';
TILE_NAMES[0xFD] = 'ground';
TILE_NAMES[0xFE] = 'X-tile';
TILE_NAMES[0xFF] = 'empty tile';

// -------------------------------------------------------
// SPRITE_NAMES — human-readable names for sprite IDs
// Taken from QDKEdit::fillSpriteNames()
// -------------------------------------------------------
const SPRITE_NAMES = {
  0x1A: 'On/off switch',         0x20: 'Enemy switch',
  0x2E: '3-pos switch',          0x3A: 'Donkey Kong (Klaptraps)',
  0x44: 'Donkey Kong (Lvl 0-2)', 0x47: 'Crushing stone',
  0x48: 'Octopus',               0x4D: 'Squid',
  0x4E: 'Fish',                  0x4F: 'Bat',
  0x50: 'Walrus',                0x54: 'Board',
  0x57: 'Hammer',                0x58: 'Skull',
  0x5A: 'Hermit crab',           0x5C: 'Oil drum flames',
  0x5E: 'Donkey Kong (fireballs)', 0x64: 'Enemy',
  0x6E: 'Donkey Kong (barrels)', 0x70: 'Elevator up',
  0x72: 'Elevator down',         0x7A: 'Giant DK',
  0x7C: 'Flame',                 0x7F: 'Mario',
  0x80: 'Wall-walking friend',   0x84: 'Floating platform',
  0x86: 'Walking enemy',         0x88: 'Knight',
  0x8A: 'Donkey Kong (Egyptian/rock guys)', 0x8E: 'Wind',
  0x90: 'Donkey Kong (spring)',  0x92: 'Donkey Kong (barrels L/R)',
  0x94: 'Climbable monkey',      0x96: 'Falling icicle',
  0x98: 'Wall-walking enemy',    0x9A: 'Donkey Kong (avalanche)',
  0x9D: 'Fruit',                 0xA2: 'Frog',
  0xA4: 'Donkey Kong (boulders)', 0xA6: 'Donkey Kong (switch)',
  0xA8: 'DK Junior (mushrooms)', 0xAA: 'Donkey Kong (mushrooms)',
  0xAC: 'Trash can enemy',       0xAE: 'Trash can',
  0xB0: 'Walking block',         0xB6: 'Klaptrap',
  0xB8: 'Key',                   0xBA: 'Oil can',
  0xBE: 'Donkey Kong (pick-up barrels)', 0xC0: 'Panser',
  0xC2: 'Pauline',               0xC6: 'DK Junior (switch)',
  0xC8: 'Sleeping monkey',       0xCA: 'DK Junior (mushrooms)',
  0xCC: 'Donkey Kong (pick-up barrels)',
};

// -------------------------------------------------------
// TILE_GROUPS — tile palette groupings for the selector
// Taken from QDKEdit::setupTileSelector()
// -------------------------------------------------------
const TILE_GROUPS = [
  { label: 'Background tiles:', tiles: [
    0xCD,0xCE,0xCF,0xD0,0xD1,0xD2,0xD3,0xD4,0xD5,0xD6,0xD7,0xD8,0xD9,0xDA,0xDB,0xDC,
    0xDD,0xDE,0xDF,0xE0,0xE1,0xE2,0xE3,0xE4,0xE5,0xE6,0xE7,0xE8,0xE9,0xEA,0xEB,0xEC,
    0xED,0xEE,0xEF,0xF0,0xF1,0xF2,0xF3,0xF4,0xF5,0xF6,0xF7,0xF8,0xF9,0xFA,0xFB,0xFC,
  ]},
  { label: 'Climbable stuff:', tiles: [
    0x07,0x2C,0x49,0x08,0x30,0x2F,0x4A,0x1D,0x1E,0x1F,0x61,0x63,0xA5,0xA7,
  ]},
  { label: 'Collectables & exits:', tiles: [
    0x9E,0x79,0x7D,0x51,0x53,0x65,0xAF,0x4B,0xAB,0x45,0xB1,0x75,0x77,0xBB,0xBC,0xC4,
  ]},
  { label: 'Ground & water blocks:', tiles: [
    0x03,0x00,0x01,0x02,0x06,0x0B,0x1C,0x27,0xFD,0x4C,0x52,0x55,0x6F,
    0x05,0x26,0x2B,0x04,0x2D,0x43,0x29,0x2A,0x56,0x23,
    0x36,0x31,0x32,0x33,0x35,0xAD,0x37,0x42,
  ]},
  { label: 'Moving stuff:', tiles: [
    0x09,0x0A,0x34,0x21,0x22,0x0C,0x0D,0x0E,0x0F,0x10,0x11,0x12,0x13,0x14,0x15,0x16,
    0x17,0x1B,0x70,0x71,0x72,0x73,0x7B,
  ]},
  { label: 'Off-center ground blocks:', tiles: [
    0x81,0x3B,0x83,0x28,0x85,0xB7,0x87,
    0xC5,0x89,0xC7,0x99,0xC9,0x9B,0xCB,0x59,0x97,0x9F,0x8B,0xA1,0x8D,0xA3,
    0x8F,0x5F,0x91,0xC1,0x93,0xC3,0x95,
  ]},
  { label: 'Other objects:', tiles: [
    0x1A,0x2E,0x20,0x18,0x5D,0x40,0x41,0x67,0xB9,0xA9,
    0x68,0x6A,0x6B,0x6D,0x6C,0x69,0xB2,0xB3,0xB4,0xB5,
  ]},
];

// -------------------------------------------------------
// MUSIC_NAMES — music track labels (0x00-0x23)
// Source: MainWindow.ui cmbMusic items
// -------------------------------------------------------
const MUSIC_NAMES = [
  'No music',          "Time's almost up!", 'Item active',       '30 seconds left',
  'Pauline abducted',  'Arcade Level 1',    'Arcade Level 2',    'Big City',
  'Forest',            'Ship',              'Jungle',            'Desert',
  'Desert 2',          'Airplane',          'Iceberg',           'Rocky Valley 1',
  'Tower 1',           'Tower 2',           'Level 1-3',         'Spooky',
  'Level 1-7',         'Monkey Stage',      'Dangerous',         'Rock Valley 2',
  'Level 1-2',         'Battle 3',          'Battle 1 (1-4)',    'Battle 2 (1-8)',
  'Level 9-8',         'Level 9-9',         '???',               '???',
  '???',               'Level 6-2',         'Level 6-4',         'Level 6-8',
];

// -------------------------------------------------------
// TILESET_NAMES — tileset labels (0x00-0x21)
// Source: MainWindow.ui cmbTileset items
// -------------------------------------------------------
const TILESET_NAMES = [
  'Classic Girder 1', 'Airplane 1',    'Iceberg 1',     'Forest 1',
  'Rocky Valley 1',   'Ship 1',        'Desert 1',      'Airplane 2',
  'Tower 1',          'Clouds 1',      'Rocky Valley 2','Desert 2',
  'Big City 1',       'Ship 2',        'Jungle 1',      'Tower 2',
  'Classic Girder 2', 'Airplane 3',    'Iceberg 2',     'Forest 2',
  'Rocky Valley 3',   'Ship 3',        'Desert 3',      'Airplane 4',
  'Tower 3',          'Clouds 2',      'Rocky Valley 4','Desert 4',
  'Big City 2',       'Ship 4',        'Jungle 2',      'Tower 4',
  'Classic Girder 3', 'Giant DK Battle',
];

// -------------------------------------------------------
// Helper: display name for a tile or sprite ID
// -------------------------------------------------------
function tileLabel(id) {
  return TILE_NAMES[id] || ('Tile 0x' + id.toString(16).padStart(2,'0'));
}
function spriteLabel(id) {
  return SPRITE_NAMES[id] || ('Sprite 0x' + id.toString(16).padStart(2,'0'));
}
