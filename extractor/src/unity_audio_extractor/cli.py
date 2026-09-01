from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__
from .protocol import EventEmitter
from .scanner import AudioScanner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="unity-audio-extractor")
    parser.add_argument("--version", action="version", version=__version__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    scan = subparsers.add_parser("scan", help="scan a prepared resource directory")
    scan.add_argument("--input", required=True, type=Path)
    scan.add_argument("--output", required=True, type=Path)
    scan.add_argument("--manifest", type=Path)
    return parser


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    emitter = EventEmitter()
    if args.command != "scan":
        raise AssertionError(f"unexpected command: {args.command}")

    emitter.emit(
        "started",
        extractorVersion=__version__,
        input=str(args.input.resolve()),
        output=str(args.output.resolve()),
    )
    try:
        summary = AudioScanner(
            input_dir=args.input,
            output_dir=args.output,
            emitter=emitter,
            manifest_path=args.manifest,
        ).run()
    except Exception as error:
        emitter.emit("fatal", error=f"{type(error).__name__}: {error}")
        raise SystemExit(1) from error

    emitter.emit(
        "completed",
        status=summary.status,
        candidatesScanned=summary.candidatesScanned,
        candidateFailures=summary.candidateFailures,
        audioFound=summary.audioFound,
        audioExported=summary.audioExported,
        audioFailed=summary.audioFailed,
        exportedBytes=summary.exportedBytes,
        manifestPath=summary.manifestPath,
    )
    sys.exit(0)
