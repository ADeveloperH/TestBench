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

## Unity resource compatibility

The scanner accepts standard Unity resources and UnityFS bundles with an extra
prefix of at most 4096 bytes. Prefix removal requires a valid bundle header and
an exact declared-size match; source files are never modified. This also applies
to bundles without an extension. Internal encryption or XOR changes are not
handled by this compatibility layer.

Missing bundle versions use a consistent version discovered from the input's
serialized headers (prefer `globalgamemanagers`), then from other bundle headers.
Split resources participate after merging. Conflicting or missing versions are
not guessed. UnityPy's fallback setting is restored after each resource, including
errors. The summary includes `unityVersionFallback` and `normalizedBundles`.

Each resource uses a scoped local filesystem. Its source and companion file
handles close when iteration completes, fails, or is explicitly closed, so
Windows can remove temporary split resources without waiting for garbage collection.

A candidate that yields no recognized serialized resource is a parse failure
(`partial` with a warning). A successfully parsed resource with no AudioClip is
valid and may produce an `empty` result.

## Build the TestBench sidecar

Runtime dependencies are pinned in `requirements.lock`; the standalone builder
dependency is pinned in `packaging-requirements.txt`. Build on the target OS and
architecture so native Unity and texture decoders match the destination:

```bash
python3 -m venv .build-venv
.build-venv/bin/pip install -r requirements.lock -r packaging-requirements.txt
bash ../scripts/build-unity-audio-sidecar.sh
```

On Windows, run `scripts/build-unity-audio-sidecar.ps1` from PowerShell. The
result is placed in `src-tauri/bin/<platform>/unity-audio-extractor[.exe]`; the
script runs `--version` after copying it. The temporary build directory is not
part of the repository output.
