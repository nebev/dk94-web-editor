'use strict';
// ============================================================
// lzss.js
// LZSS compress and decompress routines
// Ported directly from QDKEdit::LZSSDecompress() and
// QDKEdit::LZSSCompress() in QDKEdit.cpp
// ============================================================

/**
 * Decompress LZSS data from a ROM buffer.
 *
 * The Game Boy DK '94 LZSS format:
 *   - Flag byte: 8 bits, each bit (LSB first) describes next token
 *       1 = raw literal byte follows
 *       0 = back-reference: 2 bytes follow
 *           byte1 = low 8 bits of look-back distance
 *           byte2 = high 4 bits of distance (bits 7-4) + copy length - 3 (bits 3-0)
 *   - Decompression stops once decompressedSize bytes have been produced.
 *
 * @param {Uint8Array} rom   - Full ROM buffer
 * @param {number}     pos   - Byte offset in ROM where compressed data starts
 * @param {number}     decompressedSize - Expected output size in bytes
 * @returns {Uint8Array} Decompressed data
 */
function lzssDecompress(rom, pos, decompressedSize) {
  const out = new Uint8Array(decompressedSize);
  let outPos = 0;

  while (outPos < decompressedSize) {
    const flags = rom[pos++];

    for (let i = 0; i < 8 && outPos < decompressedSize; i++) {
      if (flags & (1 << i)) {
        // Raw literal byte
        out[outPos++] = rom[pos++];
      } else {
        // Back-reference: 2 bytes encode distance and copy length
        const byte1 = rom[pos++];
        const byte2 = rom[pos++];

        // Distance is 12 bits: byte1 + upper nibble of byte2 × 256
        const start = byte1 + ((byte2 >> 4) * 256);
        // Copy length is lower nibble of byte2 + 3
        const len = (byte2 & 0x0F) + 3;

        if (start === 0) {
          console.warn('LZSSDecompress: start=0, aborting block');
          return out.slice(0, outPos);
        }

        // Copy bytes from earlier in output (may overlap)
        const base = outPos - start;
        for (let j = 0; j < len && outPos < decompressedSize; j++) {
          out[outPos++] = out[base + j];
        }
      }
    }
  }

  return out;
}

/**
 * Compress data to LZSS format.
 *
 * Ported from QDKEdit::LZSSCompress().
 * Searches up to 4096 bytes back for a match; minimum match is 3 bytes,
 * maximum is 18 bytes (fits in 4-bit length field).
 *
 * @param {Uint8Array} src - Data to compress
 * @returns {Uint8Array}   - Compressed output
 */
function lzssCompress(src) {
  const compressed = [];
  let flagByte = 0x01;    // Current accumulated flag byte (first bit pre-set for raw byte)
  let flagBit  = 0x02;    // Next bit to set in flagByte
  let flagPos  = 0;       // Index in compressed[] where current flag byte lives
  let srcPos   = 0;

  // First flag byte placeholder + first raw byte (always literal)
  compressed.push(flagByte);  // flagPos = 0
  compressed.push(src[srcPos++]);

  while (srcPos < src.length) {
    // Search backwards for the best match in the last 4096 bytes
    const matchEnd = Math.max(0, srcPos - 4096);
    let matchLength = 0;
    let matchRelPos = 0;

    for (let i = srcPos - 1; i >= matchEnd; i--) {
      let j = 0;
      // Compare up to 18 bytes
      while (j < 18 && i + j < src.length && srcPos + j < src.length &&
             src[i + j] === src[srcPos + j]) {
        j++;
      }
      if (j > matchLength) {
        matchLength = j;
        matchRelPos = srcPos - i;   // Distance back from current position
        if (matchLength === 18) break; // Can't do better
      }
    }

    if (matchLength < 3) {
      // No useful match — emit raw byte
      flagByte |= flagBit;
      compressed.push(src[srcPos++]);
    } else {
      // Emit back-reference (flag bit stays 0)
      srcPos += matchLength;
      matchLength -= 3;  // Encode length offset

      // Pack distance and length into 2 bytes:
      //   byte1 = low 8 bits of distance
      //   byte2 = high 4 bits of distance (upper nibble) | length (lower nibble)
      compressed.push(matchRelPos & 0xFF);
      compressed.push(((matchRelPos >> 8) << 4) | (matchLength & 0x0F));
    }

    if (flagBit === 0x80) {
      // Flag byte is full — write it back and start a new one
      compressed[flagPos] = flagByte;
      flagByte = 0x00;
      flagBit  = 0x01;
      flagPos  = compressed.length;
      if (srcPos < src.length) {
        compressed.push(0x1D); // Placeholder for next flag byte
      }
    } else {
      flagBit <<= 1;
    }
  }

  // Write back the last (possibly incomplete) flag byte
  if (flagBit !== 1) {
    compressed[flagPos] = flagByte;
  }

  return new Uint8Array(compressed);
}
