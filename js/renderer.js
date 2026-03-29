'use strict';
// ============================================================
// renderer.js
// Extracts tile and sprite graphics from the ROM and renders
// the level editor canvas and tile palette.
//
// Ported from QDKEdit::createTileSets(), createSprites(),
// copyTileToSet(), sortSprite(), copyTile(), fillTile(),
// swapTiles(), updateTileset().
// ============================================================

class Renderer {
  /**
   * @param {RomParser} parser  - Loaded ROM parser instance
   */
  constructor(parser) {
    this.parser = parser;
    // Raw palette-index data (0-3) for each tileset atlas (128×352 pixels)
    // Indexed as this._tilesetRaw[tilesetId] = Uint8Array(128*352)
    this._tilesetRaw = new Array(C.MAX_TILESETS).fill(null);
    // Raw palette-index data for each sprite (indexed by "sprite_NN" or "sprite_NN_set_SS" key)
    this._spriteRaw = {};   // key → { w, h, data: Uint8Array(w*8 * h*8) }
    // Cached coloured ImageData for the current tileset/palette
    this._currentTilesetId  = -1;
    this._currentPalIdx     = -1;
    this._tilesetCanvas     = null; // OffscreenCanvas with coloured tileset atlas
    this._spriteCanvases    = {};   // key → OffscreenCanvas with coloured sprite
  }

  // --------------------------------------------------------
  // Build raw (palette-index) tile data for all tilesets.
  // Call once after ROM is loaded.
  // --------------------------------------------------------
  buildTilesetRawData() {
    for (let setId = 0; setId < C.MAX_TILESETS; setId++) {
      this._buildOneTileset(setId);
    }
  }

  // --------------------------------------------------------
  // Build raw sprite data for all sprite IDs.
  // Call once after ROM is loaded.
  // --------------------------------------------------------
  buildSpriteRawData() {
    const rom = this.parser.rom;
    for (let id = 0; id < 256; id++) {
      if (!IS_SPRITE[id]) continue;
      const ti = this.parser.tileInfo[id];
      if (!ti || ti.count === 0) continue;

      if (ti.setSpecific) {
        for (let setId = 0; setId < C.MAX_TILESETS; setId++) {
          const key = `spr_${id}_set_${setId}`;
          this._spriteRaw[key] = this._extractSprite(rom, id, setId);
        }
      } else {
        const key = `spr_${id}`;
        this._spriteRaw[key] = this._extractSprite(rom, id, 0);
      }
    }
  }

  // --------------------------------------------------------
  // Apply the current palette to the tileset and return a
  // canvas element ready for drawing.
  // --------------------------------------------------------
  getTilesetCanvas(tilesetId, palIdx) {
    if (this._currentTilesetId === tilesetId && this._currentPalIdx === palIdx) {
      return this._tilesetCanvas;
    }

    const raw = this._tilesetRaw[tilesetId];
    if (!raw) return null;

    // Map colour indices through BGP register and SGB palette
    const bgp   = this.parser.tilesetBGP[tilesetId];
    const pal   = this.parser.sgbPal[palIdx];
    const cmap  = this._buildBGPColorMap(bgp, pal);   // 4 RGBA arrays

    const W = 128, H = 352;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(W, H);
    const px  = img.data;

    for (let i = 0; i < raw.length; i++) {
      const [r,g,b,a] = cmap[raw[i]];
      px[i*4]   = r; px[i*4+1] = g; px[i*4+2] = b; px[i*4+3] = a;
    }

    ctx.putImageData(img, 0, 0);
    this._tilesetCanvas    = canvas;
    this._currentTilesetId = tilesetId;
    this._currentPalIdx    = palIdx;
    return canvas;
  }

  // --------------------------------------------------------
  // Get a coloured sprite canvas for a given ID, tileset and palette.
  // OBP register = 0x1E (fixed for sprites in this game).
  // --------------------------------------------------------
  getSpriteCanvas(spriteId, tilesetId, palIdx, transparent = true) {
    const ti  = this.parser.tileInfo[spriteId];
    if (!ti) return null;

    const key = ti.setSpecific
      ? `spr_${spriteId}_set_${tilesetId}`
      : `spr_${spriteId}`;

    const raw = this._spriteRaw[key];
    if (!raw) return null;

    const OBP  = 0x1E;
    const pal  = this.parser.sgbPal[palIdx];
    const cmap = this._buildBGPColorMap(OBP, pal);

    // Colour index 0 is transparent for sprites
    if (transparent) cmap[0][3] = 0;

    const W = raw.w * 8, H = raw.h * 8;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(W, H);
    const px  = img.data;

    for (let i = 0; i < raw.data.length; i++) {
      const [r,g,b,a] = cmap[raw.data[i]];
      px[i*4]   = r; px[i*4+1] = g; px[i*4+2] = b; px[i*4+3] = a;
    }

    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  // --------------------------------------------------------
  // Map a BGP/OBP register byte to an array of 4 RGBA colours
  // The register is 8 bits: bits[1:0] = colour-index-0 mapping, etc.
  // --------------------------------------------------------
  _buildBGPColorMap(bgpReg, pal) {
    const map = [];
    for (let i = 0; i < 4; i++) {
      const palIdx = (bgpReg >> (i * 2)) & 0x03;
      map.push([...pal[palIdx]]); // copy so we can mutate alpha
    }
    return map;
  }

  // --------------------------------------------------------
  // Tile position within the 128×352 atlas
  // Tiles 0x00-0xFF → rows 0-15; extended (0x100+) → rows 16+
  // --------------------------------------------------------
  _tileAtlasPos(tileId) {
    return {
      x: (tileId % 16) * 8,
      y: Math.floor(tileId / 16) * 8,
    };
  }

  // --------------------------------------------------------
  // Build raw palette-index pixel data for one tileset.
  // Ported from QDKEdit::createTileSets() + copyTileToSet().
  // --------------------------------------------------------
  _buildOneTileset(setId) {
    const W = 128, H = 352;
    const raw = new Uint8Array(W * H); // All zeros (colour index 0)

    for (let id = 0; id < 255; id++) {
      const ti = this.parser.tileInfo[id];
      if (!ti || ti.count === 0) continue;
      this._copyTileToAtlas(raw, id, setId, ti);
    }

    this._tilesetRaw[setId] = raw;
  }

  // --------------------------------------------------------
  // Copy tile pixel data into the 128×352 atlas buffer.
  // Ported from QDKEdit::copyTileToSet().
  // --------------------------------------------------------
  _copyTileToAtlas(raw, tileId, setId, ti) {
    const rom = this.parser.rom;
    let dataPos;

    if (ti.setSpecific) {
      // Look up sub-tileset offsets
      const firstSet  = rom[C.SUBTILESET_TABLE + setId*2];
      const secondSet = rom[C.SUBTILESET_TABLE + setId*2 + 1];
      const subOff = (tileId < 0xCD || tileId === 0xFD) ? firstSet : secondSet;
      const ptrPos = ti.romOffset + subOff;
      const ptr    = rom[ptrPos] | (rom[ptrPos+1] << 8);
      dataPos = ti.romOffset + ptr;
    } else {
      dataPos = ti.romOffset;
    }

    let tileBytes;
    if (ti.compressed) {
      tileBytes = lzssDecompress(rom, dataPos, 0x10 * ti.count);
    } else {
      tileBytes = rom.slice(dataPos, dataPos + 0x10 * ti.count);
    }

    // Decode and write each 8×8 tile into the atlas
    let currentId = tileId;
    for (let t = 0; t < ti.count; t++) {
      const { x: tx, y: ty } = this._tileAtlasPos(currentId);
      const base = t * 16; // 16 bytes per 8×8 tile

      for (let row = 0; row < 8; row++) {
        let lo = tileBytes[base + row*2];
        let hi = tileBytes[base + row*2 + 1];
        for (let col = 0; col < 8; col++) {
          const pixel = ((lo >> 7) & 1) | (((hi >> 7) & 1) << 1);
          raw[(ty + row) * 128 + (tx + col)] = pixel;
          lo = (lo << 1) & 0xFF;
          hi = (hi << 1) & 0xFF;
        }
      }

      // Next cell for super-tiles
      currentId = 0x100 + ti.additionalTilesAt + t;
    }
  }

  // --------------------------------------------------------
  // Extract raw pixel data for a single sprite.
  // Ported from QDKEdit::createSprites() + sortSprite().
  // --------------------------------------------------------
  _extractSprite(rom, id, setId) {
    const ti = this.parser.tileInfo[id];
    const W  = ti.w, H = ti.h;
    const data = new Uint8Array(W*8 * H*8);
    data.fill(3); // Default to colour index 3 (background)

    let dataPos;
    if (ti.setSpecific) {
      const firstSet  = rom[C.SUBTILESET_TABLE + setId*2];
      const secondSet = rom[C.SUBTILESET_TABLE + setId*2 + 1];
      const subOff = (id < 0xCD || id === 0xFD) ? firstSet : secondSet;
      const ptrPos = ti.romOffset + subOff;
      const ptr    = rom[ptrPos] | (rom[ptrPos+1] << 8);
      dataPos = ti.romOffset + ptr;
    } else {
      dataPos = ti.romOffset;
    }

    let decompSize;
    if (id === 0xC2)      decompSize = 0x10 * (ti.count + 2);
    else if (id === 0x8E) decompSize = 0x40;
    else                  decompSize = 0x10 * ti.count;

    let tileBytes;
    if (ti.compressed) {
      tileBytes = lzssDecompress(rom, dataPos, decompSize);
    } else {
      tileBytes = rom.slice(dataPos, dataPos + decompSize);
    }

    let byteOffset = 0;

    for (let col = 0; col < W; col++) {
      for (let row = 0; row < H; row++) {
        const px0 = col * 8;
        const py0 = row * 8;

        // Pauline (0xC2): the ROM stores 2 dummy/empty tiles before the real data
        // in the first column. Discard those 16 bytes then draw the NEXT tile at
        // the same grid position — matching the C++ createSprites() behaviour
        // (it reads and discards, then falls through to the pixel-drawing loop).
        if (id === 0xC2 && col === 0 && (row === 0 || row === 1)) {
          byteOffset += 16;  // discard dummy tile, then draw the following one here
        }

        for (let y = 0; y < 8; y++) {
          let lo = tileBytes[byteOffset++] || 0;
          let hi = tileBytes[byteOffset++] || 0;
          for (let x = 0; x < 8; x++) {
            const pixel = ((lo >> 7) & 1) | (((hi >> 7) & 1) << 1);
            data[(py0 + y) * (W*8) + (px0 + x)] = pixel;
            lo = (lo << 1) & 0xFF;
            hi = (hi << 1) & 0xFF;
          }
        }
      }
    }

    // Rearrange tiles to match the display order expected by the editor
    // Ported from QDKEdit::sortSprite()
    this._sortSprite(data, id, W, H);

    return { w: W, h: H, data };
  }

  // --------------------------------------------------------
  // Rearrange sprite tiles for display
  // Ported from QDKEdit::sortSprite()
  // The ROM stores some sprite tiles in a different order than they appear
  // on screen, so we permute them here.
  // --------------------------------------------------------
  _sortSprite(data, id, W, H) {
    // Normal trash can: mirror right column from left
    if (id === 0xAE) {
      this._copyTilePx(data, W, 0,0, 1,0, true);
      this._copyTilePx(data, W, 0,1, 1,1, true);
    }
    // Moving trash can
    if (id === 0xAC) {
      this._copyTilePx(data, W, 1,1, 0,1, false);
      this._copyTilePx(data, W, 1,2, 0,2, false);
      this._copyTilePx(data, W, 0,1, 1,1, true);
      this._copyTilePx(data, W, 0,2, 1,2, true);
      this._fillTilePx(data, W, 0,0, 0);
      this._fillTilePx(data, W, 1,0, 0);
    }
    // Pauline
    if (id === 0xC2) {
      this._swapTilesPx(data, W, 0,1, 1,0);
      this._swapTilesPx(data, W, 0,1, 0,2);
    }
    // Hiding monkey
    if (id === 0xC8) {
      this._copyTilePx(data, W, 0,0, 1,0, true);
      this._copyTilePx(data, W, 0,1, 1,1, true);
    }
    // DK variants (3-column layout → display layout)
    if ([0x6E,0x44,0x90,0x5E,0x9A,0xCC,0x3A,0xA6,0xAA,0xBE,0x92,0xA4,0x8A].includes(id)) {
      this._copyTilePx(data, W, 0,1, 2,1, true);
      this._copyTilePx(data, W, 1,0, 2,2, true);
      this._copyTilePx(data, W, 1,1, 2,3, true);
      this._copyTilePx(data, W, 0,0, 2,0, false);
      this._copyTilePx(data, W, 0,2, 1,0, false);
      this._copyTilePx(data, W, 2,2, 0,2, true);
      this._copyTilePx(data, W, 0,3, 1,1, false);
      this._copyTilePx(data, W, 2,3, 0,3, true);
    }
    // Moving board: mirror right tile from left
    if (id === 0x54) {
      this._copyTilePx(data, W, 0,0, 1,0, true);
    }
    // Switches: swap rows 0 and 1
    if ([0x20,0x1A,0x2E].includes(id)) {
      this._swapTilesPx(data, W, 0,1, 1,0);
    }
  }

  // Copy an 8×8 tile within the sprite pixel buffer
  _copyTilePx(data, W, srcCol, srcRow, dstCol, dstRow, mirror) {
    const stride = W * 8;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const src = data[(srcRow*8 + y) * stride + (srcCol*8 + x)];
        const dx  = mirror ? (7 - x) : x;
        data[(dstRow*8 + y) * stride + (dstCol*8 + dx)] = src;
      }
    }
  }

  _swapTilesPx(data, W, c1, r1, c2, r2) {
    const stride = W * 8;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const a = (r1*8 + y) * stride + (c1*8 + x);
        const b = (r2*8 + y) * stride + (c2*8 + x);
        const tmp = data[a]; data[a] = data[b]; data[b] = tmp;
      }
    }
  }

  _fillTilePx(data, W, col, row, value) {
    const stride = W * 8;
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++)
        data[(row*8 + y) * stride + (col*8 + x)] = value;
  }

  // --------------------------------------------------------
  // Render the tile palette / selector into a canvas element.
  // Groups are defined by TILE_GROUPS in constants.js.
  // Each tile is drawn at TILE_SIZE × TILE_SIZE pixels.
  // --------------------------------------------------------
  renderTileSelector(canvas, tilesetCanvas, tileInfo, scale = 2) {
    const TS   = 8 * scale;  // Tile size in screen pixels
    const PAD  = 4;          // Padding around groups
    const LABEL_H = 16;

    const ctx  = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!tilesetCanvas) return;

    const COLS = Math.floor((canvas.width - PAD*2) / TS);
    let y = PAD;

    for (const group of TILE_GROUPS) {
      // Group label
      ctx.fillStyle = '#ccc';
      ctx.font = '11px monospace';
      ctx.fillText(group.label, PAD, y + 11);
      y += LABEL_H;

      // Tiles in group
      let col = 0;
      for (const tileId of group.tiles) {
        const src = this._tileAtlasPos(tileId);
        const dstX = PAD + col * TS;
        ctx.drawImage(tilesetCanvas, src.x, src.y, 8, 8, dstX, y, TS, TS);

        // Hover/selection highlight drawn by editor.js
        col++;
        if (col >= COLS) { col = 0; y += TS; }
      }
      if (col > 0) y += TS;
      y += PAD;
    }

    // Resize canvas height to fit content
    canvas.height = y + PAD;
  }

  // --------------------------------------------------------
  // Render the level to a canvas context.
  // --------------------------------------------------------
  renderLevel(ctx, lvl, tilesetCanvas, tileInfo, scale) {
    const TS = 8 * scale;
    const W  = (lvl.size === 0 ? C.SMALL_W : C.LARGE_W);
    const H  = (lvl.size === 0 ? C.SMALL_H : C.LARGE_H);

    ctx.clearRect(0, 0, W * TS, H * TS);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, W * TS, H * TS);

    const dt = lvl.displayTilemap;
    for (let ty = 0; ty < H; ty++) {
      for (let tx = 0; tx < W; tx++) {
        const idx    = (ty * W + tx) * 2;
        const tileLo = dt[idx];
        const tileHi = dt[idx + 1];
        const tileId = tileHi === 0 ? tileLo : (tileHi << 8) | tileLo;

        if (tileId === 0xFF) continue; // Empty tile

        const { x: sx, y: sy } = this._tileAtlasPos(tileId);
        ctx.drawImage(tilesetCanvas, sx, sy, 8, 8, tx*TS, ty*TS, TS, TS);
      }
    }
  }
}
