#!/usr/bin/env python3
"""Hash-bound isolated Linux compile/fixture runner. Never loads the game SO."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import types

ROOT = Path(__file__).resolve().parents[1]
REMOTE_BASE = "/var/lib/squad-native-research/population-fixed-display-20261106"
parser=argparse.ArgumentParser(description=__doc__)
mode=parser.add_mutually_exclusive_group(required=True)
mode.add_argument('--render-only',type=Path,help='Write exact remote program locally; never connects')
mode.add_argument('--collect',type=Path,help='Collect a root-executed remote JSON receipt locally')
mode.add_argument('--ssh-argv-json',type=Path,help='Use explicit reviewed local ssh_argv object; no default transport')
args=parser.parse_args()

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()

plan = json.loads((ROOT/"runtime/build-plan.json").read_text())
sources = {p: (ROOT/p).read_bytes() for p in plan["sources"]}
hashes = {p: hashlib.sha256(b).hexdigest() for p, b in sources.items()}
bundle = hashlib.sha256(canonical({"plan": plan, "sources": hashes})).hexdigest()
payload = {"bundle": bundle, "plan": plan, "hashes": hashes,
           "files": {p: base64.b64encode(b).decode() for p, b in sources.items()}}
evidence_path = ROOT/f"runtime/evidence/build-{bundle}.json"
if evidence_path.exists():
    sys.exit("Immutable build receipt already exists; inspect it rather than retry")

REMOTE = r'''
import base64, hashlib, json, os, pathlib, re, subprocess, sys, time
payload = json.loads(base64.b64decode(PAYLOAD))
def canonical(value): return json.dumps(value,sort_keys=True,separators=(",",":")).encode()
assert payload["bundle"] == hashlib.sha256(canonical({"plan":payload["plan"],"sources":payload["hashes"]})).hexdigest()
assert re.fullmatch(r"[a-f0-9]{64}",payload["bundle"])
base=pathlib.Path("/var/lib/squad-native-research/population-fixed-display-20261106")
base.mkdir(mode=0o700,parents=True,exist_ok=True)
assert not base.is_symlink() and base.is_dir()
root=base/("build-"+payload["bundle"])
root.mkdir(mode=0o700,exist_ok=False)
for name,encoded in payload["files"].items():
    rel=pathlib.PurePosixPath(name)
    assert len(rel.parts)>=2 and not rel.is_absolute() and all(p not in (".","..","") for p in rel.parts)
    assert rel.suffix in (".c",".h",".inc",".S",".py")
    data=base64.b64decode(encoded,validate=True)
    assert hashlib.sha256(data).hexdigest()==payload["hashes"][name]
    destination=root/name
    destination.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    with destination.open("xb") as f:f.write(data)
(root/"tmp").mkdir(mode=0o700)
env=dict(os.environ,TMPDIR=str(root/"tmp"),PYTHONDONTWRITEBYTECODE="1",
         ASAN_OPTIONS="detect_leaks=1:abort_on_error=1",UBSAN_OPTIONS="halt_on_error=1:print_stacktrace=1")
env.pop("LD_PRELOAD",None)
receipt={"schema":1,"source_bundle":payload["bundle"],"directory":str(root),
         "scope":"compile and pure fixtures only; no game, no SO load, no service changes",
         "compiler":subprocess.run(["gcc","--version"],capture_output=True,text=True,check=True).stdout.splitlines()[0],
         "sources":payload["hashes"],"steps":[],"success":False,"artifacts":{}}
for step in payload["plan"]["steps"]:
    command=step["command"]
    assert command and (command[0] in ("gcc","readelf","python3") or re.fullmatch(r"\./fixture_[a-z_]+",command[0]))
    assert not any(".." in pathlib.PurePosixPath(arg).parts for arg in command)
    begin=time.monotonic()
    try:
        result=subprocess.run(command,cwd=root,env=env,capture_output=True,text=True,timeout=120)
        row={"name":step["name"],"command":command,"exit_code":result.returncode,
             "elapsed_seconds":round(time.monotonic()-begin,4),"stdout":result.stdout,"stderr":result.stderr}
    except subprocess.TimeoutExpired as exc:
        row={"name":step["name"],"command":command,"exit_code":-1,"error":"timeout"}
    receipt["steps"].append(row)
    if row["exit_code"]: break
else:
    receipt["success"]=True
    for name in payload["plan"]["artifacts"]:
        assert name=="libsquad_joint_population.so"
        data=(root/name).read_bytes()
        receipt["artifacts"][name]={"sha256":hashlib.sha256(data).hexdigest(),"bytes":len(data),"base64":base64.b64encode(data).decode()}
with (root/"build-receipt.json").open("x") as f:json.dump(receipt,f,indent=2,sort_keys=True)
print(json.dumps(receipt,sort_keys=True))
'''
program = "PAYLOAD = " + repr(base64.b64encode(canonical(payload)).decode()) + "\n" + REMOTE
if args.render_only:
    os.umask(0o077)
    with args.render_only.open('x') as stream:stream.write(program)
    print(json.dumps({'rendered_only':True,'remote_executed':False,'source_bundle':bundle,
        'program_sha256':hashlib.sha256(program.encode()).hexdigest(),'sources':len(sources),
        'steps':len(plan['steps']),'remote_directory':REMOTE_BASE+'/build-'+bundle}))
    sys.exit(0)
if args.collect:
    result=types.SimpleNamespace(returncode=0,stdout=args.collect.read_text(),stderr='')
else:
    transport=json.loads(args.ssh_argv_json.read_text())['ssh_argv']
    assert isinstance(transport,list) and transport and transport[0]=='ssh' and all(isinstance(v,str) and v for v in transport)
    result=subprocess.run(transport,input=program,capture_output=True,text=True,timeout=900)
if result.returncode:
    evidence_path.write_text(json.dumps({'kind':'transport_failure','source_bundle':bundle,'ssh_exit_code':result.returncode,'stderr':result.stderr,'stdout':result.stdout},indent=2)+'\n')
    sys.exit(f'Transport failed before a compile receipt was received; inspect remote unique directory before any retry: {evidence_path}')
try:
    receipt=json.loads(result.stdout)
except json.JSONDecodeError:
    evidence_path.write_text(json.dumps({"source_bundle":bundle,"parse_failed":True,"stderr":result.stderr,"stdout":result.stdout},indent=2)+"\n")
    raise
assert receipt['source_bundle']==bundle and receipt['sources']==hashes
assert set(receipt['artifacts']) <= {'libsquad_joint_population.so'}
for name,entry in receipt["artifacts"].items():
    data=base64.b64decode(entry.pop("base64"),validate=True)
    assert hashlib.sha256(data).hexdigest()==entry["sha256"]
    destination=ROOT/"runtime/artifacts"/name
    if destination.exists():
        assert destination.read_bytes()==data
    else:
        destination.write_bytes(data)
    entry["local_path"]=str(destination)
receipt["transport_stderr"]=result.stderr
evidence_path.write_text(json.dumps(receipt,indent=2,sort_keys=True)+"\n")
print(json.dumps({"success":receipt["success"],"source_bundle":bundle,"receipt":str(evidence_path),
                  "steps":[{"name":s["name"],"exit_code":s["exit_code"],"stdout":s.get("stdout","")[:1500] if (s["name"].endswith("_run") or s["name"].startswith("ticket_runtime") or s["exit_code"]) else "", "stderr":s.get("stderr","")[:2000]} for s in receipt["steps"]],
                  "artifacts":receipt["artifacts"]},ensure_ascii=False,indent=2))
sys.exit(0 if receipt["success"] else 1)
