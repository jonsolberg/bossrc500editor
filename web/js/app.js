/*
 * BOSS RC-500 Editor — user interface.
 * Copyright (C) 2026 Jon Solberg — GPL-3.0-or-later (see LICENSE).
 */
(function () {
  'use strict';

  var P = window.RC500P, L = P.L, RC0 = window.RC0, PF = window.RCPlatform, AU = window.RCAudio;
  var VERSION = '1.0';

  // ------------------------------------------------------------------ state
  var S = {
    mem: null, sys: null,           // parsed databases
    origMem: null, origSys: null,   // as loaded / last saved (for "modified" marks)
    store: null,                    // ROLAND folder view (or null = factory data)
    files: null,                    // {memLoad, memWrite, memCounter, sysLoad, sysWrite, sysCounter}
    cur: 0,                         // selected memory index
    page: 'memory',
    undo: [], redo: [],
    clip: null,
    midi: new PF.Midi(),
    midiLog: [],
    followPedal: true, sendPcOnSelect: false,
    loops: null,                    // {index -> [{name, size}]}
    player: null
  };

  // ------------------------------------------------------------------ tiny DOM helper
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { add(el, x); });
    else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  function $(id) { return document.getElementById(id); }
  function pad3(n) { return (n < 10 ? '00' : n < 100 ? '0' : '') + n; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function toast(msg, kind) {
    var t = h('div', { class: 'toast ' + (kind || '') }, msg);
    $('toasts').appendChild(t);
    setTimeout(function () { t.classList.add('out'); }, kind === 'err' ? 7000 : 3500);
    setTimeout(function () { t.remove(); }, kind === 'err' ? 7600 : 4100);
  }
  function errToast(e) { console.error(e); toast(e && e.message ? e.message : String(e), 'err'); }

  /** Modal dialog. buttons: [{label, primary, onclick (return false to keep open)}] */
  function dialog(title, body, buttons) {
    var back = h('div', { class: 'modal-back' });
    var close = function () { back.remove(); };
    var box = h('div', { class: 'modal', role: 'dialog' },
      h('h2', null, title), h('div', { class: 'modal-body' }, body),
      h('div', { class: 'modal-buttons' }, (buttons || [{ label: 'Close' }]).map(function (b) {
        return h('button', {
          class: b.primary ? 'primary' : b.danger ? 'danger' : '', onclick: function () {
            var r = b.onclick ? b.onclick() : undefined;
            if (r && r.then) r.then(function (x) { if (x !== false) close(); }, errToast);
            else if (r !== false) close();
          }
        }, b.label);
      })));
    back.appendChild(box);
    back.addEventListener('click', function (e) { if (e.target === back) close(); });
    document.body.appendChild(back);
    var f = box.querySelector('input,select'); if (f) f.focus();
    return close;
  }

  // ------------------------------------------------------------------ data access + undo
  function blk(i) { return S.mem.blocks[i === undefined ? S.cur : i]; }
  function sysBlk() { return S.sys.blocks[0]; }
  function mget(sec, key, i) { return RC0.get(blk(i), sec, key); }
  function sget(sec, key) { return RC0.get(sysBlk(), sec, key); }

  var group = null;
  function begin() { group = []; }
  function commit() {
    if (group && group.length) { S.undo.push(group); if (S.undo.length > 200) S.undo.shift(); S.redo = []; }
    group = null; refreshChrome();
  }
  function setField(db, bi, sec, key, val) {
    var b = (db === 'mem' ? S.mem : S.sys).blocks[bi];
    var old = RC0.get(b, sec, key);
    if (old === undefined || old === val) return;
    RC0.set(b, sec, key, val);
    var rec = { db: db, bi: bi, sec: sec, key: key, old: old, val: val };
    if (group) group.push(rec); else { S.undo.push([rec]); S.redo = []; refreshChrome(); }
  }
  function mset(sec, key, val, i) { setField('mem', i === undefined ? S.cur : i, sec, key, val); }
  function sset(sec, key, val) { setField('sys', 0, sec, key, val); }
  function undoRedo(from, to, useOld) {
    var g = from.pop(); if (!g) return;
    g.slice().reverse().forEach(function (r) { RC0.set((r.db === 'mem' ? S.mem : S.sys).blocks[r.bi], r.sec, r.key, useOld ? r.old : r.val); });
    to.push(g);
    if (g[0].db === 'mem') S.cur = g[0].bi;
    render();
  }

  function memDirty(i) {
    if (!S.origMem) return false;
    var a = S.mem.blocks[i].sections, b = S.origMem.blocks[i].sections;
    for (var s = 0; s < a.length; s++) for (var f = 0; f < a[s].fields.length; f++) if (a[s].fields[f][1] !== b[s].fields[f][1]) return true;
    return false;
  }
  function sysDirty() {
    var a = S.sys.blocks[0].sections, b = S.origSys.blocks[0].sections;
    for (var s = 0; s < a.length; s++) for (var f = 0; f < a[s].fields.length; f++) if (a[s].fields[f][1] !== b[s].fields[f][1]) return true;
    return false;
  }
  function anyDirty() { if (!S.mem) return false; for (var i = 0; i < S.mem.blocks.length; i++) if (memDirty(i)) return true; return sysDirty(); }

  // ------------------------------------------------------------------ field widgets
  function sel(list, value, onchange, disabledFn) {
    var s = h('select', { onchange: function () { onchange(+s.value); } });
    list.forEach(function (o, i) {
      var v = Array.isArray(o) ? o[0] : i, l = Array.isArray(o) ? o[1] : o;
      s.appendChild(h('option', { value: v, selected: v === value, disabled: disabledFn && disabledFn(v) }, l));
    });
    if (value !== undefined && s.value !== String(value)) s.appendChild(h('option', { value: value, selected: true }, '(' + value + ')'));
    return s;
  }
  function chk(value, onchange) {
    return h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!value, onchange: function (e) { onchange(e.target.checked ? 1 : 0); } }), h('span'));
  }
  function num(value, min, max, onchange, step, scale) {
    scale = scale || 1;
    var i = h('input', {
      type: 'number', min: min / scale, max: max / scale, step: step || 1, value: scale === 1 ? value : (value / scale).toFixed(1),
      onchange: function () {
        var v = Math.round(parseFloat(i.value) * scale);
        if (isNaN(v)) v = value;
        v = Math.max(min, Math.min(max, v)); onchange(v);
      }
    });
    return i;
  }
  function slider(value, min, max, onchange, fmt) {
    fmt = fmt || String;
    var out = h('output', null, fmt(value));
    var r = h('input', {
      type: 'range', min: min, max: max, value: value,
      oninput: function () { out.textContent = fmt(+r.value); },
      onchange: function () { onchange(+r.value); }
    });
    return h('span', { class: 'slider' }, r, out);
  }
  function row(label, ctrl, hint) {
    return h('div', { class: 'row' }, h('label', { title: hint || '' }, label), h('div', { class: 'ctl' }, ctrl));
  }
  function card(title, body, extra) { return h('section', { class: 'card ' + (extra || '') }, h('h3', null, title), body); }

  // shorthand builders bound to memory / system
  function M(sec, key) {
    return {
      v: mget(sec, key),
      set: function (v) { mset(sec, key, v); render(); }
    };
  }
  function Sy(sec, key) { return { v: sget(sec, key), set: function (v) { sset(sec, key, v); render(); } }; }
  function mSel(label, sec, key, list, hint) { var f = M(sec, key); return row(label, sel(list, f.v, f.set), hint); }
  function mChk(label, sec, key, hint) { var f = M(sec, key); return row(label, chk(f.v, f.set), hint); }
  function mLvl(label, sec, key, max, hint) { var f = M(sec, key); return row(label, slider(f.v, 0, max || 200, f.set), hint); }
  function sSel(label, sec, key, list, hint) { var f = Sy(sec, key); return row(label, sel(list, f.v, f.set), hint); }
  function sChk(label, sec, key, hint) { var f = Sy(sec, key); return row(label, chk(f.v, f.set), hint); }

  // ------------------------------------------------------------------ chrome (header + memory list)
  function refreshChrome() {
    var src = S.store ? (S.store.writable ? '' : ' (read-only)') : '';
    $('src').textContent = S.store ? '📁 ' + (S.store.name || 'RC-500') + src : '🏭 Factory data';
    $('src').title = S.store ? (S.files ? 'Loaded ' + S.files.memName + ' / ' + S.files.sysName : '') : 'Open the pedal drive to edit your own memories';
    $('midistat').textContent = S.midi.connected ? '🎹 ' + S.midi.name : '🎹 not connected';
    $('midistat').className = 'chip ' + (S.midi.connected ? 'ok' : '');
    $('btnUndo').disabled = !S.undo.length; $('btnRedo').disabled = !S.redo.length;
    var dirty = anyDirty();
    $('btnSave').classList.toggle('attention', dirty);
    renderMemList();
  }

  function renderMemList() {
    var ul = $('memlist'); if (!S.mem) return;
    var q = ($('memfilter').value || '').toLowerCase();
    ul.innerHTML = '';
    S.mem.blocks.forEach(function (b, i) {
      var name = RC0.memName(b).trim();
      if (q && name.toLowerCase().indexOf(q) < 0 && String(i + 1).indexOf(q) < 0) return;
      var li = h('li', {
        class: (i === S.cur ? 'sel ' : '') + (memDirty(i) ? 'dirty' : ''),
        onclick: function () { selectMemory(i); }
      }, h('span', { class: 'no' }, pad2(i + 1)), h('span', { class: 'nm' }, name || '—'),
        S.loops && S.loops[i] && (S.loops[i][1] || S.loops[i][2]) ? h('span', { class: 'wav', title: 'Has recorded loop' }, '●') : null);
      ul.appendChild(li);
    });
    var selEl = ul.querySelector('.sel'); if (selEl && selEl.scrollIntoViewIfNeeded) selEl.scrollIntoViewIfNeeded(false);
  }

  function selectMemory(i, fromPedal) {
    S.cur = i;
    if (S.sendPcOnSelect && S.midi.connected && !fromPedal) { try { S.midi.send([0xC0 | rxCh(), i]); } catch (e) { errToast(e); } }
    if (S.page !== 'memory' && S.page !== 'remote' && S.page !== 'loops') S.page = 'memory';
    render();
    document.body.classList.remove('show-list');
  }
  function rxCh() { var c = sget('MIDI', 'RxCtlCh'); return c === undefined ? 0 : c; }

  // ------------------------------------------------------------------ pages
  function render() {
    refreshChrome();
    document.querySelectorAll('nav.tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.page === S.page); });
    var main = $('main');
    var st = main.scrollTop;
    main.innerHTML = '';
    var page = { memory: pageMemory, system: pageSystem, loops: pageLoops, remote: pageRemote, about: pageAbout }[S.page];
    add(main, page());
    main.scrollTop = st;
  }

  function beatIdx() { return mget('RHYTHM', 'Beat'); }

  function trackCard(t) {
    var sec = 'TRACK' + t;
    var meas = M(sec, 'Measure');
    var tempo = mget(sec, 'RecTmp'), wl = mget(sec, 'WavLen'), ws = mget(sec, 'WavStat');
    return card('Track ' + t, [
      mLvl('Level', sec, 'PlyLvl', 200, 'Playback level (0–200, 100 = unity)'),
      (function () { var f = M(sec, 'Pan'); return row('Pan', slider(f.v, 0, 100, f.set, function (v) { return L.pan[v]; })); })(),
      mChk('Reverse', sec, 'Rev', 'Reverse playback. You cannot overdub a reversed track.'),
      mChk('1-shot', sec, 'One', 'Play the phrase once and stop; REC/PLY retriggers.'),
      mChk('Loop FX', sec, 'LoopFx', 'Apply LOOP FX to this track.'),
      mSel('Start', sec, 'StrtMod', L.start),
      mSel('Stop', sec, 'StpMod', L.stop),
      row('Measure', sel(L.measure, meas.v, function (v) {
        begin(); mset(sec, 'Measure', v);
        var mf = P.measureFields(v); Object.keys(mf).forEach(function (k) { mset(sec, k, mf[k]); });
        commit(); render();
      }), 'Number of measures (only used with LOOP SYNC on)'),
      mChk('Loop sync', sec, 'LoopSync', 'Align the start of track 1 and 2 phrases.'),
      mChk('Tempo sync', sec, 'TempoSync', 'Play at the memory tempo (on) or the tempo it was recorded at (off).'),
      mSel('Input', sec, 'Input', L.input),
      mSel('Output', sec, 'Output', L.output),
      h('p', { class: 'info' }, ws ? 'Recorded phrase: ' + (wl ? wl.toLocaleString() + ' samples, ' : '') + 'recorded at ' + (tempo / 10).toFixed(1) + ' BPM' : 'No phrase recorded')
    ]);
  }

  function pageMemory() {
    var i = S.cur, b = blk();
    var name = RC0.memName(b);
    var head = h('div', { class: 'memhead' },
      h('div', { class: 'memtitle' }, h('span', { class: 'big' }, pad2(i + 1)),
        h('input', {
          class: 'name', maxlength: 12, value: name.replace(/\s+$/, ''), spellcheck: 'false', title: 'Memory name (12 characters)',
          onchange: function (e) {
            begin(); var v = e.target.value.slice(0, 12);
            for (var c = 0; c < 12; c++) { var cc = c < v.length ? v.charCodeAt(c) : 32; if (cc < 32 || cc > 126) cc = 95; mset('NAME', 'C' + pad2(c + 1), cc); }
            commit(); render();
          }
        })),
      h('div', { class: 'tools' },
        h('button', { onclick: copyDialog, title: 'Copy this memory to other memories' }, '⧉ Copy to…'),
        h('button', { onclick: function () { S.clip = RC0.cloneSections(b); toast('Memory ' + (i + 1) + ' copied'); render(); } }, 'Copy'),
        h('button', { disabled: !S.clip, onclick: pasteDialog }, 'Paste…'),
        h('button', { onclick: swapDialog }, '⇄ Swap…'),
        h('button', { onclick: exportPreset, title: 'Save this memory as a preset file' }, '⬇ Preset'),
        h('button', { onclick: importPreset, title: 'Load a preset file into this memory' }, '⬆ Preset'),
        h('button', { class: 'danger', onclick: resetMemory }, 'Initialize')));

    var rhythmOn = mget('RHYTHM', 'State');
    var fxType = mget('LOOPFX', 'FxType'), kind = P.fxKind(fxType);
    var tempo = M('MASTER', 'Tempo');

    var lenKey = { scatter: 'ScatterLength', repeat: 'RepeatLength', shift: 'ShiftShift' }[kind];
    var lenOpts = kind === 'vinyl' ? null : P.fxLengths(kind, beatIdx());

    var assigns = [];
    for (var a = 1; a <= 8; a++) assigns.push(assignRow(a));

    var sysPref = { Pedal1: 'Pdl1', Pedal2: 'Pdl2', Pedal3: 'Pdl3', Ctl1: 'Ctl1', Ctl2: 'Ctl2', Exp: 'Exp' };
    function ctlRow(label, key, list) {
      var usesSys = sget('PREF', sysPref[key]) === 1;
      var f = M('CTL', key);
      var s = sel(list, f.v, f.set);
      return row(label, [s, usesSys ? h('span', { class: 'note', title: 'SYSTEM > PREFERENCE is set to SYSTEM for this controller' }, 'system: ' + list[sget('CTL', key)]) : null]);
    }

    return [head, h('div', { class: 'grid' },
      trackCard(1), trackCard(2),
      card('Record', [
        mSel('Dub mode', 'MASTER', 'DubMode', L.dubMode),
        mSel('Rec action', 'MASTER', 'RecAction', L.recAction, 'Order of record/play/overdub when you press REC/PLY'),
        (function () { var f = M('MASTER', 'RecQuantize'); return row('Quantize', sel(L.quantize, f.v ? 1 : 0, function (v) { f.set(v ? 2 : 0); })); })(),
        mChk('Auto rec', 'MASTER', 'AutoRec', 'Start recording when you start playing'),
        (function () { var f = M('MASTER', 'AutoRecSens'); return row('A.rec sens', slider(f.v, 1, 100, f.set)); })(),
        mSel('A.rec source', 'MASTER', 'AutoRecSrc', L.recSrc),
        (function () { var f = M('MASTER', 'LpLen'); return row('Loop length', [num(f.v, 0, 25362, f.set), h('span', { class: 'note' }, f.v ? 'measures' : 'AUTO')], '0 = AUTO (length of the first recorded phrase)'); })()
      ]),
      card('Play', [
        row('Tempo', [num(tempo.v, 400, 3000, tempo.set, 0.1, 10), h('span', { class: 'note' }, 'BPM'), h('button', { class: 'small', onclick: tapTempo, title: 'Tap repeatedly' }, 'Tap')]),
        mLvl('Memory level', 'MASTER', 'Level', 200),
        mSel('Play mode', 'MASTER', 'PlayMode', L.playMode),
        mSel('Single change', 'MASTER', 'SinglPlayeChange', L.singleChange),
        mSel('Fade time', 'MASTER', 'FadeTime', L.fadeTime),
        mSel('All start', 'MASTER', 'AllStart', L.allStart, 'Which track starts on MIDI start'),
        mSel('Track chain', 'MASTER', 'TrackChain', L.trkChain)
      ]),
      card('Loop FX', [
        mChk('Loop FX on', 'LOOPFX', 'Sw'),
        mSel('Type', 'LOOPFX', 'FxType', L.fxType),
        lenOpts ? (function () {
          var f = M('LOOPFX', lenKey);
          return row({ scatter: 'Scatter length', repeat: 'Repeat length', shift: 'Shift' }[kind],
            sel(lenOpts.map(function (o) { return [o.value, o.label]; }), f.v, f.set, function (v) { return !lenOpts.filter(function (o) { return o.value === v; })[0].enabled; }),
            'Lengths that do not fit the rhythm beat are disabled');
        })() : (function () { var f = M('LOOPFX', 'VinylFlickFlick'); return row('Flick', slider(f.v, 0, 100, f.set)); })()
      ]),
      card('Rhythm', [
        row('Rhythm on', chk(rhythmOn, function (v) { mset('RHYTHM', 'State', v); render(); }), 'Recall this memory with the rhythm on (play standby)'),
        mLvl('Level', 'RHYTHM', 'Level', 200),
        (function () { var f = M('RHYTHM', 'Reverb'); return row('Reverb', slider(f.v, 0, 100, f.set)); })(),
        row('Beat', sel(L.beat, beatIdx(), function (v) {
          begin(); var pat = P.patterns(beatIdx())[mget('RHYTHM', 'Pattern')];
          mset('RHYTHM', 'Beat', v);
          var np = P.patterns(v).indexOf(pat); mset('RHYTHM', 'Pattern', np < 0 ? 0 : np);
          commit(); render();
        }), 'You cannot change the beat after a track is recorded'),
        mSel('Pattern', 'RHYTHM', 'Pattern', P.patterns(beatIdx())),
        mSel('Variation', 'RHYTHM', 'Variation', L.variation),
        mSel('Var. change', 'RHYTHM', 'VariationChange', L.varChange),
        mSel('Kit', 'RHYTHM', 'Kit', L.kit),
        mSel('Start', 'RHYTHM', 'Start', L.rhyStart),
        mSel('Stop', 'RHYTHM', 'Stop', L.rhyStop),
        mSel('Rec count-in', 'RHYTHM', 'RecCount', L.count),
        mSel('Play count-in', 'RHYTHM', 'PlayCount', L.count),
        mChk('Fill', 'RHYTHM', 'Fill'),
        row('Parts', [1, 2, 3, 4].map(function (p) { var f = M('RHYTHM', 'Part' + p); return h('label', { class: 'inl' }, h('input', { type: 'checkbox', checked: !!f.v, onchange: function (e) { f.set(e.target.checked ? 1 : 0); } }), ' ' + p); })),
        mSel('Tone low', 'RHYTHM', 'ToneLow', L.tone),
        mSel('Tone high', 'RHYTHM', 'ToneHigh', L.tone)
      ]),
      card('Pedals & controllers', [
        ctlRow('PDL1 REC/PLAY', 'Pedal1', L.pdlCtl),
        ctlRow('PDL2 STOP', 'Pedal2', L.pdlCtl),
        ctlRow('PDL3 TRACK SEL', 'Pedal3', L.pdlCtl),
        ctlRow('CTL1 footswitch', 'Ctl1', L.pdlCtl),
        ctlRow('CTL2 footswitch', 'Ctl2', L.pdlCtl),
        ctlRow('EXP pedal', 'Exp', L.exp),
        h('p', { class: 'info' }, 'These per-memory functions are only used when SYSTEM › Preference is set to MEMORY for that controller.')
      ]),
      card('Assign 1–8', h('div', { class: 'assigns' },
        h('div', { class: 'ahead' }, h('span'), h('span', null, 'Source'), h('span', null, 'Mode'), h('span', null, 'Target'), h('span', null, 'Min'), h('span', null, 'Max')),
        assigns), 'wide'),
      card('All values (advanced)', rawEditor('mem', S.cur), 'wide raw')
    )];
  }

  function assignRow(a) {
    var sec = 'ASSIGN' + a;
    var on = mget(sec, 'Sw'), tgt = mget(sec, 'Target');
    var rng = P.targetRange(tgt, { beat: beatIdx(), fxType: mget('LOOPFX', 'FxType') });
    function mm(key) {
      var f = M(sec, key);
      if (!rng) return h('span', { class: 'note' }, '—');
      if (rng.length > 300) return h('span', { class: 'ctl' }, num(f.v, 0, rng.length - 1, f.set), h('span', { class: 'note' }, rng[f.v] !== undefined ? '= ' + rng[f.v] : ''));
      return sel(rng, f.v, f.set);
    }
    return h('div', { class: 'arow' + (on ? '' : ' off') },
      h('span', null, h('label', { class: 'inl' }, h('input', { type: 'checkbox', checked: !!on, onchange: function (e) { mset(sec, 'Sw', e.target.checked ? 1 : 0); render(); } }), ' ' + a)),
      sel(L.assignSource, mget(sec, 'Source'), function (v) { mset(sec, 'Source', v); render(); }),
      sel(L.srcMode, mget(sec, 'SourceMode'), function (v) { mset(sec, 'SourceMode', v); render(); }),
      sel(L.assignTarget, tgt, function (v) {
        begin(); mset(sec, 'Target', v);
        var r = P.targetRange(v, { beat: beatIdx(), fxType: mget('LOOPFX', 'FxType') });
        mset(sec, 'TargetMin', 0); mset(sec, 'TargetMax', r ? r.length - 1 : 1);
        commit(); render();
      }),
      mm('TargetMin'), mm('TargetMax'));
  }

  function rawEditor(db, bi) {
    var b = (db === 'mem' ? S.mem : S.sys).blocks[bi];
    var d = h('details', null, h('summary', null, 'Show every stored field as a number (for things the editor has no control for)'));
    b.sections.forEach(function (s) {
      if (s.name === 'NAME') return;
      d.appendChild(h('div', { class: 'rawsec' }, h('h4', null, s.name), h('div', { class: 'rawgrid' }, s.fields.map(function (f) {
        return h('label', null, h('span', null, f[0]), h('input', {
          type: 'number', value: f[1], onchange: function (e) { setField(db, bi, s.name, f[0], parseInt(e.target.value, 10) || 0); render(); }
        }));
      }))));
    });
    return d;
  }

  var taps = [];
  function tapTempo() {
    var now = performance.now();
    taps = taps.filter(function (t) { return now - t < 2500; }); taps.push(now);
    if (taps.length >= 2) {
      var avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
      var bpm = Math.max(40, Math.min(300, 60000 / avg));
      mset('MASTER', 'Tempo', Math.round(bpm * 10)); render();
    }
  }

  function pageSystem() {
    var ext = [];
    for (var e = 1; e <= 5; e++) {
      (function (e) {
        var mn = Sy('SETUP', 'Extent' + e + 'Min'), mx = Sy('SETUP', 'Extent' + e + 'Max');
        ext.push(row('EXT' + e, [sel(L.extVal, mn.v, mn.set), ' – ', sel(L.extVal, mx.v, mx.set)]));
      })(e);
    }
    function sCtl(label, key, list) { var f = Sy('CTL', key); return row(label, sel(list, f.v, f.set)); }
    return [h('div', { class: 'memhead' }, h('div', { class: 'memtitle' }, h('span', { class: 'big' }, 'SYSTEM')),
      h('div', { class: 'tools' }, h('button', { class: 'danger', onclick: resetSystem }, 'Initialize system'))),
    h('div', { class: 'grid' },
      card('General', [
        sSel('Display contrast', 'SETUP', 'Contrast', L.contrast),
        sSel('Display mode', 'SETUP', 'DisplayMode', L.dispMode),
        sSel('Undo/redo', 'SETUP', 'UndoRedo', L.undoRedo, 'Undo/redo while holding the switch, or when you release it'),
        sSel('Memory at power-on', 'SETUP', 'MemoryNumber', P.range(1, 99, pad2), 'The memory selected when the pedal was last saved')
      ]),
      card('Preference', [
        sSel('PDL1 pref', 'PREF', 'Pdl1', L.pref), sSel('PDL2 pref', 'PREF', 'Pdl2', L.pref), sSel('PDL3 pref', 'PREF', 'Pdl3', L.pref),
        sSel('CTL1 pref', 'PREF', 'Ctl1', L.pref), sSel('CTL2 pref', 'PREF', 'Ctl2', L.pref), sSel('EXP pref', 'PREF', 'Exp', L.pref),
        h('p', { class: 'info' }, 'MEMORY: each memory’s own functions. SYSTEM: the functions below for all memories.')
      ]),
      card('System pedal functions', [
        sCtl('PDL1 REC/PLAY', 'Pedal1', L.pdlCtl), sCtl('PDL2 STOP', 'Pedal2', L.pdlCtl), sCtl('PDL3 TRACK SEL', 'Pedal3', L.pdlCtl),
        sCtl('CTL1 footswitch', 'Ctl1', L.pdlCtl), sCtl('CTL2 footswitch', 'Ctl2', L.pdlCtl), sCtl('EXP pedal', 'Exp', L.exp)
      ]),
      card('MIDI', [
        sSel('Rx ctl channel', 'MIDI', 'RxCtlCh', L.ch16),
        sChk('Omni', 'MIDI', 'Omni', 'Receive on all channels'),
        sSel('Rx note channel', 'MIDI', 'RxNoteCh', L.ch16, 'Channel for notes that play the drum sounds'),
        sSel('Tx channel', 'MIDI', 'TxCh', L.txCh),
        sSel('Sync clock', 'MIDI', 'Sync', L.syncClock),
        sChk('Clock out', 'MIDI', 'ClkOut'),
        sSel('Sync start', 'MIDI', 'SyncStart', L.syncStart),
        sChk('PC out', 'MIDI', 'PcOut', 'Send program change when you change memory'),
        sSel('MIDI thru', 'MIDI', 'MidiThru', L.thru),
        sSel('USB thru', 'MIDI', 'UsbThru', L.thru)
      ]),
      card('Extent (memory range)', [sSel('Active extent', 'SETUP', 'ExtentCh', L.extent)].concat(ext)),
      card('Input / output', [
        sChk('Phantom power', 'INPUT', 'Phantom'),
        sSel('MIC IN out', 'INPUT', 'MicOut', L.micOut),
        sSel('INST IN out', 'INPUT', 'InstOut', L.instOut),
        sSel('Rhythm out', 'INPUT', 'RhythmOut', L.rhyOut),
        (function () { var f = Sy('INPUT', 'MicNs'); return row('MIC IN NS', slider(f.v, 0, 100, f.set)); })(),
        (function () { var f = Sy('INPUT', 'InstNs'); return row('INST IN NS', slider(f.v, 0, 100, f.set)); })(),
        sSel('Peak source', 'INPUT', 'Indicator', L.peak)
      ]),
      card('All values (advanced)', rawEditor('sys', 0), 'wide raw'))];
  }

  // ------------------------------------------------------------------ loops (WAV)
  function loopDir(i, t) { return 'WAVE/' + pad3(i + 1) + '_' + t; }
  async function scanLoops() {
    if (!S.store || !S.store.hasWave) { S.loops = null; return; }
    var loops = {};
    var dirs = await S.store.list('WAVE');
    var names = {}; dirs.forEach(function (d) { if (d.dir) names[d.name] = 1; });
    for (var i = 0; i < 99; i++) {
      loops[i] = {};
      for (var t = 1; t <= 2; t++) {
        var dn = pad3(i + 1) + '_' + t;
        if (!names[dn]) continue;
        var files = (await S.store.list('WAVE/' + dn)).filter(function (f) { return !f.dir && /\.wav$/i.test(f.name) && f.name[0] !== '.'; });
        if (files.length) {
          var size = await S.store.size('WAVE/' + dn + '/' + files[0].name);
          loops[i][t] = { name: files[0].name, size: size };
        }
      }
    }
    S.loops = loops;
  }

  function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' kB'; }

  function pageLoops() {
    if (!S.store || !S.store.hasWave) {
      return h('div', { class: 'empty' }, h('h2', null, 'Loops'),
        h('p', null, 'Open the pedal drive (or its ROLAND folder) to see, play, export and import the recorded phrases.'),
        h('p', null, h('button', { class: 'primary', onclick: openFolder }, 'Open pedal folder…')));
    }
    if (!S.loops) { scanLoops().then(render, errToast); return h('div', { class: 'empty' }, h('p', null, 'Scanning ROLAND/WAVE…')); }
    var onlyUsed = !!S.loopsOnlyUsed;
    var rows = [];
    for (var i = 0; i < 99; i++) {
      var l = S.loops[i] || {};
      if (onlyUsed && !l[1] && !l[2] && i !== S.cur) continue;
      rows.push(h('tr', { class: i === S.cur ? 'sel' : '' },
        h('td', { class: 'no', onclick: (function (i) { return function () { S.cur = i; render(); }; })(i) }, pad2(i + 1)),
        h('td', { class: 'nm' }, RC0.memName(blk(i)).trim()),
        [1, 2].map(function (t) { return h('td', null, loopCell(i, t, l[t])); })));
    }
    return [h('div', { class: 'memhead' }, h('div', { class: 'memtitle' }, h('span', { class: 'big' }, 'LOOPS')),
      h('div', { class: 'tools' },
        h('label', { class: 'inl' }, h('input', { type: 'checkbox', checked: onlyUsed, onchange: function (e) { S.loopsOnlyUsed = e.target.checked; render(); } }), ' Only memories with loops'),
        h('button', { onclick: function () { S.loops = null; render(); } }, '↻ Rescan'))),
    h('p', { class: 'info' }, 'Imported audio is converted to the RC-500 format (44.1 kHz, 32-bit float, stereo) and copied to ROLAND/WAVE/<memory>_<track>. ' +
      (S.store.writable ? 'The pedal picks up the new phrase when you leave storage mode.' : 'Read-only folder: imports are downloaded, copy them into the folder shown.')),
    h('table', { class: 'loops' }, h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Memory'), h('th', null, 'Track 1'), h('th', null, 'Track 2'))), h('tbody', null, rows))];
  }

  function loopCell(i, t, f) {
    var tempo = RC0.get(blk(i), 'MASTER', 'Tempo') / 10;
    var bt = P.beatOf(RC0.get(blk(i), 'RHYTHM', 'Beat'));
    var playing = S.player && S.player.key === i + '_' + t;
    return h('div', { class: 'loopcell' },
      f ? h('span', { class: 'fname', title: f.name + ' — ' + fmtSize(f.size) }, f.name.replace(/\.wav$/i, ''), h('small', null, ' ' + fmtSize(f.size) +
        (f.secs ? ' · ' + f.secs.toFixed(1) + ' s ≈ ' + (f.secs * tempo / 60 / (bt[0] * 4 / bt[1])).toFixed(1) + ' meas' : ''))) : h('span', { class: 'empty-l' }, '—'),
      f ? h('button', { class: 'small', title: playing ? 'Stop' : 'Play', onclick: function () { playLoop(i, t, f); } }, playing ? '■' : '▶') : null,
      f ? h('button', { class: 'small', title: 'Export WAV', onclick: function () { exportLoop(i, t, f); } }, '⬇') : null,
      h('button', { class: 'small', title: 'Import audio (WAV, MP3, …) into this track', onclick: function () { importLoop(i, t); } }, '⬆'),
      f && S.store.writable ? h('button', { class: 'small danger', title: 'Delete this phrase', onclick: function () { deleteLoop(i, t, f); } }, '✕') : null);
  }

  async function playLoop(i, t, f) {
    if (S.player) { var k = S.player.key; S.player.stop(); S.player = null; if (k === i + '_' + t) { render(); return; } }
    if (f.size > 150 * 1048576) throw new Error('Too large to preview here');
    toast('Loading ' + f.name + '…');
    var bytes = await S.store.read(loopDir(i, t) + '/' + f.name);
    var AC = window.AudioContext || window.webkitAudioContext, ctx = new AC();
    var buf;
    try { buf = AU.wavToAudioBuffer(ctx, bytes); } catch (e) { buf = await ctx.decodeAudioData(bytes.buffer.slice(0)); }
    f.secs = buf.duration;
    var src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.connect(ctx.destination); src.start();
    S.player = { key: i + '_' + t, stop: function () { try { src.stop(); } catch (e) { } ctx.close(); } };
    render();
  }
  async function exportLoop(i, t, f) {
    var bytes = await S.store.read(loopDir(i, t) + '/' + f.name);
    var nm = RC0.memName(blk(i)).trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_') || 'Memory';
    await PF.saveFile('RC500_' + pad2(i + 1) + '_' + nm + '_T' + t + '.wav', bytes, 'audio/wav');
  }
  function pickFile(accept) {
    return new Promise(function (res) {
      var inp = h('input', { type: 'file', accept: accept, style: 'display:none' });
      inp.addEventListener('change', function () { res(inp.files[0] || null); inp.remove(); });
      document.body.appendChild(inp); inp.click();
    });
  }
  async function importLoop(i, t) {
    var file = await pickFile('audio/*,.wav,.mp3,.m4a,.aac,.ogg,.flac');
    if (!file) return;
    toast('Converting ' + file.name + '…');
    var buf = await AU.decodeAny(new Uint8Array(await file.arrayBuffer()));
    if (buf.duration < 0.35) throw new Error('The RC-500 needs at least 0.35 seconds of audio');
    var wav = AU.encodeRc500Wav(buf);
    var base = file.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_\- ]+/g, '_').slice(0, 40) || 'IMPORT';
    var name = base + '.WAV';
    if (!S.store.writable) {
      await PF.saveFile(name, wav, 'audio/wav');
      dialog('Copy the file to the pedal', h('div', null,
        h('p', null, 'This folder was opened read-only, so the converted file was downloaded instead.'),
        h('p', null, 'Copy ', h('b', null, name), ' into ', h('code', null, 'ROLAND/' + loopDir(i, t) + '/'), ' on the BOSS RC-500 drive, and delete any other WAV file in that folder.')));
      return;
    }
    var old = S.loops && S.loops[i] && S.loops[i][t];
    var go = async function () {
      var existing = (await S.store.list(loopDir(i, t))).filter(function (f) { return !f.dir && /\.wav$/i.test(f.name); });
      for (var k = 0; k < existing.length; k++) await S.store.remove(loopDir(i, t) + '/' + existing[k].name);
      await S.store.write(loopDir(i, t) + '/' + name, wav);
      S.loops[i] = S.loops[i] || {}; S.loops[i][t] = { name: name, size: wav.length, secs: buf.duration };
      toast('Imported into memory ' + (i + 1) + ', track ' + t); render();
    };
    if (old) dialog('Replace phrase?', h('p', null, 'Memory ' + (i + 1) + ' track ' + t + ' already has ' + old.name + '. Replace it?'),
      [{ label: 'Cancel' }, { label: 'Replace', danger: true, onclick: go }]);
    else await go();
  }
  function deleteLoop(i, t, f) {
    dialog('Delete phrase?', h('p', null, 'Delete ' + f.name + ' from memory ' + (i + 1) + ', track ' + t + '? This cannot be undone.'),
      [{ label: 'Cancel' }, {
        label: 'Delete', danger: true, onclick: async function () {
          await S.store.remove(loopDir(i, t) + '/' + f.name); delete S.loops[i][t]; render();
        }
      }]);
  }

  // ------------------------------------------------------------------ remote (MIDI)
  function logMidi(dir, m) {
    S.midiLog.unshift({ dir: dir, text: describe(m) });
    if (S.midiLog.length > 40) S.midiLog.pop();
    var el = $('midilog'); if (el) el.innerHTML = '', S.midiLog.forEach(function (l) { el.appendChild(h('div', { class: l.dir }, (l.dir === 'in' ? '← ' : '→ ') + l.text)); });
  }
  function describe(m) {
    var s = m[0], t = s & 0xF0, ch = (s & 15) + 1;
    if (t === 0xC0) return 'Program change ' + (m[1] + 1) + ' (ch ' + ch + ')';
    if (t === 0xB0) return 'CC#' + m[1] + ' = ' + m[2] + ' (ch ' + ch + ')';
    if (t === 0x90) return 'Note on ' + m[1] + ' vel ' + m[2] + ' (ch ' + ch + ')';
    if (t === 0x80) return 'Note off ' + m[1] + ' (ch ' + ch + ')';
    if (s === 0xFA) return 'Start'; if (s === 0xFC) return 'Stop'; if (s === 0xFB) return 'Continue';
    if (s === 0xF0) { var e = PF.SYSEX.editMode(m); if (e >= 0) return 'Storage mode: ' + ['off', 'on', 'busy'][e]; }
    return PF.hex(m);
  }
  function midiSend(bytes) {
    try { S.midi.send(bytes); if (bytes[0] !== 0xF8) logMidi('out', bytes); } catch (e) { errToast(e); }
  }

  async function connectMidi() {
    try {
      await S.midi.connect();
      toast('Connected to ' + S.midi.name);
      if (!S.midi.sysexOk) toast('SysEx was not allowed: storage mode switching is unavailable', 'err');
    } catch (e) { errToast(e); }
    render();
  }

  S.midi.onMessage(function (m) {
    if (m === null) { toast('MIDI device disconnected', 'err'); render(); return; }
    if (m.length === 1 && m[0] >= 0xF8 && m[0] !== 0xFA && m[0] !== 0xFC) return; // clock etc.
    logMidi('in', m);
    if ((m[0] & 0xF0) === 0xC0 && S.followPedal && S.mem && m[1] < 99) { selectMemory(m[1], true); }
  });

  async function storageMode(on) {
    if (!S.midi.connected) { await connectMidi(); if (!S.midi.connected) return; }
    if (!on && S.store && S.store.writable && !PF.isAndroid) {
      var ok = await new Promise(function (res) {
        dialog('Leave storage mode', h('div', null, h('p', null, 'Eject the “BOSS RC-500” drive in your operating system first, so that everything is written to the pedal.'),
          h('p', null, 'Then the pedal reloads its memories.')), [{ label: 'Cancel', onclick: function () { res(false); } }, { label: 'Drive is ejected', primary: true, onclick: function () { res(true); } }]);
      });
      if (!ok) return;
    }
    toast(on ? 'Asking the pedal for storage mode…' : 'Leaving storage mode…');
    try {
      var done = await S.midi.setEditMode(on);
      if (!done) throw new Error('The pedal did not answer. Stop playback on the RC-500 and try again, or use MENU › STORAGE on the pedal.');
      if (on) {
        toast('Storage mode on — the “BOSS RC-500” drive appears in a few seconds');
        if (!S.store) setTimeout(function () {
          dialog('Open the pedal drive', h('p', null, 'When the BOSS RC-500 drive has appeared, open it (or its ROLAND folder).'),
            [{ label: 'Later' }, { label: 'Open…', primary: true, onclick: openFolder }]);
        }, 1500);
      } else { toast('Storage mode off — the pedal reloads its data'); S.store = null; S.files = null; S.loops = null; }
    } catch (e) { errToast(e); }
    render();
  }

  function pageRemote() {
    var ch = rxCh();
    var connected = S.midi.connected;
    var ccRows = [];
    for (var a = 1; a <= 8; a++) {
      var src = mget('ASSIGN' + a, 'Source');
      if (src < 12) continue;
      var name = L.assignSource[src], cc = +name.slice(3);
      var target = L.assignTarget[mget('ASSIGN' + a, 'Target')];
      ccRows.push(ccPad(cc, target + (mget('ASSIGN' + a, 'Sw') ? '' : ' (assign off)'), mget('ASSIGN' + a, 'SourceMode')));
    }
    var genCc = { n: S.genCc || 1, v: 127 };
    return [h('div', { class: 'memhead' }, h('div', { class: 'memtitle' }, h('span', { class: 'big' }, 'REMOTE')),
      h('div', { class: 'tools' }, connected
        ? h('button', { onclick: function () { S.midi.disconnect(); render(); } }, 'Disconnect')
        : h('button', { class: 'primary', onclick: connectMidi }, 'Connect over USB MIDI'))),
    !S.midi.available() ? h('p', { class: 'warn' }, 'This browser has no Web MIDI. Use Firefox or Chrome/Edge on an https page, or the Android app.') : null,
    h('div', { class: 'grid' },
      card('Storage mode (USB drive)', [
        h('p', { class: 'info' }, 'Switches the pedal’s USB port to a drive so the editor can read and write its memories and loops — like MENU › STORAGE on the pedal. Playback must be stopped.'),
        h('div', { class: 'btnrow' },
          h('button', { class: 'primary', disabled: !S.midi.available(), onclick: function () { storageMode(true); } }, 'Enter storage mode'),
          h('button', { disabled: !S.midi.available(), onclick: function () { storageMode(false); } }, 'Leave storage mode'))
      ]),
      card('Memory & transport', [
        row('Channel', sel(L.ch16, ch, function (v) { sset('MIDI', 'RxCtlCh', v); render(); }), 'The pedal’s RX CTL CH (SYSTEM › MIDI)'),
        row('Memory', [h('button', { class: 'small', disabled: !connected, onclick: function () { selectMemory(Math.max(0, S.cur - 1)); midiSend([0xC0 | ch, S.cur]); } }, '◀'),
          h('span', { class: 'big2' }, pad2(S.cur + 1)),
          h('button', { class: 'small', disabled: !connected, onclick: function () { selectMemory(Math.min(98, S.cur + 1)); midiSend([0xC0 | ch, S.cur]); } }, '▶'),
          h('button', { disabled: !connected, onclick: function () { midiSend([0xC0 | ch, S.cur]); } }, 'Send PC')]),
        row('Follow pedal', chk(S.followPedal, function (v) { S.followPedal = !!v; }), 'Select the memory the pedal switches to (needs PC OUT on)'),
        row('Send on select', chk(S.sendPcOnSelect, function (v) { S.sendPcOnSelect = !!v; }), 'Send a program change when you pick a memory in the list'),
        h('div', { class: 'btnrow' },
          h('button', { class: 'transport', disabled: !connected, onclick: function () { midiSend([0xFA]); } }, '▶ Start'),
          h('button', { class: 'transport', disabled: !connected, onclick: function () { midiSend([0xFC]); } }, '■ Stop')),
        h('p', { class: 'info' }, 'MIDI Start plays all tracks (ALL START / SYNC START settings). Program changes 1–99 select memories.')
      ]),
      card('Assigned CC controls (memory ' + (S.cur + 1) + ')', ccRows.length ? ccRows : h('p', { class: 'info' }, 'No ASSIGN in this memory uses a CC# source. Set an assign’s source to CC#1–31 or CC#64–95 to control it from here.')),
      card('Send any CC', [
        row('CC#', num(genCc.n, 0, 127, function (v) { S.genCc = v; render(); })),
        ccPad(genCc.n, 'CC#' + genCc.n, 0)
      ]),
      card('MIDI monitor', h('div', { id: 'midilog', class: 'midilog' }, S.midiLog.map(function (l) { return h('div', { class: l.dir }, (l.dir === 'in' ? '← ' : '→ ') + l.text); })))
    )];
  }

  function ccPad(cc, label, mode) {
    var ch = rxCh(), connected = S.midi.connected;
    var state = S.ccToggle = S.ccToggle || {};
    var btn = h('button', { class: 'pad' + (state[cc] ? ' on' : ''), disabled: !connected }, label);
    if (mode === 1) btn.addEventListener('click', function () { state[cc] = !state[cc]; midiSend([0xB0 | ch, cc, state[cc] ? 127 : 0]); btn.classList.toggle('on', state[cc]); });
    else {
      btn.addEventListener('pointerdown', function () { midiSend([0xB0 | ch, cc, 127]); btn.classList.add('on'); });
      ['pointerup', 'pointerleave'].forEach(function (ev) { btn.addEventListener(ev, function () { if (btn.classList.contains('on')) { midiSend([0xB0 | ch, cc, 0]); btn.classList.remove('on'); } }); });
    }
    var rng = h('input', { type: 'range', min: 0, max: 127, value: 0, disabled: !connected, oninput: function () { midiSend([0xB0 | ch, cc, +rng.value]); } });
    return h('div', { class: 'ccpad' }, h('span', { class: 'ccn' }, 'CC#' + cc), btn, rng);
  }

  function pageAbout() {
    var fsa = typeof window.showDirectoryPicker === 'function';
    return h('div', { class: 'about' },
      h('h2', null, 'BOSS RC-500 Editor ' + VERSION),
      h('p', null, 'Edit every memory and system setting of the BOSS RC-500 Loop Station, manage its recorded loops and control it live — all through the pedal’s USB port.'),
      h('h3', null, 'How to connect'),
      h('ol', null,
        h('li', null, 'Connect the RC-500 with a USB cable that carries data (not a charge-only cable).'),
        h('li', null, 'Go to ', h('b', null, 'Remote'), ' and press ', h('b', null, 'Enter storage mode'), ' — or on the pedal: MENU › STORAGE › CONNECT.'),
        h('li', null, 'Press ', h('b', null, 'Open pedal'), ' and choose the BOSS RC-500 drive (or its ROLAND folder).'),
        h('li', null, 'Edit, then ', h('b', null, 'Save'), '. ' + (fsa || PF.isAndroid ? 'The files are written straight to the pedal.' : 'Your browser downloads the changed files — copy them into ROLAND/DATA on the drive.')),
        h('li', null, 'Eject the drive and press ', h('b', null, 'Leave storage mode'), ' (or exit STORAGE on the pedal). The pedal reloads its memories.')),
      h('h3', null, 'Your browser'),
      h('ul', null,
        h('li', null, 'Write directly to the pedal: ', fsa || PF.isAndroid ? '✅' : '❌ (Firefox/Safari can only read the folder; saving downloads the files)'),
        h('li', null, 'USB MIDI (remote + storage mode): ', navigator.requestMIDIAccess || PF.isAndroid ? '✅' : '❌'),
        h('li', null, 'Secure page (needed for both): ', window.isSecureContext ? '✅' : '❌ open the https version')),
      h('h3', null, 'Good to know'),
      h('ul', null,
        h('li', null, 'Make a backup first (⬇ Backup). The editor never deletes the pedal’s files; it writes the older of the two copies the RC-500 keeps (MEMORY1/2.RC0, SYSTEM1/2.RC0) with a newer save counter.'),
        h('li', null, 'The pedal loads the newest copy when it leaves storage mode.'),
        h('li', null, 'Imported audio is converted to 44.1 kHz 32-bit float stereo WAV, which the RC-500 reads directly.')),
      h('h3', null, 'Credits & licence'),
      h('p', null, 'By Jon Solberg. Free software under the GNU GPL v3 or later. ',
        h('a', { href: 'https://github.com/jonsolberg/bossrc500editor', target: '_blank', rel: 'noopener' }, 'Source code on GitHub'), '.'),
      h('p', null, 'File format and parameter encoding were worked out by D. Fleury’s ',
        h('a', { href: 'https://github.com/dfleury2/boss-rc500-editor', target: '_blank', rel: 'noopener' }, 'boss-rc500-editor'), ' (MIT licence). Not affiliated with BOSS or Roland.'),
      h('p', null, h('a', { class: 'kofi', href: 'https://ko-fi.com/jonsolberg', target: '_blank', rel: 'noopener' }, '🍺 Buy me a beer on Ko-fi')));
  }

  // ------------------------------------------------------------------ memory tools
  function rangeInputs() {
    var from = h('input', { type: 'number', min: 1, max: 99, value: Math.min(99, S.cur + 2) });
    var to = h('input', { type: 'number', min: 1, max: 99, value: Math.min(99, S.cur + 2) });
    return { from: from, to: to, el: h('div', { class: 'rangein' }, 'Memories ', from, ' to ', to) };
  }
  var SECTION_GROUPS = [['Tracks', ['TRACK1', 'TRACK2']], ['Record & play', ['MASTER']], ['Loop FX', ['LOOPFX']], ['Rhythm', ['RHYTHM']],
    ['Pedals & controllers', ['CTL']], ['Assigns', ['ASSIGN1', 'ASSIGN2', 'ASSIGN3', 'ASSIGN4', 'ASSIGN5', 'ASSIGN6', 'ASSIGN7', 'ASSIGN8']], ['Name', ['NAME']]];
  function sectionChecks(defName) {
    var boxes = SECTION_GROUPS.map(function (g) {
      var c = h('input', { type: 'checkbox', checked: g[0] === 'Name' ? !!defName : true });
      return { c: c, secs: g[1], el: h('label', { class: 'inl' }, c, ' ' + g[0]) };
    });
    return { el: h('div', { class: 'checks' }, boxes.map(function (b) { return b.el; })), get: function () { var o = []; boxes.forEach(function (b) { if (b.c.checked) o = o.concat(b.secs); }); return o; } };
  }
  function copySectionsUndoable(fromSections, toIdx, names) {
    fromSections.forEach(function (s) {
      if (names.indexOf(s.name) < 0) return;
      s.fields.forEach(function (f) { mset(s.name, f[0], f[1], toIdx); });
    });
  }
  function copyDialog() {
    var r = rangeInputs(), sc = sectionChecks(false);
    dialog('Copy memory ' + (S.cur + 1), h('div', null, r.el, h('p', null, 'Parts to copy:'), sc.el), [{ label: 'Cancel' }, {
      label: 'Copy', primary: true, onclick: function () {
        var a = Math.max(1, Math.min(99, +r.from.value)) - 1, b = Math.max(1, Math.min(99, +r.to.value)) - 1;
        if (a > b) { var t = a; a = b; b = t; }
        var src = RC0.cloneSections(blk()), names = sc.get();
        begin(); for (var i = a; i <= b; i++) if (i !== S.cur) copySectionsUndoable(src, i, names); commit();
        toast('Copied to ' + (a + 1) + (b > a ? '–' + (b + 1) : '')); render();
      }
    }]);
  }
  function pasteDialog() {
    var sc = sectionChecks(false);
    dialog('Paste into memory ' + (S.cur + 1), h('div', null, h('p', null, 'Parts to paste:'), sc.el), [{ label: 'Cancel' }, {
      label: 'Paste', primary: true, onclick: function () { begin(); copySectionsUndoable(S.clip, S.cur, sc.get()); commit(); render(); }
    }]);
  }
  function swapDialog() {
    var n = h('input', { type: 'number', min: 1, max: 99, value: Math.min(99, S.cur + 2) });
    dialog('Swap memory ' + (S.cur + 1) + ' with…', h('div', null, h('p', null, 'Memory ', n),
      h('p', { class: 'info' }, 'Settings and names are swapped. Recorded loops are not moved — use the Loops page for that.')), [{ label: 'Cancel' }, {
      label: 'Swap', primary: true, onclick: function () {
        var j = Math.max(1, Math.min(99, +n.value)) - 1; if (j === S.cur) return;
        var a = RC0.cloneSections(blk()), b = RC0.cloneSections(blk(j)), all = a.map(function (s) { return s.name; });
        begin(); copySectionsUndoable(b, S.cur, all); copySectionsUndoable(a, j, all); commit(); render();
      }
    }]);
  }
  function resetMemory() {
    var sc = sectionChecks(false);
    dialog('Initialize memory ' + (S.cur + 1), h('div', null, h('p', null, 'Reset to the factory settings:'), sc.el), [{ label: 'Cancel' }, {
      label: 'Initialize', danger: true, onclick: function () {
        var f = RC0.factoryMemory().blocks[S.cur];
        begin(); copySectionsUndoable(RC0.cloneSections(f), S.cur, sc.get()); commit(); render();
      }
    }]);
  }
  function resetSystem() {
    dialog('Initialize system settings', h('p', null, 'Reset all SYSTEM settings to factory values? (Undo is available.)'), [{ label: 'Cancel' }, {
      label: 'Initialize', danger: true, onclick: function () {
        var f = RC0.factorySystem().blocks[0];
        begin(); f.sections.forEach(function (s) { s.fields.forEach(function (x) { if (s.name === 'SETUP' && x[0] === 'MemoryNumber') return; sset(s.name, x[0], x[1]); }); }); commit(); render();
      }
    }]);
  }
  async function exportPreset() {
    var b = blk(), name = RC0.memName(b).trim() || 'Memory' + (S.cur + 1);
    var obj = { app: 'bossrc500editor', format: 1, model: S.mem.name || 'RC-500', name: name, sections: {} };
    b.sections.forEach(function (s) { var o = {}; s.fields.forEach(function (f) { o[f[0]] = f[1]; }); obj.sections[s.name] = o; });
    await PF.saveFile(name.replace(/[^\w\- ]+/g, '_') + '.rc500.json', new TextEncoder().encode(JSON.stringify(obj, null, 1)), 'application/json');
  }
  async function importPreset() {
    var f = await pickFile('.json,application/json'); if (!f) return;
    var obj = JSON.parse(await f.text());
    var secs = obj.sections;
    if (!secs && obj.tracks) throw new Error('This looks like a preset from another editor; only bossrc500editor presets are supported.');
    if (!secs) throw new Error('Not an RC-500 editor preset');
    var sc = sectionChecks(true);
    dialog('Load preset “' + (obj.name || f.name) + '” into memory ' + (S.cur + 1), h('div', null, h('p', null, 'Parts to load:'), sc.el), [{ label: 'Cancel' }, {
      label: 'Load', primary: true, onclick: function () {
        var names = sc.get();
        begin();
        Object.keys(secs).forEach(function (s) { if (names.indexOf(s) < 0) return; Object.keys(secs[s]).forEach(function (k) { mset(s, k, secs[s][k] | 0); }); });
        commit(); render();
      }
    }]);
  }

  // ------------------------------------------------------------------ open / save
  async function loadFrom(store) {
    var data = (await store.list('DATA')).map(function (f) { return f.name.toUpperCase(); });
    var have = function (n) { return data.indexOf(n) >= 0; };
    if (!have('MEMORY1.RC0') && !have('MEMORY2.RC0')) throw new Error('No MEMORY1.RC0 / MEMORY2.RC0 in ROLAND/DATA');
    async function readPair(base) {
      var b1 = have(base + '1.RC0') ? await store.read('DATA/' + base + '1.RC0') : null;
      var b2 = have(base + '2.RC0') ? await store.read('DATA/' + base + '2.RC0') : null;
      var c1 = b1 ? RC0.readCounter(b1) : 0, c2 = b2 ? RC0.readCounter(b2) : 0;
      var pick = RC0.pickFiles(c1, c2, !!b1, !!b2);
      var db;
      try { db = RC0.parse(pick.load === 1 ? b1 : b2); }
      catch (e) { // newest copy damaged: fall back to the other one
        var other = pick.load === 1 ? b2 : b1; if (!other) throw e;
        db = RC0.parse(other); pick = { load: pick.write, write: pick.load };
      }
      return { db: db, load: pick.load, write: pick.write, counter: Math.max(c1, c2) };
    }
    var m = await readPair('MEMORY'), s = await readPair('SYSTEM');
    if (m.db.blocks.length !== 99 || !RC0.section(m.db.blocks[0], 'LOOPFX')) {
      throw new Error('This is a ' + (m.db.name || 'unknown') + ' data file. Only the RC-500 is supported.');
    }
    S.store = store; S.mem = m.db; S.sys = s.db;
    S.origMem = RC0.clone(m.db); S.origSys = RC0.clone(s.db);
    S.files = { mem: m, sys: s, memName: 'MEMORY' + m.load + '.RC0', sysName: 'SYSTEM' + s.load + '.RC0' };
    S.undo = []; S.redo = []; S.loops = null;
    var mn = sget('SETUP', 'MemoryNumber'); S.cur = mn >= 0 && mn < 99 ? mn : 0;
    toast('Loaded ' + S.files.memName + ' and ' + S.files.sysName + (store.writable ? '' : ' (read-only)'));
    render();
    if (store.hasWave) scanLoops().then(renderMemList).catch(function () { });
  }

  async function confirmDiscard() {
    if (!anyDirty()) return true;
    return new Promise(function (res) {
      dialog('Unsaved changes', h('p', null, 'Discard the changes you have not saved?'),
        [{ label: 'Cancel', onclick: function () { res(false); } }, { label: 'Discard', danger: true, onclick: function () { res(true); } }]);
    });
  }

  async function openFolder() {
    if (!(await confirmDiscard())) return;
    try {
      if (PF.Storage.canWriteDirect) await loadFrom(await PF.Storage.pick());
      else $('dirinput').click();
    } catch (e) { if (e.name !== 'AbortError' && e.message !== 'Cancelled') errToast(e); }
  }
  async function openFactory() {
    if (!(await confirmDiscard())) return;
    S.store = null; S.files = null; S.loops = null;
    S.mem = RC0.factoryMemory(); S.sys = RC0.factorySystem();
    S.origMem = RC0.clone(S.mem); S.origSys = RC0.clone(S.sys);
    S.undo = []; S.redo = []; S.cur = 0; render();
  }

  async function save() {
    if (!S.mem) return;
    var memChanged = false; for (var i = 0; i < 99; i++) if (memDirty(i)) { memChanged = true; break; }
    var sysChanged = sysDirty();
    if (S.store && !memChanged && !sysChanged) { toast('Nothing to save'); return; }

    if (S.store && S.store.writable) {
      var f = S.files;
      var list = [];
      if (memChanged) list.push(['MEMORY', S.mem, f.mem]);
      if (sysChanged) list.push(['SYSTEM', S.sys, f.sys]);
      return new Promise(function (res) {
        dialog('Save to the pedal', h('div', null,
          h('p', null, 'Write ' + list.map(function (x) { return x[0] + x[2].write + '.RC0'; }).join(' and ') + ' to ' + (S.store.name || 'the pedal') + '?'),
          h('p', { class: 'info' }, 'The previous copy (' + list.map(function (x) { return x[0] + x[2].load + '.RC0'; }).join(', ') + ') stays untouched as a fallback. Make a backup if you have not already.')),
          [{ label: 'Cancel', onclick: function () { res(); } }, { label: '⬇ Backup first', onclick: function () { backup(); return false; } }, {
            label: 'Save', primary: true, onclick: async function () {
              try {
                for (var k = 0; k < list.length; k++) {
                  var x = list[k], counter = (x[2].counter + 2) >>> 0, bytes = RC0.serialize(x[1], counter);
                  var path = 'DATA/' + x[0] + x[2].write + '.RC0';
                  await S.store.write(path, bytes);
                  var back = await S.store.read(path);
                  if (back.length !== bytes.length || back.some(function (v, n) { return v !== bytes[n]; })) throw new Error('Verification of ' + path + ' failed');
                  x[2].counter = counter; var t = x[2].load; x[2].load = x[2].write; x[2].write = t;
                }
                S.files.memName = 'MEMORY' + f.mem.load + '.RC0'; S.files.sysName = 'SYSTEM' + f.sys.load + '.RC0';
                S.origMem = RC0.clone(S.mem); S.origSys = RC0.clone(S.sys);
                render();
                dialog('Saved', h('div', null, h('p', null, 'Written and verified.'),
                  h('p', null, PF.isAndroid ? 'Leave storage mode so the pedal reloads its memories.' : 'Eject the BOSS RC-500 drive, then leave storage mode so the pedal reloads its memories.')),
                  [{ label: 'OK' }, S.midi.available() ? { label: 'Leave storage mode', primary: true, onclick: function () { storageMode(false); } } : null].filter(Boolean));
              } catch (e) { errToast(e); }
              res();
            }
          }]);
      });
    }

    // Read-only folder (Firefox) or factory data: download the files.
    var files = [];
    if (S.store) {
      if (memChanged) files.push({ name: 'MEMORY' + S.files.mem.write + '.RC0', data: RC0.serialize(S.mem, S.files.mem.counter + 2) });
      if (sysChanged) files.push({ name: 'SYSTEM' + S.files.sys.write + '.RC0', data: RC0.serialize(S.sys, S.files.sys.counter + 2) });
    } else {
      files.push({ name: 'MEMORY1.RC0', data: RC0.serialize(S.mem, 2) }, { name: 'MEMORY2.RC0', data: RC0.serialize(S.mem, 1) },
        { name: 'SYSTEM1.RC0', data: RC0.serialize(S.sys, 2) }, { name: 'SYSTEM2.RC0', data: RC0.serialize(S.sys, 1) });
    }
    dialog('Download the changed files', h('div', null,
      h('p', null, S.store ? 'This browser can’t write to the drive, so download these files and copy them into ' : 'You are editing factory data. Download all four files and copy them into ',
        h('code', null, 'ROLAND/DATA'), ' on the BOSS RC-500 drive, replacing the files with the same name:'),
      h('ul', { class: 'dl' }, files.map(function (f) { return h('li', null, h('button', { onclick: function () { PF.saveFile(f.name, f.data); } }, '⬇ ' + f.name)); })),
      h('p', { class: 'info' }, 'Check that the downloaded names are exactly as shown (no “(1)” added). ' + (S.store ? '' : 'Replacing all four files overwrites every memory and system setting on the pedal.'))),
      [{ label: 'Close' }, { label: 'Mark as saved', primary: true, onclick: function () {
        if (S.store) { if (memChanged) S.files.mem.counter += 2; if (sysChanged) S.files.sys.counter += 2; }
        S.origMem = RC0.clone(S.mem); S.origSys = RC0.clone(S.sys); render();
      } }]);
  }

  async function backup() {
    if (!S.store) { toast('Open the pedal folder first'); return; }
    var files = [], data = await S.store.list('DATA');
    for (var i = 0; i < data.length; i++) if (!data[i].dir) files.push({ name: 'ROLAND/DATA/' + data[i].name, data: await S.store.read('DATA/' + data[i].name) });
    var d = new Date(), stamp = d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes());
    await PF.saveFile('rc500-backup-' + stamp + '.zip', AU.zip(files), 'application/zip');
    toast('Backup of ROLAND/DATA saved (loops not included — copy ROLAND/WAVE yourself to keep them)');
  }

  // ------------------------------------------------------------------ theme
  function applyTheme() {
    var t = localStorage.getItem('rc500-theme') || 'auto';
    document.documentElement.dataset.theme = t;
    $('btnTheme').textContent = t === 'dark' ? '🌙' : t === 'light' ? '☀️' : '🌓';
    $('btnTheme').title = 'Theme: ' + t;
  }

  // ------------------------------------------------------------------ boot
  function boot() {
    try { applyTheme(); } catch (e) { }
    $('btnTheme').onclick = function () {
      var order = ['auto', 'light', 'dark'], cur = localStorage.getItem('rc500-theme') || 'auto';
      try { localStorage.setItem('rc500-theme', order[(order.indexOf(cur) + 1) % 3]); } catch (e) { }
      applyTheme();
    };
    $('btnOpen').onclick = openFolder;
    $('btnFactory').onclick = openFactory;
    $('btnSave').onclick = function () { save().catch(errToast); };
    $('btnBackup').onclick = function () { backup().catch(errToast); };
    $('btnUndo').onclick = function () { undoRedo(S.undo, S.redo, true); };
    $('btnRedo').onclick = function () { undoRedo(S.redo, S.undo, false); };
    $('midistat').onclick = function () { S.page = 'remote'; render(); };
    $('btnList').onclick = function () { document.body.classList.toggle('show-list'); };
    $('memfilter').oninput = renderMemList;
    $('dirinput').onchange = function (e) {
      if (!e.target.files.length) return;
      PF.Storage.fromFileList(e.target.files).then(loadFrom).catch(errToast);
      e.target.value = '';
    };
    document.querySelectorAll('nav.tabs button').forEach(function (b) { b.onclick = function () { S.page = b.dataset.page; render(); }; });
    document.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey) || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undoRedo(S.undo, S.redo, true); }
      if (e.key === 'y' || (e.key === 'z' && e.shiftKey) || e.key === 'Z') { e.preventDefault(); undoRedo(S.redo, S.undo, false); }
      if (e.key === 's') { e.preventDefault(); save().catch(errToast); }
    });
    window.addEventListener('beforeunload', function (e) { if (anyDirty()) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('unhandledrejection', function (e) { errToast(e.reason); });

    S.mem = RC0.factoryMemory(); S.sys = RC0.factorySystem();
    S.origMem = RC0.clone(S.mem); S.origSys = RC0.clone(S.sys);
    if (!window.isSecureContext && !PF.isAndroid) {
      var https = 'https://jonsolberg.github.io/bossrc500editor/';
      $('banner').appendChild(h('div', { class: 'warn' }, 'This page is not served over https, so the browser blocks USB MIDI and direct writing. ',
        h('a', { href: https }, 'Open the https version'), ' for all features.'));
    }
    render();
    PF.Storage.reopen().then(function (st) { if (st) return loadFrom(st); }).catch(function () { });
  }

  // Android back button: close dialogs / list first.
  window.rc500Back = function () {
    var m = document.querySelector('.modal-back'); if (m) { m.remove(); return true; }
    if (document.body.classList.contains('show-list')) { document.body.classList.remove('show-list'); return true; }
    if (S.page !== 'memory') { S.page = 'memory'; render(); return true; }
    return false;
  };

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();
})();
