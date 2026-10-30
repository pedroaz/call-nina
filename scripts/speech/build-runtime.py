"""Prepare a private, relocatable CPU runtime candidate; never publish or synthesize."""
import argparse
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import signal
import subprocess
import tarfile
import urllib.request

os.umask(0o077)
def cancelled(_signal, _frame):
    # subprocess.run kills and reaps its exact child when this unwinds.
    raise SystemExit("OD_SPEECH_PREPARATION_CANCELLED")
signal.signal(signal.SIGINT, cancelled)
signal.signal(signal.SIGTERM, cancelled)
parser = argparse.ArgumentParser()
parser.add_argument("engine", choices=["piper", "pocket"])
parser.add_argument("destination", type=Path)
args = parser.parse_args()
if platform.system() != "Linux" or platform.machine() != "x86_64":
    raise SystemExit("OD_SPEECH_PLATFORM_UNSUPPORTED")
base = Path(__file__).resolve().parent
out = args.destination.resolve()
out.mkdir(parents=True, exist_ok=True, mode=0o700)
build_lock = (out / "build.lock").open("a")
try:
    fcntl.flock(build_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    raise SystemExit("OD_SPEECH_PREPARATION_BUSY")
url = "https://github.com/astral-sh/python-build-standalone/releases/download/20260211/cpython-3.12.12%2B20260211-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz"
digest = "1dbaa624a09e15afe7efbdac08d42993135a68db8d34f986ef6977a6d77bdc3c"

def sha(file):
    with file.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()

def atomic_json(file, value):
    temporary = file.with_suffix(file.suffix + ".new")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(file)

source_names = ("build-runtime.py", "validate-runtime.py", "worker.py", args.engine + ".lock")
source_files = {name: (base / name).read_bytes() for name in source_names}
source_digest = hashlib.sha256(b"".join(source_files.values())).hexdigest()
receipt = out / "runtime.json"
archive = out / "runtime.tar.gz"
marker = out / "build-owner.json"
if marker.is_file():
    if json.loads(marker.read_text()) != {"sourceDigest": source_digest}:
        raise SystemExit("OD_SPEECH_RUNTIME_CANDIDATE_CONFLICT")
elif any(file.name != "build.lock" for file in out.iterdir()):
    raise SystemExit("OD_SPEECH_RUNTIME_CANDIDATE_CONFLICT")
else:
    atomic_json(marker, {"sourceDigest": source_digest})
if receipt.is_file() and archive.is_file():
    existing = json.loads(receipt.read_text())
    if existing["sourceDigest"] == source_digest and sha(archive) == existing["sha256"]:
        subprocess.run(["python3", str(base / "validate-runtime.py"), args.engine, str(out)], check=True)
        print(json.dumps({"engine": args.engine, "reused": True, "bytes": archive.stat().st_size}))
        raise SystemExit(0)
    raise SystemExit("OD_SPEECH_RUNTIME_CANDIDATE_CONFLICT")

python_archive = out / "python.tar.gz"
if not python_archive.is_file() or sha(python_archive) != digest:
    temporary = out / "python.tar.gz.part"
    with urllib.request.urlopen(url, timeout=120) as response, temporary.open("wb") as target:
        shutil.copyfileobj(response, target, 1024 * 1024)
    if sha(temporary) != digest:
        raise SystemExit("OD_SPEECH_PYTHON_INTEGRITY")
    temporary.replace(python_archive)
runtime = out / "python"
# A private marker proves which incomplete build directory can be replaced.
if runtime.exists():
    if not marker.is_file() or json.loads(marker.read_text()) != {"sourceDigest": source_digest}:
        raise SystemExit("OD_SPEECH_RUNTIME_CANDIDATE_CONFLICT")
    shutil.rmtree(runtime)
atomic_json(marker, {"sourceDigest": source_digest})
with tarfile.open(python_archive) as bundle:
    bundle.extractall(out, filter="data")
lock_file = out / "requirements.lock"
lock_file.write_bytes(source_files[args.engine + ".lock"])
command = ["uv", "pip", "sync", str(lock_file), "--python",
    str(runtime / "bin/python3"), "--require-hashes", "--break-system-packages", "--no-compile-bytecode", "--only-binary", ":all:"]
if args.engine == "pocket":
    command += ["--index", "https://download.pytorch.org/whl/cpu", "--index-strategy", "unsafe-best-match"]
subprocess.run(command, check=True)
(runtime / "worker.py").write_bytes(source_files["worker.py"])
(runtime / "requirements.lock").write_bytes(source_files[args.engine + ".lock"])
for executable in (runtime / "bin").iterdir():
    if not executable.name.startswith("python"):
        executable.unlink()
# Eliminate installer-generated absolute paths while retaining dependency notices.
for cache in list(runtime.rglob("__pycache__")):
    shutil.rmtree(cache)
for file in runtime.rglob("direct_url.json"):
    file.unlink()
# Dependency / codec validation only: no model load, synthesis, or audio playback.
probe = '''
import importlib.metadata as m, json, platform, soundfile as sf, sys
import numpy
assert sys.version_info[:2] == (3, 12)
assert "OPUS" in sf.available_subtypes("OGG")
engine = sys.argv[1]
if engine == "piper":
    import piper, onnxruntime
    from piper.phonemize_espeak import ESPEAK_DATA_DIR
    from pathlib import Path
    assert Path(ESPEAK_DATA_DIR).is_dir()
else:
    import pocket_tts, torch
    from pocket_tts.utils.config import CONFIGS_DIR
    assert torch.version.cuda is None
    assert all((CONFIGS_DIR / (language + ".yaml")).is_file() for language in ("german", "english", "portuguese", "spanish"))
print(json.dumps({"pythonVersion": platform.python_version(), "packages": sorted([{"name": d.metadata["Name"], "version": d.version} for d in m.distributions()], key=lambda d: d["name"].lower()), "opus": True}))
'''
checked = subprocess.run([str(runtime / "bin/python3"), "-I", "-B", "-c", probe, args.engine],
    check=True, capture_output=True, text=True, env={**os.environ, "OMP_NUM_THREADS": "2", "OPENBLAS_NUM_THREADS": "2"})
validation = json.loads(checked.stdout)
atomic_json(runtime / "dependency-inventory.json", validation)
# Compile worker syntax without creating bytecode or executing it.
compile((runtime / "worker.py").read_text(), "worker.py", "exec")
files = []
temporary = out / "runtime.tar.gz.part"
with temporary.open("wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0, compresslevel=1) as compressed, tarfile.open(fileobj=compressed, mode="w", format=tarfile.USTAR_FORMAT, dereference=True) as bundle:
    for file in sorted(runtime.rglob("*")):
        if not file.is_file() or "__pycache__" in file.parts:
            continue
        name = file.relative_to(runtime).as_posix()
        executable = bool(file.stat().st_mode & 0o111)
        files.append({"file": name, "url": "", "bytes": file.stat().st_size,
            "sha256": sha(file), "executable": executable})
        info = bundle.gettarinfo(str(file), arcname=name)
        info.uid = info.gid = 0
        info.uname = info.gname = ""
        info.mtime = 0
        info.mode = 0o700 if executable else 0o600
        with file.open("rb") as stream:
            bundle.addfile(info, stream)
temporary.replace(archive)
atomic_json(receipt, {"sourceDigest": source_digest, "bytes": archive.stat().st_size,
    "sha256": sha(archive), "files": files, **validation})
subprocess.run(["python3", str(base / "validate-runtime.py"), args.engine, str(out)], check=True)
print(json.dumps({"engine": args.engine, "bytes": archive.stat().st_size,
    "sha256": sha(archive), "qualified": False}))
