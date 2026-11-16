/*
 * BOSS RC-500 Editor — WAV reading/writing and a tiny ZIP writer (for backups).
 * Copyright (C) 2026 Jon Solberg — GPL-3.0-or-later (see LICENSE).
 */
(function (root) {
  'use strict';

  /** Read a WAV header: returns {format, channels, rate, bits, dataOffset, dataLength, frames, seconds}. */
  function wavInfo(bytes) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    function tag(o) { return String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]); }
    if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file');
    var o = 12, info = {};
    while (o + 8 <= bytes.length) {
      var id = tag(o), len = dv.getUint32(o + 4, true);
      if (id === 'fmt ') {
        info.format = dv.getUint16(o + 8, true);
        info.channels = dv.getUint16(o + 10, true);
        info.rate = dv.getUint32(o + 12, true);
        info.bits = dv.getUint16(o + 22, true);
        if (info.format === 0xFFFE && len >= 26) info.format = dv.getUint16(o + 32, true); // EXTENSIBLE sub-format
      } else if (id === 'data') {
        info.dataOffset = o + 8;
        info.dataLength = Math.min(len, bytes.length - o - 8);
        break;
      }
      o += 8 + len + (len & 1);
    }
    if (!info.channels || info.dataOffset === undefined) throw new Error('Unsupported WAV file');
    info.frames = Math.floor(info.dataLength / (info.channels * info.bits / 8));
    info.seconds = info.frames / info.rate;
    return info;
  }

  /** Decode PCM16/24/32 or float32 WAV to an AudioBuffer (doesn't rely on decodeAudioData). */
  function wavToAudioBuffer(ctx, bytes) {
    var w = wavInfo(bytes);
    var dv = new DataView(bytes.buffer, bytes.byteOffset + w.dataOffset, w.dataLength);
    var buf = ctx.createBuffer(w.channels, Math.max(1, w.frames), w.rate);
    var bps = w.bits / 8, stride = bps * w.channels;
    for (var c = 0; c < w.channels; c++) {
      var out = buf.getChannelData(c);
      for (var i = 0, p = c * bps; i < w.frames; i++, p += stride) {
        var v;
        if (w.format === 3 && w.bits === 32) v = dv.getFloat32(p, true);
        else if (w.bits === 16) v = dv.getInt16(p, true) / 32768;
        else if (w.bits === 24) { var x = dv.getUint8(p) | (dv.getUint8(p + 1) << 8) | (dv.getInt8(p + 2) << 16); v = x / 8388608; }
        else if (w.bits === 32) v = dv.getInt32(p, true) / 2147483648;
        else v = (dv.getUint8(p) - 128) / 128;
        out[i] = v;
      }
    }
    return buf;
  }

  /** Encode an AudioBuffer as 44.1 kHz, 32-bit float, stereo WAV — the format the RC-500 imports. */
  function encodeRc500Wav(buf) {
    var frames = buf.length, ch = 2;
    var L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    var dataLen = frames * ch * 4;
    var out = new ArrayBuffer(58 + dataLen);
    var dv = new DataView(out);
    function str(o, s) { for (var i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); dv.setUint32(4, 50 + dataLen, true); str(8, 'WAVE');
    str(12, 'fmt '); dv.setUint32(16, 18, true);
    dv.setUint16(20, 3, true); dv.setUint16(22, ch, true); dv.setUint32(24, buf.sampleRate, true);
    dv.setUint32(28, buf.sampleRate * ch * 4, true); dv.setUint16(32, ch * 4, true); dv.setUint16(34, 32, true);
    dv.setUint16(36, 0, true);
    str(38, 'fact'); dv.setUint32(42, 4, true); dv.setUint32(46, frames, true);
    str(50, 'data'); dv.setUint32(54, dataLen, true);
    var f = new Float32Array(frames * 2); // little-endian on every platform we run on
    for (var i = 0; i < frames; i++) { f[2 * i] = L[i]; f[2 * i + 1] = R[i]; }
    var bytes = new Uint8Array(out);
    bytes.set(new Uint8Array(f.buffer), 58);
    return bytes;
  }

  /** Decode any browser-supported audio file and resample to 44.1 kHz stereo. */
  function decodeAny(bytes) {
    var AC = root.AudioContext || root.webkitAudioContext;
    var ctx = new AC();
    var copy = bytes.slice().buffer;
    return new Promise(function (res, rej) {
      var p = ctx.decodeAudioData(copy, res, rej);
      if (p && p.then) p.then(res, rej);
    }).catch(function () {
      return wavToAudioBuffer(ctx, bytes); // e.g. 32-bit float WAV in older WebViews
    }).then(function (decoded) {
      ctx.close && ctx.close();
      var frames = Math.ceil(decoded.duration * 44100);
      var off = new OfflineAudioContext(2, frames, 44100);
      var src = off.createBufferSource();
      src.buffer = decoded;
      if (decoded.numberOfChannels === 1) {
        var merger = off.createChannelMerger(2);
        src.connect(merger, 0, 0); src.connect(merger, 0, 1); merger.connect(off.destination);
      } else src.connect(off.destination);
      src.start();
      return off.startRendering();
    });
  }

  // ---- ZIP (stored, no compression) ----
  var CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  /** files: [{name, data:Uint8Array}] -> Uint8Array */
  function zip(files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    var d = new Date(), dt = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)),
      dd = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate());
    files.forEach(function (f) {
      var name = enc.encode(f.name), crc = crc32(f.data);
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true); h.setUint16(8, 0, true);
      h.setUint16(10, dt, true); h.setUint16(12, dd, true); h.setUint32(14, crc, true);
      h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, f.data);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true);
      c.setUint16(12, dt, true); c.setUint16(14, dd, true); c.setUint32(16, crc, true);
      c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, name.length, true);
      c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + f.data.length;
    });
    var cdSize = central.reduce(function (a, b) { return a + b.length; }, 0);
    var e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
    var all = parts.concat(central, [new Uint8Array(e.buffer)]);
    var out = new Uint8Array(all.reduce(function (a, b) { return a + b.length; }, 0)), p = 0;
    all.forEach(function (b) { out.set(b, p); p += b.length; });
    return out;
  }

  root.RCAudio = { wavInfo: wavInfo, wavToAudioBuffer: wavToAudioBuffer, encodeRc500Wav: encodeRc500Wav, decodeAny: decodeAny, zip: zip, crc32: crc32 };
})(typeof window !== 'undefined' ? window : globalThis);
