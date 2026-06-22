/* ===================================================================
   zip.js — minimal, dependency-free ZIP writer (STORE / no compression)
   Lets us bundle many CSV + JSON files into one download with no CDN.
   Implements CRC-32 and the ZIP local-file / central-directory records.
   =================================================================== */
(function (global) {
  "use strict";

  // --- CRC-32 (IEEE 802.3) lookup table -------------------------------
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // --- DOS date/time from a JS Date ------------------------------------
  function dosDateTime(date) {
    const y = Math.max(1980, date.getFullYear());
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const day = ((y - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time: time & 0xFFFF, date: day & 0xFFFF };
  }

  const enc = new TextEncoder();

  /**
   * Build a ZIP blob from a list of files.
   * @param {Array<{name:string, data:(string|Uint8Array)}>} files
   * @returns {Blob}
   */
  function makeZip(files) {
    const now = new Date();
    const { time, date } = dosDateTime(now);
    const chunks = [];        // body: local headers + data
    const central = [];       // central directory records
    let offset = 0;

    function u16(n) { return new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF]); }
    function u32(n) {
      return new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]);
    }

    for (const f of files) {
      const nameBytes = enc.encode(f.name);
      const data = (typeof f.data === "string") ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const size = data.length;

      // ---- local file header (sig 0x04034b50) ----
      const local = [
        u32(0x04034b50),
        u16(20),            // version needed
        u16(0x0800),        // flags: bit 11 = UTF-8 filenames
        u16(0),             // method 0 = stored
        u16(time), u16(date),
        u32(crc), u32(size), u32(size),
        u16(nameBytes.length), u16(0),
        nameBytes, data,
      ];
      const localLen = local.reduce((a, b) => a + b.length, 0);
      chunks.push(...local);

      // ---- central directory record (sig 0x02014b50) ----
      central.push(
        u32(0x02014b50),
        u16(20), u16(20),   // version made by / needed
        u16(0x0800), u16(0),
        u16(time), u16(date),
        u32(crc), u32(size), u32(size),
        u16(nameBytes.length), u16(0), u16(0), // name/extra/comment len
        u16(0), u16(0),     // disk start / internal attrs
        u32(0),             // external attrs
        u32(offset),        // local header offset
        nameBytes,
      );
      offset += localLen;
    }

    const centralStart = offset;
    const centralLen = central.reduce((a, b) => a + b.length, 0);

    // ---- end of central directory (sig 0x06054b50) ----
    const eocd = [
      u32(0x06054b50),
      u16(0), u16(0),
      u16(files.length), u16(files.length),
      u32(centralLen), u32(centralStart),
      u16(0),
    ];

    return new Blob([...chunks, ...central, ...eocd], { type: "application/zip" });
  }

  global.CSBZip = { makeZip, crc32 };
})(window);
