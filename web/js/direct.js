/*
 * BOSS RC-500 Editor — Direct mode: play the pedal live from an on-screen copy of its panel.
 * Copyright (C) 2026 Jon Solberg — GPL-3.0-or-later (see LICENSE).
 *
 * The RC-500 has no MIDI messages for its switches. It reacts to MIDI CC only through a
 * memory's ASSIGN slots (SOURCE = CC#, TARGET = function). Direct mode therefore uses a fixed
 * set of CC numbers (80–89), which "Set up memories" writes into the ASSIGNs of the chosen
 * memories. Program change selects memories and MIDI Start/Stop start/stop everything.
 * The pedal reports nothing about track states over MIDI, so the lights on screen follow the
 * presses the way the pedal itself would (they can drift if you also use the real switches).
 */
(function () {
  'use strict';

  var FUNCS = [
    { id: 'rec', cc: 80, target: 'CUR REC/PLY', label: 'REC/PLAY switch', def: true },
    { id: 'stop', cc: 81, target: 'CUR PLY/STP', label: 'STOP switch', def: true },
    { id: 'trk', cc: 82, target: 'TRK SELECT', label: 'TRACK SELECT switch and track EDIT buttons', def: true, min: 0, max: 1 },
    { id: 'lvl1', cc: 83, target: 'T1 LEVEL1', label: 'TRACK 1 slider', def: true, min: 0, max: 200 },
    { id: 'lvl2', cc: 84, target: 'T2 LEVEL1', label: 'TRACK 2 slider', def: true, min: 0, max: 200 },
    { id: 'rhy', cc: 85, target: 'RHYTHM P/S', label: 'Rhythm ON/OFF button', def: true },
    { id: 'clear', cc: 86, target: 'CUR CLEAR', label: 'Hold STOP 2 s: clear the track', def: true },
    { id: 'undo', cc: 87, target: 'UNDO/REDO', label: 'Hold REC/PLAY 2 s: undo/redo', def: true },
    { id: 'tap', cc: 88, target: 'TAP TEMPO', label: 'TEMPO button (tap tempo)', def: false },
    { id: 'fx', cc: 89, target: 'LOOP FX', label: 'LOOP FX on/off', def: false, min: 0, max: 1 }
  ];
  var HOLD_MS = 2000;

  var A;                    // app API (set on first render)
  var sim = null;           // simulated pedal state for the current memory
  var tempoTimer = null, clock = { ticks: [], n: 0 }, lastBlink = 0;

  function L() { return A.P.L; }
  function srcIndex(cc) { return L().assignSource.indexOf('CC#' + cc); }
  function tgtIndex(name) { return L().assignTarget.indexOf(name); }

  /** Which direct functions the given memory has an active ASSIGN for. */
  function installed(mi) {
    var have = {};
    for (var a = 1; a <= 8; a++) {
      var sec = 'ASSIGN' + a;
      if (!A.mget(sec, 'Sw', mi)) continue;
      var src = A.mget(sec, 'Source', mi), tgt = A.mget(sec, 'Target', mi);
      FUNCS.forEach(function (f) { if (src === srcIndex(f.cc) && tgt === tgtIndex(f.target)) have[f.id] = true; });
    }
    return have;
  }

  // ------------------------------------------------------------------ simulated state
  function resetSim() {
    var mi = A.S.cur;
    function hasPhrase(t) {
      if (A.mget('TRACK' + t, 'WavStat', mi)) return true;
      var l = A.S.loops && A.S.loops[mi]; return !!(l && l[t]);
    }
    sim = {
      mem: mi,
      tr: [null, { st: hasPhrase(1) ? 'stop' : 'empty' }, { st: hasPhrase(2) ? 'stop' : 'empty' }],
      cur: (A.mget('MASTER', 'CurrentTrack', mi) || 0) + 1,
      lvl: [0, A.mget('TRACK1', 'PlyLvl', mi), A.mget('TRACK2', 'PlyLvl', mi)],
      rhythm: A.mget('RHYTHM', 'State', mi) ? 'ready' : 'off',
      fx: !!A.mget('LOOPFX', 'Sw', mi),
      tempo: A.mget('MASTER', 'Tempo', mi) / 10,
      tapTimes: []
    };
  }
  function ensureSim() { if (!sim || sim.mem !== A.S.cur) resetSim(); }

  function cc(n, v) { A.midiSend([0xB0 | A.rxCh(), n, v]); }
  function press(f) { cc(f.cc, 127); }
  function release(f) { cc(f.cc, 0); }
  function fn(id) { for (var i = 0; i < FUNCS.length; i++) if (FUNCS[i].id === id) return FUNCS[i]; }

  function recPlay() {
    var t = sim.tr[sim.cur], recAction = A.mget('MASTER', 'RecAction');
    var single = A.mget('MASTER', 'PlayMode') === 1;
    var startsPlaying = false;
    switch (t.st) {
      case 'empty': t.st = 'rec'; startsPlaying = true; break;
      case 'rec': t.st = recAction === 0 ? 'dub' : 'play'; break;
      case 'play': t.st = 'dub'; break;
      case 'dub': t.st = 'play'; break;
      case 'stop': t.st = 'play'; startsPlaying = true; break;
    }
    if (startsPlaying && single) { var o = sim.tr[3 - sim.cur]; if (o.st !== 'empty') o.st = 'stop'; }
    if (sim.rhythm === 'ready' && startsPlaying) sim.rhythm = 'on';
  }
  function stopTrack() {
    var t = sim.tr[sim.cur];
    if (t.st === 'rec' || t.st === 'play' || t.st === 'dub') t.st = 'stop';
    else if (t.st === 'stop') t.st = 'play'; // PLY/STP toggles
  }

  // ------------------------------------------------------------------ setup dialog
  function setupDialog() {
    var h = A.h;
    var boxes = FUNCS.map(function (f) {
      var c = h('input', { type: 'checkbox', checked: f.def });
      return { f: f, c: c, el: h('label', { class: 'dfunc' }, c, h('span', { class: 'ccn' }, 'CC#' + f.cc), ' ' + f.label) };
    });
    var from = h('input', { type: 'number', min: 1, max: 99, value: 1 }), to = h('input', { type: 'number', min: 1, max: 99, value: 99 });
    var over = h('input', { type: 'checkbox' });
    var count = h('p', { class: 'info' });
    function upd() { var n = boxes.filter(function (b) { return b.c.checked; }).length; count.textContent = n + ' of 8 ASSIGN slots per memory'; count.classList.toggle('warn', n > 8); }
    boxes.forEach(function (b) { b.c.addEventListener('change', upd); }); upd();
    A.dialog('Set up memories for Direct mode', h('div', null,
      h('p', null, 'The RC-500 only reacts to MIDI CC messages that a memory’s ASSIGNs listen for. This adds the ASSIGNs Direct mode needs to the memories you choose:'),
      h('div', { class: 'dfuncs' }, boxes.map(function (b) { return b.el; })), count,
      h('div', { class: 'rangein' }, 'Memories ', from, ' to ', to),
      h('label', { class: 'inl' }, over, ' Replace existing ASSIGNs if there are not enough free slots'),
      h('p', { class: 'info' }, 'Free (switched off) ASSIGN slots are used first. Afterwards, Save to write the memories to the pedal. Undo is available.')),
      [{ label: 'Cancel' }, {
        label: 'Set up', primary: true, onclick: function () {
          var want = boxes.filter(function (b) { return b.c.checked; }).map(function (b) { return b.f; });
          if (want.length > 8) { A.toast('Pick at most 8 functions', 'err'); return false; }
          var a = Math.max(1, Math.min(99, +from.value)) - 1, b = Math.max(1, Math.min(99, +to.value)) - 1, skipped = 0, done = 0;
          if (a > b) { var t = a; a = b; b = t; }
          A.begin();
          for (var mi = a; mi <= b; mi++) {
            var have = installed(mi);
            var need = want.filter(function (f) { return !have[f.id]; });
            if (!need.length) { done++; continue; }
            var free = [];
            for (var s = 1; s <= 8; s++) if (!A.mget('ASSIGN' + s, 'Sw', mi)) free.push(s);
            if (free.length < need.length) {
              if (!over.checked) { skipped++; continue; }
              // keep slots that already hold a wanted direct function, reuse the rest
              free = [];
              for (s = 1; s <= 8; s++) {
                var src = A.mget('ASSIGN' + s, 'Source', mi), tg = A.mget('ASSIGN' + s, 'Target', mi), keep = false;
                if (A.mget('ASSIGN' + s, 'Sw', mi)) want.forEach(function (f) { if (src === srcIndex(f.cc) && tg === tgtIndex(f.target)) keep = true; });
                if (!keep) free.push(s);
              }
            }
            need.forEach(function (f, k) {
              var sec = 'ASSIGN' + free[k];
              A.mset(sec, 'Sw', 1, mi); A.mset(sec, 'Source', srcIndex(f.cc), mi); A.mset(sec, 'SourceMode', 0, mi);
              A.mset(sec, 'Target', tgtIndex(f.target), mi);
              A.mset(sec, 'TargetMin', f.min || 0, mi); A.mset(sec, 'TargetMax', f.max === undefined ? 1 : f.max, mi);
            });
            done++;
          }
          A.commit();
          A.toast('Direct mode set up in ' + done + ' memor' + (done === 1 ? 'y' : 'ies') + (skipped ? ', ' + skipped + ' skipped (not enough free ASSIGN slots)' : '') + '. Save to write it to the pedal.', skipped ? 'err' : '');
          A.render();
        }
      }]);
  }

  // ------------------------------------------------------------------ panel widgets
  function led(cls) { return A.h('span', { class: 'led ' + (cls || '') }); }

  function vslider(t, enabled) {
    var h = A.h;
    var val = sim.lvl[t];
    var thumb = h('div', { class: 'vthumb' });
    var track = h('div', { class: 'vtrack' + (enabled ? '' : ' dis'), title: enabled ? 'Track ' + t + ' level' : 'Set up Direct mode to use the slider' }, h('div', { class: 'vgroove' }), thumb);
    function place(v) { thumb.style.bottom = 'calc(' + (v / 200 * 100) + '% - ' + (v / 200 * 22) + 'px)'; }
    place(val);
    var lastCc = -1;
    function setFromY(y) {
      var r = track.getBoundingClientRect();
      var v = Math.round(Math.max(0, Math.min(1, (r.bottom - y - 11) / (r.height - 22))) * 200);
      sim.lvl[t] = v; place(v);
      var c = Math.round(v * 127 / 200);
      if (c !== lastCc) { lastCc = c; cc(fn('lvl' + t).cc, c); }
      out.textContent = v;
    }
    var out = h('span', { class: 'vval' }, String(val));
    if (enabled) {
      track.addEventListener('pointerdown', function (e) { track.setPointerCapture(e.pointerId); setFromY(e.clientY); e.preventDefault(); });
      track.addEventListener('pointermove', function (e) { if (track.hasPointerCapture(e.pointerId)) setFromY(e.clientY); });
      track.addEventListener('wheel', function (e) { e.preventDefault(); var v = Math.max(0, Math.min(200, sim.lvl[t] + (e.deltaY < 0 ? 5 : -5))); var r = track.getBoundingClientRect(); setFromY(r.bottom - 11 - v / 200 * (r.height - 22)); }, { passive: false });
    }
    return h('div', { class: 'vslider' }, track, out);
  }

  function knob(onStep, title) {
    var h = A.h;
    var cap = h('div', { class: 'knobcap' }, h('span', { class: 'knobmark' }));
    var k = h('div', { class: 'knob', title: title, tabindex: 0 }, cap);
    var acc = 0, lastY = null, rot = (A.S.cur * 15) % 360;
    cap.style.transform = 'rotate(' + rot + 'deg)';
    function step(d) { rot += d * 15; cap.style.transform = 'rotate(' + rot + 'deg)'; onStep(d); }
    k.addEventListener('pointerdown', function (e) { k.setPointerCapture(e.pointerId); lastY = e.clientY; acc = 0; e.preventDefault(); });
    k.addEventListener('pointermove', function (e) {
      if (lastY === null || !k.hasPointerCapture(e.pointerId)) return;
      acc += lastY - e.clientY; lastY = e.clientY;
      while (acc > 18) { acc -= 18; step(1); } while (acc < -18) { acc += 18; step(-1); }
    });
    var settle = null;
    function later() { clearTimeout(settle); settle = setTimeout(function () { if (lastY === null) A.render(); }, 700); }
    k.addEventListener('pointerup', function () { lastY = null; later(); });
    k.addEventListener('wheel', function (e) { e.preventDefault(); step(e.deltaY < 0 ? 1 : -1); later(); }, { passive: false });
    return k;
  }

  /** A footswitch: action on press (timing matters for loop points), optional hold action. */
  function footswitch(label, enabled, onPress, onHold, keyHint) {
    var h = A.h;
    var holdTimer = null;
    var sw = h('button', { class: 'fsw', disabled: !enabled, title: keyHint ? 'Key: ' + keyHint : '' }, h('span', { class: 'fswcap' }));
    sw.addEventListener('pointerdown', function (e) {
      if (e.button) return;
      sw.classList.add('down'); onPress();
      if (onHold) holdTimer = setTimeout(function () { holdTimer = null; onHold(); }, HOLD_MS);
    });
    var up = function () { sw.classList.remove('down'); if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } };
    sw.addEventListener('pointerup', up); sw.addEventListener('pointerleave', up); sw.addEventListener('pointercancel', up);
    sw.__press = onPress; sw.__hold = onHold;
    return h('div', { class: 'fswwrap' }, h('span', { class: 'fswlabel' }, label), sw);
  }

  function stColor(st) { return { empty: 'blue', rec: 'red', play: 'green', dub: 'yellow', stop: 'white' }[st]; }
  function overall() {
    var s = [sim.tr[1].st, sim.tr[2].st];
    if (s.indexOf('rec') >= 0) return 'rec';
    if (s.indexOf('dub') >= 0) return 'dub';
    if (s.indexOf('play') >= 0) return 'play';
    if (s.indexOf('stop') >= 0) return 'stop';
    return 'empty';
  }

  /** Refresh lights and display without rebuilding the page (keeps presses and drags alive). */
  function updateLights() {
    if (!sim) return;
    if (sim.mem !== A.S.cur) resetSim();
    var lcd = document.getElementById('lcd'); if (!lcd) return;
    lcd.className = 'lcd ' + stColor(overall());
    var st = { empty: '', rec: ' REC', play: ' PLAY', dub: ' DUB', stop: ' STOP' }[sim.tr[sim.cur].st];
    document.getElementById('lcdstate').textContent = 'TRK' + sim.cur + st;
    document.getElementById('lcdno').textContent = A.pad2(A.S.cur + 1);
    document.getElementById('lcdname').textContent = A.RC0.memName(A.blk()).replace(/\s+$/, '');
    var te = document.getElementById('lcdtempo'); if (te && performance.now() - clock.last > 1500) te.textContent = '♩' + sim.tempo.toFixed(1);
    [1, 2].forEach(function (t) {
      var l = document.querySelector('[data-tled="' + t + '"]');
      if (l) l.className = 'led ' + stColor(sim.tr[t].st) + (sim.cur === t ? ' blink' : '');
    });
    var r = document.getElementById('rhyled'); if (r) r.className = 'led ' + (sim.rhythm === 'on' ? 'green' : sim.rhythm === 'ready' ? 'green blink' : '');
    var f = document.getElementById('fxled'); if (f) f.className = 'led ' + (sim.fx ? 'red' : '');
  }

  // ------------------------------------------------------------------ page
  var keyActions = {};

  function page(api) {
    A = api; ensureSim();
    var h = A.h, S = A.S, mi = S.cur;
    var have = installed(mi), conn = S.midi.connected;
    function ok(id) { return conn && !!have[id]; }
    var missing = FUNCS.filter(function (f) { return f.def && !have[f.id]; }).length;

    var bt = A.P.beatOf(A.mget('RHYTHM', 'Beat'));
    var stateText = { empty: '', rec: 'REC', play: 'PLAY', dub: 'DUB', stop: 'STOP' }[sim.tr[sim.cur].st];
    var lcd = h('div', { id: 'lcd', class: 'lcd ' + stColor(overall()) },
      h('div', { class: 'lcd1' }, h('span', { id: 'lcdno', class: 'lcdno' }, A.pad2(mi + 1)), h('span', { id: 'lcdname', class: 'lcdname' }, A.RC0.memName(A.blk()).replace(/\s+$/, ''))),
      h('div', { class: 'lcd2' },
        h('span', { id: 'lcdstate' }, 'TRK' + sim.cur + (stateText ? ' ' + stateText : '')),
        h('span', { id: 'lcdtempo' }, '♩' + sim.tempo.toFixed(1)),
        h('span', null, bt[0] + '/' + bt[1])));

    function trackCol(t) {
      var st = sim.tr[t].st;
      return h('div', { class: 'trackcol' },
        h('div', { class: 'tlabel' }, 'TRACK ' + t),
        h('div', { class: 'trackrow' }, vslider(t, ok('lvl' + t)),
          h('div', { class: 'tled' }, h('span', { class: 'led ' + stColor(st) + (sim.cur === t ? ' blink' : ''), 'data-tled': t }))),
        h('button', {
          class: 'pbtn small', disabled: !ok('trk'), title: 'Make track ' + t + ' the current track', onclick: function () {
            sim.cur = t; cc(fn('trk').cc, t === 2 ? 127 : 0); updateLights();
          }
        }, 'EDIT'));
    }

    var rec = footswitch('REC/PLAY', ok('rec'), function () { press(fn('rec')); recPlay(); updateLights(); setTimeout(function () { release(fn('rec')); }, 60); },
      have.undo ? function () { press(fn('undo')); setTimeout(function () { release(fn('undo')); }, 60); A.toast('Undo/redo'); } : null, 'Space');
    var stop = footswitch('STOP', ok('stop'), function () { press(fn('stop')); stopTrack(); updateLights(); setTimeout(function () { release(fn('stop')); }, 60); },
      have.clear ? function () { press(fn('clear')); setTimeout(function () { release(fn('clear')); }, 60); sim.tr[sim.cur].st = 'empty'; updateLights(); A.toast('Track ' + sim.cur + ' cleared'); } : null, 'S (hold: clear)');
    var sel = footswitch('TRACK SELECT', ok('trk'), function () { sim.cur = 3 - sim.cur; cc(fn('trk').cc, sim.cur === 2 ? 127 : 0); updateLights(); }, null, 'T');
    keyActions = { ' ': rec, s: stop, t: sel };

    var rhyLed = sim.rhythm === 'on' ? 'green' : sim.rhythm === 'ready' ? 'green blink' : '';
    var panel = h('div', { class: 'rcpanel' },
      h('div', { class: 'rctop' },
        h('div', { class: 'tracks' }, trackCol(1), trackCol(2)),
        h('div', { class: 'center' },
          h('div', { class: 'brandrow' }, h('span', { class: 'model' }, 'RC-500'), h('span', { class: 'sub' }, 'Loop Station')),
          lcd,
          h('div', { class: 'btnrow2' },
            h('div', { class: 'rhythm' }, h('span', { class: 'grp' }, 'RHYTHM'),
              h('div', { class: 'rbtns' },
                h('div', { class: 'lbtn' }, led('red tempoled'), h('button', {
                  class: 'pbtn', disabled: !ok('tap'), title: have.tap ? 'Tap tempo (key: Enter)' : 'Add TAP TEMPO in “Set up memories” to use this',
                  onclick: tap
                }, 'TEMPO')),
                h('div', { class: 'lbtn' }, h('span', { id: 'rhyled', class: 'led ' + rhyLed }), h('button', {
                  class: 'pbtn', disabled: !ok('rhy'), title: 'Rhythm play/stop (key: R)', onclick: rhythm
                }, 'ON/OFF')))),
            h('div', { class: 'lbtn' }, h('span', { class: 'led none' }), h('button', { class: 'pbtn', title: 'Edit this memory', onclick: function () { A.go('memory'); } }, 'MEMORY')),
            h('div', { class: 'lbtn' }, h('span', { class: 'led none' }), h('button', { class: 'pbtn', title: 'System settings', onclick: function () { A.go('system'); } }, 'MENU')))),
        h('div', { class: 'right' },
          h('div', { class: 'knobwrap' }, knob(function (d) {
            var n = Math.max(0, Math.min(98, A.S.cur + d));
            if (n !== A.S.cur) { A.selectMemory(n, false, true); updateLights(); }
          }, 'MEMORY/VALUE: turn to change memory'), h('span', { class: 'klabel' }, 'MEMORY/VALUE')),
          h('div', { class: 'fxrow' }, h('div', { class: 'lbtn' }, h('span', { id: 'fxled', class: 'led ' + (sim.fx ? 'red' : '') }), h('button', {
            class: 'pbtn', disabled: !ok('fx'), title: have.fx ? 'Loop FX on/off (key: F)' : 'Add LOOP FX in “Set up memories” to use this', onclick: loopFx
          }, 'LOOP FX'))))),
      h('div', { class: 'rcbottom' }, rec, stop, sel));

    var wrap = h('div', { class: 'rcwrap' }, panel);
    requestAnimationFrame(function () { fit(wrap, panel); });

    var notes = [];
    if (!conn) notes.push(h('div', { class: 'dnote' }, h('span', null, 'Connect the RC-500 over USB to play it from here.'), h('button', { class: 'primary', onclick: A.connectMidi }, 'Connect over USB MIDI')));
    if (missing) notes.push(h('div', { class: 'dnote' }, h('span', null, 'Memory ' + (mi + 1) + ' is not set up for Direct mode yet (' + missing + ' of the switches have no ASSIGN).'),
      h('button', { onclick: setupDialog }, 'Set up memories…')));

    return [h('div', { class: 'memhead' }, h('div', { class: 'memtitle' }, h('span', { class: 'big' }, 'DIRECT')),
      h('div', { class: 'tools' },
        h('button', { disabled: !conn, onclick: function () { A.midiSend([0xFA]); ['1', '2'].forEach(function (t) { if (sim.tr[t].st === 'stop') sim.tr[t].st = 'play'; }); if (sim.rhythm === 'ready') sim.rhythm = 'on'; updateLights(); }, title: 'MIDI Start: start all tracks' }, '▶ All start'),
        h('button', { disabled: !conn, onclick: function () { A.midiSend([0xFC]); ['1', '2'].forEach(function (t) { var s = sim.tr[t]; if (s.st !== 'empty') s.st = 'stop'; }); updateLights(); }, title: 'MIDI Stop: stop everything' }, '■ All stop'),
        h('button', { onclick: setupDialog }, 'Set up memories…'),
        h('button', { onclick: function () { resetSim(); A.render(); }, title: 'Reset the lights to the memory’s saved state' }, '↺ Lights'))),
    notes, wrap,
    h('p', { class: 'info keyhelp' }, 'Keys: Space = REC/PLAY (hold: undo), S = STOP (hold: clear), T = TRACK SELECT, R = rhythm, Enter = tap tempo, F = loop FX, ↑/↓ = memory. ' +
      'The pedal doesn’t report its track states, so the lights follow your presses here; use ↺ Lights if they get out of step.')];
  }

  function tap() {
    press(fn('tap')); setTimeout(function () { release(fn('tap')); }, 40);
    var now = performance.now(); sim.tapTimes = sim.tapTimes.filter(function (t) { return now - t < 2500; }); sim.tapTimes.push(now);
    if (sim.tapTimes.length >= 2) { sim.tempo = Math.max(40, Math.min(300, 60000 / ((now - sim.tapTimes[0]) / (sim.tapTimes.length - 1)))); var el = document.getElementById('lcdtempo'); if (el) el.textContent = '♩' + sim.tempo.toFixed(1); restartTempo(); }
  }
  function rhythm() {
    press(fn('rhy')); setTimeout(function () { release(fn('rhy')); }, 60);
    sim.rhythm = sim.rhythm === 'on' ? 'off' : 'on'; updateLights();
  }
  function loopFx() {
    sim.fx = !sim.fx; cc(fn('fx').cc, sim.fx ? 127 : 0); updateLights();
  }

  /** Scale the fixed-size panel to the available width. */
  function fit(wrap, panel) {
    var w = wrap.clientWidth || 900;
    wrap.classList.toggle('narrow', w < 640);
    var s = Math.min(1.25, w / (w < 640 ? 560 : 920));
    panel.style.transform = 'scale(' + s + ')';
    wrap.style.height = Math.ceil(panel.offsetHeight * s) + 'px';
  }
  window.addEventListener('resize', function () { var w = document.querySelector('.rcwrap'), p = document.querySelector('.rcpanel'); if (w && p) fit(w, p); });

  // Tempo LED: follows MIDI clock from the pedal when it sends it, otherwise the memory tempo.
  function blink() { var el = document.querySelector('.tempoled'); if (!el) return; el.classList.add('on'); setTimeout(function () { el.classList.remove('on'); }, 90); }
  function restartTempo() {
    if (tempoTimer) clearInterval(tempoTimer);
    tempoTimer = setInterval(function () { if (performance.now() - clock.last < 600) return; blink(); }, 60000 / ((sim && sim.tempo) || 120));
  }
  clock.last = 0;

  function onMidi(m) {
    if (!sim) return;
    if (m[0] === 0xF8) {
      var now = performance.now(); clock.last = now;
      clock.n = (clock.n + 1) % 24; if (clock.n === 0) blink();
      clock.ticks.push(now); if (clock.ticks.length > 25) clock.ticks.shift();
      if (clock.ticks.length === 25 && now - lastBlink > 1000) {
        lastBlink = now;
        var bpm = 60000 / (clock.ticks[24] - clock.ticks[0]);
        var el = document.getElementById('lcdtempo'); if (el) el.textContent = '♩' + bpm.toFixed(1);
      }
    } else if (m[0] === 0xFA) { clock.n = 23; }
  }

  function onKey(e) {
    if (!A || A.S.page !== 'direct' || e.ctrlKey || e.metaKey || e.altKey) return false;
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return false;
    if (document.querySelector('.modal-back')) return false;
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    var sw = keyActions[k];
    if (sw) {
      var b = sw.querySelector('button.fsw');
      if (e.type === 'keydown' && !e.repeat && !b.disabled) {
        b.classList.add('down'); b.__press();
        if (b.__hold) b.__ht = setTimeout(function () { b.__ht = null; b.__hold(); }, HOLD_MS);
      }
      if (e.type === 'keyup') { b.classList.remove('down'); if (b.__ht) { clearTimeout(b.__ht); b.__ht = null; } }
      e.preventDefault(); return true;
    }
    if (e.type !== 'keydown') return false;
    var installedNow = installed(A.S.cur), conn = A.S.midi.connected;
    if (k === 'r' && conn && installedNow.rhy) { rhythm(); return true; }
    if (k === 'Enter' && conn && installedNow.tap) { tap(); return true; }
    if (k === 'f' && conn && installedNow.fx) { loopFx(); return true; }
    if (k === 'ArrowUp' || k === 'ArrowDown') { A.selectMemory(Math.max(0, Math.min(98, A.S.cur + (k === 'ArrowUp' ? 1 : -1)))); e.preventDefault(); return true; }
    return false;
  }
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKey);

  window.RCDirect = {
    page: function (api) { var r = page(api); if (!tempoTimer) restartTempo(); return r; },
    onMemory: function () { if (A) { resetSim(); restartTempo(); updateLights(); } },
    onMidi: onMidi,
    FUNCS: FUNCS
  };
})();
