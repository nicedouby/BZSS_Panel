import ipaddress
import json
import os
import struct
import threading
import time
from pathlib import Path
from . import __version__
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlsplit,parse_qs
from .reader import Reader
from .memory import BridgeError


class Sampler:
    def __init__(self,target,profile,interval,max_age):
        self.target=target;self.reader=Reader(target,profile);self.interval=interval;self.max_age=max_age
        self.lock=threading.Lock();self.stop_event=threading.Event();self.data=None;self.published=0
        self.last_success=None;self.last_state=None
        self.last_good=None;self.last_good_at=0.0

    def start(self):
        self.thread=threading.Thread(target=self.run,name='read-'+self.target['id'],daemon=True);self.thread.start()

    def unavailable(self,code,message):
        return {'schema':1,'module':'BZSS-MEM-BRIDGE','version':__version__,'readOnly':True,'target':self.target['id'],
            'observedAt':time.time(),'epoch':None,'map':None,'players':[],'mapPoints':[],
            'health':{'status':'unavailable','code':code,'message':message,'lastSuccessAt':self.last_success}}

    def run(self):
        invalidating_errors={
            'build_mismatch','elf_mismatch','layout_guard_mismatch',
            'process_not_unique','process_changed','permission_denied',
            'world_changed','world_unavailable','object_table_unavailable',
        }
        while not self.stop_event.is_set():
            began=time.monotonic();delay=self.interval
            try:
                value=self.reader.snapshot();state='ok'
                self.last_success=value['observedAt']
                self.last_good=value
                self.last_good_at=time.monotonic()
            except BridgeError as exc:
                value=self.unavailable(exc.code,str(exc));state=exc.code
                if exc.code in ('build_mismatch','process_not_unique','permission_denied'):
                    delay=max(5,self.interval)
            except (OSError,ValueError,struct.error):
                value=self.unavailable('read_unavailable','Game data changed or became unavailable.')
                state='read_unavailable'
            except Exception:
                value=self.unavailable('reader_error','Reader could not produce a complete snapshot.')
                state='reader_error'

            if state in invalidating_errors:
                self.last_good=None
                self.last_good_at=0.0
            elif state!='ok' and self.last_good is not None:
                age=time.monotonic()-self.last_good_at
                if age<=self.max_age:
                    # A transient failure should not erase previously known entities.
                    # Degraded snapshots remain explicitly marked and age out.
                    value={**self.last_good,'health':{
                        **self.last_good['health'],'status':'degraded',
                        'code':state,'message':value['health'].get('message'),
                        'lastSuccessAt':self.last_success,
                        'staleAgeSeconds':round(age,3),
                    }}

            with self.lock:self.data=value;self.published=time.monotonic()
            if state!=self.last_state:
                print(json.dumps({'module':'BZSS-MEM-BRIDGE','target':self.target['id'],'status':state}),flush=True)
                self.last_state=state
            # Always yield after an over-budget sample; never spin continuously
            # when a single snapshot takes longer than the configured period.
            minimum_rest=max(.02,min(.1,self.interval*.1))
            self.stop_event.wait(max(minimum_rest,delay-(time.monotonic()-began)))

    def latest(self):
        with self.lock:
            data=self.data;age=time.monotonic()-self.published
        if data is None:return self.unavailable('warming_up','Initial memory read is in progress.')
        if age>self.max_age:return self.unavailable('snapshot_stale','Latest sample exceeded the freshness limit.')
        if data['health']['status']=='degraded' and time.monotonic()-self.last_good_at>self.max_age:
            return self.unavailable('snapshot_stale','Last successful sample exceeded the freshness limit.')
        return data


class RuntimeSettings:
    def __init__(self,config,samplers):
        self.samplers=samplers;self.max_age=float(config.get('maxAgeSeconds',4))
        self.path=Path(config.get('settingsPath','/var/lib/bzss-mem-bridge/runtime-settings.json'))
        self.lock=threading.RLock();self.updated_at=None
        self.values={key:{'sampleIntervalSeconds':float(config.get('intervalSeconds',.5)),
            'playerStatsIntervalSeconds':float(sampler.target.get('playerStatsIntervalSeconds',config.get('playerStatsIntervalSeconds',1))),
            'pointScanIntervalSeconds':float(sampler.target.get('pointScanIntervalSeconds',5))}
            for key,sampler in samplers.items()}
        self.load()
        for key in samplers:self.apply(key)

    @staticmethod
    def number(value,low,high):
        return type(value) in (int,float) and low<=float(value)<=high

    def load(self):
        try:document=json.loads(self.path.read_text(encoding='utf-8'))
        except FileNotFoundError:return
        except (OSError,ValueError):
            print(json.dumps({'module':'BZSS-MEM-BRIDGE','settings':'invalid_file','using':'config_defaults'}),flush=True)
            return
        if not isinstance(document,dict) or document.get('schema')!=1 or not isinstance(document.get('targets'),dict):return
        for key,current in self.values.items():
            row=document['targets'].get(key)
            if not isinstance(row,dict):continue
            sample=row.get('sampleIntervalSeconds',current['sampleIntervalSeconds'])
            stats=row.get('playerStatsIntervalSeconds',current['playerStatsIntervalSeconds'])
            points=row.get('pointScanIntervalSeconds',current['pointScanIntervalSeconds'])
            if self.number(sample,.05,60) and self.number(stats,.25,60) and self.number(points,1,60) and float(points).is_integer():
                current['sampleIntervalSeconds']=float(sample)
                current['playerStatsIntervalSeconds']=float(stats)
                current['pointScanIntervalSeconds']=float(points)
        self.updated_at=document.get('updatedAt')

    def apply(self,key):
        row=self.values[key];sampler=self.samplers[key]
        sampler.interval=row['sampleIntervalSeconds']
        sampler.max_age=max(self.max_age,sampler.interval*3)
        sampler.target['playerStatsIntervalSeconds']=row['playerStatsIntervalSeconds']
        sampler.reader.target['pointScanIntervalSeconds']=row['pointScanIntervalSeconds']

    def snapshot(self,key):
        if key not in self.samplers:raise ValueError('unknown_target')
        with self.lock:
            return {'schema':1,'module':'BZSS-MEM-BRIDGE','version':__version__,'target':key,
                **self.values[key],'updatedAt':self.updated_at,
                'limits':{'sampleIntervalSeconds':{'min':.05,'max':60,'step':.01},
                    'playerStatsIntervalSeconds':{'min':.25,'max':60,'step':.25},
                    'pointScanIntervalSeconds':{'min':1,'max':60,'step':1}}}

    def update(self,key,body):
        if key not in self.samplers:raise ValueError('unknown_target')
        if not isinstance(body,dict) or set(body)-{'sampleIntervalSeconds','playerStatsIntervalSeconds','pointScanIntervalSeconds'} or not body:
            raise ValueError('invalid_settings')
        with self.lock:
            current=self.values[key].copy()
            sample=body.get('sampleIntervalSeconds',current['sampleIntervalSeconds'])
            stats=body.get('playerStatsIntervalSeconds',current['playerStatsIntervalSeconds'])
            points=body.get('pointScanIntervalSeconds',current['pointScanIntervalSeconds'])
            if not self.number(sample,.05,60) or not self.number(stats,.25,60) or not self.number(points,1,60) or not float(points).is_integer():raise ValueError('out_of_range')
            candidate={'sampleIntervalSeconds':round(float(sample),2),
                'playerStatsIntervalSeconds':round(float(stats),2),
                'pointScanIntervalSeconds':float(int(points))}
            updated=time.time();document={'schema':1,'updatedAt':updated,'targets':{k:v.copy() for k,v in self.values.items()}}
            document['targets'][key]=candidate
            self.path.parent.mkdir(parents=True,exist_ok=True)
            tmp=self.path.with_name(self.path.name+f'.tmp-{os.getpid()}')
            with tmp.open('w',encoding='utf-8') as stream:
                os.chmod(tmp,0o600);json.dump(document,stream,ensure_ascii=False,separators=(',',':'))
                stream.write('\n');stream.flush();os.fsync(stream.fileno())
            os.replace(tmp,self.path)
            self.values[key]=candidate;self.updated_at=updated;self.apply(key)
            return self.snapshot(key)


def select_payload(snapshot,route,kind=None):
    if route=='/v1/snapshot':return snapshot
    key={'/v1/map':'map','/v1/players':'players','/v1/map-points':'mapPoints'}[route]
    value=snapshot.get(key)
    if kind and key=='mapPoints':value=[row for row in value if row['kind']==kind]
    result={field:snapshot.get(field) for field in ('schema','module','version','readOnly','target','observedAt','epoch','health')}
    if key!='map':result['map']=snapshot.get('map')
    result[key]=value;return result


def serve(config,profiles):
    host=config.get('host','127.0.0.1');port=config.get('port',31903)
    if not ipaddress.ip_address(host).is_loopback:raise BridgeError('listen_config','This version binds to loopback only.')
    samplers={target['id']:Sampler(target,profiles[target['profile']],config.get('intervalSeconds',.5),config.get('maxAgeSeconds',4)) for target in config['targets']}
    settings=RuntimeSettings(config,samplers)

    class Handler(BaseHTTPRequestHandler):
        server_version=f'BZSS-MEM-BRIDGE/{__version__}';sys_version=''
        def setup(self):
            super().setup();self.connection.settimeout(4)
        def log_message(self,*args):pass
        def send_json(self,status,value):
            data=json.dumps(value,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode('utf-8')
            self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8')
            self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store')
            self.end_headers()
            try:self.wfile.write(data)
            except (BrokenPipeError,ConnectionResetError):pass
        def do_GET(self):
            url=urlsplit(self.path);query=parse_qs(url.query,keep_blank_values=True)
            if url.path=='/v1/settings':
                if set(query)-{'target'} or any(len(v)!=1 for v in query.values()):return self.send_json(400,{'error':'invalid_query'})
                target=query.get('target',[config.get('defaultTarget')])[0]
                try:return self.send_json(200,settings.snapshot(target))
                except ValueError:return self.send_json(404,{'error':'unknown_target'})
            if url.path in ('/health','/v1/targets'):
                if query:return self.send_json(400,{'error':'invalid_query'})
                return self.send_json(200,{'module':'BZSS-MEM-BRIDGE','version':__version__,'readOnly':True,
                    'targets':[{'id':key,'label':sampler.target.get('label',key),'health':sampler.latest()['health']} for key,sampler in samplers.items()]})
            if url.path not in ('/v1/snapshot','/v1/map','/v1/players','/v1/map-points'):return self.send_json(404,{'error':'not_found'})
            if set(query)-{'target','kind'} or any(len(v)!=1 for v in query.values()):return self.send_json(400,{'error':'invalid_query'})
            if 'kind' in query and url.path!='/v1/map-points':return self.send_json(400,{'error':'invalid_query'})
            target=query.get('target',[config.get('defaultTarget')])[0]
            if target not in samplers:return self.send_json(404,{'error':'unknown_target'})
            data=samplers[target].latest()
            return self.send_json(200 if data['health']['status'] in ('ok','degraded') else 503,
                select_payload(data,url.path,query.get('kind',[None])[0]))
        def do_POST(self):self.send_json(405,{'error':'read_only','message':'Only GET endpoints and local sampler settings are available.'})
        def do_PATCH(self):
            url=urlsplit(self.path)
            if url.path!='/v1/settings' or url.query:return self.send_json(404,{'error':'not_found'})
            if not ipaddress.ip_address(self.client_address[0]).is_loopback:return self.send_json(403,{'error':'loopback_only'})
            try:length=int(self.headers.get('Content-Length','0'))
            except ValueError:return self.send_json(400,{'error':'invalid_body'})
            if not 1<=length<=8192:return self.send_json(400,{'error':'invalid_body'})
            try:body=json.loads(self.rfile.read(length))
            except (ValueError,KeyError,TypeError):return self.send_json(400,{'error':'invalid_body'})
            if not isinstance(body,dict):return self.send_json(400,{'error':'invalid_body'})
            target=body.pop('target',None)
            if not isinstance(target,str):return self.send_json(400,{'error':'invalid_body'})
            try:return self.send_json(200,settings.update(target,body))
            except ValueError as exc:return self.send_json(400,{'error':str(exc)})
            except OSError:return self.send_json(500,{'error':'settings_persist_failed'})
        do_PUT=do_POST;do_DELETE=do_POST

    server=ThreadingHTTPServer((host,port),Handler);server.daemon_threads=True
    for sampler in samplers.values():sampler.start()
    print(json.dumps({'module':'BZSS-MEM-BRIDGE','version':__version__,'listen':f'http://{host}:{port}','memoryAccess':'read_only'}),flush=True)
    try:server.serve_forever(poll_interval=.5)
    except KeyboardInterrupt:pass
    finally:
        for sampler in samplers.values():sampler.stop_event.set()
        server.server_close()
