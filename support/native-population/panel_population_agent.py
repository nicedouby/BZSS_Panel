"""Fixed-path local bridge. No shell, browser paths, credentials, or game restart API."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import socket
import socketserver
import stat
import struct
import subprocess
import sys
import threading
import time

BROKER = '/run/squad-population/control.sock'
SOCKET = Path('/run/bzss-panel-population/control.sock')
PROFILE = Path('/etc/bzss-panel-native/fixed-profile.json')
GAME = '/opt/squad/game/SquadGame/Binaries/Linux/SquadGameServer'
LIBDIR = Path('/opt/squad-population/bzss-node')
ORIGINAL = '99143250c79bd0762e194c7015cce2b1896e51dd60a1abaa1161ad273ced6e57'
CANDIDATE = '9e4129eb1115ef00a0813db7f113b0b7e0457a6cc70c490980406effe6bac36d'
LOCK = threading.Lock()

class Refused(Exception):
    def __init__(self, message, status=409, outcome='not_submitted'):
        self.message, self.status, self.outcome = message, status, outcome

def load(raw):
    def pairs(rows):
        out = {}
        for k, v in rows:
            if k in out: raise ValueError('duplicate key')
            out[k] = v
        return out
    return json.loads(raw, object_pairs_hook=pairs)

def broker_exchange(value):
    with socket.socket(socket.AF_UNIX) as sock:
        sock.settimeout(3)
        sock.connect(BROKER)
        _, uid, _ = struct.unpack('3i', sock.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        if uid != 0: raise ValueError('unexpected broker owner')
        sock.sendall((json.dumps(value, separators=(',', ':'))+'\n').encode())
        raw = sock.makefile('rb').readline(16385)
        if len(raw)>16384 or not raw.endswith(b'\n'): raise ValueError('broker frame')
        result = load(raw)
        if result.get('status') != 200: raise ValueError('broker rejected')
        return result['body']

def broker(value):
    # The existing broker accepts UID 995; the web/game account cannot write it directly.
    try:
        result = subprocess.run([sys.executable, '-B', str(Path(__file__).resolve()), '--broker-call'],
            input=json.dumps(value), text=True, capture_output=True, timeout=4,
            user=995, group=990, extra_groups=[990], check=True)
        return load(result.stdout)
    except Exception:
        raise Refused('原生控制服务不可用，请重新读取状态。', 503,
                      'unknown' if value.get('op') == 'population_set' else 'not_submitted') from None

def file_digest(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError('file ownership')
        if info.st_size > 4*1024*1024: raise ValueError('library too large')
        with os.fdopen(fd, 'rb', closefd=False) as f:
            digest = hashlib.sha256(f.read()).hexdigest()
        return digest, info
    finally: os.close(fd)

def native_binding():
    """Bind hash to the sole process's mapped inode, not a replaced on-disk file."""
    try:
        games = []
        for p in Path('/proc').glob('[0-9]*'):
            try:
                if os.readlink(p/'exe') == GAME: games.append(p)
            except OSError: pass
        if len(games) != 1: return None
        libraries = set()
        for row in (games[0]/'maps').read_text().splitlines():
            parts = row.split(maxsplit=5)
            if len(parts) != 6 or 'x' not in parts[1]: continue
            path = Path(parts[5])
            if path.parent != LIBDIR or not re.fullmatch(r'libpopulation[\w.-]*\.so', path.name): continue
            digest, info = file_digest(path)
            major, minor = (int(x,16) for x in parts[3].split(':'))
            if os.makedev(major,minor) != info.st_dev or int(parts[4]) != info.st_ino: continue
            libraries.add(digest)
        return libraries.pop() if len(libraries) == 1 else None
    except (OSError, ValueError): return None

def verified_profile(digest):
    # The original and the incomplete experimental patch cannot be enabled by a profile.
    if not digest or digest in (ORIGINAL, CANDIDATE): return None
    try:
        info = PROFILE.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022 or info.st_size > 2048:
            return None
        p = load(PROFILE.read_bytes())
        startup_name=p.pop('startup_broker',None)
        startup_sha=p.pop('startup_broker_sha256',None)
        if startup_name is not None or startup_sha is not None:
            if (not isinstance(startup_name,str) or not re.fullmatch(r'population_broker_fixed_owned_[0-9a-f]{8}\.py',startup_name)
                    or not isinstance(startup_sha,str) or not re.fullmatch('[0-9a-f]{64}',startup_sha)):
                return None
        if p == {'schema':1, 'library_sha256':digest, 'mode':'fixed_owned',
                 'full_policy':'preserve_owned_queue_humans', 'live_verified':True}:
            return {'queueVerified':True}
        expected = {'schema':2, 'library_sha256':digest, 'mode':'fixed_owned',
                    'full_policy':'preserve_owned_queue_humans', 'fixed_count_verified':True,
                    'publisher_verified':True, 'queue_verified':False}
        if p == expected: return {'queueVerified':False}
        return None
    except (OSError, ValueError): return None

def fixed_verified(digest):
    return verified_profile(digest) is not None

def prepare_game_start():
    # Local launch-script operation only; the HTTP API never exposes it.
    # The pinned broker refuses to prepare while its game executable is alive.
    try:
        info=PROFILE.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022 or info.st_size>2048:
            raise ValueError('unsafe startup profile')
        p=load(PROFILE.read_bytes());digest=p.get('library_sha256')
        if not fixed_verified(digest):raise ValueError('startup profile not verified')
        name=p.get('startup_broker');expected=p.get('startup_broker_sha256')
        if not isinstance(name,str) or not re.fullmatch(r'population_broker_fixed_owned_[0-9a-f]{8}\.py',name):
            raise ValueError('startup broker name')
        broker_path=Path('/opt/bzss-team/node')/name
        actual,_=file_digest(broker_path)
        if actual!=expected:raise ValueError('startup broker hash')
        completed=subprocess.run([sys.executable,'-B',str(broker_path),'prepare-start'],
            text=True,capture_output=True,timeout=4,check=True)
        result=load(completed.stdout)
        if result.get('prepared') is not True or result.get('paused') is not True or result.get('target')!=0:
            raise ValueError('startup reset not confirmed')
        return result
    except Exception:
        raise Refused('启动前归零未获确认；请确认旧游戏进程已停止。',409) from None

def configuration_ready(s):
    """A saved target is intent; native roster operations still need admission."""
    rt = s.get('runtime') or {}
    return bool(s.get('epoch') and s.get('config') and rt.get('armed') is True
                and rt.get('failed') is False and rt.get('gt_fresh') is True
                and not rt.get('waiting_world_change') and s.get('reason') != 'map_transition_pending')

def fixed_count_limit(s):
    config=s.get('config') or {}
    capacity,reserved=config.get('capacity'),config.get('reserved_slots')
    if type(capacity) is not int or type(reserved) is not int or not 1<=reserved<capacity<=100:
        return 0
    return min(99,capacity-reserved)  # Generated names remain unique against the live census.

def status():
    s = broker({'op':'population_status'})
    if s.get('target_id') != 'bzss-node' or s.get('schema') != 1:
        raise Refused('原生服务目标不匹配。', 502)
    if not isinstance(s.get('observed_at'), (int,float)) or not -2 <= time.time()-s['observed_at'] <= 15:
        raise Refused('原生状态已过期，请重新读取。', 503)
    digest = native_binding()
    verified = fixed_verified(digest)
    queue_verified = bool(verified and (verified_profile(digest) or {}).get('queueVerified'))
    mode = 'fixed_owned' if verified else 'total' if digest == ORIGINAL else 'fixed_owned_unverified' if digest == CANDIDATE else 'unknown'
    message = (('固定占位、原生人数发布和满服排队均已验证。' if queue_verified else '固定占位和原生人数发布已验证；满服排队尚未实测。') if verified else
               '当前原生库按目标总人数工作，不能提交固定占位数量。' if mode == 'total' else
               '固定占位候选库尚未完成发布人数和入场验证，暂不能启用。' if mode == 'fixed_owned_unverified' else
               '未识别到已验证的原生库，请检查游戏进程与接入配置。')
    if verified and not s.get('available'):
        message = (('人数扫描正在刷新，可以保存新目标；实际增减会等待扫描和入场状态就绪。'
                    if s.get('runtime',{}).get('census_fresh') is False else
                    '入场状态正在刷新，可以保存新的固定占位目标；实际增减会等待服务端确认。')
                   if configuration_ready(s) else
                   '游戏线程或控制器尚未就绪，暂不能保存新目标；请稍后读取状态。')
    return {'connected':True, 'server':'BZSS 正式服', 'mode':mode, 'reason':s.get('reason'),
            'message':message, 'librarySha256':digest,
            'capabilities':{'fixedOwned':verified, 'maxFixedCount':fixed_count_limit(s) if verified else 0, 'configureFixedCount':bool(verified and configuration_ready(s)), 'queueVerified':queue_verified, 'pause':bool(s.get('epoch') and s.get('config') and s.get('runtime',{}).get('armed'))},
            'status':s}

def handle(value):
    if not isinstance(value,dict): raise Refused('请求格式无效。',400)
    op = value.get('op')
    if value == {'op':'status'}: return status()
    if value == {'op':'prepare_start'}: return prepare_game_start()
    required = {'op','operationId','expectedEpoch','expectedVersion'} | ({'count'} if op == 'set_fixed_count' else set())
    if op not in ('set_fixed_count','pause') or set(value) != required:
        raise Refused('请求格式无效。',400)
    for key, length in [('operationId',32),('expectedEpoch',64),('expectedVersion',64)]:
        if not isinstance(value[key],str) or not re.fullmatch('[0-9a-f]{%d}'%length,value[key]):
            raise Refused('状态版本格式无效。',400)
    count = value.get('count',0)
    if type(count) is not int or not 0<=count<=99: raise Refused('人数必须是 0–99 的整数。',400)
    current = status()
    if op == 'set_fixed_count' and not current['capabilities']['fixedOwned']:
        raise Refused(current['message'])
    s = current['status']
    if op == 'set_fixed_count' and count>fixed_count_limit(s):
        raise Refused('当前词库与服务器容量最多支持 %d 个固定占位，请减少目标数量。'%fixed_count_limit(s),400)
    if op == 'set_fixed_count' and not configuration_ready(s):
        raise Refused('游戏线程已过期、正在切图或控制器异常，未提交新数量；请重新读取状态。')
    if not s.get('epoch') or not s.get('config') or not s.get('runtime',{}).get('armed'):
        raise Refused('原生控制器尚未就绪。')
    if s['epoch'] != value['expectedEpoch'] or s['config']['version'] != value['expectedVersion']:
        raise Refused('地图或配置已变化，请重新读取后提交。')
    result = broker({'op':'population_set','operation_id':value['operationId'],
                     'expected_epoch':value['expectedEpoch'],'expected_version':value['expectedVersion'],
                     'target':count,'enabled':count>0})
    if result.get('operation_id') != value['operationId']:
        raise Refused('提交结果无法确认，请重新读取状态。',502,'unknown')
    # Do not turn accepted into applied or retry an uncertain mutation.
    return {'outcome':result.get('outcome','unknown'),'reason':result.get('reason'),
            'accepted':result.get('accepted') is True,'applied':result.get('applied') is True,
            'operationId':value['operationId'],'requestedFixedCount':count if op=='set_fixed_count' else None}

class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        try:
            _,uid,_=struct.unpack('3i',self.request.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))
            if uid not in (0,self.server.panel_uid): raise Refused('本地进程无权访问。',403)
            self.request.settimeout(8)
            raw=self.rfile.readline(4097)
            if len(raw)>4096 or not raw.endswith(b'\n'): raise Refused('请求过大。',400)
            with LOCK: body=handle(load(raw))
            response={'ok':True,'body':body}
        except Refused as e:
            response={'ok':False,'statusCode':e.status,'message':e.message,'outcome':e.outcome}
        except Exception:
            response={'ok':False,'statusCode':503,'message':'原生代理暂不可用，请重新读取。','outcome':'unknown'}
        self.wfile.write((json.dumps(response,separators=(',',':'),ensure_ascii=False)+'\n').encode())

class Server(socketserver.UnixStreamServer):
    # Serial requests plus fixed read/child timeouts bound helper resource use.
    request_queue_size=4

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--broker-call',action='store_true')
    args=parser.parse_args()
    if args.broker_call:
        raw=sys.stdin.buffer.read(4097)
        if len(raw)>4096: raise SystemExit(2)
        print(json.dumps(broker_exchange(load(raw))))
        return
    if os.geteuid()!=0: raise SystemExit('root bridge required')
    parent=SOCKET.parent.lstat()
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid!=0 or parent.st_mode&0o022:
        raise SystemExit('unsafe runtime directory')
    if SOCKET.exists() or SOCKET.is_symlink(): raise SystemExit('inspect existing bridge socket before restarting')
    panel=pwd.getpwnam('steam')
    try:
        with Server(str(SOCKET),Handler) as server:
            server.panel_uid=panel.pw_uid
            os.chown(SOCKET,0,panel.pw_gid);os.chmod(SOCKET,0o660)
            server.serve_forever()
    finally:
        SOCKET.unlink(missing_ok=True)

if __name__=='__main__':main()
