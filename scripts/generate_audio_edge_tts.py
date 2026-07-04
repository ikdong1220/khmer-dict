#!/usr/bin/env python3
import argparse
import asyncio
import json
from pathlib import Path

import edge_tts


DEFAULT_VOICES = {
    "female": "km-KH-SreymomNeural",
    "male": "km-KH-PisethNeural",
}


def parse_args():
    parser = argparse.ArgumentParser(description="Generate Khmer mp3 files for dictionary entries.")
    parser.add_argument("--json", default="/Users/debydi/캄보디아어사전/khmer_dictionary_20000.json")
    parser.add_argument("--out-dir", default="/Users/debydi/캄보디아어사전/audio")
    parser.add_argument("--source", default="수작업 기본 단어", help="Only synthesize entries from this source. Use 'all' for every entry.")
    parser.add_argument("--voice", default=DEFAULT_VOICES["female"])
    parser.add_argument("--rate", default="-12%")
    parser.add_argument("--limit", type=int, default=640)
    parser.add_argument("--start-id", type=int, default=0)
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--delay", type=float, default=0.15)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--progress-every", type=int, default=10)
    parser.add_argument("--stop-on-error", action="store_true")
    return parser.parse_args()


def audio_name(entry_id):
    return f"{entry_id:06d}.mp3"


def load_entries(json_path, source, start_id, limit):
    data = json.loads(Path(json_path).read_text(encoding="utf-8"))
    entries = data["entries"]
    if source != "all":
        entries = [entry for entry in entries if entry.get("source") == source]
    entries = [entry for entry in entries if int(entry["id"]) >= start_id]
    if limit:
        entries = entries[:limit]
    return entries


async def synthesize(entry, out_dir, voice, rate, overwrite, delay, retries):
    entry_id = int(entry["id"])
    text = str(entry["km"]).strip()
    output = out_dir / audio_name(entry_id)
    if output.exists() and output.stat().st_size > 0 and not overwrite:
        return "skipped", output

    temp = output.with_suffix(".tmp.mp3")
    for attempt in range(1, retries + 1):
        try:
            if temp.exists():
                temp.unlink()
            communicate = edge_tts.Communicate(text, voice=voice, rate=rate)
            await communicate.save(str(temp))
            if temp.stat().st_size < 512:
                raise RuntimeError("generated mp3 is unexpectedly small")
            temp.replace(output)
            if delay:
                await asyncio.sleep(delay)
            return "created", output
        except Exception:
            if temp.exists():
                temp.unlink()
            if attempt == retries:
                raise
            await asyncio.sleep(1.5 * attempt)


async def main():
    args = parse_args()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    entries = load_entries(args.json, args.source, args.start_id, args.limit)
    print(f"Generating {len(entries)} Khmer audio files with {args.voice}", flush=True)

    counts = {"created": 0, "skipped": 0, "failed": 0}
    failed = []
    for index, entry in enumerate(entries, start=1):
        try:
            status, output = await synthesize(
                entry,
                out_dir,
                args.voice,
                args.rate,
                args.overwrite,
                args.delay,
                args.retries,
            )
        except Exception as error:
            counts["failed"] += 1
            failed.append({"id": int(entry["id"]), "km": entry["km"], "error": str(error)})
            print(f"{index}/{len(entries)} failed: {audio_name(int(entry['id']))} {error}", flush=True)
            if args.stop_on_error:
                raise
            continue

        counts[status] += 1
        if index == 1 or index % args.progress_every == 0 or index == len(entries):
            print(f"{index}/{len(entries)} {status}: {output.name}", flush=True)

    if failed:
        failure_path = out_dir / "failed_audio_entries.json"
        failure_path.write_text(json.dumps(failed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Failed entries written to {failure_path}", flush=True)

    print(json.dumps(counts, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
