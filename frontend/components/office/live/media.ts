import { AUDIO_FRAME, AUDIO_RATE, MEDIA_ID_LEN } from "./protocol";

/**
 * Voice and video without peer-to-peer connections: the mic is downsampled to
 * 16 kHz and µ-law encoded, the camera is sent as small JPEG snapshots, and
 * both go over the live socket for the API to relay. Works anywhere HTTPS does.
 */

/* ------------------------------- Frame format ------------------------------- */

/** browser → API: [kind][payload] */
export function pack(kind: number, payload: Uint8Array) {
  const out = new Uint8Array(1 + payload.length);
  out[0] = kind;
  out.set(payload, 1);
  return out;
}

/** API → browser: [kind][sender id][payload] */
export function unpack(buf: ArrayBuffer) {
  const b = new Uint8Array(buf);
  if (b.length < 1 + MEDIA_ID_LEN) return null;
  const id = String.fromCharCode(...b.subarray(1, 1 + MEDIA_ID_LEN)).trim();
  return { kind: b[0], id, payload: b.subarray(1 + MEDIA_ID_LEN) };
}

/* ---------------------------------- µ-law ---------------------------------- */

/** G.711 µ-law: 1 byte per sample, telephone-style quality, trivial to code. */
export function encodeMulaw(samples: Float32Array) {
  const out = new Uint8Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    let x = Math.round(Math.max(-1, Math.min(1, samples[i])) * 32635);
    const sign = x < 0 ? 0x80 : 0;
    if (sign) x = -x;
    x += 0x84;
    let exp = 7;
    for (let mask = 0x4000; (x & mask) === 0 && exp > 0; mask >>= 1) exp--;
    const mantissa = (x >> (exp + 3)) & 0x0f;
    out[i] = ~(sign | (exp << 4) | mantissa) & 0xff;
  }
  return out;
}

const MU_TABLE = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const u = ~i & 0xff;
    const exp = (u >> 4) & 7;
    const x = (((u & 0x0f) << 3) + 0x84) << exp;
    t[i] = ((u & 0x80 ? 0x84 - x : x - 0x84) / 32768);
  }
  return t;
})();

export function decodeMulaw(bytes: Uint8Array) {
  const out = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = MU_TABLE[bytes[i]];
  return out;
}

/* ------------------------------- Microphone -------------------------------- */

/** Runs on the audio thread: averages the mic down to 16 kHz and posts 20 ms frames. */
const WORKLET = `
class MicCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / ${AUDIO_RATE};
    this.pos = 0; this.acc = 0; this.cnt = 0;
    this.buf = new Float32Array(${AUDIO_FRAME}); this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i]; this.cnt++; this.pos++;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        this.buf[this.n++] = this.acc / this.cnt; this.acc = 0; this.cnt = 0;
        if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor("mic-capture", MicCapture);
`;

/** Quieter than this (RMS) counts as silence and isn't sent. */
const SILENCE = 0.006;
/** Keep sending this long after speech stops, so word endings aren't clipped. */
const HANGOVER_MS = 400;

/** Captures a mic stream as µ-law frames; silent stretches are skipped to save bandwidth. */
export class MicCapture {
  private ctx: AudioContext | null = null;
  private stopped = false;

  async start(stream: MediaStream, onFrame: (bytes: Uint8Array) => void) {
    const ctx = new AudioContext({ latencyHint: "interactive" });
    this.ctx = ctx;
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    if (this.stopped) return;
    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "mic-capture");
    let lastLoud = 0;
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const f = e.data;
      let sum = 0;
      for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
      const now = performance.now();
      if (Math.sqrt(sum / f.length) > SILENCE) lastLoud = now;
      if (now - lastLoud < HANGOVER_MS) onFrame(encodeMulaw(f));
    };
    // The worklet only runs while connected to the output: route it through a muted gain.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    src.connect(node).connect(mute).connect(ctx.destination);
  }

  stop() {
    this.stopped = true;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}

/* --------------------------------- Playback -------------------------------- */

/** Start this far ahead so small network hiccups don't cause gaps (seconds). */
const JITTER = 0.06;
/** Fell this far behind real time: skip ahead instead of lagging (seconds). */
const MAX_LAG = 0.25;

/**
 * Plays everyone's audio: a gain per speaker (for distance) and a small
 * jitter buffer so frames arriving a little late still play smoothly.
 */
export class VoicePlayer {
  private ctx: AudioContext | null = null;
  private voices = new Map<string, { gain: GainNode; next: number }>();
  /** When each speaker was last heard (performance.now()). */
  readonly heard = new Map<string, number>();

  /** Call from a click or key press: browsers only start audio after a gesture. */
  resume() {
    this.ctx ??= new AudioContext({ latencyHint: "interactive" });
    void this.ctx.resume().catch(() => {});
  }

  play(id: string, bytes: Uint8Array, volume: number) {
    const ctx = this.ctx;
    if (!ctx || volume <= 0 || !bytes.length) return;
    this.heard.set(id, performance.now());
    let v = this.voices.get(id);
    if (!v) {
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      v = { gain, next: 0 };
      this.voices.set(id, v);
    }
    v.gain.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
    const buf = ctx.createBuffer(1, bytes.length, AUDIO_RATE);
    buf.getChannelData(0).set(decodeMulaw(bytes));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(v.gain);
    const now = ctx.currentTime;
    if (v.next < now || v.next > now + MAX_LAG) v.next = now + JITTER;
    src.start(v.next);
    v.next += buf.duration;
  }

  forget(id: string) {
    this.voices.get(id)?.gain.disconnect();
    this.voices.delete(id);
    this.heard.delete(id);
  }

  close() {
    this.voices.clear();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}

/* ---------------------------------- Video ---------------------------------- */

export const VIDEO_W = 320;
export const VIDEO_H = 180;

/** Sends the camera as JPEG snapshots, a few per second. */
export class CameraCapture {
  private timer: ReturnType<typeof setInterval> | null = null;
  private video: HTMLVideoElement | null = null;

  start(stream: MediaStream, onFrame: (bytes: Uint8Array) => void, fps = 8) {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    void video.play().catch(() => {});
    this.video = video;
    const canvas = document.createElement("canvas");
    canvas.width = VIDEO_W;
    canvas.height = VIDEO_H;
    const g = canvas.getContext("2d");
    let busy = false;
    this.timer = setInterval(() => {
      if (!g || busy || video.readyState < 2 || !video.videoWidth) return;
      // Fill 16:9, cropping the middle of whatever the camera gives.
      const scale = Math.max(VIDEO_W / video.videoWidth, VIDEO_H / video.videoHeight);
      const sw = VIDEO_W / scale;
      const sh = VIDEO_H / scale;
      g.drawImage(video, (video.videoWidth - sw) / 2, (video.videoHeight - sh) / 2, sw, sh, 0, 0, VIDEO_W, VIDEO_H);
      busy = true;
      canvas.toBlob(
        (blob) => {
          busy = false;
          if (blob) void blob.arrayBuffer().then((a) => onFrame(new Uint8Array(a)));
        },
        "image/jpeg",
        0.6,
      );
    }, 1000 / fps);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.video) this.video.srcObject = null;
    this.video = null;
  }
}

/** The latest video snapshot from each person in the call, for their tiles. */
export class FrameStore {
  private frames = new Map<string, { url: string; at: number }>();
  private subs = new Map<string, Set<(url: string | null) => void>>();

  put(id: string, bytes: Uint8Array) {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/jpeg" }));
    const old = this.frames.get(id);
    this.frames.set(id, { url, at: Date.now() });
    this.subs.get(id)?.forEach((fn) => fn(url));
    // Give the <img> time to switch before the old picture is freed.
    if (old) setTimeout(() => URL.revokeObjectURL(old.url), 1000);
  }

  latest(id: string) {
    return this.frames.get(id) ?? null;
  }

  subscribe(id: string, fn: (url: string | null) => void) {
    if (!this.subs.has(id)) this.subs.set(id, new Set());
    this.subs.get(id)!.add(fn);
    return () => void this.subs.get(id)?.delete(fn);
  }

  clear() {
    for (const [id, f] of this.frames) {
      URL.revokeObjectURL(f.url);
      this.subs.get(id)?.forEach((fn) => fn(null));
    }
    this.frames.clear();
  }
}
