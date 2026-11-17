/*
 * BOSS RC-500 Editor — parameter definitions.
 * Copyright (C) 2026 Jon Solberg — GPL-3.0-or-later (see LICENSE).
 *
 * Value tables follow the RC-500 Parameter Guide and the value encoding found by
 * D. Fleury's boss-rc500-editor (MIT licence, https://github.com/dfleury2/boss-rc500-editor).
 */
(function (root) {
  'use strict';

  function range(a, b, fmt) { var o = []; for (var i = a; i <= b; i++) o.push(fmt ? fmt(i) : String(i)); return o; }
  function opts(list) { return list.map(function (l, i) { return [i, l]; }); }


  var L = {
    offOn: ['Off', 'On'],
    pan: range(0, 100, function (i) { return i < 50 ? 'L' + (50 - i) : i > 50 ? 'R' + (i - 50) : 'Center'; }),
    start: ['Immediately', 'Fade in'],
    stop: ['Immediately', 'Fade out', 'At the loop end'],
    measure: ['Auto', 'Free', '16th note', '8th note', 'Quarter note', 'Dotted quarter', 'Half note', 'Dotted half']
      .concat(range(1, 16, function (i) { return i + (i === 1 ? ' measure' : ' measures'); })),
    input: ['All inputs', 'Mic', 'Instrument A+B', 'Instrument A', 'Instrument B', 'Mic + instrument'],
    output: ['Outputs A+B', 'Output A', 'Output B'],
    dubMode: ['Overdub', 'Replace'],
    recAction: ['Record, then overdub', 'Record, then play'],
    recSrc: ['All inputs', 'Mic', 'Instrument', 'Instrument A', 'Instrument B'],
    playMode: ['Together', 'One at a time'],
    singleChange: ['Immediately', 'At the loop end'],
    fadeTime: ['16th note', '8th note', 'Quarter note', 'Half note'].concat(range(1, 64, function (i) { return i + (i === 1 ? ' measure' : ' measures'); })),
    allStart: ['Both tracks', 'Track 1', 'Track 2'],
    trkChain: ['Parallel', 'Series'],
    trkSelect: ['Track 1', 'Track 2'],
    fxType: ['Scatter 1', 'Scatter 2', 'Scatter 3', 'Scatter 4', 'Repeat 1', 'Repeat 2', 'Repeat 3', 'Shift 1', 'Shift 2', 'Vinyl flick'],
    variation: ['A', 'B'],
    varChange: ['Next measure', 'At the loop end'],
    kit: ['Studio', 'Live', 'Light', 'Heavy', 'Rock', 'Metal', 'Jazz', 'Brush', 'Cajon', 'Drum&Bass', 'R&B', 'Dance', 'Techno', 'Dance Beats', 'HipHop', '808+909'],
    beat: range(2, 7, function (i) { return i + '/4'; }).concat(range(5, 15, function (i) { return i + '/8'; })),
    rhyStart: ['With the loop', 'After recording', 'Before recording'],
    rhyStop: ['Keeps playing', 'With the loop', 'After recording'],
    count: ['Off', '1 measure'],
    tone: range(-10, 10, function (i) { return i > 0 ? '+' + i : String(i); }),
    rhyState: ['Off', 'On (ready)'],
    pdlCtl: ['OFF', 'T1 REC/PLY', 'T1 R/P/S', 'T1 R/P/S(CLR)', 'T1 MOM R/P', 'T1 PLY/STP', 'T1 P/S(CLR)',
      'T1 STOP', 'T1 STOP(TAP)', 'T1 STOP(CLR)', 'T1 STOP(T/C)', 'T1 CLEAR', 'T1 UND/RED', 'T1 REVERSE',
      'T2 REC/PLY', 'T2 R/P/S', 'T2 R/P/S(CLR)', 'T2 MOM R/P', 'T2 PLY/STP', 'T2 P/S(CLR)', 'T2 STOP',
      'T2 STOP(TAP)', 'T2 STOP(CLR)', 'T2 STOP(T/C)', 'T2 CLEAR', 'T2 UND/RED', 'T2 REVERSE', 'TRK SELECT',
      'CUR REC/PLY', 'CUR R/P/S', 'CUR R/P/S(CLR)', 'CUR MOM R/P', 'CUR PLY/STP', 'CUR P/S(CLR)', 'CUR STOP',
      'CUR STP(TAP)', 'CUR STP(CLR)', 'CUR STP(T/C)', 'CUR CLEAR', 'CUR UND/RED', 'CUR REVERSE', 'UNDO/REDO',
      'ALL START', 'TAP TEMPO', 'LOOP FX', 'TR1 FX', 'TR2 FX', 'CUR TR FX', 'FX INC',
      'FX DEC', 'RHYTHM P/S', 'RHYTHM PLAY', 'RHYTHM STOP', 'MEMORY INC', 'MEMORY DEC', 'MIC MUTE',
      'EXTENT INC', 'EXTENT DEC'],
    exp: ['OFF', 'T1 LEVEL1', 'T1 LEVEL2', 'T2 LEVEL1', 'T2 LEVEL2', 'CUR LEVEL1', 'CUR LEVEL2', 'TEMPO UP', 'TEMPO DOWN',
      'FX CONTROL', 'RHYTHM LEV1', 'RHYTHM LEV2', 'MEMORY LEV1', 'MEMORY LEV2'],
    srcMode: ['MOMENT', 'TOGGLE'],
    contrast: range(1, 10),
    dispMode: ['Track status', 'Loop position', 'Position of both tracks', 'Status and position', 'Memory number and position', 'Memory name and position', 'Beat and position', 'Beat'],
    undoRedo: ['While holding the switch', 'When you let go'],
    extent: ['Range 1', 'Range 2', 'Range 3', 'Range 4', 'Range 5'],
    extVal: range(1, 99, function (i) { return (i < 10 ? '0' : '') + i; }),
    pref: ['Each memory', 'System (same in every memory)'],
    ch16: range(1, 16),
    txCh: range(1, 16).concat(['Same as receive channel']),
    syncClock: ['Auto (USB or MIDI IN if there is a clock)', 'Own tempo only', 'USB', 'MIDI IN jack'],
    syncStart: ['Nothing', 'Tracks and rhythm', 'Rhythm only'],
    thru: ['Nowhere', 'MIDI OUT jack', 'USB', 'MIDI OUT and USB'],
    micOut: ['Outputs A and B', 'Output A', 'Not heard'],
    instOut: ['Outputs A and B', 'Output A', 'Output B', 'Not heard'],
    rhyOut: ['Outputs A and B', 'Output A', 'Output B', 'Into the loop', 'Not heard'],
    peak: ['All inputs', 'Mic', 'Instrument', 'Loop and rhythm'],
    quantize: ['Off', 'To the measure']
  };

  var CCS = range(1, 31, function (i) { return 'CC#' + i; }).concat(range(64, 95, function (i) { return 'CC#' + i; }));
  L.assignSource = ['PEDAL1', 'PEDAL2', 'PEDAL3', 'EXP PEDAL', 'CTL1 PEDAL', 'CTL2 PEDAL', 'TR1 KNOB', 'TR2 KNOB',
    'TR1 PLY/STOP', 'TR2 PLY/STOP', 'CUR TR CHG', 'SYNC START'].concat(CCS);
  L.assignTarget = ['T1 REC/PLY', 'T1 PLY/STP', 'T1 CLEAR', 'T1 UND/RED', 'T1 REVERSE', 'T1 1SHOT', 'T1 LEVEL1', 'T1 LEVEL2',
    'T1 PAN', 'T1 START', 'T1 STOP', 'T1 LOOP.S', 'T1 TEMPO.S', 'T1 INPUT', 'T1 OUTPUT',
    'T2 REC/PLY', 'T2 PLY/STP', 'T2 CLEAR', 'T2 UND/RED', 'T2 REVERSE', 'T2 1SHOT', 'T2 LEVEL1', 'T2 LEVEL2',
    'T2 PAN', 'T2 START', 'T2 STOP', 'T2 LOOP.S', 'T2 TEMPO.S', 'T2 INPUT', 'T2 OUTPUT',
    'TRK SELECT', 'CUR REC/PLY', 'CUR PLY/STP', 'CUR CLEAR', 'CUR UND/RED', 'CUR REVERSE', 'CUR 1SHOT', 'CUR LEVEL1',
    'CUR LEVEL2', 'CUR PAN', 'CUR START', 'CUR STOP', 'CUR LOOP.S', 'CUR TEMPO.S', 'CUR INPUT', 'CUR OUTPUT',
    'UNDO/REDO', 'ALL START', 'TAP TEMPO', 'TEMPO UP', 'TEMPO DOWN', 'TEMPO', 'DUB MODE', 'REC ACTION',
    'AUTO REC', 'A.REC SENS', 'A.REC SRC', 'LOOP LENGTH', 'PLAY MODE', 'SINGL CHNGE', 'FADE TIME', 'ALL ST TRK',
    'TRK CHAIN', 'LOOP FX', 'TR1 FX', 'TR2 FX', 'CUR TR FX', 'FX TYPE', 'FX INC', 'FX DEC',
    'FX CONTROL', 'RHYTHM P/S', 'RHYTHM PLAY', 'RHYTHM STOP', 'RHYTHM LEV1', 'RHYTHM LEV2', 'RHY REVERB', 'RHY PATTERN',
    'VARIATION', 'VAR.CHANGE', 'KIT', 'RHY START', 'RHY STOP', 'REC COUNT', 'PLAY COUNT', 'RHY FILL',
    'RHY PART1', 'RHY PART2', 'RHY PART3', 'RHY PART4', 'TONE LOW', 'TONE HIGH', 'MEMORY INC', 'MEMORY DEC',
    'MEMORY LEV1', 'MEMORY LEV2'].concat(CCS);

  /** Index of the first "CC#" target. */
  var TARGET_CC0 = L.assignTarget.indexOf('CC#1');

  // Beat index -> [numerator, denominator]
  function beatOf(idx) { return idx <= 5 ? [idx + 2, 4] : [idx - 1, 8]; }

  var PATTERN_44 = ['SimpleBeat1', 'SimpleBeat2', 'SimpleBeat3', 'SimpleBeat4', 'GrooveBeat1', 'GrooveBeat2', 'GrooveBeat3',
    'GrooveBeat4', 'GrooveBeat5', 'GrooveBeat6', 'GrooveBeat7', 'Rock1', 'Rock2', 'Rock3', 'Rock4', 'Funk1', 'Funk2', 'Funk3',
    'Funk4', 'Shuffle1', 'Shuffle2', 'Shuffle3', 'Shuffle4', 'Shuffle5', 'Swing1', 'Swing2', 'Swing3', 'Swing4', 'Swing5',
    'SideStick1', 'SideStick2', 'SideStick3', 'SideStick4', 'SideStick5', 'PercusBeat1', 'PercusBeat2', 'PercusBeat3',
    'PercusBeat4', 'LatinBeat1', 'LatinBeat2', 'LatinBeat3', 'LatinBeat4', 'Conga1', 'Conga2', 'Conga3', 'Bossa1', 'Bossa2',
    'Samba1', 'Samba2', 'DanceBeat1', 'DanceBeat2', 'DanceBeat3', 'DanceBeat4', 'Metronome1', 'Metronome2', 'Metronome3',
    'Metronome4', 'Blank'];
  var PATTERN_X4 = ['SimpleBeat1', 'SimpleBeat2', 'Rock1', 'Rock2', 'Funk1', 'Shuffle1', 'Swing1', 'SideStick1', 'DanceBeat1',
    'Metronome1', 'Metronome2', 'Metronome3', 'Metronome4', 'Blank'];
  var PATTERN_X8 = ['SimpleBeat1', 'SimpleBeat2', 'Rock1', 'Rock2', 'Funk1', 'Shuffle1', 'Swing1', 'SideStick1', 'DanceBeat1',
    'Metronome1', 'Metronome2', 'Blank'];
  function patterns(beatIdx) {
    var b = beatOf(beatIdx);
    if (b[0] === 4 && b[1] === 4) return PATTERN_44;
    return b[1] === 4 ? PATTERN_X4 : PATTERN_X8;
  }

  // Loop FX lengths: stored value = note code (0 = THRU). Availability depends on the beat.
  function fxLengths(kind, beatIdx) {
    var b = beatOf(beatIdx), x = b[0], y = b[1];
    var items;
    if (kind === 'scatter') {
      items = [[0, true], [8, false], [7, false], [6, x === 2 || x === 4 || x === 8], [5, y === 8 && x % 3 === 0],
        [4, y === 4 || (y === 8 && (x === 8 || x === 10 || x === 14))], [3, true], [2, true]];
    } else if (kind === 'repeat') {
      items = [[0, true], [8, x === y], [7, x % 3 === 0 && x !== 9 && x !== 15], [6, x * 2 === y], [5, y === 8 && x % 3 === 0 && x > y],
        [4, y === 4], [3, true], [2, true], [1, true]];
    } else {
      items = [[0, true], [2, true], [3, true], [4, y === 4 || x === 8 || x === 10 || x === 14], [5, y === 8 && x % 3 === 0],
        [6, x === 2 || x === y], [7, x === 3 || x === 6 || x === 12], [8, x === y]];
    }
    return items.map(function (it) { return { value: it[0], label: it[0] ? noteName(it[0]) : 'Off (thru)', enabled: it[1] }; });
  }
  function noteName(code) { return ({ 1: '32nd note', 2: '16th note', 3: '8th note', 4: 'Quarter note', 5: 'Dotted quarter', 6: 'Half note', 7: 'Dotted half', 8: 'Whole note' })[code]; }
  function fxKind(type) { return type <= 3 ? 'scatter' : type <= 6 ? 'repeat' : type <= 8 ? 'shift' : 'vinyl'; }

  /**
   * Value labels for an ASSIGN target's MIN/MAX (stored as list index).
   * ctx: {beat, fxType}. Returns an array of labels, or null for "no range" (momentary actions).
   */
  function targetRange(t, ctx) {
    var name = L.assignTarget[t] || '';
    if (t >= TARGET_CC0) return range(0, 127);
    if (/REVERSE|1SHOT|LOOP\.S|TEMPO\.S|^AUTO REC$|^LOOP FX$|^TR[12] FX$|^CUR TR FX$|^RHY FILL$|^RHY PART/.test(name)) return L.offOn;
    if (/LEVEL[12]$|^RHYTHM LEV|^MEMORY LEV/.test(name)) return range(0, 200);
    if (/ PAN$/.test(name)) return L.pan;
    if (/ START$/.test(name) && name !== 'ALL START' && name !== 'RHY START') return L.start;
    if (/ STOP$/.test(name) && name !== 'RHYTHM STOP' && name !== 'RHY STOP') return L.stop;
    if (/ INPUT$/.test(name)) return L.input;
    if (/ OUTPUT$/.test(name)) return L.output;
    switch (name) {
      case 'TRK SELECT': return L.trkSelect;
      case 'TEMPO': return range(400, 3000, function (i) { return (i / 10).toFixed(1); });
      case 'DUB MODE': return L.dubMode;
      case 'REC ACTION': return L.recAction;
      case 'A.REC SENS': return range(1, 100);
      case 'A.REC SRC': return L.recSrc;
      case 'LOOP LENGTH': return ['Auto'].concat(range(1, 25362));
      case 'PLAY MODE': return L.playMode;
      case 'SINGL CHNGE': return L.singleChange;
      case 'FADE TIME': return L.fadeTime;
      case 'ALL ST TRK': return L.allStart;
      case 'TRK CHAIN': return L.trkChain;
      case 'FX TYPE': return L.fxType;
      case 'FX CONTROL':
        var k = fxKind(ctx.fxType);
        return k === 'vinyl' ? range(0, 100) : fxLengths(k, ctx.beat).map(function (o) { return o.label; });
      case 'RHY REVERB': return range(0, 100);
      case 'RHY PATTERN': return patterns(ctx.beat);
      case 'VARIATION': return L.variation;
      case 'VAR.CHANGE': return L.varChange;
      case 'KIT': return L.kit;
      case 'RHY START': return L.rhyStart;
      case 'RHY STOP': return L.rhyStop;
      case 'REC COUNT': case 'PLAY COUNT': return L.count;
      case 'TONE LOW': case 'TONE HIGH': return L.tone;
    }
    return null;
  }

  // Measure combo index <-> MeasMod / MeasLen / MeasBtLp (as the pedal stores them)
  function measureFields(idx) {
    if (idx === 0) return { MeasMod: 0, MeasLen: 0, MeasBtLp: 0 };
    if (idx === 1) return { MeasMod: 1, MeasLen: 0, MeasBtLp: 0 };
    if (idx <= 7) return { MeasMod: 2, MeasLen: 1, MeasBtLp: idx - 1 };
    return { MeasMod: 2, MeasLen: idx - 7, MeasBtLp: 0 };
  }

  root.RC500P = {
    L: L, opts: opts, range: range, beatOf: beatOf, patterns: patterns, fxLengths: fxLengths, fxKind: fxKind,
    targetRange: targetRange, measureFields: measureFields, TARGET_CC0: TARGET_CC0, noteName: noteName
  };
})(typeof window !== 'undefined' ? window : globalThis);
