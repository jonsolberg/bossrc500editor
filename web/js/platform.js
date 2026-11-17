/*
 * BOSS RC-500 Editor — access to the pedal over its USB port.
 * Copyright (C) 2026 Jon Solberg — GPL-3.0-or-later (see LICENSE).
 *
 * Two things come in over the RC-500's single USB connector:
 *  - USB MIDI: remote control (PC/CC/start/stop) and the Roland SysEx that switches the
 *    pedal into "storage" mode, exactly as BOSS TONE STUDIO for RC does.
 *  - USB mass storage ("BOSS RC-500" drive, ROLAND/DATA + ROLAND/WAVE) while in storage mode.
 *
 * Back ends:
 *  - Web, Chromium:   Web MIDI + File System Access API (read & write the drive directly)
 *  - Web, Firefox:    Web MIDI + folder upload (read) / downloads (write)
 *  - Android app:     window.RC500Native bridge (android.media.midi + Storage Access Framework)
 */
(function (root) {
  'use strict';

  var Native = root.RC500Native || null;
  var isAndroid = !!Native;

  // ------------------------------------------------------------------ helpers
  function b64ToBytes(s) { var bin = atob(s), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  function bytesToB64(b) { var s = '', CH = 0x8000; for (var i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH)); return btoa(s); }
  function hex(b) { return Array.prototype.map.call(b, function (x) { return (x < 16 ? '0' : '') + x.toString(16).toUpperCase(); }).join(' '); }
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Async native calls: Java answers through window.__rcNative(id, ok, payload)
  var pending = {}, nextId = 1;
  root.__rcNative = function (id, ok, payload) {
    var p = pending[id]; if (!p) return; delete pending[id];
    ok ? p.res(payload) : p.rej(new Error(payload || 'Cancelled'));
  };
  function nativeAsync(fn) {
    return new Promise(function (res, rej) { var id = nextId++; pending[id] = { res: res, rej: rej }; fn(id); });
  }
  function nativeSync(r) {
    if (typeof r === 'string' && r.indexOf('ERR:') === 0) throw new Error(r.slice(4));
    return r;
  }

  // ------------------------------------------------------------------ raw stores (paths relative to the picked folder)
  function FsaRaw(handle) {
    this.handle = handle; this.name = handle.name; this.writable = true; this.kind = 'fsa';
  }
  FsaRaw.prototype._dir = async function (parts, create) {
    var h = this.handle;
    for (var i = 0; i < parts.length; i++) if (parts[i]) h = await h.getDirectoryHandle(parts[i], { create: !!create });
    return h;
  };
  FsaRaw.prototype.list = async function (path) {
    var out = [];
    try {
      var d = await this._dir(path ? path.split('/') : []);
      for await (var e of d.values()) out.push({ name: e.name, dir: e.kind === 'directory' });
    } catch (e) { if (e.name !== 'NotFoundError' && e.name !== 'TypeMismatchError') throw e; }
    return out;
  };
  FsaRaw.prototype.read = async function (path) {
    var p = path.split('/'), f = p.pop();
    var fh = await (await this._dir(p)).getFileHandle(f);
    return new Uint8Array(await (await fh.getFile()).arrayBuffer());
  };
  FsaRaw.prototype.size = async function (path) {
    try { var p = path.split('/'), f = p.pop(); return (await (await (await this._dir(p)).getFileHandle(f)).getFile()).size; }
    catch (e) { return -1; }
  };
  FsaRaw.prototype.write = async function (path, bytes) {
    var p = path.split('/'), f = p.pop();
    var fh = await (await this._dir(p, true)).getFileHandle(f, { create: true });
    var w = await fh.createWritable();
    await w.write(bytes); await w.close();
  };
  FsaRaw.prototype.remove = async function (path) {
    var p = path.split('/'), f = p.pop();
    await (await this._dir(p)).removeEntry(f);
  };

  function FilesRaw(fileList) {
    this.files = {}; this.writable = false; this.kind = 'files';
    var first = fileList[0] && (fileList[0].webkitRelativePath || fileList[0].name);
    this.name = first ? first.split('/')[0] : '';
    for (var i = 0; i < fileList.length; i++) {
      var f = fileList[i], rel = (f.webkitRelativePath || f.name).split('/').slice(1).join('/');
      this.files[rel] = f;
    }
  }
  FilesRaw.prototype.list = async function (path) {
    var pre = path ? path + '/' : '', seen = {}, out = [];
    Object.keys(this.files).forEach(function (k) {
      if (k.indexOf(pre) !== 0) return;
      var rest = k.slice(pre.length).split('/');
      if (seen[rest[0]]) return; seen[rest[0]] = 1;
      out.push({ name: rest[0], dir: rest.length > 1 });
    });
    return out;
  };
  FilesRaw.prototype.read = async function (path) {
    var f = this.files[path]; if (!f) throw new Error('Not found: ' + path);
    return new Uint8Array(await f.arrayBuffer());
  };
  FilesRaw.prototype.size = async function (path) { var f = this.files[path]; return f ? f.size : -1; };
  FilesRaw.prototype.write = function () { return Promise.reject(new Error('read-only')); };
  FilesRaw.prototype.remove = FilesRaw.prototype.write;

  function NativeRaw(name) { this.name = name; this.writable = true; this.kind = 'native'; }
  NativeRaw.prototype.list = async function (path) { return JSON.parse(nativeSync(Native.list(path || ''))); };
  NativeRaw.prototype.size = async function (path) { return +nativeSync(Native.size(path)); };
  NativeRaw.prototype.read = async function (path) {
    var size = await this.size(path); if (size < 0) throw new Error('Not found: ' + path);
    var out = new Uint8Array(size), CH = 768 * 1024;
    for (var o = 0; o < size; o += CH) {
      var part = b64ToBytes(nativeSync(Native.readChunk(path, o, Math.min(CH, size - o))));
      out.set(part, o); await tick();
    }
    return out;
  };
  NativeRaw.prototype.write = async function (path, bytes) {
    var t = nativeSync(Native.writeBegin(path));
    await streamToNative(t, bytes);
  };
  NativeRaw.prototype.remove = async function (path) { nativeSync(Native.remove(path)); };
  async function streamToNative(token, bytes) {
    var CH = 768 * 1024;
    try {
      for (var o = 0; o < bytes.length; o += CH) { nativeSync(Native.writeChunk(token, bytesToB64(bytes.subarray(o, o + CH)))); await tick(); }
    } finally { nativeSync(Native.writeEnd(token)); }
  }

  // ------------------------------------------------------------------ ROLAND folder view on top of a raw store
  /**
   * Accepts the drive root, the ROLAND folder, or the DATA folder itself.
   * Paths are then "DATA/MEMORY1.RC0", "WAVE/001_1/xyz.WAV".
   */
  async function rolandView(raw) {
    var top = await raw.list('');
    function has(list, n, dir) { return list.some(function (e) { return e.name.toUpperCase() === n && e.dir === dir; }); }
    function find(list, n) { for (var i = 0; i < list.length; i++) if (list[i].name.toUpperCase() === n) return list[i].name; return n; }
    var prefix = null, dataOnly = false;
    if (has(top, 'ROLAND', true)) prefix = find(top, 'ROLAND') + '/';
    else if (has(top, 'DATA', true)) prefix = '';
    else if (has(top, 'MEMORY1.RC0', false) || has(top, 'MEMORY2.RC0', false)) { prefix = ''; dataOnly = true; }
    if (prefix === null) throw new Error('No ROLAND folder found. Pick the BOSS RC-500 drive, its ROLAND folder or ROLAND/DATA.');
    function map(p) {
      if (dataOnly) { if (p.indexOf('DATA/') === 0) return p.slice(5); if (p === 'DATA') return ''; return null; }
      return prefix + p;
    }
    return {
      name: raw.name, kind: raw.kind, writable: raw.writable, hasWave: !dataOnly,
      list: function (p) { var m = map(p); return m === null ? Promise.resolve([]) : raw.list(m.replace(/\/$/, '')); },
      read: function (p) { return raw.read(map(p)); },
      size: function (p) { var m = map(p); return m === null ? Promise.resolve(-1) : raw.size(m); },
      write: function (p, b) { var m = map(p); if (m === null) return Promise.reject(new Error('No WAVE folder')); return raw.write(m, b); },
      remove: function (p) { return raw.remove(map(p)); }
    };
  }

  // A tiny IndexedDB store, to remember the picked drive between visits (Chromium keeps the handle).
  function idb(mode, fn) {
    return new Promise(function (res, rej) {
      if (!root.indexedDB) { rej(new Error('no IndexedDB')); return; }
      var r = indexedDB.open('rc500editor', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onerror = function () { rej(r.error); };
      r.onsuccess = function () {
        var tx = r.result.transaction('kv', mode), st = tx.objectStore('kv'), q = fn(st);
        tx.oncomplete = function () { res(q && q.result); r.result.close(); };
        tx.onerror = function () { rej(tx.error); };
      };
    });
  }
  function remember(handle) { return idb('readwrite', function (st) { return st.put(handle, 'drive'); }).catch(function () { }); }
  function remembered() { return idb('readonly', function (st) { return st.get('drive'); }).catch(function () { return null; }); }

  var Storage = {
    canWriteDirect: isAndroid || typeof root.showDirectoryPicker === 'function',
    isAndroid: isAndroid,
    /** Pick folder (Chromium / Android). */
    pick: async function () {
      if (isAndroid) {
        var name = await nativeAsync(function (id) { Native.pickFolder(id); });
        return rolandView(new NativeRaw(name));
      }
      var h = await root.showDirectoryPicker({ id: 'rc500', mode: 'readwrite' });
      var v = await rolandView(new FsaRaw(h));
      remember(h);
      return v;
    },
    /**
     * Use the drive picked earlier, without asking where it is.
     * Returns the view, null if there is none, or throws 'needs-permission' (Chromium wants a click first)
     * or the read error when the drive isn't there (yet).
     */
    openRemembered: async function (ask) {
      if (isAndroid) {
        if (!Native.hasFolder()) return null;
        var name = Native.currentFolder();
        if (!name) { var nr = new Error('The drive is not there (yet)'); nr.code = 'not-ready'; throw nr; }
        return rolandView(new NativeRaw(name));
      }
      if (!Storage.canWriteDirect) return null;
      var h = await remembered();
      if (!h) return null;
      var perm = await h.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        if (!ask) { var e = new Error('needs-permission'); e.code = 'needs-permission'; throw e; }
        perm = await h.requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') throw new Error('Permission to use the drive was not given');
      }
      return rolandView(new FsaRaw(h));
    },
    hasRemembered: async function () { return isAndroid ? !!Native.hasFolder() : !!(Storage.canWriteDirect && await remembered()); },
    /** Re-open the folder remembered by the Android app. */
    reopen: async function () {
      if (!isAndroid) return null;
      var name = Native.currentFolder();
      if (!name) return null;
      try { return await rolandView(new NativeRaw(name)); } catch (e) { return null; }
    },
    /** From <input type=file webkitdirectory> (Firefox etc.). */
    fromFileList: function (list) { return rolandView(new FilesRaw(list)); }
  };

  // ------------------------------------------------------------------ saving a file to the user's computer / phone
  async function saveFile(name, bytes, mime) {
    if (isAndroid) {
      var token = await nativeAsync(function (id) { Native.saveAs(id, name, mime || 'application/octet-stream'); });
      await streamToNative(token, bytes);
      return;
    }
    var blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a); a.click();
    // Firefox can drop the download if the link disappears straight away.
    setTimeout(function () { a.remove(); }, 2000);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
  }

  // ------------------------------------------------------------------ MIDI
  var SYSEX = {
    model: [0x00, 0x00, 0x00, 0x77], device: 0x10, ADDR_EDIT: 0x7F700000,
    checksum: function (body) { var s = 0; body.forEach(function (b) { s += b; }); return (128 - (s & 0x7F)) & 0x7F; },
    addr: function (a) { return [(a >>> 24) & 0x7F, (a >>> 16) & 0x7F, (a >>> 8) & 0x7F, a & 0x7F]; },
    dt1: function (a, data) { var body = SYSEX.addr(a).concat(data); return [0xF0, 0x41, SYSEX.device].concat(SYSEX.model, [0x12], body, [SYSEX.checksum(body), 0xF7]); },
    rq1: function (a, size) { var body = SYSEX.addr(a).concat(SYSEX.addr(size)); return [0xF0, 0x41, SYSEX.device].concat(SYSEX.model, [0x11], body, [SYSEX.checksum(body), 0xF7]); },
    /** Parse a DT1 reply for the edit-mode address: 0 off, 1 on, 2 busy, -1 not ours. */
    editMode: function (m) {
      if (m.length !== 15 || m[0] !== 0xF0 || m[1] !== 0x41 || m[7] !== 0x12) return -1;
      for (var i = 0; i < 4; i++) if (m[3 + i] !== SYSEX.model[i]) return -1;
      var a = ((m[8] << 24) | (m[9] << 16) | (m[10] << 8) | m[11]) >>> 0;
      return a === SYSEX.ADDR_EDIT ? m[12] : -1;
    }
  };

  function Midi() {
    this.connected = false; this.name = ''; this.listeners = []; this.sysexOk = false;
    this._out = null; this._in = null; this._buf = []; this._inSysex = false;
  }
  Midi.prototype.onMessage = function (fn) { this.listeners.push(fn); };
  Midi.prototype._emit = function (msg) { this.listeners.forEach(function (f) { try { f(msg); } catch (e) { console.error(e); } }); };
  /** Byte stream -> messages (Android delivers raw bytes). */
  Midi.prototype._feed = function (bytes) {
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i];
      if (b >= 0xF8) { this._emit(new Uint8Array([b])); continue; } // realtime
      if (b === 0xF0) { this._inSysex = true; this._buf = [b]; continue; }
      if (this._inSysex) { this._buf.push(b); if (b === 0xF7) { this._inSysex = false; this._emit(new Uint8Array(this._buf)); this._buf = []; } continue; }
      if (b & 0x80) { this._buf = [b]; this._status = b; }
      else if (this._status) { if (!this._buf.length) this._buf = [this._status]; this._buf.push(b); }
      var st = this._buf[0], need = (st & 0xF0) === 0xC0 || (st & 0xF0) === 0xD0 ? 2 : st === 0xF1 || st === 0xF3 ? 2 : st === 0xF2 ? 3 : 3;
      if (st >= 0xF4 && st <= 0xF7) need = 1;
      if (this._buf.length >= need) { this._emit(new Uint8Array(this._buf)); this._buf = []; }
    }
  };
  Midi.prototype.available = function () { return isAndroid || !!navigator.requestMIDIAccess; };
  /** Returns the list of candidate port names on the web (for a picker), or connects directly on Android. */
  Midi.prototype.connect = async function (preferName) {
    var self = this;
    if (isAndroid) {
      var name = await nativeAsync(function (id) { Native.midiOpen(id); });
      root.__rcMidiIn = function (h) { self._feed(b64ToBytes(h)); };
      root.__rcMidiClosed = function () { self.connected = false; self._emit(null); };
      self.connected = true; self.name = name; self.sysexOk = true;
      return name;
    }
    if (!navigator.requestMIDIAccess) throw new Error('This browser has no Web MIDI. Use Firefox or a Chromium-based browser over https.');
    var access;
    try { access = await navigator.requestMIDIAccess({ sysex: true }); self.sysexOk = true; }
    catch (e) { access = await navigator.requestMIDIAccess(); self.sysexOk = false; }
    self.access = access;
    var outs = [], ins = [];
    access.outputs.forEach(function (p) { outs.push(p); });
    access.inputs.forEach(function (p) { ins.push(p); });
    function score(p) { return /RC-?500/i.test(p.name) ? 2 : /BOSS|Roland/i.test(p.name) ? 1 : 0; }
    var pick = function (list) {
      if (preferName) for (var i = 0; i < list.length; i++) if (list[i].name === preferName) return list[i];
      return list.slice().sort(function (a, b) { return score(b) - score(a); })[0];
    };
    var out = pick(outs), inp = null;
    if (!out) throw new Error('No MIDI output found. Is the RC-500 connected with a data USB cable?');
    ins.forEach(function (p) { if (!inp && (p.name === out.name || score(p) === score(out) && score(p) > 0)) inp = p; });
    inp = inp || pick(ins);
    self._out = out; self._in = inp;
    if (inp) inp.onmidimessage = function (ev) { self._emit(ev.data); };
    var wantName = out.name;
    access.onstatechange = function (ev) {
      var p = ev.port;
      if (p.name !== wantName) return;
      if (p.state === 'disconnected') {
        if (p.type === 'output' && self.connected) { self.connected = false; self._emit(null); }
        return;
      }
      // The pedal came back (power cycle, cable): pick up the new ports automatically.
      if (p.type === 'output') { self._out = p; if (!self.connected) { self.connected = true; self._emit('reconnected'); } }
      if (p.type === 'input') { if (self._in && self._in !== p) self._in.onmidimessage = null; self._in = p; p.onmidimessage = function (e) { self._emit(e.data); }; }
    };
    self.connected = true; self.name = out.name;
    self.ports = outs.map(function (p) { return p.name; });
    try { localStorage.setItem('rc500-midi-ok', '1'); } catch (e) { }
    return out.name;
  };
  /**
   * Connect by itself when that's possible without a permission prompt: always in the Android app,
   * and in browsers once MIDI has been allowed for this page. Calls onFound(name) when connected.
   */
  Midi.prototype.autoConnect = async function (onFound) {
    var self = this;
    function tryNow() {
      if (self.connected || self._autoBusy) return;
      self._autoBusy = true;
      self.connect().then(function (n) { self._autoBusy = false; onFound(n); }, function () { self._autoBusy = false; });
    }
    if (isAndroid) { root.__rcMidiAdded = tryNow; tryNow(); return; }
    if (!navigator.requestMIDIAccess) return;
    var allowed = false;
    try { allowed = (await navigator.permissions.query({ name: 'midi', sysex: true })).state === 'granted'; } catch (e) { }
    try { if (!allowed) allowed = localStorage.getItem('rc500-midi-ok') === '1'; } catch (e) { }
    if (!allowed) return;
    try {
      var access = await navigator.requestMIDIAccess({ sysex: true });
      var has = false;
      access.outputs.forEach(function (p) { if (/RC-?500|BOSS|Roland/i.test(p.name)) has = true; });
      access.addEventListener('statechange', function (ev) {
        if (ev.port.type === 'output' && ev.port.state === 'connected' && /RC-?500|BOSS|Roland/i.test(ev.port.name)) setTimeout(tryNow, 300);
      });
      if (has) tryNow();
    } catch (e) { }
  };

  Midi.prototype.disconnect = function () {
    this.clockStop();
    if (isAndroid) { try { Native.midiClose(); } catch (e) { } }
    else if (this._in) this._in.onmidimessage = null;
    this.connected = false;
  };
  Midi.prototype.send = function (bytes) {
    if (!this.connected) throw new Error('MIDI not connected');
    if (bytes[0] === 0xF0 && !this.sysexOk) throw new Error('The browser did not allow SysEx messages');
    if (isAndroid) nativeSync(Native.midiSend(bytesToB64(new Uint8Array(bytes))));
    else this._out.send(bytes);
    if (this.onOut && bytes[0] === 0xF0) this.onOut(bytes);
  };
  /**
   * MIDI clock to the pedal (24 ticks per quarter note). With SYNC CLOCK = AUTO or USB the RC-500
   * follows it. No Start/Stop is sent, so the tracks are not started by the clock.
   * Web: ticks are scheduled ahead with Web MIDI timestamps. Android: a native thread sends them.
   */
  Midi.prototype.clockStart = function (bpm, onBeat) {
    var self = this;
    self.clockBpm = bpm; self.clockRunning = true; self._onBeat = onBeat;
    if (isAndroid) { root.__rcBeat = function () { if (self._onBeat) self._onBeat(); }; nativeSync(Native.midiClockStart(bpm)); return; }
    if (self._clk) return;
    var next = performance.now() + 30, n = 0;
    function pump() {
      if (!self.connected) { self.clockStop(); return; }
      var now = performance.now(), ahead = now + (document.hidden ? 1500 : 150);
      if (next < now - 200) next = now + 10; // we fell behind (sleeping tab): restart cleanly
      while (next < ahead) {
        try { self._out.send([0xF8], next); } catch (e) { self.clockStop(); return; }
        if (n % 24 === 0 && self._onBeat) setTimeout(self._onBeat, Math.max(0, next - now));
        n++; next += 60000 / (self.clockBpm * 24);
      }
    }
    self._clk = setInterval(pump, 25); pump();
  };
  Midi.prototype.clockSet = function (bpm) {
    this.clockBpm = bpm;
    if (isAndroid && this.clockRunning) nativeSync(Native.midiClockSet(bpm));
  };
  Midi.prototype.clockStop = function () {
    this.clockRunning = false;
    if (isAndroid) { try { Native.midiClockStop(); } catch (e) { } return; }
    if (this._clk) { clearInterval(this._clk); this._clk = null; }
  };

  /** Ask the pedal for its edit (storage) mode. Resolves 0 off / 1 on / 2 busy / -1 no answer. */
  Midi.prototype.queryEditMode = function (timeout) {
    var self = this;
    return new Promise(function (res) {
      var done = false;
      var fn = function (m) { if (!m || done) return; var v = SYSEX.editMode(m); if (v >= 0) { done = true; res(v); } };
      self.listeners.push(fn);
      try { self.send(SYSEX.rq1(SYSEX.ADDR_EDIT, 1)); } catch (e) { done = true; res(-1); }
      setTimeout(function () { var i = self.listeners.indexOf(fn); if (i >= 0) self.listeners.splice(i, 1); if (!done) res(-1); }, timeout || 600);
    });
  };
  /** Switch storage (edit) mode on/off, retrying the way BOSS TONE STUDIO does.
      Resolves {ok, last} where last is the pedal's last answer (0 off, 1 on, 2 busy, -1 none). */
  Midi.prototype.setEditMode = async function (on, timeoutMs) {
    var t0 = Date.now(), want = on ? 1 : 0, answered = false, last = -1, busySince = 0;
    if (on) { try { this.send([0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7]); } catch (e) { } await sleep(300); } // identity request ("hello")
    while (Date.now() - t0 < (timeoutMs || 10000)) {
      var m = await this.queryEditMode();
      if (m >= 0) { answered = true; last = m; }
      if (m === want) return { ok: true, last: m };
      if (m === 2) { if (!busySince) busySince = Date.now(); }
      else busySince = 0;
      // Send the request when the pedal is off, and also every second while it keeps saying busy.
      if (m !== 2 || Date.now() - busySince > 1500) { this.send(SYSEX.dt1(SYSEX.ADDR_EDIT, [want])); if (m === 2) busySince = Date.now() - 500; }
      await sleep(250);
    }
    if (!answered && !on) return { ok: true, last: -1 }; // the pedal often stops answering once it leaves storage mode
    return { ok: false, last: last };
  };

  root.RCPlatform = { Storage: Storage, Midi: Midi, SYSEX: SYSEX, saveFile: saveFile, hex: hex, isAndroid: isAndroid, sleep: sleep };
})(window);
