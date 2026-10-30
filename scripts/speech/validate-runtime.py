"""Inspect a runtime archive and its relocated dependencies; never load voice models."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument("engine", choices=["piper", "pocket"])
parser.add_argument("directory", type=Path)
args = parser.parse_args()
root = args.directory.resolve()
metadata = json.loads((root / "runtime.json").read_text())
expected = {file["file"]: file for file in metadata["files"]}
with (root / "runtime.tar.gz").open("rb") as stream:
    assert hashlib.file_digest(stream, "sha256").hexdigest() == metadata["sha256"]
with tempfile.TemporaryDirectory(prefix="relocated-", dir=root) as directory:
    relocated = Path(directory)
    with tarfile.open(root / "runtime.tar.gz") as bundle:
        seen = set()
        for member in bundle:
            assert member.name in expected and member.name not in seen and member.isfile()
            spec = expected[member.name]
            assert not member.name.startswith("/") and ".." not in Path(member.name).parts
            assert member.size == spec["bytes"]
            assert bool(member.mode & 0o100) == spec["executable"]
            target = relocated / member.name
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            digest = hashlib.sha256()
            with bundle.extractfile(member) as stream, target.open("xb") as output:
                while chunk := stream.read(1024 * 1024):
                    digest.update(chunk)
                    output.write(chunk)
            assert digest.hexdigest() == spec["sha256"]
            target.chmod(0o700 if spec["executable"] else 0o600)
            seen.add(member.name)
        assert seen == expected.keys()
    probe = '''
import importlib.metadata as m, json, pathlib, platform, soundfile as sf, sys
import numpy
assert sys.version_info[:2] == (3, 12)
assert pathlib.Path(sys.prefix).resolve() == pathlib.Path(sys.argv[2]).resolve()
assert "OPUS" in sf.available_subtypes("OGG")
if sys.argv[1] == "piper":
    import piper, onnxruntime
    from piper.phonemize_espeak import ESPEAK_DATA_DIR
    assert pathlib.Path(ESPEAK_DATA_DIR).is_dir()
else:
    import pocket_tts, torch
    from pocket_tts.utils.config import CONFIGS_DIR
    assert torch.version.cuda is None
    assert all((CONFIGS_DIR / (language + ".yaml")).is_file() for language in ("german", "english", "portuguese", "spanish"))
print(json.dumps({"pythonVersion": platform.python_version(), "packages": sorted([{"name": d.metadata["Name"], "version": d.version} for d in m.distributions()], key=lambda d: d["name"].lower()), "opus": True}))
'''
    checked = subprocess.run([str(relocated / "bin/python3"), "-I", "-B", "-c", probe,
        args.engine, str(relocated)], check=True, capture_output=True, text=True,
        env={"PATH": str(relocated / "bin"), "HOME": str(relocated),
            "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "OMP_NUM_THREADS": "2", "OPENBLAS_NUM_THREADS": "2"})
    observed = json.loads(checked.stdout)
    assert observed["packages"] == metadata["packages"]
    compile((relocated / "worker.py").read_text(), "worker.py", "exec")
print(json.dumps({"engine": args.engine, "archiveIntegrity": True, "relocatable": True,
    "dependencies": True, "opus": True, "synthesis": "not-run"}))
