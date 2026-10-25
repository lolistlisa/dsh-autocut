import argparse
import json
import wave
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument("wav")
parser.add_argument("alignment")
parser.add_argument("output")
args = parser.parse_args()
with wave.open(args.wav, "rb") as handle:
    rate = handle.getframerate()
    channels = handle.getnchannels()
    width = handle.getsampwidth()
    raw = handle.readframes(handle.getnframes())
if width != 2:
    raise SystemExit("breath detector requires signed 16-bit PCM WAV")
audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
if channels > 1:
    audio = audio.reshape(-1, channels).mean(axis=1)
with open(args.alignment, encoding="utf-8") as handle:
    words = json.load(handle)["words"]

window = int(rate * 0.02)
rms_global = float(np.sqrt(np.mean(audio * audio)) + 1e-9)
events = []
for previous, following in zip(words, words[1:]):
    start, end = float(previous["end"]), float(following["start"])
    duration = end - start
    if duration < 0.08 or duration > 0.8:
        continue
    a, b = int(start * rate), int(end * rate)
    region = audio[a:b]
    if len(region) < window * 3:
        continue
    trimmed = region[:len(region) // window * window].reshape(-1, window)
    rms = np.sqrt(np.mean(trimmed * trimmed, axis=1) + 1e-12)
    active = trimmed[rms > max(rms_global * 0.12, float(np.max(rms)) * 0.35)]
    if len(active) < 2:
        continue
    signal = active.reshape(-1)
    spectrum = np.abs(np.fft.rfft(signal * np.hanning(len(signal))))
    freqs = np.fft.rfftfreq(len(signal), 1 / rate)
    high = float(np.sum(spectrum[freqs > 1800]) / (np.sum(spectrum) + 1e-9))
    zcr = float(np.mean(np.abs(np.diff(np.signbit(signal))) > 0))
    confidence = min(0.99, max(0.0, (high - 0.25) * 1.8 + (zcr - 0.08) * 2.0))
    if confidence >= 0.72:
        events.append({"start": start + 0.015, "end": end - 0.015, "confidence": round(confidence, 3), "kind": "breath_candidate"})
with open(args.output, "w", encoding="utf-8") as handle:
    json.dump({"schema_version": 1, "detector": "conservative-hf-zcr-v1", "events": events}, handle, ensure_ascii=False, indent=2)
