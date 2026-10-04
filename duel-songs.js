window.BD_SONGS = {
  "_about": "Bonk Duel background music: original loops in the style of each map's theme (no game audio is used). bpm = quarter notes per minute, div = steps per beat, spb = steps per bar. Notes are semitones above root; null = rest. chords/roots are per bar, relative to root.",
  "henesys": {
    "_style": "Floral Life feel: relaxed, sunny, ~80 BPM, D with a mixolydian D-C sway. Breathy flute, plucked guitar, pizzicato bass, soft shaker.",
    "bpm": 80, "div": 4, "spb": 16, "root": 62, "echoMix": 0.25,
    "lead": {"wave": "sine", "vol": 0.085, "vib": true, "legato": true, "atk": 0.045, "oct2": {"wave": "triangle", "vol": 0.02}},
    "mel": [12,null,null,null,14,null,16,null,19,null,null,null,16,null,14,null,
            12,null,null,null,10,null,7,null,10,null,12,null,14,null,null,null,
            16,null,14,null,12,null,14,16,19,null,null,null,21,null,19,null,
            17,null,null,null,16,null,14,null,12,null,null,null,null,null,null,null,
            17,null,19,null,21,null,19,null,17,null,16,null,14,null,12,null,
            16,null,null,null,12,null,14,null,16,null,19,null,16,null,null,null,
            14,null,12,null,10,null,12,null,14,null,16,17,19,null,null,null,
            21,null,null,null,19,null,16,null,14,null,null,null,null,null,null,null],
    "roots": [0,-2,0,-2,5,0,-2,7],
    "chords": [[0,4,7],[-2,2,5],[0,4,7],[-2,2,5],[5,9,12],[0,4,7],[-2,2,5],[7,11,14]],
    "layers": [
      {"type": "arp", "at": [0,2,4,6,8,10,12,14], "pattern": [[0,0],[1,0],[2,0],[1,12],[2,0],[1,0],[0,12],[2,0]], "wave": "triangle", "vol": 0.028, "oct": -12, "len": 3, "box": true},
      {"type": "bass", "at": {"0": 0, "6": 0, "8": 7, "14": 0}, "wave": "triangle", "vol": 0.09, "oct": -24, "len": 2.2, "box": true},
      {"type": "drum", "kind": "kick", "at": [0,8], "vol": 0.07},
      {"type": "drum", "kind": "snare", "at": [4,12], "vol": 0.025},
      {"type": "drum", "kind": "hat", "at": [0,2,4,6,8,10,12,14], "vol": 0.012}
    ]
  },
  "elnath": {
    "_style": "Snowy Village feel: wintry but warm and moving, B-flat major, ~126 BPM. Snow bells on the tune, string pad, pizzicato bass, sleigh shaker.",
    "bpm": 126, "div": 2, "spb": 8, "root": 70, "echoMix": 0.18,
    "lead": {"wave": "sine", "vol": 0.075, "box": true, "len": 3, "oct2": {"wave": "sine", "vol": 0.025}},
    "mel": [12,null,11,12,14,null,12,null,  9,null,null,null,7,null,9,null,  12,null,14,16,17,null,16,14,  14,null,null,null,null,null,null,null,
            12,null,11,12,14,null,16,null,  17,null,16,14,12,null,9,null,  11,null,12,14,14,null,11,null,  12,null,null,null,null,null,null,null],
    "roots": [0,-3,5,7,0,-3,7,0],
    "chords": [[0,4,7],[-3,0,4],[5,9,12],[7,11,14],[0,4,7],[-3,0,4],[7,11,14],[0,4,7]],
    "layers": [
      {"type": "chord", "at": [0], "wave": "triangle", "vol": 0.016, "oct": -12, "len": 8, "atk": 0.35},
      {"type": "bass", "at": {"0": 0, "4": 7}, "wave": "triangle", "vol": 0.08, "oct": -24, "len": 2, "box": true},
      {"type": "arp", "at": [2,6], "pattern": [[2,0],[1,12]], "wave": "sine", "vol": 0.02, "oct": 0, "len": 2, "box": true},
      {"type": "drum", "kind": "hat", "at": [0,1,2,3,4,5,6,7], "vol": 0.014},
      {"type": "drum", "kind": "kick", "at": [0,4], "vol": 0.05}
    ]
  },
  "zakum": {
    "_style": "Welcome To The Hell feel: slow (72 BPM), dark and heavy, full of cave sounds. Low drone, rumbles, war drums, brass hits, a lone low horn. D phrygian.",
    "bpm": 72, "div": 2, "spb": 8, "root": 50,
    "lead": {"wave": "sawtooth", "vol": 0.04, "legato": true, "atk": 0.08},
    "mel": [12,null,null,null,13,null,12,null,  10,null,null,null,null,null,null,null,  12,null,null,null,15,null,13,null,  12,null,null,null,null,null,null,null,
            17,null,null,null,15,null,13,null,  15,null,null,null,12,null,null,null,  10,null,12,null,13,null,10,null,  12,null,null,null,null,null,null,null],
    "roots": [0,0,1,0,0,0,-2,1],
    "chords": [[0,3,7],[0,3,7],[1,5,8],[0,3,7],[0,3,7],[0,3,7],[-2,2,5],[1,5,8]],
    "layers": [
      {"type": "bass", "at": {"0": 0}, "wave": "sawtooth", "vol": 0.05, "oct": -24, "len": 8, "atk": 0.3},
      {"type": "chord", "at": [0], "bars": [0,2,4,6], "wave": "sawtooth", "vol": 0.022, "oct": -12, "len": 1.6},
      {"type": "drum", "kind": "tom", "at": [0,3], "vol": 0.14},
      {"type": "drum", "kind": "tom", "at": [6], "vol": 0.08},
      {"type": "rumble", "bars": [0,4], "vol": 0.16}
    ]
  },
  "ludi": {
    "_style": "Fantastic Thinking feel: an energetic toy-box waltz (3/4), D major, ~106 BPM. Glockenspiel tune, oom-pah-pah bass and chords, clock tick-tock.",
    "bpm": 106, "div": 2, "spb": 6, "root": 62, "echoMix": 0.15,
    "lead": {"wave": "sine", "vol": 0.075, "box": true, "len": 2.5, "oct2": {"wave": "sine", "vol": 0.022}},
    "mel": [16,null,14,null,12,14,  16,null,11,null,null,null,  14,null,12,null,9,12,  14,null,7,null,null,null,
            12,16,19,null,21,19,  17,null,14,null,12,14,  16,null,14,null,11,null,  12,null,null,null,null,null],
    "roots": [0,7,9,5,0,5,7,0],
    "chords": [[0,4,7],[7,11,14],[9,12,16],[5,9,12],[0,4,7],[5,9,12],[7,11,14],[0,4,7]],
    "layers": [
      {"type": "bass", "at": {"0": 0}, "wave": "triangle", "vol": 0.08, "oct": -24, "len": 1.8},
      {"type": "chord", "at": [2,4], "wave": "triangle", "vol": 0.022, "oct": -12, "len": 0.8},
      {"type": "drum", "kind": "click", "at": [0,2,4], "vol": 0.025, "clock": true}
    ]
  },
  "sleepy": {
    "_style": "Sleepywood feel: slow and mysterious (~76 BPM), E minor with a dark leading note. Harp arpeggios, low strings, a lonely echoing flute, a wood knock now and then.",
    "bpm": 76, "div": 2, "spb": 8, "root": 64, "echoMix": 0.35,
    "lead": {"wave": "sine", "vol": 0.06, "vib": true, "legato": true, "atk": 0.06},
    "mel": [7,null,null,null,null,null,3,null,  0,null,null,null,null,null,null,null,  5,null,7,null,8,null,7,null,  11,null,null,null,null,null,null,null,
            7,null,null,null,12,null,10,null,  7,null,null,null,3,null,null,null,  5,null,3,null,0,null,null,null,  -1,null,null,null,null,null,null,null],
    "roots": [0,-4,5,7,0,-4,5,7],
    "chords": [[0,3,7],[-4,0,3],[5,8,12],[7,11,14],[0,3,7],[-4,0,3],[5,8,12],[7,11,14]],
    "layers": [
      {"type": "arp", "at": [0,1,2,3,4,5,6,7], "pattern": [[0,0],[1,0],[2,0],[0,12],[2,0],[1,0],[0,0],[1,0]], "wave": "triangle", "vol": 0.026, "oct": -12, "len": 3, "box": true},
      {"type": "chord", "at": [0], "wave": "triangle", "vol": 0.013, "oct": -12, "len": 8, "atk": 0.45},
      {"type": "bass", "at": {"0": 0}, "wave": "sine", "vol": 0.06, "oct": -24, "len": 8, "atk": 0.2},
      {"type": "drum", "kind": "click", "at": [0], "bars": [3,7], "vol": 0.02}
    ]
  }
};
