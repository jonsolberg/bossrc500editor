# BOSS RC-500 Editor (web + Android)

An editor for the **BOSS RC-500 Loop Station** that talks to the pedal through its own USB port —
no BOSS TONE STUDIO needed. Use it in the browser or as a standalone Android app.

**[Open the web version](https://jonsolberg.github.io/bossrc500editor/)** ·
**[Download the Android APK](https://github.com/jonsolberg/bossrc500editor/releases/latest/download/RC500Editor.apk)** ·
[all releases](https://github.com/jonsolberg/bossrc500editor/releases)

> ⚠️ Not affiliated with BOSS/Roland. Make a backup (the ⬇ Backup button) before you save to the pedal.

## Features

- **Direct mode**: play the pedal live from an on-screen copy of its panel — REC/PLAY, STOP and TRACK SELECT
  footswitches (hold REC/PLAY to undo, hold STOP to clear), TRACK 1/2 level sliders with status lights, the colour
  display, rhythm ON/OFF and TEMPO, LOOP FX and the MEMORY/VALUE knob. Keyboard shortcuts on a computer
  (Space, S, T, R, F, ↑/↓). The RC-500 only reacts to MIDI CC through a memory's ASSIGNs, so *Set up memories*
  adds the needed ASSIGNs (CC#80–89, see below) to the memories you choose; then save them to the pedal
- **All 99 memories**: name, both tracks (level, pan, reverse, 1-shot, loop FX, start/stop, measure, loop/tempo sync,
  input/output), record (dub mode, rec action, quantize, auto rec, loop length), play (tempo with tap, play mode,
  fade time, track chain …), Loop FX (type and beat-aware lengths), rhythm (pattern per time signature, kit,
  variation, start/stop, count-ins, fill, parts, tone), pedal/CTL/EXP functions and **ASSIGN 1–8** with target-aware
  min/max values
- **System settings**: display, undo/redo, preferences, system pedal functions, MIDI, extents, input/output
- An "all values" view of every field stored in the files, for anything without its own control
- Copy a memory to a range (choose which parts), copy/paste, swap, initialize; undo/redo
- Presets: save a memory as a `.rc500.json` file and load it into any memory
- **Loops**: see which memories have recorded phrases, play them, export them as WAV, import any audio file
  (WAV/MP3/M4A … converted to the RC-500 format, 44.1 kHz 32-bit float stereo) or delete them
- **Remote over USB MIDI**: switch memories (program change), start/stop, play the CC numbers used by the memory's
  ASSIGNs (momentary/toggle + sliders), send any CC, MIDI monitor, follow the pedal's memory changes
- **Storage mode from the app**: the same SysEx that BOSS TONE STUDIO for RC sends turns the pedal's USB drive on/off,
  so you don't have to go through MENU › STORAGE on the pedal
- Backup of `ROLAND/DATA` as a ZIP; light/dark theme

## How it works

The RC-500 has one USB port that carries both **USB MIDI** and, in storage mode, a **USB drive**
(`BOSS RC-500`) with `ROLAND/DATA/MEMORY1.RC0`, `MEMORY2.RC0`, `SYSTEM1.RC0`, `SYSTEM2.RC0` and the recorded
phrases in `ROLAND/WAVE/<memory>_<track>/`. The pedal keeps two copies of each data file and loads the one with
the higher save counter (the last 4 bytes). The editor reads the newest copy and saves to the *other* one with a
higher counter, so the previous version stays on the pedal as a fallback. Unchanged files are written back byte for
byte identical.

| | Read pedal | Write pedal | USB MIDI |
|---|---|---|---|
| Chrome / Edge / Opera (desktop, https) | ✅ | ✅ directly | ✅ |
| Firefox (https) | ✅ (folder upload) | downloads the changed files to copy into `ROLAND/DATA` | ✅ (asks for permission) |
| Android app | ✅ | ✅ directly | ✅ |

Web MIDI and direct writing only work on secure (https) pages, so use the GitHub Pages link above.

### Direct mode CC numbers

| CC# | ASSIGN target | Panel control |
|---|---|---|
| 80 | CUR REC/PLY | REC/PLAY switch |
| 81 | CUR PLY/STP | STOP switch |
| 82 | TRK SELECT (0 = track 1, 127 = track 2) | TRACK SELECT switch, EDIT buttons |
| 83 / 84 | T1 / T2 LEVEL1 (0–200) | TRACK 1 / TRACK 2 sliders |
| 85 | RHYTHM P/S | Rhythm ON/OFF |
| 86 | CUR CLEAR | hold STOP |
| 87 | UNDO/REDO | hold REC/PLAY |
| 88 | TAP TEMPO (optional) | TEMPO |
| 89 | LOOP FX (optional) | LOOP FX |

Messages go out on the pedal's RX CTL channel (SYSTEM › MIDI). Memories are selected with program change, and
MIDI Start/Stop start and stop everything. The pedal doesn't report its track states over MIDI, so the lights on
screen follow your presses.

### Using it

1. Connect the RC-500 with a USB cable that carries data (on a phone: USB-C/OTG).
2. **Remote › Enter storage mode** (or MENU › STORAGE › CONNECT on the pedal).
3. **Open pedal** and pick the `BOSS RC-500` drive or its `ROLAND` folder.
4. Edit, then **Save**.
5. Eject the drive (desktop) and **Leave storage mode** — the pedal reloads its memories.

## Building

- **Web**: plain HTML/CSS/JS in [`web/`](web), no build step. Open `web/index.html` or serve the folder.
  The `pages` workflow publishes it to GitHub Pages.
- **Android**: the app bundles `web/` as its assets and adds a native bridge (`MainActivity.java`) for USB MIDI
  (`android.media.midi`) and the USB drive (Storage Access Framework). Push to GitHub — the `build` workflow
  builds a signed APK and publishes it as a release. Or open the folder in Android Studio.

## Credits

The RC-500 file format, the value encoding and the storage-mode SysEx were worked out by D. Fleury in
[boss-rc500-editor](https://github.com/dfleury2/boss-rc500-editor) (MIT licence, © 2022 D. Fleury), which this
project started from. Parameter descriptions follow the BOSS RC-500 Parameter Guide.

## Support

The editor is free, open source and has no ads. If you find it useful, you can
[buy me a beer on Ko-fi](https://ko-fi.com/jonsolberg) 🍺

[![Buy me a beer on Ko-fi](https://img.shields.io/badge/Ko--fi-buy%20me%20a%20beer-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/jonsolberg)

## License

Copyright © 2026 Jon Solberg

This program is free software: you can redistribute it and/or modify it under the terms of the
GNU General Public License as published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
[GNU General Public License](LICENSE) for more details.
