'use strict';
// ============================================================
// app.js
// Main application: wires together the ROM parser, renderer
// and editor; handles UI events (drag-drop, controls, tabs).
// ============================================================

// ---- Module-level state ----
let parser   = null;
let renderer = null;
let editor   = null;

let currentLevelId = 0;
let isChanged      = false;
let romLoaded      = false;

// ---- DOM element references ----
const elCanvas       = () => document.getElementById('level-canvas');
const elTileCanvas   = () => document.getElementById('tile-canvas');
const elLevelNum     = () => document.getElementById('level-num');
const elLevelInfo    = () => document.getElementById('level-info');
const elSaveLevel    = () => document.getElementById('btn-save-level');
const elSaveROM      = () => document.getElementById('btn-save-rom');
const elExportLvl    = () => document.getElementById('btn-export-lvl');
const elImportLvl    = () => document.getElementById('btn-import-lvl');
const elUndo         = () => document.getElementById('btn-undo');
const elClear        = () => document.getElementById('btn-clear');
const elCmbSize      = () => document.getElementById('cmb-size');
const elCmbMusic     = () => document.getElementById('cmb-music');
const elCmbTileset   = () => document.getElementById('cmb-tileset');
const elSpbTime      = () => document.getElementById('spb-time');
const elSpbPalette   = () => document.getElementById('spb-palette');
const elSpriteList   = () => document.getElementById('sprite-list');
const elSpriteProps  = () => document.getElementById('sprite-props');
const elSwitchList   = () => document.getElementById('switch-list');
const elVRAMtilesBar = () => document.getElementById('vram-tiles-bar');
const elVRAMsprBar   = () => document.getElementById('vram-sprites-bar');
const elVRAMtilesLbl = () => document.getElementById('vram-tiles-text');
const elVRAMsprLbl   = () => document.getElementById('vram-sprites-text');

// ============================================================
// Initialisation
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  _setupDragDrop();
  _setupMenuButtons();
  _setupModals();
  _setupTabs();
  _populateDropdowns();
  _setupLevelControls();
  _setupSpriteControls();
  _setupZoomControl();
  _setupKeyboardShortcuts();
});

// ============================================================
// ROM loading
// ============================================================
function _setupDragDrop() {
  const wrapper = document.getElementById('drop-zone');

  wrapper.addEventListener('dragover', e => {
    e.preventDefault();
    wrapper.classList.add('drag-over');
  });
  wrapper.addEventListener('dragleave', () => wrapper.classList.remove('drag-over'));
  wrapper.addEventListener('drop', e => {
    e.preventDefault();
    wrapper.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) _loadROMFile(file);
  });

  document.getElementById('btn-load-rom').addEventListener('click', () => {
    const inp = document.getElementById('file-rom');
    inp.onchange = () => inp.files[0] && _loadROMFile(inp.files[0]);
    inp.click();
  });
}

function _loadROMFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      _initFromBuffer(e.target.result, file.name);
    } catch (err) {
      alert('Failed to load ROM: ' + err.message);
      console.error(err);
    }
  };
  reader.readAsArrayBuffer(file);
}

function _initFromBuffer(buffer, filename) {
  elLevelInfo().textContent = 'Loading ROM…';

  // Parse ROM (this may take a moment for 34 tilesets)
  parser   = new RomParser();
  const ok = parser.loadFromBuffer(buffer);
  if (!ok) {
    elLevelInfo().textContent = 'Failed to parse ROM. Is this a DK \'94 ROM?';
    return;
  }

  // Build graphics data
  renderer = new Renderer(parser);
  elLevelInfo().textContent = 'Extracting tile graphics…';
  // Use setTimeout so the UI can update before the heavy work
  setTimeout(() => {
    renderer.buildTilesetRawData();
    elLevelInfo().textContent = 'Extracting sprite graphics…';
    setTimeout(() => {
      renderer.buildSpriteRawData();

      // Create editor
      editor = new Editor(elCanvas(), parser, renderer);
      _attachEditorEvents();

      // Enable UI
      romLoaded = true;
      _enableUI(true);
      _populateMusicDropdown();
      _populateTilesetDropdown();
      _populateSpriteAddMenu();

      // Load level 0
      _changeLevel(0);

      elLevelInfo().textContent = `ROM loaded: ${filename}`;
    }, 0);
  }, 0);
}

// ============================================================
// Level management
// ============================================================
function _changeLevel(id) {
  if (!romLoaded || !parser) return;

  // Ask to save if there are unsaved changes
  if (isChanged) {
    if (!confirm('Level data has changed. Save before switching?')) {
      // Discard changes — reload from parser
    } else {
      _saveCurrentLevel();
    }
  }

  currentLevelId = id;
  isChanged = false;

  // Load into editor
  const lvl = parser.levels[id];
  // Sync level properties to UI (without triggering change handlers)
  _silentSet(elCmbSize(),    lvl.size);
  _silentSet(elCmbMusic(),   lvl.music);
  _silentSet(elCmbTileset(), lvl.tileset);
  _silentSet(elSpbTime(),    lvl.time);
  _silentSet(elSpbPalette(), lvl.paletteIndex);

  editor.loadLevel(id);
  _refreshSpriteList();
  _refreshSwitchList();
  _updateLevelInfo();
  _updateVRAM();
  _renderTileSelector();
  elSaveLevel().disabled = true;
  isChanged = false;
}

function _saveCurrentLevel() {
  if (!editor) return;
  editor.saveToLevel();

  // Copy edited properties back to parser level
  const lvl = parser.levels[currentLevelId];
  lvl.size         = parseInt(elCmbSize().value, 10);
  lvl.music        = parseInt(elCmbMusic().value, 10);
  lvl.tileset      = parseInt(elCmbTileset().value, 10);
  lvl.time         = parseInt(elSpbTime().value, 10);
  lvl.paletteIndex = parseInt(elSpbPalette().value, 10);
  lvl.fullDataUpToDate = false;

  isChanged = false;
  elSaveLevel().disabled = true;
  _updateLevelInfo();
}

// ============================================================
// UI control wiring
// ============================================================
function _setupMenuButtons() {
  document.getElementById('btn-save-level').addEventListener('click', _saveCurrentLevel);

  document.getElementById('btn-save-rom').addEventListener('click', async () => {
    if (!romLoaded) return;
    _saveCurrentLevel();
    const buf = parser.saveToBuffer();
    if (!buf) { alert('Save failed — ROM too full!'); return; }
    _downloadBuffer(buf, 'dk94_edited.gb');
  });

  document.getElementById('btn-export-lvl').addEventListener('click', () => {
    if (!romLoaded) return;
    _saveCurrentLevel();
    const buf = parser.exportLevel(currentLevelId);
    _downloadBuffer(buf, `level_${currentLevelId.toString().padStart(3,'0')}.lvl`);
  });

  document.getElementById('btn-import-lvl').addEventListener('click', () => {
    const inp = document.getElementById('file-lvl-import');
    inp.onchange = () => {
      if (!inp.files[0]) return;
      const reader = new FileReader();
      reader.onload = e => {
        parser.importLevel(e.target.result, currentLevelId);
        _changeLevel(currentLevelId);
      };
      reader.readAsArrayBuffer(inp.files[0]);
    };
    inp.click();
  });

  document.getElementById('btn-undo').addEventListener('click', () => editor && editor.undo());
  document.getElementById('btn-clear').addEventListener('click', () => {
    if (editor && confirm('Clear all tiles and sprites from this level?')) {
      editor.clearLevel();
    }
  });
}

function _setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const tab = document.getElementById('tab-' + btn.dataset.tab);
      if (tab) tab.classList.add('active');

      const tabName = btn.dataset.tab;
      if (editor) {
        editor.setSpriteMode(tabName === 'sprites');
        editor.setSwitchMode(tabName === 'switches');
      }
    });
  });
}

function _populateDropdowns() {
  // Music dropdown
  const musEl = elCmbMusic();
  musEl.innerHTML = '';
  for (let i = 0; i < MUSIC_NAMES.length; i++) {
    const opt = document.createElement('option');
    const hex = i.toString(16).padStart(2,'0').toUpperCase();
    opt.value = i;
    opt.textContent = `(${hex}) ${MUSIC_NAMES[i]}`;
    musEl.appendChild(opt);
  }
  // Tileset dropdown
  const tsEl = elCmbTileset();
  tsEl.innerHTML = '';
  for (let i = 0; i < C.MAX_TILESETS; i++) {
    const opt = document.createElement('option');
    const hex = i.toString(16).padStart(2,'0').toUpperCase();
    opt.value = i;
    opt.textContent = `(${hex}) ${TILESET_NAMES[i] || '???'}`;
    tsEl.appendChild(opt);
  }
}

function _populateMusicDropdown() { /* already done in _populateDropdowns */ }
function _populateTilesetDropdown() { /* already done in _populateDropdowns */ }

function _setupLevelControls() {
  elLevelNum().addEventListener('change', () => {
    const id = parseInt(elLevelNum().value, 10);
    if (!isNaN(id) && id >= 0 && id < C.LAST_LEVEL) _changeLevel(id);
  });

  // Level property changes mark the level as modified
  [elCmbSize(), elCmbMusic(), elCmbTileset(), elSpbTime(), elSpbPalette()]
    .forEach(el => el && el.addEventListener('change', () => _onLevelPropChanged()));
}

function _onLevelPropChanged() {
  if (!romLoaded || !editor) return;
  isChanged = true;
  elSaveLevel().disabled = false;

  // Update tileset/palette on the editor's level reference so re-render looks right
  const lvl = parser.levels[currentLevelId];
  const newTileset = parseInt(elCmbTileset().value, 10);
  const newPalette = parseInt(elSpbPalette().value, 10);
  const newSize    = parseInt(elCmbSize().value, 10);

  if (newSize !== lvl.size) {
    lvl.size = newSize;
    editor.lvl = lvl;
    editor._resizeCanvas();
    // Reinitialise display tilemap to match new size
    const W = newSize === 0 ? C.SMALL_W : C.LARGE_W;
    const H = newSize === 0 ? C.SMALL_H : C.LARGE_H;
    const newMap = new Uint8Array(W * H * 2);
    // Fill with empty tile 0xFF
    for (let i = 0; i < W * H; i++) { newMap[i*2] = 0xFF; }
    // Copy old map into new one
    const oldW = lvl.size === 0 ? C.SMALL_W : C.LARGE_W;
    const oldH = lvl.size === 0 ? C.SMALL_H : C.LARGE_H;
    const srcMap = editor.displayTilemap;
    const minW = Math.min(W, oldW), minH = Math.min(H, oldH);
    for (let y = 0; y < minH; y++)
      for (let x = 0; x < minW; x++) {
        newMap[(y*W+x)*2]   = srcMap[(y*oldW+x)*2];
        newMap[(y*W+x)*2+1] = srcMap[(y*oldW+x)*2+1];
      }
    editor.displayTilemap = newMap;
    editor.lvl.displayTilemap = newMap;
  }

  if (newTileset !== lvl.tileset || newPalette !== lvl.paletteIndex) {
    lvl.tileset      = newTileset;
    lvl.paletteIndex = newPalette;
    renderer._currentTilesetId = -1; // Invalidate cached canvas
  }

  lvl.music = parseInt(elCmbMusic().value, 10);
  lvl.time  = parseInt(elSpbTime().value, 10);

  editor.render();
  _renderTileSelector();
  _updateVRAM();
}

function _setupSpriteControls() {
  // "New Sprite…" opens the modal
  document.getElementById('btn-add-sprite').addEventListener('click', () => {
    if (romLoaded) _openSpriteModal();
  });

  // Delete selected sprite
  document.getElementById('btn-delete-sprite').addEventListener('click', () => {
    if (!editor) return;
    const { idx } = editor.getSelectedSprite();
    if (idx >= 0) { editor.deleteSprite(idx); _refreshSpriteList(); }
  });

  // Sprite property controls
  document.getElementById('btn-flip').addEventListener('click', () => {
    if (!editor) return;
    const { idx, id } = editor.getSelectedSprite();
    if (idx < 0) return;
    let flag = editor.getSpriteFlag(idx);
    if (id === 0x7F) flag = flag ? 0 : 1;
    else if (id === 0x80 || id === 0x98) flag ^= 1;
    else if (id === 0x84) flag ^= 1;
    else if (id === 0x54) flag = flag ? 0 : 1;
    editor.setSpriteFlag(idx, flag);
    _updateSpriteProps();
  });

  document.getElementById('spb-speed').addEventListener('input', () => {
    if (!editor) return;
    const { idx, id } = editor.getSelectedSprite();
    if (idx < 0) return;
    if ([0x80,0x98,0x84].includes(id)) {
      const speed = parseInt(document.getElementById('spb-speed').value, 10);
      const cur   = editor.getSpriteFlag(idx);
      editor.setSpriteFlag(idx, ((speed & 0x7F) << 1) | (cur & 1));
    }
  });

  document.getElementById('cmb-elevator').addEventListener('change', () => {
    if (!editor) return;
    const { idx, id } = editor.getSelectedSprite();
    if (idx < 0 || (id !== 0x70 && id !== 0x72)) return;
    editor.setSpriteFlag(idx, parseInt(document.getElementById('cmb-elevator').value, 10));
  });

  document.getElementById('spb-raw').addEventListener('input', () => {
    if (!editor) return;
    const { idx, id } = editor.getSelectedSprite();
    if (idx < 0) return;
    if ([0xB8,0x6E,0x9A,0xCC].includes(id)) {
      editor.setSpriteFlag(idx, parseInt(document.getElementById('spb-raw').value, 10));
    }
  });

  document.getElementById('ckb-transparent').addEventListener('change', e => {
    if (editor) editor.setSpriteTransparency(e.target.checked);
  });
}

function _populateSpriteAddMenu() {
  // No dropdown to populate — sprites are chosen via the modal
  document.getElementById('btn-add-sprite').disabled = false;
}

// ============================================================
// Sprite add modal
// ============================================================
function _setupModals() {
  // ---- Test modal ----
  document.getElementById('btn-test-level').addEventListener('click', () => {
    if (romLoaded) openTestModal();
  });
  document.getElementById('btn-close-test').addEventListener('click', closeTestModal);
  document.getElementById('btn-dl-savestate').addEventListener('click', downloadTestSaveState);
  // Close test modal on backdrop click
  document.getElementById('test-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('test-modal')) closeTestModal();
  });

  // ---- Sprite modal ----
  document.getElementById('btn-sprite-modal-close').addEventListener('click', _closeSpriteModal);
  // Close on backdrop click
  document.getElementById('sprite-modal').addEventListener('click', e => {
    if (e.target.id === 'sprite-modal') _closeSpriteModal();
  });
  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') _closeSpriteModal();
  });
}

function _openSpriteModal() {
  const modal = document.getElementById('sprite-modal');
  modal.style.display = 'flex';
  _buildSpriteModal();
}

function _closeSpriteModal() {
  document.getElementById('sprite-modal').style.display = 'none';
}

function _buildSpriteModal() {
  const grid = document.getElementById('sprite-modal-grid');
  grid.innerHTML = '';
  if (!renderer || !parser) return;

  const lvl      = parser.levels[currentLevelId];
  const THUMB    = 48;  // thumbnail pixel size (display)

  // Iterate in SPRITE_NAMES order so grouping is preserved
  for (const [idStr, name] of Object.entries(SPRITE_NAMES)) {
    const id = parseInt(idStr, 10);
    if (!IS_SPRITE[id]) continue;

    const item = document.createElement('div');
    item.className = 'sprite-modal-item';

    // --- Sprite thumbnail ---
    const sprCanvas = renderer.getSpriteCanvas(id, lvl.tileset, lvl.paletteIndex, true);
    const thumb     = document.createElement('canvas');
    thumb.width     = THUMB;
    thumb.height    = THUMB;
    const tctx = thumb.getContext('2d');
    tctx.fillStyle = '#F8F8E0';
    tctx.fillRect(0, 0, THUMB, THUMB);
    if (sprCanvas && sprCanvas.width > 0 && sprCanvas.height > 0) {
      const scale = Math.min(THUMB / sprCanvas.width, THUMB / sprCanvas.height) * 0.9;
      const dw = Math.round(sprCanvas.width  * scale);
      const dh = Math.round(sprCanvas.height * scale);
      const dx = Math.round((THUMB - dw) / 2);
      const dy = Math.round((THUMB - dh) / 2);
      tctx.imageSmoothingEnabled = false;
      tctx.drawImage(sprCanvas, dx, dy, dw, dh);
    }
    item.appendChild(thumb);

    // --- Label ---
    const hex   = id.toString(16).padStart(2, '0').toUpperCase();
    const label = document.createElement('span');
    label.textContent = `0x${hex}: ${name}`;
    item.title = label.textContent;
    item.appendChild(label);

    // --- Click to add ---
    item.addEventListener('click', () => {
      if (editor) editor.addSprite(id);
      _closeSpriteModal();
    });

    grid.appendChild(item);
  }
}

function _setupZoomControl() {
  const el = document.getElementById('zoom-level');
  const applyZoom = () => {
    if (!editor) return;
    const z = Math.max(1, Math.min(4, parseInt(el.value, 10) || 2));
    el.value = z;
    editor.scale       = z;
    editor.screenTileW = 8 * z;
    editor._resizeCanvas();
    editor.render();
    _renderTileSelector();
  };
  // 'input' fires on spinner arrow clicks and keyboard; 'change' fires on blur — cover both
  el.addEventListener('input',  applyZoom);
  el.addEventListener('change', applyZoom);
}

function _setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    if (!editor || !romLoaded) return;
    if (e.ctrlKey && e.key === 'z') { editor.undo(); e.preventDefault(); }
    if (e.key === 'Delete') {
      // Delete selected sprite
      const { idx } = editor.getSelectedSprite();
      if (idx >= 0) {
        editor.deleteSprite(idx);
        _refreshSpriteList();
      }
    }
  });
}

// ============================================================
// Editor event handlers
// ============================================================
function _attachEditorEvents() {
  const canvas = elCanvas();

  canvas.addEventListener('levelChanged', () => {
    isChanged = true;
    elSaveLevel().disabled = false;
    _updateLevelInfo();
    _updateVRAM();
  });

  canvas.addEventListener('spriteSelected', e => {
    const idx = e.detail;
    document.querySelectorAll('#sprite-list li').forEach((li, i) => {
      li.classList.toggle('selected', i === idx);
    });
    _updateSpriteProps();
  });

  canvas.addEventListener('spriteAdded',       () => _refreshSpriteList());
  canvas.addEventListener('spriteRemoved',      () => _refreshSpriteList());
  canvas.addEventListener('spriteListChanged',  () => _refreshSpriteList());

  canvas.addEventListener('switchAdded',        () => _refreshSwitchList());
  canvas.addEventListener('switchUpdated',      () => _refreshSwitchList());
  canvas.addEventListener('switchRemoved',      () => _refreshSwitchList());
  canvas.addEventListener('switchListChanged',  () => _refreshSwitchList());

  // Show tile name in info bar while hovering over the main level canvas
  canvas.addEventListener('mousemove', e => {
    if (!editor || !editor.lvl) return;
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const TS = editor.screenTileW;
    const tx = Math.floor((e.clientX - rect.left)  * scaleX / TS);
    const ty = Math.floor((e.clientY - rect.top)   * scaleY / TS);
    const W  = editor._levelW(), H = editor._levelH();
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return;
    const idx    = (ty * W + tx) * 2;
    const tileLo = editor.displayTilemap[idx];
    const tileHi = editor.displayTilemap[idx + 1];
    let info;
    if (tileLo === 0xFF && tileHi === 0) {
      info = `(${tx}, ${ty})  —  empty`;
    } else if (tileHi !== 0) {
      const baseId = tileLo; // sub-cell; show hex only
      info = `(${tx}, ${ty})  —  sub-cell 0x${((tileHi << 8) | tileLo).toString(16).toUpperCase()}`;
    } else {
      const name = TILE_NAMES[tileLo] || '???';
      info = `(${tx}, ${ty})  —  0x${tileLo.toString(16).padStart(2,'0').toUpperCase()}: ${name}`;
    }
    elLevelInfo().textContent = info;
  });
  canvas.addEventListener('mouseleave', () => _updateLevelInfo());

  // Tile selector canvas
  elTileCanvas().addEventListener('click',     e => _onTileSelectorClick(e));
  elTileCanvas().addEventListener('mousemove', e => _onTileSelectorHover(e));
  elTileCanvas().addEventListener('mouseleave', () => {
    document.getElementById('tile-hover-info').textContent = '';
    _hoveredTileId = -1;
    _renderTileSelector();
  });
}

// ============================================================
// Tile selector
// ============================================================
let _hoveredTileId   = -1;
let _selectedTileId  = 0xFF;
let _tileSelectorMap = []; // Array of { tileId, x, y } for hit testing

function _renderTileSelector() {
  if (!renderer || !editor) return;
  const canvas     = elTileCanvas();
  const lvl        = parser.levels[currentLevelId];
  const tsetCanvas = renderer.getTilesetCanvas(lvl.tileset, lvl.paletteIndex);

  // Sync internal canvas width to its displayed width.
  // Setting canvas.width resets the canvas — we do this first, before any drawing.
  const parentW = canvas.parentElement ? canvas.parentElement.clientWidth : 280;
  if (parentW > 0) canvas.width = parentW;

  _tileSelectorMap = [];
  const TS      = 16;   // Screen pixels per game tile in the selector
  const PAD     = 4;
  const LABEL_H = 16;
  const COLS    = Math.max(1, Math.floor((canvas.width - PAD * 2) / TS));

  // Helper: get tile dimensions from parser (falls back to 1×1)
  const getTileDims = id => {
    const ti = parser.tileInfo[id];
    return { tw: (ti && ti.w > 0) ? ti.w : 1, th: (ti && ti.h > 0) ? ti.h : 1 };
  };

  // --- Pre-calculate total canvas height (must be set BEFORE any drawing) ---
  let totalH = PAD;
  for (const group of TILE_GROUPS) {
    totalH += LABEL_H;
    let col = 0, rowH = 0;
    for (const tileId of group.tiles) {
      const { tw, th } = getTileDims(tileId);
      if (col > 0 && col + tw > COLS) { totalH += rowH; rowH = 0; col = 0; }
      rowH = Math.max(rowH, th * TS);
      col += tw;
      if (col >= COLS)               { totalH += rowH; rowH = 0; col = 0; }
    }
    if (rowH > 0) totalH += rowH;
    totalH += PAD;
  }
  canvas.height = totalH;   // Set ONCE here — never change again after this point

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!tsetCanvas) return;

  // --- Draw each group ---
  let y = PAD;
  for (const group of TILE_GROUPS) {
    ctx.fillStyle = '#aaa';
    ctx.font = '11px sans-serif';
    ctx.fillText(group.label, PAD, y + 11);
    y += LABEL_H;

    let col = 0, rowH = 0;
    for (const tileId of group.tiles) {
      const ti    = parser.tileInfo[tileId];
      const tw    = ti && ti.w > 0 ? ti.w : 1;
      const th    = ti && ti.h > 0 ? ti.h : 1;
      const addAt = ti ? ti.additionalTilesAt : 0;

      // Wrap to next row if tile doesn't fit
      if (col > 0 && col + tw > COLS) { y += rowH; rowH = 0; col = 0; }

      const cellX = PAD + col * TS;
      const cellY = y;

      // Draw all sub-cells of this tile
      for (let r = 0; r < th; r++) {
        for (let c = 0; c < tw; c++) {
          const linearIdx = r * tw + c;
          const atlasId   = linearIdx === 0 ? tileId : (0x100 + addAt + linearIdx - 1);
          const src       = renderer._tileAtlasPos(atlasId);
          ctx.drawImage(tsetCanvas, src.x, src.y, 8, 8,
            cellX + c * TS, cellY + r * TS, TS, TS);
        }
      }

      // Selection / hover highlight over full tile footprint
      const fw = tw * TS, fh = th * TS;
      if (tileId === _selectedTileId) {
        ctx.strokeStyle = '#ff0';
        ctx.lineWidth   = 2;
        ctx.strokeRect(cellX + 1, cellY + 1, fw - 2, fh - 2);
      } else if (tileId === _hoveredTileId) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth   = 1;
        ctx.strokeRect(cellX + 0.5, cellY + 0.5, fw - 1, fh - 1);
      }

      _tileSelectorMap.push({ tileId, x: cellX, y: cellY, w: fw, h: fh });
      rowH = Math.max(rowH, th * TS);
      col += tw;
      if (col >= COLS) { y += rowH; rowH = 0; col = 0; }
    }
    if (rowH > 0) { y += rowH; }
    y += PAD;
  }
}

function _onTileSelectorClick(e) {
  const hit = _hitTestTileSelector(e);
  if (hit >= 0) {
    _selectedTileId = hit;
    if (editor) editor.tileToDraw = hit;
    _renderTileSelector();
  }
}

function _onTileSelectorHover(e) {
  const hit = _hitTestTileSelector(e);
  if (hit !== _hoveredTileId) {
    _hoveredTileId = hit;
    _renderTileSelector();
  }
  const info = document.getElementById('tile-hover-info');
  if (hit >= 0 && hit !== 0xFF) {
    const hex  = hit.toString(16).padStart(2, '0').toUpperCase();
    const name = TILE_NAMES[hit] || '???';
    info.textContent = `0x${hex}: ${name}`;
  } else {
    info.textContent = '';
  }
}

function _hitTestTileSelector(e) {
  const canvas = elTileCanvas();
  const rect   = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  const mx = (e.clientX - rect.left)  * scaleX;
  const my = (e.clientY - rect.top)   * scaleY;

  for (const item of _tileSelectorMap) {
    if (mx >= item.x && mx < item.x + item.w &&
        my >= item.y && my < item.y + item.h)
      return item.tileId;
  }
  return -1;
}

// ============================================================
// Sprite list UI
// ============================================================
function _refreshSpriteList() {
  if (!editor) return;
  const list = elSpriteList();
  list.innerHTML = '';
  for (let i = 0; i < editor.sprites.length; i++) {
    const spr = editor.sprites[i];
    const li  = document.createElement('li');
    li.textContent = `${i}: ${spriteLabel(spr.id)}`;
    li.dataset.idx = i;
    li.classList.toggle('selected', i === editor.selectedSprite);

    li.addEventListener('click', () => {
      editor.selectedSprite = i;
      editor.render();
      document.querySelectorAll('#sprite-list li').forEach((el, j) =>
        el.classList.toggle('selected', j === i)
      );
      _updateSpriteProps();
    });

    li.addEventListener('keydown', e => {
      if (e.key === 'Delete') editor.deleteSprite(i);
    });
    list.appendChild(li);
  }
  _updateSpriteProps();
  _updateVRAM();
}

function _updateSpriteProps() {
  if (!editor) return;
  const { idx, id } = editor.getSelectedSprite();
  const propsEl = document.getElementById('sprite-props-container');
  if (!propsEl) return;

  // Always show the container when any sprite is selected (delete button is always needed)
  propsEl.style.display = idx >= 0 ? 'block' : 'none';
  if (idx < 0) return;

  const flag = editor.getSpriteFlag(idx);

  // Show/hide controls based on sprite type
  document.getElementById('prop-flip').style.display    = [0x7F,0x80,0x98,0x84,0x54].includes(id) ? '' : 'none';
  document.getElementById('prop-speed').style.display   = [0x80,0x98,0x84].includes(id) ? '' : 'none';
  document.getElementById('prop-elevator').style.display= [0x70,0x72].includes(id) ? '' : 'none';
  document.getElementById('prop-raw').style.display     = [0xB8,0x6E,0x9A,0xCC].includes(id) ? '' : 'none';

  document.getElementById('spb-raw').value = flag;

  if (id === 0x7F) {
    document.getElementById('btn-flip').textContent = flag ? 'Facing Left' : 'Facing Right';
  } else if (id === 0x84) {
    document.getElementById('btn-flip').textContent = (flag & 1) ? 'Facing Left' : 'Facing Right';
  } else if (id === 0x54) {
    document.getElementById('btn-flip').textContent = flag ? 'Slow' : 'Normal';
  } else {
    document.getElementById('btn-flip').textContent = (flag & 1) ? 'Facing Left' : 'Facing Right';
  }

  if ([0x80,0x98,0x84].includes(id)) {
    document.getElementById('spb-speed').value = flag >> 1;
  }
  if ([0x70,0x72].includes(id)) {
    document.getElementById('cmb-elevator').value = Math.min(flag, 15);
  }
}

// ============================================================
// Switch list UI
// ============================================================
function _refreshSwitchList() {
  if (!editor) return;
  const list = elSwitchList();
  // Clear old switch entries (keep the hint paragraph if present)
  const items = list.querySelectorAll('.switch-item');
  items.forEach(el => el.remove());

  for (let i = 0; i < editor.switches.length; i++) {
    const sw   = editor.switches[i];
    const states = ['left','middle','right'];
    const item = document.createElement('div');
    item.className = 'switch-item';
    item.innerHTML = `
      <div class="switch-header" data-idx="${i}">
        <span>Switch ${i} (${states[sw.state] || '?'}) at ${sw.x}×${sw.y}</span>
        <button class="btn-del-sw" data-idx="${i}" title="Delete switch">✕</button>
      </div>
      <ul class="switch-objs">
        ${sw.connectedTo.map((obj, j) =>
          `<li data-sw="${i}" data-obj="${j}">${obj.isSprite ? 'Sprite' : 'Tile'} at ${obj.x}×${obj.y}
            <button class="btn-del-obj" data-sw="${i}" data-obj="${j}" title="Remove">✕</button>
          </li>`
        ).join('')}
      </ul>
    `;
    list.appendChild(item);
  }

  // Event delegation for delete buttons
  list.querySelectorAll('.btn-del-sw').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx, 10);
      editor.switchToEdit = idx;
      editor.deleteCurrentSwitch();
    });
  });
  list.querySelectorAll('.btn-del-obj').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const swIdx  = parseInt(btn.dataset.sw,  10);
      const objIdx = parseInt(btn.dataset.obj, 10);
      editor.switchToEdit = swIdx;
      editor.deleteSwitchObj(objIdx);
    });
  });
  list.querySelectorAll('.switch-header').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const idx = parseInt(hdr.dataset.idx, 10);
      editor.selectSwitch(idx === editor.switchToEdit ? -1 : idx);
    });
  });
}

// ============================================================
// VRAM usage
// ============================================================
function _updateVRAM() {
  if (!editor || !parser) return;
  const lvl = parser.levels[currentLevelId];
  const { tiles, sprites } = parser.calcVRAMUsage(editor.displayTilemap, editor.sprites);

  const tBar = elVRAMtilesBar();
  const sBar = elVRAMsprBar();

  const tPct = Math.min(100, (tiles   / C.VRAM_TILES)   * 100);
  const sPct = Math.min(100, (sprites / C.VRAM_SPRITES) * 100);

  tBar.style.width = tPct + '%';
  sBar.style.width = sPct + '%';

  tBar.style.background = tiles   > C.VRAM_TILES   ? '#e55' : tiles   > C.VRAM_TILES * 0.85   ? '#fa0' : '#4a4';
  sBar.style.background = sprites > C.VRAM_SPRITES ? '#e55' : sprites > C.VRAM_SPRITES * 0.85 ? '#fa0' : '#4a4';

  elVRAMtilesLbl().textContent = `${tiles}/${C.VRAM_TILES}`;
  elVRAMsprLbl().textContent   = `${sprites}/${C.VRAM_SPRITES}`;
}

// ============================================================
// Level info panel
// ============================================================
function _updateLevelInfo() {
  if (!parser) return;
  elLevelInfo().textContent = parser.getLevelInfo(currentLevelId);
}

// ============================================================
// UI helpers
// ============================================================
function _enableUI(on) {
  [elLevelNum(), elCmbSize(), elCmbMusic(), elCmbTileset(), elSpbTime(), elSpbPalette(),
   elSaveROM(), elExportLvl(), elImportLvl(), elUndo(), elClear(),
   document.getElementById('btn-add-sprite'), document.getElementById('zoom-level'),
   document.getElementById('btn-test-level')]
    .forEach(el => el && (el.disabled = !on));
}

function _silentSet(el, value) {
  if (!el) return;
  const prev = el.onchange;
  el.onchange = null;
  el.value = value;
  el.onchange = prev;
}

function _downloadBuffer(buffer, filename) {
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Expose globally so _renderTileSelector can be triggered from editor
window._renderTileSelector = _renderTileSelector;
