/**
 * Audio asset loading.
 *
 * The site ships without audio files on purpose: all core sounds have a
 * procedural fallback. To use real recordings, drop files into
 * apps/web/assets/audio/ and register them in assets/audio/manifest.json.
 *
 * manifest.json
 * {
 *   "version": 1,
 *   "sounds": {
 *     "rain": { "src": "rain.ogg", "loop": true, "trim": 1 }
 *   }
 * }
 *
 * `src` is resolved relative to manifest.json. Any entry that fails to load
 * falls back to the synth version of the same sound without breaking the app.
 */

const DEFAULT_MANIFEST_URL = new URL("../../assets/audio/manifest.json", import.meta.url);

let manifestPromise = null;

export function loadManifest(url = DEFAULT_MANIFEST_URL) {
  if (manifestPromise) return manifestPromise;

  manifestPromise = (async () => {
    try {
      const response = await fetch(url, { cache: "no-cache" });
      if (!response.ok) {
        return { status: "missing", baseUrl: new URL(".", url), sounds: {} };
      }
      const data = await response.json();
      const baseUrl = new URL(data?.basePath || "./", url);
      return {
        status: Object.keys(data?.sounds ?? {}).length > 0 ? "loaded" : "empty",
        baseUrl,
        sounds: data?.sounds ?? {},
        raw: data,
      };
    } catch {
      return { status: "missing", baseUrl: new URL(".", url), sounds: {} };
    }
  })();

  return manifestPromise;
}

export async function createFileLayer(ctx, entry, baseUrl) {
  if (!entry?.src) throw new Error("Missing audio source");

  const sourceUrl = new URL(entry.src, baseUrl).href;
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`Audio request failed with ${response.status}`);

  const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
  const output = ctx.createGain();
  output.gain.value = Number.isFinite(entry.trim) ? entry.trim : 1;

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = entry.loop !== false;
  source.connect(output);

  return {
    kind: "file",
    output,
    duration: buffer.duration,
    start() {
      source.start();
    },
    stop() {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
      try {
        source.disconnect();
      } catch {
        /* already disconnected */
      }
      try {
        output.disconnect();
      } catch {
        /* already disconnected */
      }
    },
  };
}

export { DEFAULT_MANIFEST_URL };
