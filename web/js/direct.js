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
    var ticks = h('div', { class: 'vticks' }); for (var i = 0; i < 7; i++) ticks.appendChild(h('i'));
    var track = h('div', { class: 'vtrack' + (enabled ? '' : ' dis'), title: enabled ? 'Track ' + t + ' level' : 'Set up Direct mode to use the slider' }, ticks, h('div', { class: 'vgroove' }), thumb);
    function place(v) { thumb.style.bottom = 'calc(' + (v / 200 * 100) + '% - ' + (v / 200 * 30) + 'px)'; }
    place(val);
    var lastCc = -1;
    function setFromY(y) {
      var r = track.getBoundingClientRect();
      var v = Math.round(Math.max(0, Math.min(1, (r.bottom - y - 15) / (r.height - 30))) * 200);
      sim.lvl[t] = v; place(v);
      var c = Math.round(v * 127 / 200);
      if (c !== lastCc) { lastCc = c; cc(fn('lvl' + t).cc, c); }
      out.textContent = v;
    }
    var out = h('span', { class: 'vval' }, String(val));
    if (enabled) {
      track.addEventListener('pointerdown', function (e) { track.setPointerCapture(e.pointerId); setFromY(e.clientY); e.preventDefault(); });
      track.addEventListener('pointermove', function (e) { if (track.hasPointerCapture(e.pointerId)) setFromY(e.clientY); });
      track.addEventListener('wheel', function (e) { e.preventDefault(); var v = Math.max(0, Math.min(200, sim.lvl[t] + (e.deltaY < 0 ? 5 : -5))); var r = track.getBoundingClientRect(); setFromY(r.bottom - 15 - v / 200 * (r.height - 30)); }, { passive: false });
    }
    out.className = 'vval'; return h('div', { class: 'vslider' }, track);
  }

  function knob(onStep, title) {
    var h = A.h;
    var cap = h('div', { class: 'knobcap' }, h('span', { class: 'knobshine' }));
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

  /** A footswitch: action on press (timing matters for loop points), optional hold action.
      The whole area around the small metal switch reacts, so it is easy to hit on a phone. */
  function footswitch(label, enabled, onPress, onHold, keyHint, ledId, ledCls) {
    var h = A.h;
    var holdTimer = null;
    var cap = h('span', { class: 'stomp' });
    var sw = h('button', { class: 'fsw', disabled: !enabled, title: keyHint ? 'Key: ' + keyHint : '' },
      h('span', { class: 'fswlabel' }, label), h('span', { id: ledId, class: 'pill ' + (ledCls || '') }), cap);
    sw.addEventListener('pointerdown', function (e) {
      if (e.button) return;
      sw.classList.add('down'); onPress();
      if (onHold) holdTimer = setTimeout(function () { holdTimer = null; onHold(); }, HOLD_MS);
    });
    var up = function () { sw.classList.remove('down'); if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } };
    sw.addEventListener('pointerup', up); sw.addEventListener('pointerleave', up); sw.addEventListener('pointercancel', up);
    sw.__press = onPress; sw.__hold = onHold;
    return h('div', { class: 'fswwrap' }, sw);
  }

  function nameRows() { var n = A.RC0.memName(A.blk()); return [n.slice(0, 6), n.slice(6, 12)]; }
  function recLed() { var st = sim.tr[sim.cur].st; return st === 'rec' ? 'red' : st === 'play' ? 'green' : st === 'dub' ? 'yellow' : 'white'; }

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
    var nm = nameRows(); document.getElementById('lcdn1').textContent = nm[0]; document.getElementById('lcdn2').textContent = nm[1];
    var rl = document.getElementById('recled'); if (rl) rl.className = 'pill ' + recLed();
    var te = document.getElementById('lcdtempo'); if (te && (A.S.midi.clockRunning || performance.now() - clock.last > 1500)) te.textContent = '♩' + shownTempo().toFixed(1);
    var cs = document.getElementById('clockstrip'); if (cs) cs.classList.toggle('on', !!A.S.midi.clockRunning);
    [1, 2].forEach(function (t) {
      var l = document.querySelector('[data-tled="' + t + '"]');
      if (l) l.className = 'led sm ' + stColor(sim.tr[t].st) + (sim.cur === t ? ' blink' : '');
    });
    var r = document.getElementById('rhyled'); if (r) r.className = 'led xs ' + (sim.rhythm === 'on' ? 'green' : sim.rhythm === 'ready' ? 'green blink' : '');
    var f = document.getElementById('fxbtn'); if (f) f.classList.toggle('on', sim.fx);
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
    var nm = nameRows();
    // Positions are in panel pixels (920 × 714), measured from the real pedal's top panel.
    function at(x, y, el) { el.style.left = x + 'px'; el.style.top = y + 'px'; return el; }
    function label(x, y, text, cls) { return at(x, y, h('span', { class: 'plabel ' + (cls || '') }, text)); }
    function sqbtn(x, y, text, enabled, onclick, title) {
      return [label(x, 308, text), at(x, y, h('button', { class: 'sq', disabled: !enabled, title: title || text, onclick: onclick }))];
    }
    var rhyLed = sim.rhythm === 'on' ? 'green' : sim.rhythm === 'ready' ? 'green blink' : '';

    var rec = footswitch('REC/PLAY', ok('rec'), function () { press(fn('rec')); recPlay(); updateLights(); setTimeout(function () { release(fn('rec')); }, 60); },
      have.undo ? function () { press(fn('undo')); setTimeout(function () { release(fn('undo')); }, 60); A.toast('Undo/redo'); } : null, 'Space', 'recled', recLed());
    var stop = footswitch('STOP', ok('stop'), function () { press(fn('stop')); stopTrack(); updateLights(); setTimeout(function () { release(fn('stop')); }, 60); },
      have.clear ? function () { press(fn('clear')); setTimeout(function () { release(fn('clear')); }, 60); sim.tr[sim.cur].st = 'empty'; updateLights(); A.toast('Track ' + sim.cur + ' cleared'); } : null, 'S (hold: clear)', 'stopled', 'white');
    var sel = footswitch('TRACK\nSELECT', ok('trk'), function () { sim.cur = 3 - sim.cur; cc(fn('trk').cc, sim.cur === 2 ? 127 : 0); updateLights(); }, null, 'T', 'trkled', 'red');
    keyActions = { ' ': rec, s: stop, t: sel };

    var panel = h('div', { class: 'rcpanel' },
      // jacks along the top edge
      [144, 393, 473, 560, 660].map(function (x) { return at(x, -14, h('span', { class: 'jack' })); }),
      at(887, 40, h('div', { class: 'logo' }, h('span', { class: 'ls' }, 'LOOP STATION'), h('span', { class: 'mdl' }, 'RC-500'))),
      // track sliders
      at(116, 164, vslider(1, ok('lvl1'))), at(211, 164, vslider(2, ok('lvl2'))),
      label(117, 269, '1'), label(164, 269, 'TRACK'), label(211, 269, '2'),
      at(117, 289, h('span', { class: 'led sm ' + stColor(sim.tr[1].st) + (sim.cur === 1 ? ' blink' : ''), 'data-tled': 1 })),
      at(211, 289, h('span', { class: 'led sm ' + stColor(sim.tr[2].st) + (sim.cur === 2 ? ' blink' : ''), 'data-tled': 2 })),
      [1, 2].map(function (t) {
        return sqbtn(t === 1 ? 117 : 211, 340, 'EDIT', ok('trk'), function () { sim.cur = t; cc(fn('trk').cc, t === 2 ? 127 : 0); updateLights(); }, 'Make track ' + t + ' the current track');
      }),
      at(263, 237, h('span', { class: 'vline' })), at(731, 237, h('span', { class: 'vline' })),
      // display
      at(439, 174, h('div', { class: 'lcdframe' },
        h('div', { id: 'lcd', class: 'lcd ' + stColor(overall()) },
          h('span', { id: 'lcdno', class: 'lcdno' }, A.pad2(mi + 1)),
          h('span', { class: 'lcdname' }, h('span', { id: 'lcdn1' }, nm[0]), h('span', { id: 'lcdn2' }, nm[1]))),
        h('div', { class: 'lcdinfo' }, h('span', { id: 'lcdstate' }, 'TRK' + sim.cur + (stateText ? ' ' + stateText : '')),
          h('span', { id: 'lcdtempo' }, '♩' + shownTempo().toFixed(1)), h('span', null, bt[0] + '/' + bt[1])))),
      // MEMORY/VALUE and MIC LEVEL
      label(647, 103, 'MEMORY/\nVALUE'),
      at(647, 168, knob(function (d) {
        var n = Math.max(0, Math.min(98, A.S.cur + d));
        if (n !== A.S.cur) { A.selectMemory(n, false, true); updateLights(); }
      }, 'MEMORY/VALUE: turn to change memory')),
      label(796, 113, 'MIC LEVEL'),
      at(796, 168, h('div', { class: 'miclevel', title: 'MIC LEVEL (only on the pedal)' }, h('span', { class: 'micmark' }), h('span', { class: 'mtick l' }), h('span', { class: 'mtick r' }))),
      at(797, 287, h('span', { class: 'led xs' })),
      sqbtn(796, 340, 'INPUT', false, null, 'INPUT (only on the pedal)'),
      // rhythm + menu buttons
      label(343, 269, 'RHYTHM'),
      at(305, 287, h('span', { class: 'led xs red tempoled' })),
      at(381, 287, h('span', { id: 'rhyled', class: 'led xs ' + rhyLed })),
      sqbtn(305, 340, 'TEMPO', conn, tap, 'Tap the tempo (key: Enter). The editor sends it to the pedal as MIDI clock.'),
      sqbtn(381, 340, 'ON/OFF', ok('rhy'), rhythm, 'Rhythm play/stop (key: R)'),
      sqbtn(457, 340, 'MEMORY', true, function () { A.go('memory'); }, 'Edit this memory'),
      sqbtn(533, 340, 'MENU', true, function () { A.go('system'); }, 'System settings'),
      label(647, 281, 'WRITE'), at(647, 296, h('span', { class: 'hline' })),
      sqbtn(609, 340, 'EXIT', false, null, 'EXIT (only on the pedal)'),
      sqbtn(685, 340, 'ENTER', false, null, 'ENTER (only on the pedal)'),
      at(460, 420, h('span', { class: 'seam' })),
      // footswitches
      at(108, 572, rec), at(456, 572, stop), at(807, 572, sel));
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
        have.fx ? h('button', { id: 'fxbtn', class: sim.fx ? 'on' : '', disabled: !conn, onclick: loopFx, title: 'Loop FX on/off (key: F)' }, 'LOOP FX') : null,
        h('button', { onclick: setupDialog }, 'Set up memories…'),
        h('button', { onclick: function () { resetSim(); A.render(); }, title: 'Reset the lights to the memory’s saved state' }, '↺ Lights'))),
    notes, wrap, clockStrip(conn),
    h('p', { class: 'info keyhelp' }, 'Keys: Space = REC/PLAY (hold: undo), S = STOP (hold: clear), T = TRACK SELECT, R = rhythm, Enter = tap tempo, F = loop FX, ↑/↓ = memory. ' +
      'The pedal doesn’t report its track states, so the lights follow your presses here; use ↺ Lights if they get out of step.')];
  }

  // ------------------------------------------------------------------ tempo: MIDI clock from the editor
  var clockBpm = null, taps = [];
  function shownTempo() { return A.S.midi.clockRunning ? clockBpm : sim.tempo; }
  function setClock(bpm, start) {
    clockBpm = Math.round(Math.max(40, Math.min(300, bpm)) * 10) / 10;
    var m = A.S.midi;
    try {
      if (m.clockRunning) m.clockSet(clockBpm);
      else if (start && m.connected) m.clockStart(clockBpm, blink);
    } catch (e) { A.toast(e.message, 'err'); }
    var inp = document.getElementById('clockbpm'); if (inp && document.activeElement !== inp) inp.value = clockBpm.toFixed(1);
    updateLights();
  }
  function tap() {
    var now = performance.now();
    taps = taps.filter(function (t) { return now - t < 2500; }); taps.push(now);
    blink();
    if (taps.length >= 2) setClock(60000 / ((now - taps[0]) / (taps.length - 1)), true);
  }
  function clockStrip(conn) {
    var h = A.h, m = A.S.midi;
    if (clockBpm === null) clockBpm = sim.tempo;
    var inp = h('input', { id: 'clockbpm', type: 'number', min: 40, max: 300, step: 0.5, value: clockBpm.toFixed(1),
      onchange: function () { var v = parseFloat(inp.value); if (!isNaN(v)) setClock(v, false); } });
    return h('div', { id: 'clockstrip', class: 'clockstrip' + (m.clockRunning ? ' on' : '') },
      h('span', { class: 'clabel' }, 'Tempo to the pedal'),
      h('button', { class: 'small', onclick: function () { setClock(clockBpm - 1, false); } }, '−'), inp,
      h('button', { class: 'small', onclick: function () { setClock(clockBpm + 1, false); } }, '+'), h('span', { class: 'note' }, 'BPM'),
      h('button', { class: 'small', title: 'Use this memory’s saved tempo', onclick: function () { setClock(sim.tempo, false); } }, 'Memory tempo'),
      h('button', {
        id: 'clockbtn', class: m.clockRunning ? 'primary' : '', disabled: !conn, onclick: function () {
          if (m.clockRunning) m.clockStop(); else setClock(clockBpm, true);
          A.render();
        }
      }, m.clockRunning ? '■ Stop clock' : '▶ Send clock'),
      h('span', { class: 'note' }, 'The pedal follows the clock while it runs (SYSTEM › MIDI › Sync clock: AUTO or USB). Tap TEMPO to set it.'));
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
    var w = wrap.clientWidth || 900, s = Math.min(1.2, w / 920, Math.max(0.45, (window.innerHeight - 190) / 714));
    panel.style.transform = 'scale(' + s + ')';
    wrap.style.height = Math.ceil(panel.offsetHeight * s) + 'px';
  }
  window.addEventListener('resize', function () { var w = document.querySelector('.rcwrap'), p = document.querySelector('.rcpanel'); if (w && p) fit(w, p); });

  // Tempo LED: follows MIDI clock from the pedal when it sends it, otherwise the memory tempo.
  function blink() { var el = document.querySelector('.tempoled'); if (!el) return; el.classList.add('on'); setTimeout(function () { el.classList.remove('on'); }, 90); }
  function restartTempo() {
    if (tempoTimer) clearInterval(tempoTimer);
    tempoTimer = setInterval(function () { if (A.S.midi.clockRunning || performance.now() - clock.last < 600) return; blink(); }, 60000 / ((sim && sim.tempo) || 120));
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
    if (k === 'Enter' && conn) { tap(); return true; }
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
