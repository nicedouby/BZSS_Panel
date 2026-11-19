import hashlib
import json
import time
from . import __version__
from .capture_geometry import read_capture_volumes
from .memory import RemoteMemory,BridgeError,find_process,start_ticks
from .ue import UE

COMBAT_FIELDS={
    'kills':('NumKills','Kills'),
    'vehicleKills':('VehicleKills','NumVehicleKills'),
    'deaths':('NumDeaths','Deaths'),
    'woundeds':('NumWoundeds','Woundeds'),
    'wounds':('NumWounds','Wounds'),
    'teamKills':('NumTeamKills','NumTK','TKs'),
    'healPoints':('HealPoints','HealPoint'),
    'revives':('RevivedPoints','Revived','Revives'),
    'teamworkScore':('TeamworkScore','TeamWork'),
    'objectiveScore':('ObjectiveScore','Objective'),
    'combatScore':('CombatScore','Combat'),
}
COMBAT_STRUCTS=('PlayerScoreboard','PlayerScoreboardStats','ScoreboardStats','PlayerStats','CombatStats','PlayerCombatStats','CurrentStats')
COMBAT_OBJECTS=('PlayerScoreboard','Scoreboard','ScoreboardStats','PlayerStats','CombatStats','PlayerCombatStats','Stats','CachedStats')
HEALTH_PERCENT_FIELDS=('HealthPercent','HealthPercentage','HealthPct','CurrentHealthPercent','CurrentHealthPct')
HEALTH_CURRENT_FIELDS=('CurrentHealth','Health','CurrentHP','HP','HitPoints')
HEALTH_MAX_FIELDS=('MaxHealth','HealthMax','MaximumHealth','MaxHP','MaxHitPoints')
HEALTH_COMPONENTS=('HealthComponent','DamageableComponent','HealthSystemComponent','HealthComponentPrivate','HealthSystem')


def metres(position):return {axis:value/100 for axis,value in position.items()} if position else None


class Reader:
    def __init__(self,target,profile):
        self.target=target;self.profile=profile;self.memory=None;self.ue=None
        self.world_key=None;self.epoch=None;self.points=[];self.discovery_at=0
        self.player_details={};self.player_details_at=0

    def bind(self):
        proc=find_process(self.target)
        if self.memory is None or self.memory.pid!=int(proc.name) or self.memory.start!=start_ticks(proc):
            self.memory=RemoteMemory(self.target,self.profile);self.ue=UE(self.memory)
            self.world_key=None;self.points=[];self.discovery_at=0
        return self.memory,self.ue

    def optional_string(self,obj,name):
        try:return self.ue.string(obj,name)
        except BridgeError:return None

    def optional_object_name(self,obj,name):
        try:
            pointer=self.ue.pointer(obj,name)
            return self.ue.name(pointer) if pointer else None
        except BridgeError:return None

    def player_combat(self,ps):
        values={key:self.ue.scalar_any(ps,aliases) for key,aliases in COMBAT_FIELDS.items()}
        sources=['player_state'] if any(value is not None for value in values.values()) else []
        for field in COMBAT_STRUCTS:
            discovered=self.ue.struct_scalars_any(ps,field,COMBAT_FIELDS)
            changed=False
            for key,value in discovered.items():
                if values[key] is None and value is not None:
                    values[key]=value;changed=True
            if changed:sources.append('player_state.'+field)
        for field in COMBAT_OBJECTS:
            obj=self.ue.optional_pointer(ps,field)
            if not obj:continue
            discovered={key:self.ue.scalar_any(obj,aliases) for key,aliases in COMBAT_FIELDS.items()}
            changed=False
            for key,value in discovered.items():
                if values[key] is None and value is not None:
                    values[key]=value;changed=True
            if changed:sources.append('player_state.'+field)
        return values,','.join(sources) or None

    def player_vitals(self,pawn):
        sources=[('pawn',pawn)]
        for field in HEALTH_COMPONENTS:
            component=self.ue.optional_pointer(pawn,field)
            if component:sources.append(('pawn.'+field,component))
        for source,obj in sources:
            percent=self.ue.scalar_any(obj,HEALTH_PERCENT_FIELDS)
            current=self.ue.scalar_any(obj,HEALTH_CURRENT_FIELDS)
            maximum=self.ue.scalar_any(obj,HEALTH_MAX_FIELDS)
            if percent is None and current is None:continue
            normalized=None
            if percent is not None and 0<=percent<=100:
                normalized=percent*100 if percent<=1 else percent
            elif current is not None and maximum is not None and maximum>0 and 0<=current<=maximum:
                normalized=current/maximum*100
            elif current is not None and 0<=current<=100:
                normalized=current*100 if current<=1 else current
            return {'current':current,'maximum':maximum,'percent':round(normalized,2) if normalized is not None else None,
                'source':source,'status':'ok' if normalized is not None else 'raw_only'}
        return {'current':None,'maximum':None,'percent':None,'source':None,'status':'unknown'}

    def player(self,ps,refresh_details=True):
        m=self.memory;u=self.ue;identity=u.info(ps)
        if not u.is_a(ps,'PlayerState'):raise BridgeError('player_class','Unexpected PlayerArray entry.')
        team=u.optional_scalar(ps,'TeamId')
        player_key=u.entity_id(self.epoch,ps)
        result={'id':player_key,'playerId':u.optional_scalar(ps,'PlayerId'),
            'name':self.optional_string(ps,'PlayerNamePrivate') or u.name(ps),'class':u.class_name(ps),
            'teamId':team,'squadId':None,'connectionKind':'unknown','hasPawn':False,
            'position':None,'positionMeters':None,'positionStatus':'no_controller',
            'yaw':None,'fireteamIndex':u.scalar_any(ps,('FireteamIndex','FireTeamIndex')),
            'fireteamPosition':u.scalar_any(ps,('FireteamPosition','FireTeamPosition')),
            'isLeader':False,'role':self.optional_object_name(ps,'CurrentRole') or self.optional_object_name(ps,'DeployRole'),
            'vitals':{'current':None,'maximum':None,'percent':None,'source':None,'status':'unknown'},
            'combat':{key:None for key in COMBAT_FIELDS},'combatStatus':'unknown','combatSource':None,
            'combatObservedAt':None}
        try:
            squad=u.pointer(ps,'SquadState')
            if squad:
                result['squadId']=u.optional_scalar(squad,'ID')
                leader=None
                for name in ('LeaderPlayerState','Leader','SquadLeader'):
                    leader=u.optional_pointer(squad,name)
                    if leader:break
                result['isLeader']=bool(leader and leader==ps)
        except BridgeError:pass
        details=self.player_details.get(player_key) if not refresh_details else None
        if details is None:
            combat,combat_source=self.player_combat(ps)
            vitals={'current':None,'maximum':None,'percent':None,'source':None,'status':'unknown'}
            result['combat']=combat
            result['combatSource']=combat_source
            result['combatStatus']='ok' if any(value is not None for value in combat.values()) else 'unknown'
            result['combatObservedAt']=time.time()
            details={'combat':combat,'combatSource':combat_source,'combatStatus':result['combatStatus'],
                'combatObservedAt':result['combatObservedAt'],'vitals':vitals}
        else:
            result.update(details)
        if refresh_details or player_key not in self.player_details:
            self.player_details[player_key]=details
        pc=u.pointer(ps,'Owner')
        if not pc:return result
        pc_info=u.info(pc)
        if not u.is_a(pc,'Controller'):return result
        if u.pointer(pc,'PlayerState')!=ps:raise BridgeError('player_link_changed','Controller/PlayerState link changed.')
        if u.is_a(pc,'PlayerController'):
            connection=u.pointer(pc,'NetConnection')
            result['connectionKind']='network_player' if connection else 'local_controller'
        elif u.is_a(pc,'AIController'):result['connectionKind']='ai_controller'
        pawn=u.pointer(pc,'Pawn')
        result['positionStatus']='no_pawn'
        if pawn:
            pawn_info=u.info(pawn)
            if u.pointer(pawn,'Controller')!=pc or u.pointer(pawn,'PlayerState')!=ps:
                raise BridgeError('player_link_changed','Pawn/Controller link changed.')
            result.update(hasPawn=True,pawnClass=u.class_name(pawn))
            if details['vitals']['status']=='unknown':
                details={**details,'vitals':self.player_vitals(pawn)}
            result['vitals']=details['vitals']
            try:
                position=u.location(pawn)
                if u.pointer(pc,'Pawn')!=pawn or not u.unchanged(pawn_info):raise BridgeError('object_changed','Pawn changed during sampling.')
                result.update(position=position,positionMeters=metres(position),positionStatus='ok',positionSource='component_to_world')
            except BridgeError as error:result['positionStatus']=error.code
            if u.pointer(pc,'Pawn')!=pawn or not u.unchanged(pawn_info):
                raise BridgeError('player_link_changed','Pawn changed while reading player telemetry.')
        if not u.unchanged(identity) or not u.unchanged(pc_info) or u.pointer(pc,'PlayerState')!=ps:
            raise BridgeError('player_link_changed','Player identity changed during sampling.')
        if details['vitals']['status']!='unknown':self.player_details[player_key]=details
        return result

    def capture_component(self,actor):
        u=self.ue
        properties=u.properties(actor)
        for name in ('SQCaptureZoneInvasion','SQCaptureZone'):
            if name in properties:
                component=u.pointer(actor,name)
                if component and u.is_a(component,'SQCaptureZoneComponent'):
                    return component
        return None

    def kind(self,actor):
        chain=self.ue.hierarchy(actor);names=' '.join(chain).lower()
        if 'capturezone' in names:
            component=self.capture_component(actor)
            if component:
                if 'main' in names:
                    if self.ue.optional_scalar(component,'InitialTeam') in (1,2):return 'main_base'
                return 'capture_zone'
        if 'SQTeamSpawnGroup' in chain:return 'spawn_group'
        if 'PlayerStart' in chain or any('spawnpoint' in name.lower() for name in chain):return 'spawn_point'
        if 'vehiclespawner' in names:return 'vehicle_spawner'
        if 'deployablespawner' in names:return 'deployable_spawner'
        return None

    def discover(self,world,levels):
        u=self.ue;rows=[];seen=set();actors=0;skipped=0
        allowed=set(self.target.get('pointKinds',['capture_zone','main_base','spawn_point','spawn_group']))
        for level in levels:
            level_info=u.info(level)
            if not u.is_a(level,'Level'):continue
            values=u.array_at(level,int(self.profile['layout']['levelActorsOffset'],0),50000)
            actors+=len(values)
            if actors>150000:raise BridgeError('actor_limit','Current world exceeds actor discovery limit.')
            for actor in values:
                if not actor or actor in seen:continue
                seen.add(actor)
                try:
                    info=u.info(actor)
                    if info.outer!=level:continue
                    kind=self.kind(actor)
                    if kind in allowed:rows.append((info,level_info,kind))
                except BridgeError:skipped+=1
            if not u.unchanged(level_info):raise BridgeError('world_changed','Level changed during discovery.')
        self.points=rows;self.discovery_at=time.monotonic();self.discovery_stats={'actorsScanned':actors,'skippedActors':skipped}

    def point(self,entry,current_levels):
        u=self.ue;info,level,kind=entry;actor=info.address
        if level.address not in current_levels or not u.unchanged(level) or not u.unchanged(info):
            raise BridgeError('point_changed','Point no longer belongs to the current world.')
        result={'id':u.entity_id(self.epoch,actor),'kind':kind,'name':u.name(actor),'labelSource':'actor_name',
            'class':u.class_name(actor),'position':None,'positionMeters':None,'positionStatus':'unavailable','teamId':None}
        try:
            position=u.location(actor)
            result.update(position=position,positionMeters=metres(position),positionStatus='ok',positionSource='component_to_world')
        except BridgeError as error:result['positionStatus']=error.code
        if kind in ('capture_zone','main_base'):
            component=self.capture_component(actor)
            if not component:raise BridgeError('point_class','Capture component type changed.')
            component_info=u.info(component)
            result['capture']={key:u.optional_scalar(component,field) for key,field in (
                ('initialTeam','InitialTeam'),('owningTeam','OwningTeam'),('capturingTeam','CapturingTeam'),
                ('percentRaw','CapturePercent'),('locked','bIsLocked'),('uncappable','Uncappable'),('componentActive','bIsActive'))}
            if kind=='capture_zone':
                try:volumes=read_capture_volumes(u,actor,result['position'],self.epoch)
                except BridgeError:volumes=[]
                result['capture']['footprints']=[volume.pop('outline') for volume in volumes]
                result['capture']['volumes']=volumes
            result['teamId']=result['capture']['owningTeam']
            # Component activation is not equivalent to an active RAAS objective.
            result['objectiveActive']=None
            if not u.unchanged(component_info):raise BridgeError('point_changed','Capture component changed while reading.')
        elif kind in ('spawn_point','spawn_group'):
            result['teamId']=u.optional_scalar(actor,'Team')
            result['spawn']={key:u.optional_scalar(actor,field) for key,field in (
                ('enabled','bSpawningEnabled'),('sieged','bSieged'),('typeRaw','SpawnPointType'),('hasValidLocation','bHasValidSpawnLocation'))}
        if not u.unchanged(info):raise BridgeError('point_changed','Point changed while reading.')
        return result

    def snapshot(self):
        started=time.monotonic();m,u=self.bind();m.begin();u.begin();m.validate_process()
        world=m.u64(int(self.profile['layout']['gworldAddress'],0));wi=u.info(world)
        if not u.is_a(world,'World'):raise BridgeError('world_unavailable','Current World is unavailable.')
        game=m.u64(world+int(self.profile['layout']['worldGameStateOffset'],0));gi=u.info(game)
        if not u.is_a(game,'GameStateBase'):raise BridgeError('world_unavailable','Current GameState is unavailable.')
        persistent=m.u64(world+0x30);li=u.info(persistent)
        key=(wi.key(),gi.key(),li.key())
        if key!=self.world_key:
            u.reset_metadata();self.points=[];self.discovery_at=0;self.player_details.clear();self.player_details_at=0;self.world_key=key
            self.epoch=hashlib.sha256(json.dumps((m.pid,m.start,key)).encode()).hexdigest()
        levels=u.array(world,'Levels',2048)
        if persistent not in levels:levels.insert(0,persistent)
        point_interval=self.target.get('pointScanIntervalSeconds',5)
        if time.monotonic()-self.discovery_at>=point_interval:self.discover(world,levels)
        players=[];points=[];errors={}
        stats_due=time.monotonic()-self.player_details_at>=float(self.target.get('playerStatsIntervalSeconds',1))
        live_player_keys=set()
        def error(code):errors[code]=errors.get(code,0)+1
        for ps in u.array(game,'PlayerArray',256):
            try:
                player_key=u.entity_id(self.epoch,ps);live_player_keys.add(player_key)
                players.append(self.player(ps,stats_due or player_key not in self.player_details))
            except BridgeError as exc:error(exc.code)
        if stats_due:
            self.player_details={key:value for key,value in self.player_details.items() if key in live_player_keys}
            self.player_details_at=time.monotonic()
        for entry in self.points:
            try:points.append(self.point(entry,set(levels)))
            except BridgeError as exc:error(exc.code)
        world_name=u.name(world)
        if '_invasion_' in world_name.lower():
            points.sort(key=lambda point: (point['kind'] != 'capture_zone', point['name']))
        try:layer_settings=u.struct_names(game,'CurrentLayerInfo')
        except BridgeError:layer_settings=None
        map_data={'worldName':world_name,'mapName':world_name,'mapNameSource':'world_object',
            'layerSettings':layer_settings,'units':'centimeters','coordinateSpace':'ue_world'}
        m.validate_process()
        if (m.u64(int(self.profile['layout']['gworldAddress'],0))!=world or not u.unchanged(wi)
            or m.u64(world+int(self.profile['layout']['worldGameStateOffset'],0))!=game or not u.unchanged(gi)):
            raise BridgeError('world_changed','World changed during sampling; snapshot discarded.')
        return {'schema':1,'module':'BZSS-MEM-BRIDGE','version':__version__,'readOnly':True,'target':self.target['id'],
            'observedAt':time.time(),'epoch':self.epoch,'process':{'pid':m.pid,'startTicks':m.start,'gameSha256':m.sha256},
            'map':map_data,
            'players':players,'mapPoints':points,
            'health':{'status':'ok','consistency':'world_validated_non_atomic','readDurationMs':round((time.monotonic()-started)*1000,2),
                'readCalls':m.read_calls,'readBytes':m.read_bytes,'levels':len(levels),'playerStates':len(players),
                'playersWithPosition':sum(p['positionStatus']=='ok' for p in players),'mapPointCount':len(points),
                'playersWithVitals':sum(p['vitals']['status']=='ok' for p in players),
                'playersWithCombatStats':sum(p['combatStatus']=='ok' for p in players),
                'discoveryAgeSeconds':round(time.monotonic()-self.discovery_at,3),'skipped':errors,**self.discovery_stats}}
