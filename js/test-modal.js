'use strict';
// ============================================================
// test-modal.js  —  WASMBoy embedded emulator for level testing
//
// Each test session runs inside an <iframe src="/test-player.html">.
// Setting a new src gives a completely fresh JS/WASM/Worker context,
// eliminating all shared state between sessions.
//
// On close the iframe is blanked (about:blank), which terminates every
// Worker and AudioContext the player created.
// ============================================================

const TEST_SLOT = 4;   // Level index whose ROM slot we overwrite for testing

let _messageHandler = null;   // Active listener; removed on close

// ---- Serialise Uint8Arrays as { __b64, data } for JSON transport ----
function _serializeState(val) {
  if (val instanceof Uint8Array) {
    let bin = '';
    for (let i = 0; i < val.length; i++) bin += String.fromCharCode(val[i]);
    return { __b64: true, data: btoa(bin) };
  }
  if (Array.isArray(val))                 return val.map(_serializeState);
  if (val && typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) out[k] = _serializeState(v);
    return out;
  }
  return val;
}

// ---- Open modal and launch emulator -------------------------
async function openTestModal() {
  const modal  = document.getElementById('test-modal');
  const status = document.getElementById('test-status');
  const frame  = document.getElementById('test-frame');

  const setStatus = msg => { status.textContent = msg; console.log('[Test]', msg); };

  modal.style.display = 'flex';
  setStatus('Building test ROM…');

  // Remove any listener left over from a previous session.
  if (_messageHandler) {
    window.removeEventListener('message', _messageHandler);
    _messageHandler = null;
  }

  try {
    // Build a ROM with the current level spliced into slot TEST_SLOT.
    const romArr    = new Uint8Array(_buildTestROM());
    // slice() produces an independent ArrayBuffer — safe to transfer.
    const romBuffer = romArr.buffer.slice(0);

    // Fetch the committed save state as raw JSON each time so we always
    // have a fresh copy.  This is the state the iframe will restore.
    let stateJson = null;
    try {
      const res = await fetch('/saves/teststate.json');
      if (res.ok) stateJson = await res.text();
    } catch (_) { /* no state yet — player will boot from scratch */ }

    // Wire up the message handler before setting src so we never miss
    // the PLAYER_LOADED message.
    _messageHandler = (e) => {
      if (e.source !== frame.contentWindow) return;

      switch (e.data.type) {
        case 'PLAYER_LOADED':
          // iframe script has run; send it the ROM and state.
          setStatus('Loading ROM…');
          frame.contentWindow.postMessage(
            { type: 'INIT', rom: romBuffer, stateJson },
            '*',
            [romBuffer]   // transfer: avoids copying the ~1 MB ROM
          );
          break;
        case 'STATUS':
          setStatus(e.data.message);
          break;
        case 'READY':
          setStatus(`▶ Running`);
          break;
        case 'ERROR':
          setStatus('❌ ' + e.data.message);
          break;
        case 'STATE_SAVED':
          setStatus('✅ teststate.json downloaded — place it in saves/ and commit to repo.');
          break;
        case 'SAVE_ERROR':
          setStatus('❌ Save error: ' + e.data.message);
          break;
      }
    };

    window.addEventListener('message', _messageHandler);

    // Navigate the iframe — this creates a completely fresh JS/WASM context.
    frame.src = '/test-player.html';

    // Focus the frame
    setTimeout(() => frame.contentWindow.focus(), 100);

  } catch (err) {
    setStatus('❌ ' + err.message);
    console.error('[Test]', err);
  }
}

// ---- Close modal — blank the iframe to kill everything ------
// Navigating to about:blank terminates all Workers and AudioContexts
// that were created inside the iframe, so audio stops immediately.
function closeTestModal() {
  document.getElementById('test-modal').style.display = 'none';

  if (_messageHandler) {
    window.removeEventListener('message', _messageHandler);
    _messageHandler = null;
  }

  const frame = document.getElementById('test-frame');
  frame.src = 'about:blank';
}

// ---- Download the current emulator state --------------------
function downloadTestSaveState() {
  const frame = document.getElementById('test-frame');
  if (!frame || !frame.contentWindow) { alert('Emulator is not running.'); return; }
  frame.contentWindow.postMessage({ type: 'SAVE_STATE' }, '*');
}

// ---- Build a ROM with the current level in TEST_SLOT --------
function _buildTestROM() {
  if (!parser) throw new Error('No ROM loaded');

  parser._recompressLevel(currentLevelId);

  const src  = parser.levels[currentLevelId];
  const orig = parser.levels[TEST_SLOT];

  parser.levels[TEST_SLOT] = {
    ...orig,
    size:             src.size,
    music:            src.music,
    tileset:          src.tileset,
    time:             src.time,
    paletteIndex:     src.paletteIndex,
    fullData:         new Uint8Array(src.fullData),
    fullDataUpToDate: true,
    sprites:          src.sprites.map(s => Object.assign({}, s)),
    switches:         src.switches.map(s => Object.assign({}, s)),
    switchData:       src.switchData,
    addSpriteData:    src.addSpriteData,
    rawSwitchData:    src.rawSwitchData    ? new Uint8Array(src.rawSwitchData)    : null,
    rawAddSpriteData: src.rawAddSpriteData ? new Uint8Array(src.rawAddSpriteData) : null,
    rawTilemap:       src.rawTilemap       ? new Uint8Array(src.rawTilemap)       : null,
    displayTilemap:   src.displayTilemap   ? new Uint8Array(src.displayTilemap)   : null,
  };

  let result;
  try {
    result = parser.saveToBuffer();
  } finally {
    parser.levels[TEST_SLOT] = orig;
  }

  if (!result) throw new Error('saveToBuffer() returned null');
  return result;
}
