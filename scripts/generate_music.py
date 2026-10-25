import argparse
import json
import torch
import torchaudio
from audiocraft.models import MusicGen

parser = argparse.ArgumentParser()
parser.add_argument("prompt")
parser.add_argument("output")
parser.add_argument("--duration", type=float, default=30)
parser.add_argument("--seed", type=int, default=42)
parser.add_argument("--model", default="facebook/musicgen-small")
args = parser.parse_args()
torch.manual_seed(args.seed)
model = MusicGen.get_pretrained(args.model)
model.set_generation_params(duration=args.duration)
audio = model.generate([args.prompt])[0].cpu()
torchaudio.save(args.output, audio, model.sample_rate)
with open(args.output + ".json", "w", encoding="utf-8") as handle:
    json.dump({"prompt": args.prompt, "seed": args.seed, "model": args.model, "duration": args.duration}, handle, ensure_ascii=False, indent=2)
