---
name: youtube-transcript
description: Fetch the transcript and title of a YouTube video, saving the full transcript to ~/transcripts as Markdown. Use when the user provides a YouTube URL and you need the spoken content (captions) for analysis, summarization, quoting, or search.
---

# YouTube Transcript

Fetches a YouTube video's title and full transcript by pulling captions via `yt-dlp`. Prefers manual English subtitles, falls back to auto-generated English.

## Requirements

- `yt-dlp`, available in this skill's own virtual environment
- Python 3

## Usage

Run the script with the skill's virtual environment first on `PATH` so it finds
its bundled `yt-dlp`:

```bash
SKILL=~/.pi/agent/skills/youtube-transcript
PATH="$SKILL/.venv/bin:$PATH" "$SKILL/.venv/bin/python" "$SKILL/fetch_transcript.py" "<youtube_url>"
```

## Output

The full transcript is **saved to a file**; stdout only carries a short JSON
summary:

```json
{
  "title": "Video title",
  "saved": "~/transcripts/2026-09-24-jDG7L5HuBnk-i-talked-to-50-people-building-with-ai.md",
  "captions": "auto-generated",
  "lang": "en",
  "words": 5677,
  "characters": 30403
}
```

To read the actual transcript, read the file at `saved` (or grep it for a
keyword rather than loading the whole thing). Progress/info logs go to stderr.
On failure (no English captions, network error, bad URL), the script exits
non-zero with a message on stderr.

## Where transcripts are saved

- Folder: `~/transcripts/` (created automatically if missing)
- Filename: `YYYY-MM-DD-<video-id>-<slug-of-title>.md`
- Contents: title, video URL, channel, upload date, duration, caption type, and
  the full transcript under a `## Transcript` heading

Re-fetching the same video on the same day overwrites that day's file.

## Notes

- Only English captions are attempted (`en`, `en-US`, `en-GB`, then any `en*`). Manual captions are preferred over auto-generated.
- Transcript is plain text with timing/formatting stripped — not timestamped, and a `&t=` start time in the URL is ignored (the whole video is always fetched).
- For non-English videos or videos with captions disabled, the script will fail; consider `video_extract` with a Gemini prompt as a fallback.
