#!/usr/bin/env python3
"""Build the self-contained, standard-library BZSS Memory Bridge zipapp."""

from pathlib import Path
import tarfile
import zipapp


ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
APP = DIST / "bzss-mem-bridge.pyz"
BUNDLE = DIST / "bzss-mem-bridge-linux.tar.gz"


def include_in_app(path: Path) -> bool:
    parts = Path(path).parts
    return "dist" not in parts and "__pycache__" not in parts and path.suffix != ".pyc"


def main() -> None:
    DIST.mkdir(parents=True, exist_ok=True)
    zipapp.create_archive(
        ROOT,
        target=APP,
        interpreter="/usr/bin/env python3",
        compressed=True,
        filter=include_in_app,
    )
    with tarfile.open(BUNDLE, "w:gz") as archive:
        archive.add(APP, arcname=APP.name)
        archive.add(ROOT / "README.md", arcname="README.md")
        archive.add(ROOT / "config.example.json", arcname="config.example.json")
        archive.add(ROOT / "profiles", arcname="profiles")
        archive.add(ROOT / "deploy", arcname="deploy")
    print(f"Built {APP} ({APP.stat().st_size:,} bytes)")
    print(f"Built {BUNDLE} ({BUNDLE.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
