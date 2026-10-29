"""Manual Linux bundle preparation; emits an unqualified catalog candidate, never publishes."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request

parser=argparse.ArgumentParser()
parser.add_argument("engine",choices=["piper","pocket"])
parser.add_argument("destination",type=Path)
args=parser.parse_args()
base=Path(__file__).resolve().parent
out=args.destination.resolve();out.mkdir(parents=True,exist_ok=False)
url="https://github.com/astral-sh/python-build-standalone/releases/download/20260211/cpython-3.12.12%2B20260211-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz"
digest="1dbaa624a09e15afe7efbdac08d42993135a68db8d34f986ef6977a6d77bdc3c"
archive=out/"python.tar.gz"
with urllib.request.urlopen(url,timeout=120) as response: archive.write_bytes(response.read())
assert hashlib.sha256(archive.read_bytes()).hexdigest()==digest
with tarfile.open(archive) as bundle: bundle.extractall(out,filter="data")
runtime=out/"python"
command=["uv","pip","sync",str(base/(args.engine+".lock")),"--python",str(runtime/"bin/python3"),"--require-hashes","--break-system-packages"]
if args.engine=="pocket":command += ["--index","https://download.pytorch.org/whl/cpu","--index-strategy","unsafe-best-match"]
subprocess.run(command,check=True)
shutil.copy(base/"worker.py",runtime/"worker.py")
shutil.copy(base/(args.engine+".lock"),runtime/"requirements.lock")
# Retain installed dist-info notices and CPython license. Source compliance is
# reviewed before any candidate is qualified/published.
for command in (runtime/"bin").iterdir():
 if not command.name.startswith("python"):command.unlink()
files=[]
with (out/"runtime.tar.gz").open("wb") as raw, gzip.GzipFile(filename="",mode="wb",fileobj=raw,mtime=0) as compressed, tarfile.open(fileobj=compressed,mode="w",format=tarfile.USTAR_FORMAT,dereference=True) as bundle:
 for file in sorted(runtime.rglob("*")):
  if not file.is_file() or "__pycache__" in file.parts:continue
  name=file.relative_to(runtime).as_posix()
  data=file.read_bytes()
  files.append({"file":name,"bytes":len(data),"sha256":hashlib.sha256(data).hexdigest(),"url":""})
  info=bundle.gettarinfo(str(file),arcname=name)
  info.uid=info.gid=0;info.uname=info.gname="";info.mtime=0
  with file.open("rb") as stream:bundle.addfile(info,stream)
archive=out/"runtime.tar.gz"
(out/"runtime.json").write_text(json.dumps({"url":None,"bytes":archive.stat().st_size,"sha256":hashlib.sha256(archive.read_bytes()).hexdigest(),"files":files},indent=2)+"\n")
print(json.dumps({"engine":args.engine,"bytes":archive.stat().st_size,"qualified":False}))
