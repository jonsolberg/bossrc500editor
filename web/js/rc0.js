/*
 * BOSS RC-500 Editor — reading and writing the pedal's MEMORYx.RC0 / SYSTEMx.RC0 files.
 * Copyright (C) 2026 Jon Solberg — GPL-3.0-or-later (see LICENSE).
 *
 * The files are line-based XML followed by a 4-byte little-endian save counter.
 * The pedal keeps two copies of each file (…1.RC0 and …2.RC0) and loads the one
 * with the higher counter. We parse into an ordered structure and write it back in
 * exactly the same layout, so an unmodified file round-trips byte for byte.
 */
(function (root) {
  'use strict';

  var enc = new TextEncoder();
  var dec = new TextDecoder('utf-8');

  function readCounter(bytes) {
    var n = bytes.length;
    if (n < 4) return 0;
    return (bytes[n - 4] | (bytes[n - 3] << 8) | (bytes[n - 2] << 16) | (bytes[n - 1] << 24)) >>> 0;
  }

  /** Split off the trailing counter. Files without one (hand-made XML) get counter 0. */
  function splitFile(bytes) {
    var text = dec.decode(bytes);
    var end = text.lastIndexOf('</database>');
    if (end < 0) throw new Error('Not an RC-500 data file (no </database>)');
    // Everything after "</database>\n" is the counter.
    var xmlEnd = text.indexOf('\n', end);
    xmlEnd = xmlEnd < 0 ? text.length : xmlEnd + 1;
    var xmlBytes = enc.encode(text.slice(0, xmlEnd)).length;
    var hasCounter = bytes.length - xmlBytes === 4;
    return { xml: text.slice(0, xmlEnd), counter: hasCounter ? readCounter(bytes) : 0 };
  }

  /**
   * Parse a database. Result:
   * { name, revision, head:[lines], blocks:[{open, tag, id, sections:[{name, fields:[[key, value]]}]}], eol, counter }
   */
  function parse(bytes) {
    var f = splitFile(bytes);
    var eol = f.xml.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
    var lines = f.xml.split(/\r?\n/);
    if (lines[lines.length - 1] === '') lines.pop();
    var db = { head: [], blocks: [], eol: eol, counter: f.counter, name: '', revision: 0 };
    var i = 0, block = null, sec = null, m;
    for (; i < lines.length; i++) {
      var l = lines[i];
      if (!block) {
        if ((m = /^<(mem|sys)\b([^>]*)>$/.exec(l))) {
          var id = /id="(\d+)"/.exec(m[2]);
          block = { open: l, tag: m[1], id: id ? +id[1] : 0, sections: [] };
          db.blocks.push(block);
        } else if (l === '</database>') {
          break;
        } else {
          db.head.push(l);
          if ((m = /<database\s+name="([^"]*)"\s+revision="(\d+)"/.exec(l))) { db.name = m[1]; db.revision = +m[2]; }
        }
      } else if (!sec) {
        if (l === '</' + block.tag + '>') { block = null; }
        else if ((m = /^<([A-Za-z0-9_]+)>$/.exec(l))) { sec = { name: m[1], fields: [] }; block.sections.push(sec); }
        else throw new Error('Unexpected line ' + (i + 1) + ': ' + l);
      } else {
        if (l === '</' + sec.name + '>') { sec = null; }
        else if ((m = /^\t<([A-Za-z0-9_]+)>(-?\d+)<\/\1>$/.exec(l))) { sec.fields.push([m[1], +m[2]]); }
        else throw new Error('Unexpected line ' + (i + 1) + ': ' + l);
      }
    }
    if (block) throw new Error('File ends inside <' + block.tag + '>');
    return db;
  }

  function serializeXml(db) {
    var out = db.head.slice();
    db.blocks.forEach(function (b) {
      out.push(b.open);
      b.sections.forEach(function (s) {
        out.push('<' + s.name + '>');
        s.fields.forEach(function (f) { out.push('\t<' + f[0] + '>' + f[1] + '</' + f[0] + '>'); });
        out.push('</' + s.name + '>');
      });
      out.push('</' + b.tag + '>');
    });
    out.push('</database>');
    return out.join(db.eol) + db.eol;
  }

  /** Serialize with the given counter appended. */
  function serialize(db, counter) {
    var xml = enc.encode(serializeXml(db));
    var out = new Uint8Array(xml.length + 4);
    out.set(xml, 0);
    var c = counter >>> 0;
    out[xml.length] = c & 255; out[xml.length + 1] = (c >>> 8) & 255;
    out[xml.length + 2] = (c >>> 16) & 255; out[xml.length + 3] = (c >>> 24) & 255;
    return out;
  }

  // ---- convenient accessors on the parsed structure ----

  function section(block, name) {
    for (var i = 0; i < block.sections.length; i++) if (block.sections[i].name === name) return block.sections[i];
    return null;
  }
  function get(block, sec, key) {
    var s = section(block, sec);
    if (!s) return undefined;
    for (var i = 0; i < s.fields.length; i++) if (s.fields[i][0] === key) return s.fields[i][1];
    return undefined;
  }
  function set(block, sec, key, value) {
    var s = section(block, sec);
    if (!s) return false;
    for (var i = 0; i < s.fields.length; i++) if (s.fields[i][0] === key) { s.fields[i][1] = value | 0; return true; }
    return false;
  }
  function memName(block) {
    var s = section(block, 'NAME');
    if (!s) return '';
    return s.fields.map(function (f) { return String.fromCharCode(f[1]); }).join('');
  }
  function setMemName(block, name) {
    var s = section(block, 'NAME');
    if (!s) return;
    for (var i = 0; i < s.fields.length; i++) {
      var c = i < name.length ? name.charCodeAt(i) : 32;
      if (c < 32 || c > 126) c = 95; // '_' like the pedal's own charset
      s.fields[i][1] = c;
    }
  }
  /** Deep copy of a block (or parts of it). */
  function cloneSections(block) {
    return block.sections.map(function (s) { return { name: s.name, fields: s.fields.map(function (f) { return [f[0], f[1]]; }) }; });
  }
  function clone(db) {
    return {
      head: db.head.slice(), eol: db.eol, counter: db.counter, name: db.name, revision: db.revision,
      blocks: db.blocks.map(function (b) { return { open: b.open, tag: b.tag, id: b.id, sections: cloneSections(b) }; })
    };
  }
  /** Copy the named sections (default: all except NAME) from one memory block to another. */
  function copySections(from, to, names) {
    from.sections.forEach(function (s) {
      if (names ? names.indexOf(s.name) < 0 : s.name === 'NAME') return;
      var t = section(to, s.name);
      if (!t) return;
      s.fields.forEach(function (f) { set(to, s.name, f[0], f[1]); });
    });
  }

  /** Build factory databases from js/factory.js. */
  function factoryMemory() {
    var F = root.RC500_FACTORY;
    var parts = [F.memHead];
    for (var i = 0; i < 99; i++) {
      var nm = ('Memory' + (i < 9 ? '0' : '') + (i + 1) + '    ');
      var name = '<NAME>\n';
      for (var c = 0; c < 12; c++) name += '\t<C' + (c < 9 ? '0' : '') + (c + 1) + '>' + nm.charCodeAt(c) + '</C' + (c < 9 ? '0' : '') + (c + 1) + '>\n';
      name += '</NAME>\n';
      parts.push('<mem id="' + i + '">\n' + name + F.memBody + '</mem>\n');
    }
    parts.push('</database>\n');
    return parse(enc.encode(parts.join('')));
  }
  function factorySystem() { return parse(enc.encode(root.RC500_FACTORY.system)); }
  function factoryMemBlock() { return factoryMemory().blocks[0]; }

  /** Given the counters of file 1 and 2, decide which to load and which to write. */
  function pickFiles(c1, c2, have1, have2) {
    if (have1 && !have2) return { load: 1, write: 2 };
    if (have2 && !have1) return { load: 2, write: 1 };
    return c1 >= c2 ? { load: 1, write: 2 } : { load: 2, write: 1 };
  }

  root.RC0 = {
    parse: parse, serialize: serialize, serializeXml: serializeXml, readCounter: readCounter,
    section: section, get: get, set: set, memName: memName, setMemName: setMemName,
    clone: clone, cloneSections: cloneSections, copySections: copySections,
    factoryMemory: factoryMemory, factorySystem: factorySystem, factoryMemBlock: factoryMemBlock,
    pickFiles: pickFiles
  };
})(typeof window !== 'undefined' ? window : globalThis);
