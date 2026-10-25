import argparse
import json
from faster_whisper import WhisperModel

parser = argparse.ArgumentParser()
parser.add_argument("audio")
parser.add_argument("output")
parser.add_argument("--model", default="small")
parser.add_argument("--language", default="zh")
args = parser.parse_args()

model = WhisperModel(args.model, device="auto", compute_type="auto")
segments, info = model.transcribe(args.audio, language=args.language, word_timestamps=True, vad_filter=True)
words = []
for segment in segments:
    for word in segment.words or []:
        words.append({"text": word.word, "start": word.start, "end": word.end, "probability": word.probability})
with open(args.output, "w", encoding="utf-8") as handle:
    json.dump({"schema_version": 1, "language": info.language, "duration": info.duration, "words": words}, handle, ensure_ascii=False, indent=2)
