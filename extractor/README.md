# TestBench Unity Audio Extractor

Standalone sidecar used by TestBench to scan an already prepared directory for
standard audio files and Unity `AudioClip` objects. Device access and APK
extraction remain the responsibility of the Rust backend.

## Development

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.lock
PYTHONPATH=src .venv/bin/python -m unittest discover -s tests -v
PYTHONPATH=src .venv/bin/python -m unity_audio_extractor --version
```

The unit tests do not require UnityPy. UnityPy is imported only when a real
Unity candidate is scanned.

## CLI

```bash
unity-audio-extractor scan \
  --input /path/to/prepared/resources \
  --output /path/to/export-directory
```

The output directory must not be inside the input directory. The command emits
one JSON object per stdout line. Human-readable diagnostics go to stderr.

Protocol events use `schemaVersion: 1` and the following event names:

- `started`
- `progress`
- `warning`
- `completed`
- `fatal`

`completed` can report `complete`, `partial`, or `empty`. A partial result is a
successful process exit with recoverable errors recorded in the summary.

