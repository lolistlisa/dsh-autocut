# -*- coding: utf-8 -*-
"""Create a JianyingPro 11.x encrypted draft from an autocut timeline.json.

JianyingPro 11.6 stores ``draft_content.json`` and ``draft_meta_info.json`` as
ciphertext.  The aoguai fork of pyJianYingDraft exposes ``JianyingDraftCryptoCodec``
(backed by the installed ``videoeditor.dll``); the plain upstream 0.3.1 does not.

This script keeps the original autocut track/clip assembly and adds:
  * install-dir and User Data discovery,
  * ``draft_content.json`` as the main file,
  * post-save canvas ratio fix,
  * encryption of the main file and sidecar metadata,
  * ``draft_settings`` and cover image for the Jianying draft list.

Exit code 0 and one JSON object on stdout on success; exception otherwise.
"""

import argparse
import json
import os
import shutil
import time

import pyJianYingDraft as draft
from pyJianYingDraft import ClipSettings, TextStyle, trange_seconds

MAIN_FILE = "draft_content.json"
META_FILE = "draft_meta_info.json"


def find_install_dir(preferred=""):
    """Return a JianyingPro version directory that contains videoeditor.dll."""
    candidates = []
    if preferred:
        candidates.append(preferred)
    env = os.environ.get("JY_INSTALL_DIR") or ""
    if env:
        candidates.append(env)
    bases = [
        r"F:\JianyingPro",
        r"D:\JianyingPro",
        r"E:\JianyingPro",
        r"C:\Program Files\JianyingPro",
        r"C:\Program Files (x86)\JianyingPro",
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "JianyingPro", "Apps"),
    ]
    for base in bases:
        if not base or not os.path.isdir(base):
            continue
        candidates.append(base)
        try:
            for name in os.listdir(base):
                full = os.path.join(base, name)
                if os.path.isdir(full):
                    candidates.append(full)
        except OSError:
            pass
    found = []
    for candidate in candidates:
        if candidate and os.path.isfile(os.path.join(candidate, "videoeditor.dll")):
            found.append(os.path.abspath(candidate))
    if not found:
        return ""

    def version_key(path):
        return tuple(int(part) if part.isdigit() else 0 for part in os.path.basename(path).split("."))

    found.sort(key=version_key, reverse=True)
    return found[0]


def find_user_data_dir(draft_dir):
    """Return the JianyingPro ``User Data`` directory that owns the draft folder."""
    candidates = []
    env = os.environ.get("JY_USER_DATA_DIR") or os.environ.get("JIANYING_USER_DATA_DIR") or ""
    if env:
        candidates.append(env)
    absolute = os.path.abspath(draft_dir)
    if os.path.basename(absolute).lower() == "com.lveditor.draft":
        candidates.append(os.path.dirname(os.path.dirname(absolute)))
    local_app_data = os.environ.get("LOCALAPPDATA") or ""
    if local_app_data:
        candidates.append(os.path.join(local_app_data, "JianyingPro", "User Data"))
    for candidate in candidates:
        if candidate and os.path.isfile(
            os.path.join(candidate, "Projects", "com.lveditor.draft", "root_meta_info.json")
        ):
            return os.path.abspath(candidate)
    return ""


def write_settings(draft_path):
    now = int(time.time())
    text = (
        "[General]\n"
        "draft_create_time=%d\n"
        "draft_last_edit_time=%d\n"
        "real_edit_seconds=0\n"
        "real_edit_keys=0\n"
        "cloud_last_modify_platform=windows\n"
        "timeline_use_zip_track=true\n" % (now, now)
    )
    with open(os.path.join(draft_path, "draft_settings"), "w", encoding="utf-8", newline="\r\n") as handle:
        handle.write(text)


def make_cover(draft_path):
    try:
        from PIL import Image

        image = Image.new("RGB", (480, 270), (24, 24, 28))
        image.save(os.path.join(draft_path, "draft_cover.jpg"), quality=85)
    except Exception:
        pass


def build_script(folder, timeline, name):
    script = folder.create_draft(
        name,
        int(timeline.get("width", 1920)),
        int(timeline.get("height", 1080)),
        int(timeline.get("fps", 30)),
    )
    specs = []
    for track in timeline["tracks"]:
        kind = track["kind"]
        if kind == "video":
            track_type = draft.TrackType.video
        elif kind == "audio":
            track_type = draft.TrackType.audio
        elif kind == "text":
            track_type = draft.TrackType.text
        else:
            continue
        specs.append(draft.TrackSpec(track_type, track["id"]))
    script.append_tracks(specs)

    for track in timeline["tracks"]:
        kind = track["kind"]
        if kind not in ("video", "audio", "text"):
            continue
        for clip in track["clips"]:
            duration = clip["end"] - clip["start"]
            if duration <= 0:
                continue
            if kind == "text":
                target = trange_seconds(clip["start"], end=clip["end"])
                segment = draft.TextSegment(
                    clip["text"],
                    target,
                    style=TextStyle(
                        size=6.0,
                        color=(1.0, 1.0, 1.0),
                        align=1,
                        auto_wrapping=True,
                        max_line_width=0.82,
                    ),
                    clip_settings=ClipSettings(transform_y=-0.78),
                )
            else:
                material_cls = draft.AudioMaterial if kind == "audio" else draft.VideoMaterial
                material = material_cls(clip["source"])
                source_start_us = max(0, round(float(clip.get("source_start", 0)) * 1000000))
                requested_us = max(
                    1000,
                    round(
                        (float(clip.get("source_end", duration)) - float(clip.get("source_start", 0)))
                        * 1000000
                    ),
                )
                available_us = max(1000, material.duration - source_start_us - 1000)
                source_us = min(requested_us, available_us)
                target = trange_seconds(clip["start"], duration=source_us / 1000000)
                source = trange_seconds(source_start_us / 1000000, duration=source_us / 1000000)
                if kind == "video":
                    effects = clip.get("effects") or []
                    scale = 1.0 + (0.08 if "punch_in" in effects else 0.0)
                    segment = draft.VideoSegment(
                        material,
                        target,
                        source_timerange=source,
                        clip_settings=ClipSettings(scale_x=scale, scale_y=scale),
                    )
                else:
                    volume = 10 ** (float(clip.get("gain_db", 0)) / 20)
                    segment = draft.AudioSegment(
                        material, target, source_timerange=source, volume=volume
                    )
            script.add_segment(segment, track["id"])
    return script, specs


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("timeline")
    parser.add_argument("draft_dir")
    parser.add_argument("name")
    args = parser.parse_args()

    with open(args.timeline, encoding="utf-8") as handle:
        timeline = json.load(handle)

    drafts_dir = os.path.abspath(args.draft_dir)
    if not os.path.isdir(drafts_dir):
        raise RuntimeError("剪映草稿目录不存在: %s" % drafts_dir)
    draft_path = os.path.join(drafts_dir, args.name)
    if os.path.exists(draft_path):
        raise SystemExit("Refusing to overwrite an existing draft: " + draft_path)

    install_dir = find_install_dir()
    if not install_dir:
        raise RuntimeError("未找到含 videoeditor.dll 的剪映安装目录，请设置 JY_INSTALL_DIR")
    user_data = find_user_data_dir(drafts_dir)
    if not user_data:
        raise RuntimeError("未找到剪映 User Data 目录，请设置 JY_USER_DATA_DIR")

    codec = draft.JianyingDraftCryptoCodec(draft.DraftCryptoConfig(jy_install_dir=install_dir))
    folder = draft.DraftFolder(drafts_dir, content_codec=codec, user_data_path=user_data)
    try:
        script, specs = build_script(folder, timeline, args.name)
    except Exception:
        shutil.rmtree(draft_path, ignore_errors=True)
        raise

    # Jianying 11.x reads draft_content.json; the fork still defaults to draft_info.json.
    script.save_path = os.path.join(draft_path, MAIN_FILE)
    try:
        script.save()
    except Exception:
        shutil.rmtree(draft_path, ignore_errors=True)
        raise

    # The fork writes canvas ratio "original"; 11.6 expects the real ratio.
    with open(script.save_path, "r", encoding="utf-8") as handle:
        content = json.load(handle)
    canvas = content.setdefault("canvas_config", {})
    canvas["width"] = int(timeline.get("width", 1920))
    canvas["height"] = int(timeline.get("height", 1080))
    canvas["ratio"] = "16:9"
    with open(script.save_path, "w", encoding="utf-8") as handle:
        json.dump(content, handle, ensure_ascii=False, separators=(",", ":"))

    # Encrypt the main file and the sidecar metadata the way Jianying 11.6 stores them.
    with open(script.save_path, "r", encoding="utf-8") as handle:
        plaintext = handle.read()
    with open(script.save_path, "wb") as handle:
        handle.write(codec.encode(plaintext))

    meta_path = os.path.join(draft_path, META_FILE)
    with open(meta_path, "r", encoding="utf-8") as handle:
        meta_text = handle.read()
    with open(meta_path, "wb") as handle:
        handle.write(codec.encode(meta_text))

    write_settings(draft_path)
    make_cover(draft_path)

    duration_us = int(content.get("duration") or 0)
    result = {
        "ok": True,
        "draft_name": args.name,
        "draft_path": draft_path,
        "main_file": script.save_path,
        "meta_file": meta_path,
        "install_dir": install_dir,
        "encrypted": True,
        "duration_sec": round(duration_us / 1000000.0, 3),
        "track_count": len(specs),
        "tracks": len(content.get("tracks") or []),
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
