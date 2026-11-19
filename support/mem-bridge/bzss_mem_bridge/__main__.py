import argparse
import json
from pathlib import Path
import re
import sys
from . import __version__
from .memory import BridgeError
from .reader import Reader
from .server import serve


def load_config(path):
    path=Path(path).resolve();config=json.loads(path.read_text(encoding='utf-8'))
    if config.get('schema')!=1 or not isinstance(config.get('targets'),list) or not 1<=len(config['targets'])<=16:
        raise BridgeError('invalid_config','Config requires schema 1 and 1–16 explicit targets.')
    seen=set();profiles={}
    for target in config['targets']:
        key=target.get('id','')
        if not re.fullmatch('[a-zA-Z0-9_-]{1,32}',key) or key in seen:raise BridgeError('invalid_config','Target IDs must be unique and bounded.')
        seen.add(key)
        if not isinstance(target.get('executable'),str) or not target['executable'].startswith('/'):raise BridgeError('invalid_config','Target executable must be absolute.')
        source=(path.parent/target['profile']).resolve();target['profile']=str(source)
        profile=json.loads(source.read_text(encoding='utf-8'))
        if profile.get('schema')!=1 or not re.fullmatch('[a-f0-9]{64}',profile.get('gameSha256','')):
            raise BridgeError('invalid_profile','Invalid layout profile.')
        if not 1<=target.get('pointScanIntervalSeconds',5)<=3600:raise BridgeError('invalid_config','Point scan interval is out of range.')
        if not .25<=target.get('playerStatsIntervalSeconds',config.get('playerStatsIntervalSeconds',1))<=60:raise BridgeError('invalid_config','Player stats scan interval is out of range.')
        profiles[str(source)]=profile
    if config.get('defaultTarget') not in seen:config['defaultTarget']=config['targets'][0]['id']
    if (not .05<=config.get('intervalSeconds',.5)<=60
        or not .25<=config.get('playerStatsIntervalSeconds',1)<=60
        or not 1<=config.get('maxAgeSeconds',4)<=120):
        raise BridgeError('invalid_config','Sampling interval or freshness limit is out of range.')
    if type(config.get('port',31903)) is not int or not 1024<=config.get('port',31903)<=65535:
        raise BridgeError('invalid_config','HTTP port is out of range.')
    return config,profiles


def main():
    parser=argparse.ArgumentParser(prog='bzss-mem-bridge',description='Independent Linux read-only Squad memory telemetry.')
    parser.add_argument('--version',action='version',version='BZSS-MEM-BRIDGE '+__version__)
    parser.add_argument('--config',default='config.example.json')
    commands=parser.add_subparsers(dest='command',required=True)
    snapshot=commands.add_parser('snapshot',help='Read one validated JSON snapshot.')
    snapshot.add_argument('--target');snapshot.add_argument('--output',help='Optional local UTF-8 JSON file.')
    commands.add_parser('serve',help='Run the independent loopback HTTP service.')
    args=parser.parse_args()
    try:
        config,profiles=load_config(args.config)
        if args.command=='serve':return serve(config,profiles)
        target_id=args.target or config['defaultTarget'];target=next((t for t in config['targets'] if t['id']==target_id),None)
        if target is None:raise BridgeError('unknown_target','Target is not in the configured allowlist.')
        data=Reader(target,profiles[target['profile']]).snapshot()
        text=json.dumps(data,ensure_ascii=False,allow_nan=False,indent=2)
        if args.output:Path(args.output).write_text(text+'\n',encoding='utf-8')
        else:print(text)
    except (BridgeError,OSError,ValueError,KeyError) as exc:
        print(json.dumps({'module':'BZSS-MEM-BRIDGE','error':getattr(exc,'code','configuration_error'),'message':str(exc)}),file=sys.stderr)
        return 1
    return 0


if __name__=='__main__':sys.exit(main())
