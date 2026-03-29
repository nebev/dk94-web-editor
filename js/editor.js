'use strict';
// ============================================================
// editor.js
// Canvas-based level editor.
// Handles tile drawing, sprite placement, switch editing and
// undo/redo. Ported from QTileEdit.cpp and QDKEdit.cpp
// (mouse handling, paintLevel, switch mode).
// ============================================================

// Rotation/direction constants (mirroring the C++ enum)
const ROTATE = { BOTTOM: 0, FLIPPED: 1, TOP: 2, LEFT: 3, RIGHT: 4 };

class Editor {
  /**
   * @param {HTMLCanvasElement} canvas    - Main level canvas
   * @param {RomParser}         parser    - ROM parser instance
   * @param {Renderer}          renderer  - Renderer instance
   */
  constructor(canvas, parser, renderer) {
    this.canvas   = canvas;
    this.ctx      = canvas.getContext('2d');
    this.parser   = parser;
    this.renderer = renderer;

    // Current editing state
    this.levelId      = 0;
    this.lvl          = null;     // Reference to the current level object
    this.displayTilemap = null;   // Working copy (Uint8Array, 16-bit per cell)
    this.sprites      = [];       // Working copy of sprite list
    this.switches     = [];       // Working copy of switch list
    this.scale        = 2;        // Pixels per tile pixel (tile is 8 px, so each is 16 screen px)
    this.TILE_PX      = 8;        // GB tile size
    this.screenTileW  = this.TILE_PX * this.scale; // Tile size in screen pixels

    this.tileToDraw   = 0xFF;     // Selected tile (empty tile by default)
    this.spriteMode   = false;
    this.switchMode   = false;
    this.transparent  = true;

    this.selectedSprite = -1;     // Index of selected sprite (-1 = none)
    this.spriteToMove   = -1;

    this.switchToEdit   = -1;     // Index of selected switch (-1 = none)
    this.swObjToMove    = -1;

    this.mousePressed   = false;
    this.hoverTile      = null;   // { x, y, w, h } in tile coords

    // Undo stack: array of { tilemap, sprites, switches } snapshots
    this._undoStack   = [];
    this._keepUndo    = false;

    // Tile selector (populated by app.js)
    this.tileSelector = null;
    this.selectedTileFromPalette = null;

    this._attachEvents();
  }

  // --------------------------------------------------------
  // Load a level into the editor
  // --------------------------------------------------------
  loadLevel(levelId) {
    this.levelId = levelId;
    this.lvl     = this.parser.levels[levelId];

    // Work on copies so we don't mutate the parser's data until saved
    this.displayTilemap = new Uint8Array(this.lvl.displayTilemap);
    this.sprites  = this.lvl.sprites.map(s => Object.assign({}, s));
    this.switches = this.lvl.switches.map(sw => ({
      ...sw, connectedTo: sw.connectedTo.map(o => Object.assign({}, o))
    }));

    this.selectedSprite = -1;
    this.switchToEdit   = -1;
    this.swObjToMove    = -1;
    this.hoverTile      = null;
    this._undoStack     = [];

    this._resizeCanvas();
    this.render();
    this._emitChanged();
  }

  // --------------------------------------------------------
  // Commit working copies back to the parser level object
  // (called before saving ROM or exporting level)
  // --------------------------------------------------------
  saveToLevel() {
    if (!this.lvl) return;
    this.lvl.displayTilemap = new Uint8Array(this.displayTilemap);
    this.lvl.sprites  = this.sprites.map(s => Object.assign({}, s));
    this.lvl.switches = this.switches.map(sw => ({
      ...sw, connectedTo: sw.connectedTo.map(o => Object.assign({}, o))
    }));
    this.lvl.fullDataUpToDate = false;

    // Rebuild RAM positions from x/y coordinates
    const W = this._levelW();
    for (const spr of this.lvl.sprites) {
      spr.levelPos = spr.y * W + spr.x;
      spr.ramPos   = spr.levelPos + C.SPRITE_RAM_BASE;
    }
    for (const sw of this.lvl.switches) {
      sw.levelPos = sw.y * W + sw.x;
      sw.ramPos   = sw.levelPos + C.TILE_RAM_BASE;
      for (const obj of sw.connectedTo) {
        obj.levelPos = obj.y * W + obj.x;
        obj.ramPos   = obj.isSprite
          ? (obj.levelPos + C.SPRITE_RAM_BASE)
          : (obj.levelPos + C.TILE_RAM_BASE);
      }
    }
  }

  // --------------------------------------------------------
  // Clear the level tilemap (fill with empty tile 0xFF)
  // --------------------------------------------------------
  clearLevel() {
    this._pushUndo();
    this.displayTilemap.fill(0);
    for (let i = 0; i < this.displayTilemap.length; i += 2) {
      this.displayTilemap[i]   = 0xFF;
      this.displayTilemap[i+1] = 0x00;
    }
    this.sprites  = [];
    this.switches = [];
    this.selectedSprite = -1;
    this.switchToEdit   = -1;
    this.render();
    this._emitChanged();
    this._emitSpriteListChanged();
    this._emitSwitchListChanged();
  }

  // --------------------------------------------------------
  // Undo last action
  // --------------------------------------------------------
  undo() {
    if (this._undoStack.length === 0) return;
    const snap = this._undoStack.pop();
    this.displayTilemap = snap.tilemap;
    this.sprites        = snap.sprites;
    this.switches       = snap.switches;
    this.selectedSprite = -1;
    this.switchToEdit   = -1;
    this.render();
    this._emitChanged();
    this._emitSpriteListChanged();
    this._emitSwitchListChanged();
  }

  // --------------------------------------------------------
  // Add a sprite to the level
  // --------------------------------------------------------
  addSprite(id) {
    if (!IS_SPRITE[id]) return;
    this._pushUndo();
    const ti = this.parser.tileInfo[id];
    const spr = {
      id,
      x: 0, y: 0,
      levelPos: 0,
      ramPos: C.SPRITE_RAM_BASE,
      flagByte: this.parser.getSpriteDefaultFlag(id),
      rotate: 0,
      drawOffsetX: (id === 0x54) ? -0.5 : 0,
      w: ti ? ti.w : 1,
      h: ti ? ti.h : 1,
    };
    this.sprites.push(spr);
    this._emitSpriteAdded(spr);
    this.render();
    this._emitChanged();
  }

  // --------------------------------------------------------
  // Delete a sprite by index
  // --------------------------------------------------------
  deleteSprite(idx) {
    if (idx < 0 || idx >= this.sprites.length) return;
    this._pushUndo();
    this.sprites.splice(idx, 1);
    if (this.selectedSprite === idx) this.selectedSprite = -1;
    else if (this.selectedSprite > idx) this.selectedSprite--;
    this._emitSpriteRemoved(idx);
    this.render();
    this._emitChanged();
  }

  // --------------------------------------------------------
  // Delete the currently selected switch
  // --------------------------------------------------------
  deleteCurrentSwitch() {
    if (this.switchToEdit < 0) return;
    this._pushUndo();
    this.switches.splice(this.switchToEdit, 1);
    this._emitSwitchRemoved(this.switchToEdit);
    this.switchToEdit = -1;
    this.swObjToMove  = -1;
    this.render();
    this._emitChanged();
  }

  // --------------------------------------------------------
  // Delete a connected object from the selected switch
  // --------------------------------------------------------
  deleteSwitchObj(objIdx) {
    if (this.switchToEdit < 0 || this.switchToEdit >= this.switches.length) return;
    const sw = this.switches[this.switchToEdit];
    if (objIdx < 0 || objIdx >= sw.connectedTo.length) return;
    this._pushUndo();
    sw.connectedTo.splice(objIdx, 1);
    this.swObjToMove = -1;
    this._emitSwitchUpdated(this.switchToEdit);
    this.render();
    this._emitChanged();
  }

  // --------------------------------------------------------
  // Select a switch for editing
  // --------------------------------------------------------
  selectSwitch(idx) {
    this.switchToEdit = idx;
    this.render();
  }

  // --------------------------------------------------------
  // Get/set a sprite flag byte
  // --------------------------------------------------------
  getSpriteFlag(idx) {
    if (idx < 0 || idx >= this.sprites.length) return 0;
    return this.sprites[idx].flagByte;
  }
  setSpriteFlag(idx, val) {
    if (idx < 0 || idx >= this.sprites.length) return;
    this.sprites[idx].flagByte = val & 0xFF;
    // Update rotation for direction-sensitive sprites
    const id = this.sprites[idx].id;
    if (id === 0x7F) this.sprites[idx].rotate = val;
    else if (id === 0x80 || id === 0x98) this.sprites[idx].rotate = (val + 1) & 1;
    this.render();
    this._emitChanged();
  }

  // --------------------------------------------------------
  // Get selected sprite index and ID
  // --------------------------------------------------------
  getSelectedSprite() {
    if (this.selectedSprite < 0 || this.selectedSprite >= this.sprites.length)
      return { idx: -1, id: -1 };
    return { idx: this.selectedSprite, id: this.sprites[this.selectedSprite].id };
  }

  // --------------------------------------------------------
  // Toggle sprite/switch mode
  // --------------------------------------------------------
  setSpriteMode(on) {
    this.spriteMode = on;
    this.hoverTile  = null;
    this.render();
  }
  setSwitchMode(on) {
    this.switchMode = on;
    if (on) this.spriteMode = true;
    this.hoverTile = null;
    this.render();
  }
  setSpriteTransparency(on) {
    this.transparent = on;
    this.render();
  }

  // --------------------------------------------------------
  // Main render loop
  // --------------------------------------------------------
  render() {
    if (!this.lvl) return;
    const ctx   = this.ctx;
    const TS    = this.screenTileW;
    const W     = this._levelW();
    const H     = this._levelH();

    // Checkerboard background for empty/transparent tiles (light, like a graphics editor)
    ctx.fillStyle = '#c8c8c8';
    ctx.fillRect(0, 0, W * TS, H * TS);
    ctx.fillStyle = '#a0a0a0';
    for (let ty = 0; ty < H; ty++)
      for (let tx = (ty & 1); tx < W; tx += 2)
        ctx.fillRect(tx * TS, ty * TS, TS, TS);

    // Get the coloured tileset canvas
    const tsetCanvas = this.renderer.getTilesetCanvas(
      this.lvl.tileset, this.lvl.paletteIndex
    );

    // Draw tile layer
    if (tsetCanvas) {
      const dt = this.displayTilemap;
      for (let ty = 0; ty < H; ty++) {
        for (let tx = 0; tx < W; tx++) {
          const idx    = (ty * W + tx) * 2;
          const tileLo = dt[idx];
          const tileHi = dt[idx + 1];
          const tileId = tileHi === 0 ? tileLo : ((tileHi << 8) | tileLo);

          if (tileId === 0xFF) continue;

          const pos = this.renderer._tileAtlasPos(tileId);
          ctx.drawImage(tsetCanvas, pos.x, pos.y, 8, 8, tx*TS, ty*TS, TS, TS);
        }
      }
    }

    // Draw sprites
    for (let i = 0; i < this.sprites.length; i++) {
      this._drawSprite(ctx, this.sprites[i], i === this.selectedSprite, TS);
    }

    // Draw switch overlays in switch mode
    if (this.switchMode) {
      this._drawSwitchOverlays(ctx, TS);
    }

    // Draw hover highlight
    if (this.hoverTile) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth   = 1;
      ctx.strokeRect(
        this.hoverTile.x * TS + 0.5,
        this.hoverTile.y * TS + 0.5,
        this.hoverTile.w * TS - 1,
        this.hoverTile.h * TS - 1
      );
    }

    // Draw tile-mode cursor (show which tile will be drawn)
    if (!this.spriteMode && !this.switchMode && this.hoverTile && tsetCanvas) {
      const pos = this.renderer._tileAtlasPos(this.tileToDraw);
      ctx.globalAlpha = 0.45;
      ctx.drawImage(tsetCanvas, pos.x, pos.y, 8, 8,
        this.hoverTile.x * TS, this.hoverTile.y * TS, TS, TS);
      ctx.globalAlpha = 1;
    }
  }

  // --------------------------------------------------------
  // Draw a single sprite onto the canvas
  // --------------------------------------------------------
  _drawSprite(ctx, spr, selected, TS) {
    const sprCanvas = this.renderer.getSpriteCanvas(
      spr.id, this.lvl.tileset, this.lvl.paletteIndex, this.transparent
    );

    const dx = (spr.x + spr.drawOffsetX) * TS;
    const dy = spr.y * TS;
    const W  = spr.w * TS;
    const H  = spr.h * TS;

    if (sprCanvas) {
      ctx.save();
      // Apply rotation/flip based on sprite direction
      if (spr.rotate === ROTATE.FLIPPED || spr.rotate === 1) {
        ctx.translate(dx + W, dy);
        ctx.scale(-1, 1);
        ctx.drawImage(sprCanvas, 0, 0, W, H);
      } else {
        ctx.drawImage(sprCanvas, dx, dy, W, H);
      }
      ctx.restore();
    } else {
      // Fallback: coloured rectangle with label
      ctx.fillStyle = selected ? 'rgba(255,200,0,0.5)' : 'rgba(100,100,255,0.4)';
      ctx.fillRect(dx, dy, W, H);
    }

    // Selection highlight
    if (selected) {
      ctx.strokeStyle = '#ff0';
      ctx.lineWidth   = 2;
      ctx.strokeRect(dx + 1, dy + 1, W - 2, H - 2);
    }
  }

  // --------------------------------------------------------
  // Draw switch connection overlays
  // Ported from QDKEdit::paintLevel() switch drawing code
  // --------------------------------------------------------
  _drawSwitchOverlays(ctx, TS) {
    ctx.lineWidth = 1;
    const dt = this.displayTilemap;
    const W  = this._levelW();

    if (this.switchToEdit < 0) {
      // Show all switches as blue rectangles
      ctx.strokeStyle = '#44f';
      for (const sw of this.switches) {
        const rawTile = dt[(sw.y * W + sw.x) * 2];
        if ([0x1A,0x20,0x2E].includes(rawTile)) {
          ctx.strokeRect(sw.x*TS+0.5, sw.y*TS+0.5, TS*2-1, TS*2-1);
        } else {
          ctx.strokeRect(sw.x*TS+0.5, sw.y*TS+0.5, TS-1, TS-1);
        }
      }
    } else if (this.switchToEdit < this.switches.length) {
      // Show selected switch (red) and its connections (green/blue)
      const sw = this.switches[this.switchToEdit];
      const rawTile = dt[(sw.y * W + sw.x) * 2];
      ctx.strokeStyle = [0x1A,0x20,0x2E].includes(rawTile) ? '#f00' : '#f0f';
      const swW = [0x1A,0x20,0x2E].includes(rawTile) ? TS*2-1 : TS-1;
      ctx.strokeRect(sw.x*TS+0.5, sw.y*TS+0.5, swW, TS-1);

      for (const obj of sw.connectedTo) {
        const objTile = dt[(obj.y * W + obj.x) * 2];
        const ok = [0x09,0x0A,0x1A,0x20,0x2E,0x29,0x2A,0x70,0x72,0xB9].includes(objTile);
        ctx.strokeStyle = ok ? '#0f0' : '#44f';
        if (!obj.isSprite) {
          const ti = this.parser.tileInfo[objTile];
          const tw = (ti && ok) ? ti.w : 1;
          const th = (ti && ok) ? ti.h : 1;
          ctx.strokeRect(obj.x*TS+0.5, obj.y*TS+0.5, tw*TS-1, th*TS-1);
        } else {
          ctx.strokeRect(obj.x*TS+0.5, obj.y*TS+0.5, TS-1, TS-1);
        }
      }
    }

    // Grey hover indicator
    if (this.hoverTile) {
      ctx.strokeStyle = '#888';
      ctx.strokeRect(
        this.hoverTile.x*TS+0.5, this.hoverTile.y*TS+0.5,
        this.hoverTile.w*TS-1, this.hoverTile.h*TS-1
      );
    }
  }

  // --------------------------------------------------------
  // Canvas size management
  // --------------------------------------------------------
  _resizeCanvas() {
    const TS = this.screenTileW;
    this.canvas.width  = this._levelW() * TS;
    this.canvas.height = this._levelH() * TS;
  }
  _levelW() { return this.lvl && this.lvl.size === 0 ? C.SMALL_W : C.LARGE_W; }
  _levelH() { return this.lvl && this.lvl.size === 0 ? C.SMALL_H : C.LARGE_H; }

  // --------------------------------------------------------
  // Mouse event handlers
  // --------------------------------------------------------
  _attachEvents() {
    this.canvas.addEventListener('mousedown',  e => this._onMouseDown(e));
    this.canvas.addEventListener('mousemove',  e => this._onMouseMove(e));
    this.canvas.addEventListener('mouseup',    e => this._onMouseUp(e));
    this.canvas.addEventListener('mouseleave', e => { this.mousePressed = false; this.hoverTile = null; this.render(); });
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  _getTileCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width  / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const px = (e.clientX - rect.left)  * scaleX;
    const py = (e.clientY - rect.top)   * scaleY;
    return {
      tx: Math.floor(px / this.screenTileW),
      ty: Math.floor(py / this.screenTileW),
    };
  }

  _onMouseDown(e) {
    if (!this.lvl) return;
    e.preventDefault();
    this.mousePressed = true;
    this._pushUndo();

    const { tx, ty } = this._getTileCoords(e);

    if (this.switchMode) {
      this._handleSwitchMouseDown(e, tx, ty);
    } else if (this.spriteMode) {
      this._handleSpriteMouseDown(e, tx, ty);
    } else {
      this._handleTileMouseDown(e, tx, ty);
    }
    this.render();
    this._emitChanged();
  }

  _onMouseMove(e) {
    if (!this.lvl) return;
    const { tx, ty } = this._getTileCoords(e);

    if (this.switchMode) {
      this._handleSwitchMouseMove(e, tx, ty);
    } else if (this.spriteMode) {
      this._handleSpriteMouseMove(e, tx, ty);
    } else {
      // Tile mode: update hover and paint if dragging
      this.hoverTile = { x: tx, y: ty, w: 1, h: 1 };
      if (this.mousePressed && (e.buttons & 1)) {
        this._paintTile(tx, ty, this.tileToDraw);
        this._emitChanged();
      } else if (this.mousePressed && (e.buttons & 2)) {
        this._paintTile(tx, ty, 0xFF);
        this._emitChanged();
      }
      this.render();
    }
  }

  _onMouseUp(e) {
    this.mousePressed = false;
  }

  // --------------------------------------------------------
  // Tile painting
  // --------------------------------------------------------
  _handleTileMouseDown(e, tx, ty) {
    if (e.button === 0) this._paintTile(tx, ty, this.tileToDraw);
    else if (e.button === 2) this._paintTile(tx, ty, 0xFF); // Right click = erase
  }

  _paintTile(tx, ty, tileId) {
    const W = this._levelW(), H = this._levelH();
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return;

    const idx = (ty * W + tx) * 2;
    this.displayTilemap[idx]   = tileId & 0xFF;
    this.displayTilemap[idx+1] = 0x00;

    if (tileId === 0xFF) return;

    // Place additional cells for multi-cell super-tiles
    const ti = this.parser.tileInfo[tileId];
    if (ti && ti.count > 1) {
      let tilePos = 0x100 + ti.additionalTilesAt;
      for (let j = 0; j < ti.h; j++) {
        for (let k = 0; k < ti.w; k++) {
          if (!k && !j) continue;
          const subIdx = (ty + j) * W + (tx + k);
          if (subIdx * 2 + 1 < this.displayTilemap.length) {
            this.displayTilemap[subIdx*2]   = tilePos & 0xFF;
            this.displayTilemap[subIdx*2+1] = (tilePos >> 8) & 0xFF;
          }
          tilePos++;
        }
      }
    }
  }

  // --------------------------------------------------------
  // Sprite interaction
  // --------------------------------------------------------
  _handleSpriteMouseDown(e, tx, ty) {
    if (e.button === 2) {
      // Right-click: deselect
      this.selectedSprite = -1;
      this._emitSpriteSelected(-1);
      return;
    }
    // Left-click: select or start drag
    const hit = this._hitTestSprite(tx, ty);
    if (hit !== -1) {
      this.selectedSprite = hit;
      this.spriteToMove   = hit;
      this._emitSpriteSelected(hit);
    } else {
      this.selectedSprite = -1;
      this._emitSpriteSelected(-1);
    }
  }

  _handleSpriteMouseMove(e, tx, ty) {
    this.hoverTile = { x: tx, y: ty, w: 1, h: 1 };
    if (this.mousePressed && this.spriteToMove >= 0 && (e.buttons & 1)) {
      const spr = this.sprites[this.spriteToMove];
      if (spr && (spr.x !== tx || spr.y !== ty)) {
        spr.x = tx;
        spr.y = ty;
        this._emitChanged();
      }
    }
    this.render();
  }

  _hitTestSprite(tx, ty) {
    // Walk in reverse so topmost sprite wins
    for (let i = this.sprites.length - 1; i >= 0; i--) {
      const spr = this.sprites[i];
      if (tx >= spr.x && tx < spr.x + spr.w &&
          ty >= spr.y && ty < spr.y + spr.h) return i;
    }
    return -1;
  }

  // --------------------------------------------------------
  // Switch interaction
  // Ported from QDKEdit::mousePressEvent() switch handling
  // --------------------------------------------------------
  _handleSwitchMouseDown(e, tx, ty) {
    const dt = this.displayTilemap;
    const W  = this._levelW();
    const tileId = dt[(ty * W + tx) * 2];

    const isSwitchTile = [0x1A,0x20,0x2E].includes(tileId);
    const isConnTile   = [0x09,0x0A,0x1A,0x20,0x2E,0x29,0x2A,0x70,0x72,0xB9].includes(tileId);

    if (e.button === 2) {
      // Right-click: delete switch or connected object
      if (this.swObjToMove !== -1 && this.switchToEdit >= 0) {
        const sw = this.switches[this.switchToEdit];
        if (this.swObjToMove === sw.connectedTo.length) {
          // Delete the switch itself
          sw.connectedTo = [];
          this.switches.splice(this.switchToEdit, 1);
          this._emitSwitchRemoved(this.switchToEdit);
          this.switchToEdit = -1;
          this.swObjToMove  = -1;
        } else {
          sw.connectedTo.splice(this.swObjToMove, 1);
          this._emitSwitchUpdated(this.switchToEdit);
          this.swObjToMove = -1;
        }
        this._emitChanged();
      }
      return;
    }

    if (e.button === 1) {
      // Middle-click: cycle switch state
      if (this.switchToEdit >= 0 && this.swObjToMove === this.switches[this.switchToEdit].connectedTo.length) {
        const sw = this.switches[this.switchToEdit];
        sw.state = (sw.state + 1) % 3;
        this._emitSwitchUpdated(this.switchToEdit);
        this._emitChanged();
      }
      return;
    }

    // Left-click
    if (this.switchToEdit < 0) {
      // No switch selected: look for a switch tile to select or create
      const existIdx = this.switches.findIndex(s => s.x === tx && s.y === ty);
      if (existIdx >= 0) {
        this.switchToEdit = existIdx;
        this.swObjToMove  = this.switches[existIdx].connectedTo.length;
      } else if (isSwitchTile) {
        // Create a new switch
        const levelPos = ty * W + tx;
        const newSw = {
          state: 0, x: tx, y: ty,
          levelPos, ramPos: levelPos + C.TILE_RAM_BASE,
          connectedTo: [],
        };
        this.switches.push(newSw);
        this.switchToEdit = this.switches.length - 1;
        this.swObjToMove  = 0;
        this._emitSwitchAdded(this.switchToEdit);
        this._emitChanged();
      }
    } else {
      // Switch is selected: add connected objects or move
      const sw = this.switches[this.switchToEdit];
      const existObjIdx = sw.connectedTo.findIndex(o => o.x === tx && o.y === ty);
      if (existObjIdx >= 0) {
        this.swObjToMove = existObjIdx;
      } else if (sw.x === tx && sw.y === ty) {
        this.swObjToMove = sw.connectedTo.length; // Selecting the switch itself
      } else if (isConnTile) {
        // Add a new connected object
        const levelPos = ty * W + tx;
        const isSpr    = false; // Tile connections are always tiles here
        const newObj   = {
          x: tx, y: ty, levelPos,
          ramPos: levelPos + C.TILE_RAM_BASE,
          isSprite: isSpr,
        };
        sw.connectedTo.push(newObj);
        this.swObjToMove = sw.connectedTo.length - 1;
        this._emitSwitchUpdated(this.switchToEdit);
        this._emitChanged();
      } else {
        // Click on non-switch tile: deselect switch
        this.switchToEdit = -1;
        this.swObjToMove  = -1;
      }
    }
  }

  _handleSwitchMouseMove(e, tx, ty) {
    this.hoverTile = { x: tx, y: ty, w: 1, h: 1 };

    if (this.mousePressed && this.swObjToMove >= 0 && this.switchToEdit >= 0 && (e.buttons & 1)) {
      const sw = this.switches[this.switchToEdit];
      if (this.swObjToMove === sw.connectedTo.length) {
        // Moving the switch itself
        if (sw.x !== tx || sw.y !== ty) {
          sw.x = tx; sw.y = ty;
          this._emitSwitchUpdated(this.switchToEdit);
          this._emitChanged();
        }
      } else if (this.swObjToMove < sw.connectedTo.length) {
        // Moving a connected object
        const obj = sw.connectedTo[this.swObjToMove];
        if (obj.x !== tx || obj.y !== ty) {
          obj.x = tx; obj.y = ty;
          this._emitSwitchUpdated(this.switchToEdit);
          this._emitChanged();
        }
      }
    }
    this.render();
  }

  // --------------------------------------------------------
  // Undo stack management
  // --------------------------------------------------------
  _pushUndo() {
    this._undoStack.push({
      tilemap:  new Uint8Array(this.displayTilemap),
      sprites:  this.sprites.map(s => Object.assign({}, s)),
      switches: this.switches.map(sw => ({
        ...sw, connectedTo: sw.connectedTo.map(o => Object.assign({}, o))
      })),
    });
    // Keep stack bounded
    if (this._undoStack.length > 50) this._undoStack.shift();
  }

  // --------------------------------------------------------
  // Event emitters (connected to by app.js)
  // --------------------------------------------------------
  _emitChanged()               { this.canvas.dispatchEvent(new Event('levelChanged')); }
  _emitSpriteSelected(idx)     { this.canvas.dispatchEvent(new CustomEvent('spriteSelected',  { detail: idx })); }
  _emitSpriteAdded(spr)        { this.canvas.dispatchEvent(new CustomEvent('spriteAdded',     { detail: spr })); }
  _emitSpriteRemoved(idx)      { this.canvas.dispatchEvent(new CustomEvent('spriteRemoved',   { detail: idx })); }
  _emitSpriteListChanged()     { this.canvas.dispatchEvent(new Event('spriteListChanged')); }
  _emitSwitchAdded(idx)        { this.canvas.dispatchEvent(new CustomEvent('switchAdded',     { detail: idx })); }
  _emitSwitchUpdated(idx)      { this.canvas.dispatchEvent(new CustomEvent('switchUpdated',   { detail: idx })); }
  _emitSwitchRemoved(idx)      { this.canvas.dispatchEvent(new CustomEvent('switchRemoved',   { detail: idx })); }
  _emitSwitchListChanged()     { this.canvas.dispatchEvent(new Event('switchListChanged')); }
}
