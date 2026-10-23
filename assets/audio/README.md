# Sleep audio assets

The site works without any files in this folder: every sound has a procedural
Web Audio fallback (see `src/audio/synth.js`).

To use real recordings, add them here and register them in `manifest.json`.

## manifest.json

```json
{
  "version": 1,
  "basePath": "./",
  "sounds": {
    "rain": { "src": "rain.ogg", "loop": true, "trim": 1 },
    "ocean": { "src": "ocean.ogg", "loop": true },
    "forest": { "src": "forest.ogg", "loop": true },
    "fireplace": { "src": "fireplace.ogg", "loop": true },
    "white-noise": { "src": "white-noise.ogg", "loop": true },
    "soft-music": { "src": "soft-music.ogg", "loop": true }
  }
}
```

- Keys are sound ids from `src/audio/catalog.js`.
- `src` is resolved relative to this manifest, so plain filenames are fine.
- `loop` defaults to `true`; `trim` is an extra gain applied to the file.
- If a file is missing or cannot be decoded, that sound silently falls back to
  its synth version and the user sees a small notice. Nothing breaks.

## Recommended format

- OGG Vorbis or MP3, 44.1 kHz, stereo.
- Seamless loop, 20–60 seconds, no leading/trailing silence.
- Normalize to roughly -18 LUFS so the mixer stays balanced.
- Keep files under ~2 MB each; GitHub Pages serves them as static files.

The AI voice channel (next phase) should stream or generate a clip and call
`audioEngine.playGuidance({ url })` / `{ buffer }` instead of adding files here.
Files placed in `assets/audio/voice/` can be used as a temporary stand-in.
