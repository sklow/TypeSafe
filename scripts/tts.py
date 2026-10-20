#!/usr/bin/env python3
"""VOICEVOX Engine(ローカル :50121) でナレーション台本を音声化する。
使い方: python3 scripts/tts.py <narration.txt> <out_dir> <speaker_id> [speed=1.05]
  台本は `id|本文` の行。out_dir/<id>.wav と out_dir/durations.json({id: 秒}) を出力。
  エンジン起動: ~/Library/Caches/voicevox-dl/engine/macos-arm64/run --host 127.0.0.1 --port 50121
"""
import json, sys, urllib.parse, urllib.request, wave, pathlib
BASE = "http://127.0.0.1:50121"
def synth(text, spk, speed):
    q = json.load(urllib.request.urlopen(urllib.request.Request(f"{BASE}/audio_query?speaker={spk}&text={urllib.parse.quote(text)}", method="POST")))
    q["speedScale"] = speed; q["prePhonemeLength"] = 0.15; q["postPhonemeLength"] = 0.25
    r = urllib.request.Request(f"{BASE}/synthesis?speaker={spk}", json.dumps(q).encode(), {"content-type": "application/json"})
    return urllib.request.urlopen(r, timeout=300).read()
if __name__ == "__main__":
    src, out, spk = sys.argv[1], pathlib.Path(sys.argv[2]), int(sys.argv[3]); speed = float(sys.argv[4]) if len(sys.argv) > 4 else 1.05
    out.mkdir(parents=True, exist_ok=True); dur = {}
    for line in pathlib.Path(src).read_text().splitlines():
        if "|" not in line: continue
        i, t = line.split("|", 1); wav = synth(t.strip(), spk, speed); (out / f"{i}.wav").write_bytes(wav)
        with wave.open(str(out / f"{i}.wav")) as w: dur[i] = round(w.getnframes() / w.getframerate(), 2)
    (out / "durations.json").write_text(json.dumps(dur, ensure_ascii=False, indent=1)); print(dur)
