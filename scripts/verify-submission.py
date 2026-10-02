"""Verify every submitted source input using only Python's standard library."""
from pathlib import Path
import hashlib
import json
import subprocess

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / "submission-provenance.json").read_text())
checked = 0
for name, component in manifest["components"].items():
    for relative, expected in component["files"].items():
        path = root / name / relative
        assert path.is_file(), "Missing source: " + str(path.relative_to(root))
        assert hashlib.sha256(path.read_bytes()).hexdigest() == expected, "Changed source: " + str(path.relative_to(root))
        checked += 1
release = json.loads((root / "deployed-portal-source.json").read_text())
for source in release["sourceFiles"]:
    path = root / "doctor-portal" / source["path"]
    assert hashlib.sha256(path.read_bytes()).hexdigest() == source["sha256"], "Release mismatch: " + source["path"]
tracked = set(subprocess.check_output(["git", "ls-files"], cwd=root).decode().splitlines())
missing = [name + "/" + relative for name, component in manifest["components"].items() for relative in component["files"] if name + "/" + relative not in tracked]
assert not missing, "Source files not committed: " + ", ".join(missing)
print("PASS:", checked, "source files tracked and unchanged;", len(release["sourceFiles"]), "portal release inputs match.")
