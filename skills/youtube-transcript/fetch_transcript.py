#!/usr/bin/env python3
"""Fetch a YouTube video's title and transcript via yt-dlp.

Prefers manual English captions, falls back to auto-generated. Uses yt-dlp
itself to download the caption file so we don't have to deal with SSL/cert
issues from a bare urllib request.

The full transcript is saved as a Markdown file under ~/transcripts/ and a
short JSON summary is printed to stdout. Read the saved file when you need
the actual text.
"""
import sys
import os
import re
import glob
import shutil
import subprocess
import tempfile
import json
from datetime import datetime
from pathlib import Path

TRANSCRIPTS_DIR = Path.home() / "transcripts"


def get_metadata(url):
    cmd = [
        "yt-dlp",
        "--dump-json",
        "--no-warnings",
        "--skip-download",
        url,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return json.loads(result.stdout)
    except subprocess.CalledProcessError as e:
        print(f"Error executing yt-dlp: {e.stderr}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Unexpected error: {e}", file=sys.stderr)
        sys.exit(1)


def pick_english_lang(info):
    """Return (lang_code, is_auto) for the best English caption track, or None."""
    subs = info.get("subtitles") or {}
    auto = info.get("automatic_captions") or {}

    preferred = ["en", "en-US", "en-GB"]

    # 1. Manual, preferred order
    for lang in preferred:
        if lang in subs:
            return lang, False
    # 2. Any manual en*
    for lang in subs:
        if lang.startswith("en"):
            return lang, False
    # 3. Auto, preferred order
    for lang in preferred:
        if lang in auto:
            return lang, True
    # 4. Any auto en*
    for lang in auto:
        if lang.startswith("en"):
            return lang, True
    return None


def download_subtitle(url, lang, is_auto, outdir):
    """Use yt-dlp to download the json3 subtitle file. Returns the file path."""
    cmd = [
        "yt-dlp",
        "--skip-download",
        "--no-warnings",
        "--sub-format", "json3",
        "--sub-langs", lang,
        "--write-auto-subs" if is_auto else "--write-subs",
        "-o", os.path.join(outdir, "%(id)s.%(ext)s"),
        url,
    ]
    try:
        subprocess.run(cmd, capture_output=True, text=True, check=True)
    except subprocess.CalledProcessError as e:
        print(f"Error downloading subtitles via yt-dlp: {e.stderr}", file=sys.stderr)
        sys.exit(1)

    matches = glob.glob(os.path.join(outdir, "*.json3"))
    if not matches:
        print("yt-dlp did not produce a json3 subtitle file.", file=sys.stderr)
        sys.exit(1)
    return matches[0]


def extract_text_from_json3(path):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    text_parts = []
    for event in data.get("events", []):
        for seg in event.get("segs", []) or []:
            text = seg.get("utf8", "")
            if text.strip() and text != "\n":
                text_parts.append(text.strip())
    return " ".join(text_parts)


def slugify(text, maxlen=60):
    """Turn a video title into a safe, readable filename fragment."""
    text = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    if len(text) > maxlen:
        text = text[:maxlen].rstrip("-")
    return text or "transcript"


def save_transcript(info, url, transcript, lang, is_auto):
    """Write the transcript to ~/transcripts/ and return the path written."""
    TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)

    video_id = info.get("id") or ""
    title = info.get("title") or "Unknown Title"
    fetched = datetime.now().astimezone()

    name_parts = [fetched.strftime("%Y-%m-%d")]
    if video_id:
        name_parts.append(video_id)
    name_parts.append(slugify(title))
    path = TRANSCRIPTS_DIR / ("-".join(name_parts) + ".md")

    canonical = f"https://www.youtube.com/watch?v={video_id}" if video_id else url
    meta = [f"# {title}", "", f"- Video: {canonical}"]

    if info.get("uploader"):
        meta.append(f"- Channel: {info['uploader']}")

    uploaded = info.get("upload_date") or ""
    if len(uploaded) == 8:
        meta.append(f"- Uploaded: {uploaded[:4]}-{uploaded[4:6]}-{uploaded[6:]}")

    duration = info.get("duration")
    if isinstance(duration, (int, float)) and duration > 0:
        meta.append(f"- Duration: {int(duration // 60)}m{int(duration % 60):02d}s")

    meta.append(f"- Captions: {'auto-generated' if is_auto else 'manual'} ({lang})")
    meta.append(f"- Fetched: {fetched.strftime('%Y-%m-%d %H:%M %Z')}")
    meta += ["", "## Transcript", "", transcript, ""]

    path.write_text("\n".join(meta), encoding="utf-8")
    return path


def main():
    if len(sys.argv) < 2:
        print("Usage: python fetch_transcript.py <youtube_url>", file=sys.stderr)
        sys.exit(1)

    url = sys.argv[1]

    print("Fetching video metadata...", file=sys.stderr)
    info = get_metadata(url)
    title = info.get("title", "Unknown_Title")

    pick = pick_english_lang(info)
    if pick is None:
        print(f"No English subtitles found for video: {title}", file=sys.stderr)
        sys.exit(1)
    lang, is_auto = pick

    tmpdir = tempfile.mkdtemp(prefix="yt-transcript-")
    try:
        print(
            f"Downloading {'auto ' if is_auto else ''}captions ({lang})...",
            file=sys.stderr,
        )
        sub_path = download_subtitle(url, lang, is_auto, tmpdir)
        transcript = extract_text_from_json3(sub_path)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    if not transcript.strip():
        print(f"Caption file for '{title}' contained no text.", file=sys.stderr)
        sys.exit(1)

    path = save_transcript(info, url, transcript, lang, is_auto)
    print(f"Saved transcript to {path}", file=sys.stderr)

    output = {
        "title": title,
        "saved": str(path),
        "captions": "auto-generated" if is_auto else "manual",
        "lang": lang,
        "words": len(transcript.split()),
        "characters": len(transcript),
    }
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
