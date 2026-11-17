/*
 * BOSS RC-500 Editor — plain-language names for the pedal's own (abbreviated) names.
 * Copyright (C) 2026 Jon Solberg — GPL-3.0-or-later (see LICENSE).
 * The short names are what the pedal shows on its display and what the Parameter Guide uses.
 */
(function (root) {
  'use strict';

  var TRACK = { T1: 'Track 1', T2: 'Track 2', CUR: 'Current track' };
  var ACTION = {
    'REC/PLY': 'record → play/overdub (hold: undo)',
    'R/P/S': 'record/play, press twice to stop (hold: undo)',
    'R/P/S(CLR)': 'record/play, press twice to stop (hold: undo; hold when stopped: clear)',
    'MOM R/P': 'record/play only while held',
    'PLY/STP': 'play/stop',
    'P/S(CLR)': 'play/stop (hold when stopped: clear)',
    'STOP': 'stop',
    'STOP(TAP)': 'stop; tap tempo when stopped',
    'STOP(CLR)': 'stop (hold when stopped: clear)',
    'STOP(T/C)': 'stop; when stopped: tap tempo, hold to clear',
    'STP(TAP)': 'stop; tap tempo when stopped',
    'STP(CLR)': 'stop (hold when stopped: clear)',
    'STP(T/C)': 'stop; when stopped: tap tempo, hold to clear',
    'CLEAR': 'clear (erase the phrase)',
    'UND/RED': 'undo/redo the last recording',
    'REVERSE': 'reverse playback on/off',
    '1SHOT': 'one-shot on/off',
    'LEVEL1': 'level (0–200)',
    'LEVEL2': 'level (0 up to its set level)',
    'LEVEL 1': 'level (0–200)',
    'LEVEL 2': 'level (0 up to its set level)',
    'PAN': 'pan',
    'START': 'start mode (immediately / fade in)',
    'START ': 'start mode',
    'LOOP.S': 'loop sync on/off',
    'TEMPO.S': 'tempo sync on/off',
    'INPUT': 'recording input',
    'OUTPUT': 'output jacks'
  };
  var OTHER = {
    'OFF': 'Nothing',
    'TRK SELECT': 'Switch between track 1 and 2 (hold: both)',
    'UNDO/REDO': 'Undo/redo the last recording',
    'ALL START': 'Start both tracks',
    'TAP TEMPO': 'Tap tempo',
    'TEMPO UP': 'Tempo faster',
    'TEMPO DOWN': 'Tempo slower',
    'TEMPO': 'Tempo',
    'LOOP FX': 'Loop FX on/off',
    'TR1 FX': 'Loop FX on track 1 on/off',
    'TR2 FX': 'Loop FX on track 2 on/off',
    'CUR TR FX': 'Loop FX on the current track on/off',
    'FX INC': 'Next loop FX type',
    'FX DEC': 'Previous loop FX type',
    'FX TYPE': 'Loop FX type',
    'FX CONTROL': 'Loop FX amount (length / flick)',
    'RHYTHM P/S': 'Rhythm play/stop',
    'RHYTHM PLAY': 'Rhythm play',
    'RHYTHM STOP': 'Rhythm stop',
    'RHYTHM LEV1': 'Rhythm level (0–200)',
    'RHYTHM LEV2': 'Rhythm level (0 up to its set level)',
    'MEMORY INC': 'Next memory',
    'MEMORY DEC': 'Previous memory',
    'MEMORY LEV1': 'Memory level (0–200)',
    'MEMORY LEV2': 'Memory level (0 up to its set level)',
    'MIC MUTE': 'Mute the microphone',
    'EXTENT INC': 'Next memory range',
    'EXTENT DEC': 'Previous memory range',
    'DUB MODE': 'Overdub or replace',
    'REC ACTION': 'Order of record/play/overdub',
    'AUTO REC': 'Auto record on/off',
    'A.REC SENS': 'Auto record sensitivity',
    'A.REC SRC': 'Auto record input',
    'LOOP LENGTH': 'Loop length',
    'PLAY MODE': 'Play mode (both tracks / one at a time)',
    'SINGL CHNGE': 'When to switch track in single mode',
    'FADE TIME': 'Fade time',
    'ALL ST TRK': 'Tracks started by MIDI start',
    'TRK CHAIN': 'Tracks in parallel or series',
    'RHY REVERB': 'Rhythm reverb',
    'RHY PATTERN': 'Rhythm pattern',
    'VARIATION': 'Rhythm variation A/B',
    'VAR.CHANGE': 'When the variation changes',
    'KIT': 'Drum kit',
    'RHY START': 'How the rhythm starts',
    'RHY STOP': 'How the rhythm stops',
    'REC COUNT': 'Count-in before recording',
    'PLAY COUNT': 'Count-in before playing',
    'RHY FILL': 'Rhythm fill-in on/off',
    'RHY PART1': 'Drum part 1 on/off', 'RHY PART2': 'Drum part 2 on/off', 'RHY PART3': 'Drum part 3 on/off', 'RHY PART4': 'Drum part 4 on/off',
    'TONE LOW': 'Rhythm bass tone', 'TONE HIGH': 'Rhythm treble tone',
    // assign sources
    'PEDAL1': 'REC/PLAY switch', 'PEDAL2': 'STOP switch', 'PEDAL3': 'TRACK SELECT switch',
    'EXP PEDAL': 'Expression pedal', 'CTL1 PEDAL': 'Footswitch CTL1', 'CTL2 PEDAL': 'Footswitch CTL2',
    'TR1 KNOB': 'TRACK 1 slider', 'TR2 KNOB': 'TRACK 2 slider',
    'TR1 PLY/STOP': 'When track 1 starts/stops', 'TR2 PLY/STOP': 'When track 2 starts/stops',
    'CUR TR CHG': 'When the current track changes', 'SYNC START': 'MIDI start from another device'
  };

  /** Plain description for one of the pedal's short names. */
  function plain(code, ctx) {
    if (OTHER[code]) return OTHER[code];
    var m = /^CC#(\d+)$/.exec(code);
    if (m) return ctx === 'source' ? 'MIDI CC#' + m[1] : 'Send MIDI CC#' + m[1];
    m = /^(T1|T2|CUR) (.+)$/.exec(code);
    if (m && ctx === 'target' && m[2] === 'STOP') return TRACK[m[1]] + ': stop mode (immediately / fade out / at the end of the loop)';
    if (m && ACTION[m[2]]) return TRACK[m[1]] + ': ' + ACTION[m[2]];
    return code;
  }

  /** [value, label] options in plain words. */
  function options(list, ctx) {
    return list.map(function (code, i) { return [i, plain(code, ctx)]; });
  }

  root.RCNames = { plain: plain, options: options };
})(typeof window !== 'undefined' ? window : globalThis);
