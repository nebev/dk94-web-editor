'use strict';
// ============================================================
// rom-parser.js
// Parses and writes the Donkey Kong '94 Game Boy ROM.
// Closely ported from QDKEdit.cpp: loadAllLevels, saveAllLevels,
// readLevel, recompressLevel, getTileInfo, readSGBPalettes,
// expandRawTilemap, updateRawTilemap, exportCurrentLevel, importLevel,
// rebuildSwitchData, rebuildAddSpriteData.
// ============================================================

class RomParser {
  constructor() {
    this.rom = null;       // Uint8Array of the full ROM
    this.levels = [];      // Array of 256 level objects
    this.tileInfo = [];    // Array of 256 tile metadata objects
    this.sgbPal = [];      // 512 palettes, each [r,g,b,a] × 4
    this.tilesetBGP = new Uint8Array(C.MAX_TILESETS); // BGP register per tileset
    this._addOffset = 0;   // Accumulated offset for additional super-tile slots
  }

  // --------------------------------------------------------
  // Load ROM from an ArrayBuffer
  // Returns true on success
  // --------------------------------------------------------
  loadFromBuffer(buffer) {
    this.rom = new Uint8Array(buffer);
    if (!this.checkROMValidity()) { alert('Invalid ROM file. Please make sure you load v1 of the Donkey Kong 94 ROM'); return false; }
    if (!this._getTileInfo()) return false;
    if (!this._readSGBPalettes()) return false;
    if (!this._loadAllLevels()) return false;
    return true;
  }

  checkROMValidity() {
    if (!this.rom) { return false; }
    // Check for DK '94 header at 0x0104-0x0133
    const header = this.rom.slice(0x00000134, 0x0000013F);
    const decoder = new TextDecoder('ascii');
    const decodedHeader = decoder.decode(header);
    if (decodedHeader !== 'DONKEY KONG') { return false; }

    // Now make sure it's v 1.0, and not 1.1
    // Version information is at 014C
    const versionByte = this.rom[0x014C];
    if (versionByte === 0x00) { return true; } // v1.0

    return false;
  }

  // --------------------------------------------------------
  // Save modified ROM to a new ArrayBuffer
  // Ported from QDKEdit::saveAllLevels()
  // --------------------------------------------------------
  saveToBuffer() {
    // Work on a copy
    const out = new Uint8Array(this.rom);

    // Read the three ROM banks used for level data
    const rombank = [
      C.ROMBANK_1,
      out[C.ROMBANK_POS_2],
      out[C.ROMBANK_POS_3],
    ];
    const rombankLimit = [0, 0];
    let currentBank = 0;

    // Write level data sequentially into the ROM banks
    // Start AFTER the pointer table (C++ does: rom.seek(POINTER_TABLE + MAX_LEVEL_ID * 2))
    let writePos = C.POINTER_TABLE + C.MAX_LEVEL_ID * 2;  // = 0x14200

    for (let i = 0; i < C.LAST_LEVEL; i++) {
      this._recompressLevel(i);

      const data = this.levels[i].fullData;
      const pointer = (writePos % 0x4000) + 0x4000; // GB bus address in bank

      // Check if the current bank is full
      if ((pointer + data.length) > 0x8000) {
        if (currentBank > 1) {
          console.error(`Level ${i}: no more space in ROM!`);
          return null;
        }
        rombankLimit[currentBank] = i;
        currentBank++;
        writePos = rombank[currentBank] * 0x4000;
      }

      this.levels[i].rombank = rombank[currentBank];
      this.levels[i].offset  = writePos;

      out.set(data, writePos);
      writePos += data.length;
    }

    // Write SGB palette indices for each level
    for (let i = 0; i < C.LAST_LEVEL; i++) {
      if (i < 4) {
        // Arcade levels: palette = index - 0x180 + 0xC8
        out[C.PAL_ARCADE + i * 6] = (this.levels[i].paletteIndex - 0x180 + 0xC8) & 0xFF;
      } else {
        out[C.PAL_TABLE + (i - 4) * 6] = (this.levels[i].paletteIndex - 0x180) & 0xFF;
      }
    }

    // Write new pointer table
    let ptPtr = C.POINTER_TABLE;
    const dv = new DataView(out.buffer);
    for (let i = 0; i < C.LAST_LEVEL; i++) {
      const ptr16 = (this.levels[i].offset % 0x4000) + 0x4000;
      dv.setUint16(ptPtr, ptr16, true);
      ptPtr += 2;
    }
    // Remaining pointer table entries all point to the last level (C++ uses index LAST_LEVEL=105)
    const lastPtr = (this.levels[C.LAST_LEVEL].offset % 0x4000) + 0x4000;
    for (let i = C.LAST_LEVEL; i < C.MAX_LEVEL_ID; i++) {
      dv.setUint16(ptPtr, lastPtr, true);
      ptPtr += 2;
    }

    // Write bank boundary values
    out[C.COMPARE_POS_1] = rombankLimit[0];
    out[C.COMPARE_POS_2] = rombankLimit[1];

    // Fix ROM checksums (header checksum @ 0x014D, global @ 0x014E-0x014F)
    this._fixChecksums(out);

    return out.buffer;
  }

  // --------------------------------------------------------
  // Export the current level to a .lvl file buffer
  // Format: [1 byte palette offset] + [level fullData]
  // Ported from QDKEdit::exportCurrentLevel()
  // --------------------------------------------------------
  exportLevel(levelId) {
    this._recompressLevel(levelId);
    const lvl = this.levels[levelId];
    const palByte = (lvl.paletteIndex - 0x180) & 0xFF;
    const result = new Uint8Array(1 + lvl.fullData.length);
    result[0] = palByte;
    result.set(lvl.fullData, 1);
    return result.buffer;
  }

  // --------------------------------------------------------
  // Import a level from a .lvl file buffer into levelId slot
  // Ported from QDKEdit::importLevel()
  // --------------------------------------------------------
  importLevel(buffer, levelId) {
    const data = new Uint8Array(buffer);
    // First byte is palette offset (paletteIndex - 0x180)
    const palByte = data[0];
    // Remaining bytes are the raw level data (like in ROM)
    const lvlData = data.slice(1);

    // Store the full data
    this.levels[levelId].fullData = lvlData;
    this.levels[levelId].paletteIndex = 0x180 + palByte;

    // Parse the level from the lvl data
    return this._readLevelFromBytes(lvlData, levelId);
  }

  // --------------------------------------------------------
  // Get a human-readable info string for a level
  // --------------------------------------------------------
  getLevelInfo(id) {
    const lvl = this.levels[id];
    if (!lvl) return '';
    let s = `Size ${lvl.size.toString(16).padStart(2,'0').toUpperCase()}`
          + ` | Tileset ${lvl.tileset.toString(16).padStart(2,'0').toUpperCase()}`
          + ` | Music ${lvl.music.toString(16).padStart(2,'0').toUpperCase()}`
          + ` | Time ${lvl.time}`
          + ` | Raw size ${lvl.fullData ? lvl.fullData.length : '?'} bytes`
          + ` | Palette 0x${lvl.paletteIndex.toString(16).padStart(4,'0').toUpperCase()}`;
    if (!lvl.switchData)    s += ' | No switch data';
    if (!lvl.addSpriteData) s += ' | No add. sprite data';
    return s;
  }

  // --------------------------------------------------------
  // Default flag byte for a sprite ID
  // Ported from QDKEdit::getSpriteDefaultFlag()
  // --------------------------------------------------------
  getSpriteDefaultFlag(id) {
    switch (id) {
      case 0x80: case 0x98: return 0x03;  // wall-walking friend/enemy: moving right
      case 0x70: case 0x72: return 0x05;  // elevator: default speed/time setting
      case 0x54: case 0x84: return 0x00;
      case 0x7F: return 0x00;             // Mario
      case 0xB8: return 0xFF;             // key/keyhole
      case 0x6E: return 0xFF;             // DK (barrels)
      case 0x9A: return 0xFF;             // DK (avalanche)
      case 0xCC: return 0xFF;             // DK (pick-up barrels)
      default:   return 0x00;
    }
  }

  // ========================================================
  // PRIVATE METHODS
  // ========================================================

  // --------------------------------------------------------
  // Read all level data from this.rom
  // Ported from QDKEdit::loadAllLevels()
  // --------------------------------------------------------
  _loadAllLevels() {
    const rom = this.rom;

    // Read ROM bank numbers for each bank slot
    const rombank = [
      C.ROMBANK_1,
      rom[C.ROMBANK_POS_2],
      rom[C.ROMBANK_POS_3],
    ];

    // Bank boundaries: levels 0..(limit1-1) in bank0, limit1..(limit2-1) in bank1, rest in bank2
    const limit1 = rom[C.COMPARE_POS_1];
    const limit2 = rom[C.COMPARE_POS_2];

    this.levels = [];

    // Read pointer table and compute ROM file offsets
    for (let i = 0; i < C.MAX_LEVEL_ID; i++) {
      const bank = i < limit1 ? 0 : i < limit2 ? 1 : 2;
      const ptr = rom[C.POINTER_TABLE + i*2] | (rom[C.POINTER_TABLE + i*2 + 1] << 8);
      const offset = (rombank[bank] - 1) * 0x4000 + ptr;

      this.levels[i] = {
        id: i,
        rombank: rombank[bank],
        offset,
        size: 0, music: 0, tileset: 0, time: 0,
        switchData: false, addSpriteData: false,
        fullDataUpToDate: false,
        rawTilemap: null, displayTilemap: null,
        paletteIndex: 0x180,
        sprites: [], switches: [],
        rawSwitchData: null, rawAddSpriteData: null,
        fullData: null,
      };
    }

    // Parse each level
    let ok = true;
    for (let i = 0; i < C.MAX_LEVEL_ID; i++) {
      if (!this._readLevelFromROM(i)) ok = false;
    }
    return ok;
  }

  // --------------------------------------------------------
  // Parse one level from ROM at its known offset
  // --------------------------------------------------------
  _readLevelFromROM(id) {
    const rom = this.rom;
    const lvl = this.levels[id];
    let pos = lvl.offset;

    const startPos = pos;
    pos = this._parseLevelData(rom, pos, id);

    // Read palette
    let palByte;
    if (id < 4) {
      palByte = rom[C.PAL_ARCADE + id * 6] - 0xC8;
    } else {
      palByte = rom[C.PAL_TABLE + (id - 4) * 6];
    }
    lvl.paletteIndex = 0x180 + palByte;
    if (lvl.paletteIndex >= 0x200) lvl.paletteIndex = 0x180;

    // Store raw fullData (everything from level start to current read position)
    lvl.fullData = rom.slice(startPos, pos);
    lvl.fullDataUpToDate = true;

    return true;
  }

  // --------------------------------------------------------
  // Parse level from a standalone .lvl file byte array
  // The .lvl file starts with the palette byte, then level data
  // --------------------------------------------------------
  _readLevelFromBytes(data, id) {
    const lvl = this.levels[id];
    // data here is the level payload (everything after the palette byte)
    this._parseLevelData(data, 0, id);
    lvl.fullData = data;
    lvl.fullDataUpToDate = true;
    return true;
  }

  // --------------------------------------------------------
  // Core level data parser — shared between ROM and .lvl loading
  // Ported from QDKEdit::readLevel()
  // Returns the position after all level data has been consumed.
  // --------------------------------------------------------
  _parseLevelData(buf, pos, id) {
    const lvl = this.levels[id];

    lvl.size    = buf[pos++];
    lvl.music   = buf[pos++];
    lvl.tileset = buf[pos++];
    lvl.time    = buf[pos] | (buf[pos+1] << 8); pos += 2;

    // --- Switch data ---
    // First byte: 0x00 = no switch data, else = start of 0x11 raw bytes
    const switchByte = buf[pos++];
    lvl.rawSwitchData = null;
    lvl.switchData = false;

    if (switchByte !== 0x00) {
      lvl.switchData = true;
      // 0x11 bytes stored as-is (first byte already consumed above)
      const switchRaw = new Uint8Array(0xA1);
      switchRaw[0] = switchByte;
      for (let i = 1; i < 0x11; i++) switchRaw[i] = buf[pos++];

      // Remaining 0x90 bytes are RLE-encoded (zeros compressed)
      let outPos = 0x11;
      while (outPos < 0xA1) {
        const flag = buf[pos++];
        if (flag < 0x80) {
          // Run of zeros
          for (let i = 0; i < flag && outPos < 0xA1; i++) switchRaw[outPos++] = 0;
        } else {
          // Literal bytes
          const count = flag & 0x7F;
          for (let i = 0; i < count && outPos < 0xA1; i++) switchRaw[outPos++] = buf[pos++];
        }
      }
      lvl.rawSwitchData = switchRaw;
    }

    // --- Additional sprite data ---
    // First byte: 0x00 = none, else = start of RLE-encoded 0x40 bytes
    const addSpriteByte = buf[pos++];
    lvl.rawAddSpriteData = null;
    lvl.addSpriteData = false;

    if (addSpriteByte !== 0x00) {
      lvl.addSpriteData = true;
      const addRaw = new Uint8Array(0x40);
      let outPos = 0;
      let firstByte = addSpriteByte;
      let usedFirst = false;

      while (outPos < 0x40) {
        const flag = usedFirst ? buf[pos++] : (usedFirst = true, firstByte);
        if (flag < 0x80) {
          for (let i = 0; i < flag && outPos < 0x40; i++) addRaw[outPos++] = 0;
        } else {
          const count = flag & 0x7F;
          for (let i = 0; i < count && outPos < 0x40; i++) addRaw[outPos++] = buf[pos++];
        }
      }
      lvl.rawAddSpriteData = addRaw;
    }

    // --- LZSS-compressed tilemap ---
    const uncompSize = (lvl.size === 0x00) ? C.SMALL_TILEMAP_SIZE : C.LARGE_TILEMAP_SIZE;
    const { data: rawTilemap, endPos } = this._lzssDecompressAt(buf, pos, uncompSize);
    lvl.rawTilemap = rawTilemap;
    pos = endPos;

    // Expand 8-bit tilemap to 16-bit display format (with super-tile indices)
    lvl.displayTilemap = this._expandRawTilemap(rawTilemap);

    // --- Sprite list ---
    lvl.sprites = [];
    let sprId = buf[pos++];
    while (sprId !== 0x00) {
      const ramLo = buf[pos++];
      const ramHi = buf[pos++];
      const ramPos = ramLo | (ramHi << 8);
      const levelPos = ramPos - C.SPRITE_RAM_BASE;
      const spr = {
        id: sprId,
        ramPos,
        levelPos,
        x: levelPos % 32,
        y: Math.floor(levelPos / 32),
        flagByte: this.getSpriteDefaultFlag(sprId),
        rotate: 0,  // 0=BOTTOM, 1=FLIPPED/RIGHT, 2=TOP, 3=LEFT, 4=RIGHT
        drawOffsetX: (sprId === 0x54) ? -0.5 : 0,
        w: this.tileInfo[sprId] ? this.tileInfo[sprId].w : 1,
        h: this.tileInfo[sprId] ? this.tileInfo[sprId].h : 1,
      };
      lvl.sprites.push(spr);
      sprId = buf[pos++];
    }

    // Apply additional sprite data (flags and elevator tile-sprites)
    if (lvl.addSpriteData && lvl.rawAddSpriteData) {
      this._applyAddSpriteData(lvl);
    }

    // Parse switch data into structured objects
    lvl.switches = [];
    if (lvl.switchData && lvl.rawSwitchData) {
      lvl.switches = this._parseSwitchData(lvl.rawSwitchData);
    }

    return pos;
  }

  // --------------------------------------------------------
  // Apply rawAddSpriteData to sprite list
  // Ported from the addSpriteData handling block in readLevel()
  // --------------------------------------------------------
  _applyAddSpriteData(lvl) {
    const data = lvl.rawAddSpriteData;
    for (let i = 0; i < data.length; i += 4) {
      const byteId  = data[i];
      const address = data[i+1] | (data[i+2] << 8);
      const flag    = data[i+3];

      // Only these IDs have meaningful flags
      if (![0x7F,0x98,0x80,0x54,0x70,0x72,0x84,0xB8,0x9A,0x6E,0xCC].includes(byteId)) continue;

      // Elevator tiles: they correspond to a tilemap position, not a sprite RAM address
      if (byteId === 0x70 || byteId === 0x72) {
        // Check if that tilemap byte actually contains this tile ID
        const tileAddr = address - C.TILE_RAM_BASE;
        if (tileAddr >= 0 && tileAddr < lvl.rawTilemap.length && lvl.rawTilemap[tileAddr] === byteId) {
          const spr = {
            id: byteId,
            ramPos: address,
            levelPos: tileAddr,
            x: tileAddr % 32,
            y: Math.floor(tileAddr / 32),
            flagByte: flag,
            rotate: 0,
            drawOffsetX: 0,
            w: this.tileInfo[byteId] ? this.tileInfo[byteId].w : 1,
            h: this.tileInfo[byteId] ? this.tileInfo[byteId].h : 1,
          };
          lvl.sprites.push(spr);
        }
        continue;
      }

      // Find the matching sprite by RAM address and update its flag
      for (const spr of lvl.sprites) {
        if (spr.ramPos === address) {
          spr.flagByte = flag;
          // Direction/rotation for Mario
          if (byteId === 0x7F) spr.rotate = flag;
          // Direction for walking friends/enemies
          else if (byteId === 0x80 || byteId === 0x98) spr.rotate = (flag + 1) & 1;
          break;
        }
      }
    }
  }

  // --------------------------------------------------------
  // Parse rawSwitchData (0xA1 bytes) into QDKSwitch objects
  // Ported from the switch-parsing block in readLevel()
  // --------------------------------------------------------
  _parseSwitchData(raw) {
    const switches = [];
    const usedFlags = raw[0]; // Bitmask: which of 8 switch slots are used

    for (let i = 8; i > 0; i--) {
      if (!(usedFlags & (1 << (i - 1)))) continue;

      const connFlags = raw[i];           // Bitmask: which connected objects exist
      const state     = raw[8 + i];       // Switch state (0=left, 1=mid, 2=right)
      const ramLo     = raw[17 + (i-1)*18];
      const ramHi     = raw[17 + (i-1)*18 + 1];
      const ramPos    = ramLo | (ramHi << 8);
      const levelPos  = ramPos - C.TILE_RAM_BASE;

      const sw = {
        state,
        x: levelPos % 32,
        y: Math.floor(levelPos / 32),
        levelPos,
        ramPos,
        connectedTo: [],
      };

      for (let j = 8; j > 0; j--) {
        if (!(connFlags & (1 << (j - 1)))) continue;

        const objLo  = raw[17 + (i-1)*18 + j*2];
        const objHi  = raw[17 + (i-1)*18 + j*2 + 1];
        const objRam = objLo | (objHi << 8);
        const isSprite = (objRam >= 0xDA00);
        const objLevelPos = isSprite ? (objRam - C.SPRITE_RAM_BASE) : (objRam - C.TILE_RAM_BASE);

        sw.connectedTo.push({
          x: objLevelPos % 32,
          y: Math.floor(objLevelPos / 32),
          levelPos: objLevelPos,
          ramPos: objRam,
          isSprite,
        });
      }

      switches.push(sw);
    }
    return switches;
  }

  // --------------------------------------------------------
  // Expand 8-bit raw tilemap to 16-bit display tilemap
  // Super-tiles occupy multiple tilemap cells; the additional cells
  // store extended tile IDs (0x100 + additionalTilesAt + offset).
  // Ported from QDKEdit::expandRawTilemap()
  // --------------------------------------------------------
  _expandRawTilemap(raw) {
    // Each tile takes 2 bytes: [low, high] where high=0 for base tiles
    const out = new Uint8Array(raw.length * 2);
    for (let i = 0; i < raw.length; i++) {
      out[i*2]   = raw[i];
      out[i*2+1] = 0x00;
    }

    // Fill in additional cells for multi-cell tiles
    for (let i = 0; i < raw.length; i++) {
      const tileId = raw[i];
      if (tileId === 0xFF) continue;
      const ti = this.tileInfo[tileId];
      if (!ti || ti.count <= 1) continue;

      let tilePos = 0x100 + ti.additionalTilesAt;
      for (let j = 0; j < ti.h; j++) {
        for (let k = 0; k < ti.w; k++) {
          if (!k && !j) continue; // Skip the root cell
          const idx = (i + k + j * 32) * 2;
          if (idx + 1 < out.length) {
            out[idx]   = tilePos & 0xFF;
            out[idx+1] = (tilePos >> 8) & 0xFF;
          }
          tilePos++;
        }
      }
    }
    return out;
  }

  // --------------------------------------------------------
  // Collapse 16-bit display tilemap back to 8-bit raw tilemap
  // Ported from QDKEdit::updateRawTilemap()
  // --------------------------------------------------------
  _updateRawTilemap(displayTilemap) {
    const len = displayTilemap.length / 2;
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      out[i] = displayTilemap[i*2+1] === 0 ? displayTilemap[i*2] : 0xFF;
    }
    return out;
  }

  // --------------------------------------------------------
  // Recompress a level's fullData from its parsed components
  // Ported from QDKEdit::recompressLevel()
  // --------------------------------------------------------
  _recompressLevel(id) {
    const lvl = this.levels[id];
    if (lvl.fullDataUpToDate) return;

    // Rebuild raw tilemap from display tilemap
    lvl.rawTilemap = this._updateRawTilemap(lvl.displayTilemap);

    // Rebuild additional sprite data
    this._rebuildAddSpriteData(id);

    // Rebuild switch data
    this._rebuildSwitchData(id);

    const bytes = [];

    // Header: size, music, tileset, time (2 bytes LE)
    bytes.push(lvl.size, lvl.music, lvl.tileset,
               lvl.time & 0xFF, (lvl.time >> 8) & 0xFF);

    // Switch data
    if (!lvl.switchData) {
      bytes.push(0x00);
    } else {
      // First 0x11 bytes verbatim
      for (let i = 0; i < 0x11; i++) bytes.push(lvl.rawSwitchData[i]);
      // Remaining 0x90 bytes RLE-encoded (same scheme as reading)
      const rleBytes = this._rleEncode(lvl.rawSwitchData, 0x11, 0xA1);
      for (const b of rleBytes) bytes.push(b);
    }

    // Additional sprite data
    if (!lvl.addSpriteData) {
      bytes.push(0x00);
    } else {
      const rleBytes = this._rleEncode(lvl.rawAddSpriteData, 0, 0x40);
      // First byte is the start marker (not 0x00 to indicate presence)
      // The rleBytes already encodes from the start, so first byte must != 0
      // If it happens to be 0 (run of zeros) that would read as "no data"
      // The C++ handles this by writing the RLE directly — same approach
      for (const b of rleBytes) bytes.push(b);
    }

    // LZSS-compressed tilemap
    const compressed = lzssCompress(lvl.rawTilemap);
    for (const b of compressed) bytes.push(b);

    // Sprite list (not elevator pseudo-sprites)
    for (const spr of lvl.sprites) {
      if (spr.id === 0x70 || spr.id === 0x72) continue;
      bytes.push(spr.id, spr.ramPos & 0xFF, (spr.ramPos >> 8) & 0xFF);
    }
    bytes.push(0x00); // End marker

    lvl.fullData = new Uint8Array(bytes);
    lvl.fullDataUpToDate = true;
  }

  // --------------------------------------------------------
  // RLE encode data (used for switch data and add sprite data)
  // Ported from the inline compression in QDKEdit::recompressLevel()
  // Format: count<0x80 → count zeros; count>=0x80 → (count&0x7F) literal bytes
  // --------------------------------------------------------
  _rleEncode(src, startIdx, endIdx) {
    const out = [];
    let i = startIdx;
    while (i < endIdx) {
      let count = 0;
      // Count zero bytes
      while (i < endIdx && src[i] === 0 && count < 0x7F) { count++; i++; }
      if (count > 0) { out.push(count); continue; }

      // Count non-zero bytes
      while (i < endIdx && src[i] !== 0 && count < 0x7F) { count++; i++; }
      if (count > 0) {
        out.push(0x80 | count);
        for (let j = i - count; j < i; j++) out.push(src[j]);
      }
    }
    return out;
  }

  // --------------------------------------------------------
  // Rebuild rawAddSpriteData from sprite list
  // Ported from QDKEdit::rebuildAddSpriteData()
  // --------------------------------------------------------
  _rebuildAddSpriteData(id) {
    const lvl = this.levels[id];
    const raw = new Uint8Array(0x40);
    let count = 0;

    // Walk sprites in reverse order (matches C++ loop direction)
    for (let i = lvl.sprites.length - 1; i >= 0; i--) {
      const spr = lvl.sprites[i];
      const def = this.getSpriteDefaultFlag(spr.id);
      if (spr.flagByte === def) continue;
      if (count >= 0x10) { console.warn(`Level ${id}: too many flagged sprites`); break; }

      // Elevator pseudo-sprites: verify tilemap still has the tile
      if ((spr.id === 0x70 || spr.id === 0x72) &&
          lvl.rawTilemap[spr.levelPos] !== spr.id) continue;

      raw[count*4]   = spr.id;
      raw[count*4+1] = spr.ramPos & 0xFF;
      raw[count*4+2] = (spr.ramPos >> 8) & 0xFF;
      raw[count*4+3] = spr.flagByte;
      count++;
    }

    if (count === 0) {
      lvl.rawAddSpriteData = null;
      lvl.addSpriteData = false;
    } else {
      lvl.rawAddSpriteData = raw;
      lvl.addSpriteData = true;
    }
  }

  // --------------------------------------------------------
  // Rebuild rawSwitchData from switches array
  // Ported from QDKEdit::rebuildSwitchData()
  // --------------------------------------------------------
  _rebuildSwitchData(id) {
    const lvl = this.levels[id];
    if (!lvl.switches || lvl.switches.length === 0) {
      lvl.rawSwitchData = null;
      lvl.switchData = false;
      return;
    }

    lvl.switchData = true;
    const raw = new Uint8Array(0x11 + 0x90); // 0xA1 bytes total
    const switchCount = Math.min(lvl.switches.length, 8);

    // Switch-used bitmask (bit N set = slot N used)
    raw[0] = (1 << switchCount) - 1;

    for (let i = 0; i < switchCount; i++) {
      const sw = lvl.switches[switchCount - 1 - i]; // Reversed order (matches C++)
      raw[9 + i]  = sw.state;
      raw[17 + i*18]     = sw.ramPos & 0xFF;
      raw[17 + i*18 + 1] = (sw.ramPos >> 8) & 0xFF;

      const objCount = Math.min(sw.connectedTo.length, 8);
      raw[1 + i] = (1 << objCount) - 1; // Connected-object bitmask

      for (let j = 0; j < objCount; j++) {
        const obj = sw.connectedTo[objCount - 1 - j];
        raw[17 + i*18 + j*2 + 2] = obj.ramPos & 0xFF;
        raw[17 + i*18 + j*2 + 3] = (obj.ramPos >> 8) & 0xFF;
      }
    }
    lvl.rawSwitchData = raw;
  }

  // --------------------------------------------------------
  // Read SGB palette data from ROM
  // Palettes are LZSS-compressed at SGB_SYSTEM_PAL (0x1000 bytes)
  // Each palette: 4 × 15-bit RGB555 colors (LE)
  // Ported from QDKEdit::readSGBPalettes()
  // --------------------------------------------------------
  _readSGBPalettes() {
    const { data } = this._lzssDecompressAt(this.rom, C.SGB_SYSTEM_PAL, 0x1000);
    this.sgbPal = [];
    let pos = 0;
    for (let i = 0; i < 512; i++) {
      const pal = [];
      for (let j = 0; j < 4; j++) {
        const color16 = data[pos] | (data[pos+1] << 8); pos += 2;
        // RGB555 → RGB888 (multiply by 8, clamp 248→255)
        const r = (color16 & 0x1F) * 8;
        const g = ((color16 >> 5) & 0x1F) * 8;
        const b = ((color16 >> 10) & 0x1F) * 8;
        pal.push([r === 248 ? 255 : r, g === 248 ? 255 : g, b === 248 ? 255 : b, 255]);
      }
      this.sgbPal.push(pal);
    }
    return true;
  }

  // --------------------------------------------------------
  // Parse tile metadata for all 255 tile IDs
  // Ported from QDKEdit::getTileInfo()
  // It reads the pointer table at TILE_INDEX_TABLE and follows
  // several levels of indirection to find tile graphics offsets.
  // --------------------------------------------------------
  _getTileInfo() {
    const rom = this.rom;
    this.tileInfo = new Array(256);
    let addOffset = 0;  // Next available additional-tile slot index

    for (let i = 0; i < 256; i++) {
      this.tileInfo[i] = {
        w: 1, h: 1, count: 1, fullCount: 1,
        compressed: false, setSpecific: false,
        additionalTilesAt: 0, romOffset: 0,
        needsTiles: [], projectileTileCount: 0, type: 0,
      };
    }

    for (let i = 0; i < 255; i++) {
      const ti = this.tileInfo[i];

      // TILE_INDEX_TABLE: 2-byte LE pointer for each tile
      const pointer = rom[C.TILE_INDEX_TABLE + i*2] | (rom[C.TILE_INDEX_TABLE + i*2 + 1] << 8);

      ti.setSpecific = false;
      ti.type = 0;
      ti.projectileTileCount = 0;
      let tilesCount = 0;

      // The game stores tile metadata at the pointer. We try several offsets
      // to find tilesCount because different tile types store it differently.

      // Sprites (except 0x54): try pointer+3 first
      if (IS_SPRITE[i] && i !== 0x54) {
        tilesCount = rom[pointer + 3];
        ti.type = 3;
      }

      if (tilesCount === 0) { tilesCount = rom[pointer + 4]; ti.type = 4; }
      if (tilesCount === 0) { tilesCount = rom[pointer + 5]; ti.type = 5; }

      if (tilesCount === 0) {
        tilesCount = rom[pointer + 2];
        ti.type = 2;

        if (tilesCount !== 0) {
          const proj = rom[pointer + 3];
          if (proj) {
            ti.projectileTileCount = proj + rom[pointer + 13];
          }

          // Special cases that store an extra count at pointer+0xD
          if ([0x9A,0x8A,0x9D,0x9E,0x54,0x43,0x79,0xAF,0x53,0x65].includes(i)) {
            const extra = rom[pointer + 0xD];
            if (extra >= tilesCount) tilesCount = extra;
          }
        }
      }

      if (tilesCount === 0) { tilesCount = rom[pointer + 3]; ti.type = 3; }

      // Tiles with ≥4 frames are compressed
      ti.compressed = (tilesCount >= 4);

      // Override compression flag for special tiles (see C++ comment)
      if ([0x9A,0x8A,0x9D,0x9E,0x54,0x43,0x79,0xAF,0x53,0x65].includes(i)) {
        const extra = rom[pointer + 0xD];
        ti.compressed = ((tilesCount - extra) >= 4);
      }

      // Read tile dimensions (h, w) and compute cell count
      ti.h = rom[pointer + 8];
      ti.w = rom[pointer + 9];
      ti.count = ti.h * ti.w;
      ti.fullCount = tilesCount;

      if (ti.count === 0) continue;

      // Multi-cell tiles need additional tilemap slots
      if (ti.count > 1) {
        ti.additionalTilesAt = addOffset;
        addOffset += ti.count - 1;
      }

      // Overrides for specific problematic sprites
      if (i === 0x8A) ti.h = 4;
      if (i === 0x8E) { ti.h = 2; ti.w = 2; }

      // Read the actual graphics pointer (at pointer+6, 16-bit LE)
      let gfxPtr = rom[pointer + 6] | (rom[pointer + 7] << 8);

      if (gfxPtr < 0x7E00) {
        // Direct pointer within a ROM bank
        // Bank depends on tile ID range (from C++ getTileInfo logic)
        let offset;
        if      (i < 0x80) offset = 0xD * 0x4000 + gfxPtr;
        else if (i < 0xAF) offset = 0xC * 0x4000 + gfxPtr;
        else               offset = 0x1B * 0x4000 + gfxPtr;

        ti.romOffset = offset;

        // Mario special case
        if (i === 0x7F) {
          ti.romOffset = 0x106F0;
          ti.fullCount = 0x50;
        }
      } else {
        // Indirect pointer: read (bank, ptr) from bank 0xD
        const indirectAddr = 0xD * 0x4000 + gfxPtr;
        const bank    = rom[indirectAddr];
        const ptr2    = rom[indirectAddr + 1] | (rom[indirectAddr + 2] << 8);
        ti.romOffset  = (bank - 1) * 0x4000 + ptr2;
        ti.setSpecific = true;
      }
    }

    // Empty tile (0xFF) defaults
    const ff = this.tileInfo[0xFF];
    ff.fullCount = 1; ff.w = 1; ff.h = 1; ff.count = 1; ff.compressed = false;

    // Board sprite (0x54) has 4 frames total
    this.tileInfo[0x54].fullCount = 4;

    // Determine tileset BGP register for each tileset
    // 0x6C for certain tilesets, 0x9C for others
    for (let id = 0; id < C.MAX_TILESETS; id++) {
      const tmp = id & 0x0F;
      this.tilesetBGP[id] = (id === 0x20 || tmp === 0x02 || tmp === 0x0C || tmp === 0x0E)
        ? 0x6C : 0x9C;
    }

    // Read additional-tile dependency table
    // Format: [count, tileId, byte0, byte1, ..., count, ...]  terminated by 0xFF
    let pos = C.ADDITIONAL_TILES_TABLE;
    let cnt = rom[pos++];
    while (cnt !== 0xFF) {
      const tile = rom[pos++];
      for (let i = 0; i < cnt; i++) {
        this.tileInfo[tile].needsTiles.push(rom[pos++]);
      }
      cnt = rom[pos++];
    }

    return true;
  }

  // --------------------------------------------------------
  // Internal wrapper for lzssDecompress that also returns endPos
  // --------------------------------------------------------
  _lzssDecompressAt(buf, pos, size) {
    // We need to track how many bytes were consumed
    // Re-implement the decompressor inline to track position
    const out = new Uint8Array(size);
    let outPos = 0;
    let p = pos;

    while (outPos < size) {
      const flags = buf[p++];
      for (let i = 0; i < 8 && outPos < size; i++) {
        if (flags & (1 << i)) {
          out[outPos++] = buf[p++];
        } else {
          const b1 = buf[p++];
          const b2 = buf[p++];
          const start = b1 + ((b2 >> 4) * 256);
          const len   = (b2 & 0x0F) + 3;
          if (start === 0) { return { data: out.slice(0, outPos), endPos: p }; }
          const base = outPos - start;
          for (let j = 0; j < len && outPos < size; j++) {
            out[outPos++] = out[base + j];
          }
        }
      }
    }
    return { data: out, endPos: p };
  }

  // --------------------------------------------------------
  // Fix Game Boy ROM checksums after modification
  // Ported from QDKEdit::saveAllLevels() checksum section
  // --------------------------------------------------------
  _fixChecksums(rom) {
    let globalSum = 0;
    let headerSum = 0;

    for (let i = 0; i < rom.length; i++) {
      if (i < 0x0134) {
        globalSum += rom[i];
      } else if (i < 0x014D) {
        globalSum += rom[i];
        headerSum += rom[i];
      } else if (i === 0x014D) {
        // skip — this is the header checksum byte itself
      } else {
        globalSum += rom[i];
      }
    }

    // Header checksum = 0xE7 - sum_of_0x0134_to_0x014C
    const newHeaderChk = (0xE7 - headerSum) & 0xFF;
    rom[0x014D] = newHeaderChk;
    globalSum += newHeaderChk;

    // Global checksum = 16-bit sum of entire ROM (excluding the checksum bytes)
    const dv = new DataView(rom.buffer);
    dv.setUint16(0x014E, globalSum & 0xFFFF, false); // Big-endian
  }

  // --------------------------------------------------------
  // Calculate VRAM usage for a level
  // Ported from QDKEdit::calcVRAMusage()
  // Returns { tiles, sprites }
  // --------------------------------------------------------
  calcVRAMUsage(displayTilemap, sprites) {
    let tileCount    = 0;
    let spriteCount  = 0;
    let elevatorSeen = false;
    const neededTiles = new Set();

    // Count tiles used in tilemap (each tile type counted once)
    const seenTiles = new Set();
    for (let j = 0; j < displayTilemap.length; j += 2) {
      const tileId = displayTilemap[j];
      const hiNib  = displayTilemap[j+1];
      if (hiNib !== 0) continue;            // Skip additional super-tile cells
      if (tileId === 0xFF) continue;        // Skip empty tile
      if (seenTiles.has(tileId)) continue;
      seenTiles.add(tileId);

      const ti = this.tileInfo[tileId];
      if (!ti) continue;

      // Some "tile" types actually live in sprite VRAM
      if ([0x79,0x9E,0x4B,0xBB,0xBC,0x75,0x77,0xC4].includes(tileId)) {
        spriteCount += ti.fullCount;
      } else {
        tileCount += ti.fullCount;
      }

      // Elevator graphics count as sprites
      if ([0x70,0x71,0x72,0x73].includes(tileId)) {
        if (!elevatorSeen) { elevatorSeen = true; spriteCount += 4; }
      }

      if (ti.needsTiles.length > 0) {
        for (const nt of ti.needsTiles) neededTiles.add(nt);
      }
      if (ti.projectileTileCount) spriteCount += ti.projectileTileCount;
    }

    // Count sprite graphics (each sprite type counted once)
    const seenSprites = new Set();
    for (const spr of sprites) {
      if (spr.id === 0x70 || spr.id === 0x72) continue; // Pseudo-sprites
      if (seenSprites.has(spr.id)) continue;
      seenSprites.add(spr.id);

      const ti = this.tileInfo[spr.id];
      if (!ti) continue;
      spriteCount += ti.fullCount;

      if (ti.needsTiles.length > 0) {
        for (const nt of ti.needsTiles) spriteCount += this.tileInfo[nt].fullCount;
      }
    }

    // Add needed supporting tiles
    for (const nt of neededTiles) {
      const ti = this.tileInfo[nt];
      if (ti) spriteCount += ti.fullCount;
    }

    return { tiles: tileCount, sprites: spriteCount };
  }
}
