#!/usr/bin/env python3
"""無音の縦動画にナレーションを合成する。
使い方: python3 scripts/mix-voice.py <silent.mp4> <narr_dir(wav+durations.json)> <scenes.json> <out.mp4> [credit文字列] [offset秒=0]
 - 各シーン開始時刻に wav を adelay で配置 → amix → loudnorm(-16 LUFS) → AAC 128k
 - 末尾に最終フレームを 4 秒延長し、クレジット（PNG オーバーレイ）を表示
"""
import json, subprocess, sys, pathlib
from PIL import Image, ImageDraw, ImageFont
silent, narr, scenes, out = sys.argv[1:5]
credit = sys.argv[5] if len(sys.argv) > 5 else "音声: VOICEVOX:No.7"
off = float(sys.argv[6]) if len(sys.argv) > 6 else 0.0
sc = json.load(open(scenes))["scenes"]
dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", silent]))
# クレジット PNG
W, H = 980, 120
img = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
d.rounded_rectangle((0, 0, W - 1, H - 1), 30, fill=(31, 42, 55, 235))
font = ImageFont.truetype("/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc", 52)
tw = d.textlength(credit, font=font); d.text(((W - tw) / 2, 28), credit, font=font, fill=(255, 255, 255, 255))
png = pathlib.Path(out).with_suffix(".credit.png"); img.save(png)
ins, fl, labels = [], [], []
for i, s in enumerate(sc):
    ins += ["-i", str(pathlib.Path(narr) / f"{s['id']}.wav")]
    ms = int((s["t"] + off) * 1000)
    fl.append(f"[{i + 1}:a]adelay={ms}|{ms}[a{i}]"); labels.append(f"[a{i}]")
n = len(sc)
ext = 4.0
fl.append(f"[0:v]tpad=stop_mode=clone:stop_duration={ext}[v0]")
fl.append(f"[v0][{n + 1}:v]overlay=(W-w)/2:H-h-70:enable='gte(t,{dur:.2f})'[v]")
fl.append("".join(labels) + f"amix=inputs={n}:normalize=0:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11,apad=whole_dur={dur + ext:.2f}[a]")
cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", silent, *ins, "-i", str(png), "-filter_complex", ";".join(fl), "-map", "[v]", "-map", "[a]",
       "-c:v", "libx264", "-preset", "slow", "-crf", "34", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-movflags", "+faststart", "-t", f"{dur + ext:.2f}", out]
subprocess.run(cmd, check=True); png.unlink()
print(out, round(pathlib.Path(out).stat().st_size / 1048576, 2), "MB")
