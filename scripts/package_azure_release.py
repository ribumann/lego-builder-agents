#!/usr/bin/env python3
"""Build a minimal, auditable App Service run-from-package archive."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import zipfile


REVISION_PATTERN = re.compile(r"^[0-9a-f]{40}$")
LOCAL_IMPORT_PATTERN = re.compile(
    r"""(?:\bfrom\s*|\bimport\s*)['"](\.{1,2}/[^'"]+)['"]"""
)
REQUIRED_RUNTIME_FILES = (
    Path("package.json"),
    Path("server.mjs"),
    Path("src/windows-copilot-job-runner.mjs"),
    Path("scripts/windows-copilot-job-host.ps1"),
)
OMIT_DIRECTORY_PARTS = {".bin"}


class PackageError(Exception):
    pass


def _regular_files(directory: Path):
    if not directory.is_dir():
        raise PackageError(f"Required directory is missing: {directory.name}")
    return sorted(
        path for path in directory.rglob("*")
        if path.is_file()
        and not path.is_symlink()
        and not (set(path.relative_to(directory).parts) & OMIT_DIRECTORY_PARTS)
    )


def _resolve_local_import(source: Path, specifier: str) -> Path:
    target = (source.parent / specifier).resolve()
    candidates = [target]
    if not target.suffix:
        candidates.extend(target.with_suffix(suffix) for suffix in (".mjs", ".js", ".json"))
        candidates.extend(target / f"index{suffix}" for suffix in (".mjs", ".js", ".json"))
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise PackageError(f"Unresolved local runtime import in {source.name}: {specifier}")


def collect_runtime_files(root: Path, verify_npm: bool = True) -> list[Path]:
    root = root.resolve()
    for required in REQUIRED_RUNTIME_FILES:
        if not (root / required).is_file():
            raise PackageError(f"Required runtime file is missing: {required.as_posix()}")

    package_manifest = json.loads((root / "package.json").read_text(encoding="utf-8"))
    dependencies = package_manifest.get("dependencies")
    if not isinstance(dependencies, dict) or not dependencies:
        raise PackageError("package.json has no production dependencies.")

    files = set(REQUIRED_RUNTIME_FILES)
    files.update(path.relative_to(root) for path in root.glob("*.mjs") if path.is_file())
    source_modules = sorted(path for path in (root / "src").rglob("*.mjs") if path.is_file())
    files.update(path.relative_to(root) for path in source_modules)
    files.update(
        path.relative_to(root) for path in _regular_files(root / "dist")
    )

    modules = root / "node_modules"
    for dependency in dependencies:
        installed = modules.joinpath(*dependency.split("/"), "package.json")
        if not installed.is_file():
            raise PackageError(f"Production dependency is missing: {dependency}")
    if verify_npm:
        result = subprocess.run(
            ["npm", "ls", "--omit=dev", "--depth=0", "--json"],
            cwd=root,
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode:
            raise PackageError("npm reports an incomplete production dependency tree.")

    files.update(path.relative_to(root) for path in _regular_files(modules))
    file_set = set(files)
    for relative in tuple(files):
        if relative.suffix != ".mjs":
            continue
        source = root / relative
        content = source.read_text(encoding="utf-8")
        for specifier in LOCAL_IMPORT_PATTERN.findall(content):
            target = _resolve_local_import(source, specifier)
            try:
                packaged_target = target.relative_to(root)
            except ValueError as error:
                raise PackageError(f"Runtime import escapes the release root: {specifier}") from error
            if packaged_target not in file_set:
                raise PackageError(f"Runtime import is not packaged: {specifier}")

    dist_files = [root / path for path in files if Path("dist") in path.parents]
    if not any(path.suffix == ".wasm" for path in dist_files):
        raise PackageError("Built release has no WebAssembly runtime asset.")
    if not any(path.suffix == ".mjs" for path in dist_files):
        raise PackageError("Built release has no JavaScript module runtime asset.")
    return sorted(files, key=lambda path: path.as_posix())


def build_package(root: Path, revision: str, output: Path, verify_npm: bool = True) -> dict:
    if not REVISION_PATTERN.fullmatch(revision):
        raise PackageError("Revision must be a full lowercase 40-character Git SHA.")
    root = root.resolve()
    output = output.resolve()
    if output == root or root in output.parents:
        raise PackageError("Output must be outside the repository to keep releases out of source inputs.")
    if output.exists():
        raise PackageError(f"Refusing to overwrite an existing release: {output}")

    files = collect_runtime_files(root, verify_npm=verify_npm)
    entries = []
    for relative in files:
        content = (root / relative).read_bytes()
        entries.append({
            "path": relative.as_posix(),
            "size": len(content),
            "sha256": hashlib.sha256(content).hexdigest(),
        })
    manifest = {
        "revision": revision,
        "files": entries,
        "fileCount": len(entries),
        "uncompressedBytes": sum(entry["size"] for entry in entries),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    created = False
    try:
        with output.open("xb") as archive_file:
            created = True
            with zipfile.ZipFile(archive_file, mode="w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
                for entry in entries:
                    relative = Path(entry["path"])
                    source = root / relative
                    info = zipfile.ZipInfo(relative.as_posix(), date_time=(1980, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = (stat.S_IMODE(source.stat().st_mode) & 0xFFFF) << 16
                    archive.writestr(info, (root / relative).read_bytes())
                info = zipfile.ZipInfo("release-manifest.json", date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n")
    except Exception:
        if created:
            output.unlink(missing_ok=True)
        raise

    archive_bytes = output.stat().st_size
    suffix_bytes = {}
    for entry in entries:
        suffix = Path(entry["path"]).suffix or "[no extension]"
        suffix_bytes[suffix] = suffix_bytes.get(suffix, 0) + entry["size"]
    result = {
        "revision": revision,
        "fileCount": len(entries),
        "uncompressedBytes": manifest["uncompressedBytes"],
        "archiveBytes": archive_bytes,
        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "suffixBytes": dict(sorted(suffix_bytes.items())),
    }
    return result


def verify_git_source(root: Path, revision: str) -> None:
    root = root.resolve()
    head = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=root, check=False, capture_output=True, text=True,
    )
    if head.returncode or head.stdout.strip() != revision:
        raise PackageError("Release revision does not match the checked-out Git commit.")
    status = subprocess.run(
        ["git", "status", "--porcelain", "--untracked-files=all"],
        cwd=root,
        check=False,
        capture_output=True,
        text=True,
    )
    if status.returncode or status.stdout:
        raise PackageError("Refusing to package a dirty source tree.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", required=True, help="full Git SHA represented by this package")
    parser.add_argument("--output", required=True, type=Path, help="new ZIP path outside the repository")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    try:
        verify_git_source(root, args.revision)
        result = build_package(root, args.revision, args.output)
    except (PackageError, OSError, json.JSONDecodeError, subprocess.SubprocessError) as error:
        print(f"Release packaging failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps({"output": str(args.output.resolve()), **result}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
