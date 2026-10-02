"""Freeze a built portal with locked Linux dependencies; never deploy or change Git."""
from pathlib import Path
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
import shutil
import stat
import struct
import subprocess
from urllib.parse import unquote, urlsplit
import zipfile

SOURCE = Path(__file__).resolve().parent.parent
SOURCE_DIRS = {"app", "components", "lib", "public", "data"}
SOURCE_FILES = {"package.json", "package-lock.json", "next.config.mjs", "jsconfig.json"}
FORBIDDEN_PATHS = {"components/greetings/PortalSession.js", "app/api/session/route.js"}
FORBIDDEN_CONTENT = [b"namat_portal_session", b"namat-doctor-demo-session-v1:", b"handlePortalSession", b"Enter the demo access key"]


def sha(value):
    return hashlib.sha256(value).hexdigest()


def encoded(value):
    return (json.dumps(value, indent=2) + "\n").encode()


def git(*args):
    return subprocess.check_output(["git", *args], cwd=SOURCE).decode().strip()


def entries(root):
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            assert path.exists() and not path.is_dir(), "Unmaterialized or broken package alias."
            yield path
        elif not path.is_dir():
            assert path.is_file(), "Unsupported release entry."
            yield path


def secrets_from(paths):
    secrets = set()

    def add(value):
        if isinstance(value, str) and len(value) >= 12:
            secrets.add(value.encode())
            try:
                password = urlsplit(value).password
                if password and len(password) >= 12:
                    secrets.add(password.encode())
                    secrets.add(unquote(password).encode())
            except ValueError:
                pass

    def visit(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if any(marker in key.upper() for marker in ("TOKEN", "SECRET", "PASSWORD", "API_KEY", "DATABASE_URL")):
                    add(child)
                elif isinstance(child, (dict, list)):
                    visit(child)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict) and isinstance(item.get("name"), str) and any(marker in item["name"].upper() for marker in ("TOKEN", "SECRET", "PASSWORD", "API_KEY", "DATABASE_URL")):
                    add(item.get("value"))
                else:
                    visit(item)

    for path in paths:
        path = Path(path)
        assert path.is_file(), "Private scan input is missing."
        content = path.read_text()
        if path.suffix == ".json":
            visit(json.loads(content))
        elif "=" in content:
            for line in content.splitlines():
                if "=" not in line or line.lstrip().startswith("#"):
                    continue
                key, value = line.split("=", 1)
                if any(marker in key.upper() for marker in ("TOKEN", "SECRET", "PASSWORD", "API_KEY", "DATABASE_URL")):
                    value = value.strip()
                    try:
                        add(json.loads(value) if value.startswith('"') else value.strip("'"))
                    except json.JSONDecodeError:
                        add(value.strip('"').strip("'"))
        else:
            add(content.strip())
    return secrets


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", required=True, type=Path, help="Directory with matching package files and Linux x64 node_modules.")
    parser.add_argument("--output", required=True, type=Path, help="A new release directory; previous artifacts are never overwritten.")
    parser.add_argument("--scan-secret-file", action="append", default=[], help="Private env/JSON/token file; only secret values are scanned, never recorded.")
    args = parser.parse_args()
    runtime, output = args.runtime.resolve(), args.output.resolve()
    assert not output.exists(), "Choose a fresh release output directory."
    assert not output.is_relative_to(SOURCE), "Keep generated release packages outside the source checkout."
    assert (SOURCE / ".next/BUILD_ID").is_file(), "A successful production build is required."
    assert not any((SOURCE / name).exists() for name in FORBIDDEN_PATHS), "Old access-key UI must not be packaged."
    source_package = json.loads((SOURCE / "package.json").read_text())
    runtime_package = json.loads((runtime / "package.json").read_text())
    for key in ["dependencies", "optionalDependencies", "peerDependencies", "engines"]:
        assert source_package.get(key, {}) == runtime_package.get(key, {}), "Runtime dependency configuration differs."
    assert (SOURCE / "package-lock.json").read_bytes() == (runtime / "package-lock.json").read_bytes(), "Runtime lock differs."
    assert source_package["scripts"]["start"] == runtime_package["scripts"]["start"], "Startup command differs."
    lock = json.loads((SOURCE / "package-lock.json").read_text())
    private_inputs = list(args.scan_secret_file)
    for name in [".env", ".env.local", ".env.production.local"]:
        if (SOURCE / name).is_file():
            private_inputs.append(SOURCE / name)
    secrets = secrets_from(private_inputs)
    revision = git("rev-parse", "HEAD")
    changes = git("status", "--porcelain", "--untracked-files=all").splitlines()
    output.mkdir(parents=True)
    stage = output / "stage"
    stage.mkdir()
    source_inventory = []
    selected = []
    for name in sorted(SOURCE_DIRS):
        selected.extend(path for path in (SOURCE / name).rglob("*") if not path.is_dir())
    selected.extend(SOURCE / name for name in sorted(SOURCE_FILES))
    for path in sorted(selected):
        assert path.is_file() and not path.is_symlink(), "Unexpected source symlink or missing file."
        relative = path.relative_to(SOURCE).as_posix()
        assert not any(part.startswith(".env") or part == ".git" for part in path.relative_to(SOURCE).parts), "Private file in release source."
        assert path.stat().st_mtime <= (SOURCE / ".next/BUILD_ID").stat().st_mtime, "Source changed after the build; rebuild first."
        body = path.read_bytes()
        source_inventory.append({"path": relative, "bytes": len(body), "sha256": sha(body)})
        target = stage / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
    shutil.copytree(runtime / "node_modules", stage / "node_modules", symlinks=True)
    shutil.copytree(SOURCE / ".next", stage / ".next", symlinks=True,
                    ignore=shutil.ignore_patterns("cache", "dev", "trace", "trace-build", "diagnostics"))
    aliases = []
    for path in sorted((stage / ".next").rglob("*")):
        if not path.is_symlink():
            continue
        target = path.resolve()
        assert target.is_relative_to(stage / "node_modules") and target.is_dir(), "Unexpected Next package alias."
        relative = target.relative_to(stage).as_posix()
        assert relative in lock["packages"], "Next alias is not a locked package."
        aliases.append({"path": path.relative_to(stage).as_posix(), "target": relative})
        path.unlink()
        shutil.copytree(target, path, symlinks=True)
    assert {item["target"] for item in aliases} == {"node_modules/pg", "node_modules/pdfjs-dist"}, "Review changed Next package aliases."
    packages = []
    for package in sorted((stage / "node_modules").rglob("package.json")):
        relative = package.parent.relative_to(stage).as_posix()
        if relative not in lock["packages"]:
            continue
        installed, locked = json.loads(package.read_text()), lock["packages"][relative]
        assert installed["version"] == locked["version"] and not locked.get("dev"), "Installed runtime does not match production lock."
        packages.append({"path": relative, "version": installed["version"]})
    for name in source_package["dependencies"]:
        assert any(item["path"] == f"node_modules/{name}" for item in packages), "Required production dependency is missing."
    files, native = [], []
    for path in entries(stage):
        relative = path.relative_to(stage).as_posix()
        assert not any(part.startswith(".env") or part == ".git" for part in path.relative_to(stage).parts), "Private file in release package."
        if path.is_symlink():
            assert path.resolve().is_relative_to(stage), "External runtime symlink."
            body = os.readlink(path).encode()
            files.append({"path": relative, "bytes": len(body), "sha256": sha(body), "symlink": body.decode()})
            continue
        body = path.read_bytes()
        assert not any(secret in body for secret in secrets), "A private credential was found; package refused."
        if not relative.startswith(("node_modules/", ".next/node_modules/")):
            assert not any(marker in body for marker in FORBIDDEN_CONTENT), "Old custom sign-in found."
        if path.suffix == ".node" or ".so" in path.name:
            assert len(body) >= 20 and body[:4] == b"\x7fELF" and body[4:6] == b"\x02\x01" and struct.unpack("<H", body[18:20])[0] == 62, "Runtime contains a non-Linux-x64 binary."
            native.append(relative)
        files.append({"path": relative, "bytes": len(body), "sha256": sha(body)})
    for marker in ["canvas-linux-x64-gnu", "swc-linux-x64-gnu", "sharp-linux-x64", "sharp-libvips-linux-x64"]:
        assert any(marker in item for item in native), "A required Linux native runtime is missing."
    for item in source_inventory:
        assert sha((SOURCE / item["path"]).read_bytes()) == item["sha256"], "Source changed during packaging."
    release_time = datetime.now(timezone.utc)
    release_time = release_time.replace(second=release_time.second // 2 * 2, microsecond=0)
    manifest = {
        "kind": "namat-doctor-portal-shared-api-azure", "baseCommit": revision,
        "sourceUnmodified": not changes, "workingTreeChanges": changes,
        "sourceSha256": sha(encoded(source_inventory)), "sourceFiles": source_inventory,
        "buildId": (stage / ".next/BUILD_ID").read_text().strip(),
        "nodeMajor": 22, "runtimeTarget": {"os": "linux", "cpu": "x64", "libc": "glibc"},
        "startupCommand": "node node_modules/next/dist/bin/next start -H 0.0.0.0",
        "portEnvironmentVariable": "PORT", "zipTimestampUtc": release_time.isoformat().replace("+00:00", "Z"),
        "secretsExcluded": True, "privateScanInputs": len(private_inputs), "oldCustomLoginExcluded": True,
        "lockSha256": sha((SOURCE / "package-lock.json").read_bytes()),
        "nativeFiles": native, "materializedBuildAliases": aliases, "dependencies": packages, "files": files,
    }
    (stage / "deployment-manifest.json").write_bytes(encoded(manifest))
    archive = output / "doctor-portal-shared-api-azure.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        for path in entries(stage):
            relative = path.relative_to(stage).as_posix()
            item = zipfile.ZipInfo(relative, date_time=release_time.timetuple()[:6])
            item.create_system, item.compress_type = 3, zipfile.ZIP_DEFLATED
            if path.is_symlink():
                item.external_attr, body = (stat.S_IFLNK | 0o777) << 16, os.readlink(path).encode()
            else:
                item.external_attr = (stat.S_IFREG | (0o755 if os.access(path, os.X_OK) else 0o644)) << 16
                body = path.read_bytes()
            bundle.writestr(item, body, compresslevel=6)
    with zipfile.ZipFile(archive) as bundle:
        assert bundle.testzip() is None, "Archive failed CRC verification."
        assert set(bundle.namelist()) == {item["path"] for item in files} | {"deployment-manifest.json"}, "Archive inventory differs."
        for item in files:
            assert sha(bundle.read(item["path"])) == item["sha256"], "Archive hash differs."
    result = {"path": str(archive), "bytes": archive.stat().st_size, "sha256": sha(archive.read_bytes()), "files": len(files) + 1}
    manifest["artifact"] = result
    (output / "manifest.json").write_bytes(encoded(manifest))
    print(json.dumps({"artifact": result, "manifest": str(output / "manifest.json"), "sourceSha256": manifest["sourceSha256"],
                      "buildId": manifest["buildId"], "materializedAliases": len(aliases), "linuxNativeBinaries": len(native), "lockedRuntimePackages": len(packages)}))


if __name__ == "__main__":
    main()
