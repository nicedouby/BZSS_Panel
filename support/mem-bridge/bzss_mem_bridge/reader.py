import hashlib
import json
import math
import re
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
ROTATION_FIELDS = {'pitch': ('Pitch',), 'aimYaw': ('Yaw',)}
SHOT_FIELDS = {'shotCounter': ('ShotCounter',), 'shotTime': ('WorldTime',)}
COLOR_FIELDS = {axis: (axis.upper(),) for axis in 'rgb'}
LIVE_ACTOR_LIMIT = 512
NON_RENDER_MESH = re.compile(r'collision|(?:^|[_-])col(?:mesh)?(?:[_-]|$)|ghost|preview|hitbox', re.I)


def signed_degrees(value):
    return (value + 180) % 360 - 180


def metres(position):return {axis:value/100 for axis,value in position.items()} if position else None


class Reader:
    def __init__(self,target,profile):
        self.target=target;self.profile=profile;self.memory=None;self.ue=None
        self.world_key=None;self.epoch=None;self.points=[];self.discovery_at=0
        self.discovery_job = None
        self.discovery_levels = None
        self.discovery_stats = {'actorsScanned': 0, 'skippedActors': 0}
        self.player_details={};self.player_details_at=0
        self.point_samples = []
        self.sampled_point_entries = None
        self.point_samples_at = 0
        self.layer_settings = None
        self.live_actors = []
        self.weapons = {}
        self.weapon_sockets = {}
        self.live_cache = {}
        self.live_phase = 0
        self.shot_vectors = {}
        self.projectiles = {}
        self.persistent_actors = set()

    def bind(self):
        proc=find_process(self.target)
        if self.memory is None or self.memory.pid!=int(proc.name) or self.memory.start!=start_ticks(proc):
            self.memory=RemoteMemory(self.target,self.profile);self.ue=UE(self.memory)
            self.world_key=None;self.points=[];self.live_actors=[];self.discovery_at=0
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

    def mesh_name(self, component):
        if not component:
            return None
        for name in ('SkeletalMeshAsset', 'SkeletalMesh', 'StaticMesh'):
            asset = self.ue.optional_pointer(component, name)
            if asset:
                return self.ue.name(asset)
        return None

    def player_weapon(self, pawn):
        u = self.ue
        inventory = u.optional_pointer(pawn, 'InventoryComponent')
        weapon = u.optional_weak_pointer(pawn, 'CurrentHeldItem')
        if not weapon and inventory:
            weapon = u.optional_pointer(inventory, 'CurrentWeapon')
        if not weapon:
            return {}
        identity = u.info(weapon)
        key = identity.key()
        result = {'weaponId': u.entity_id(self.epoch, weapon), 'weaponClass': u.class_name(weapon)}
        if inventory:
            result['weaponSlot'] = u.optional_scalar(inventory, 'CurrentWeaponSlot')
            result['weaponOffset'] = u.optional_scalar(inventory, 'CurrentWeaponOffset')
        if key not in self.weapons:
            data = {}
            primary = ('Mesh3P', 'ItemMesh3P', 'ItemMesh', 'WeaponMesh', 'Mesh', 'RootComponent', 'Mesh1P')
            extras = tuple(name for name, prop in u.properties(weapon).items()
                           if 'mesh' in name.casefold() and '1p' not in name.casefold() and
                           prop.kind in ('ObjectProperty', 'ObjectPtrProperty'))
            for field in dict.fromkeys((*primary[:-1], *extras, primary[-1])):
                component = u.optional_pointer(weapon, field)
                mesh = self.mesh_name(component)
                if not mesh:
                    continue
                data = {'weaponMesh': mesh, 'weaponMount': self.weapon_mount(pawn, component)}
                break
            if len(self.weapons) >= 1024:
                self.weapons.clear()
            if not u.unchanged(identity):
                return {}
            # Items in an equip transition can exist before their mesh is attached.
            if data.get('weaponMount') is not None:
                self.weapons[key] = data
            result.update(data)
        else:
            result.update(self.weapons[key])
        return {**result, **self.shot_telemetry(weapon)}

    def shot_telemetry(self, weapon):
        u = self.ue
        result = {'weaponId': u.entity_id(self.epoch, weapon), 'weaponClass': u.class_name(weapon),
                  'firing': u.optional_scalar(weapon, 'bFiring')}
        result['weaponAiming'] = u.optional_scalar(weapon, 'bAimingDownSights')
        result.update(u.struct_scalars_any(weapon, 'LastShotInfo', SHOT_FIELDS))
        if (result.get('shotTime') or 0) > 0:
            token = (result.get('shotCounter'), result['shotTime'])
            key = result['weaponId']
            old = self.shot_vectors.get(key)
            if not old or old[0] != token:
                try:shot = u.struct_triples(weapon, 'LastShotInfo', {'Origin', 'ShootDir'})
                except BridgeError:shot = {}
                direction = shot.get('ShootDir', ())
                magnitude = math.hypot(*direction)
                payload = {'shotOrigin': dict(zip('xyz', shot['Origin'])),
                           'shotDirection': dict(zip('xyz', (value / magnitude for value in direction)))
                           } if 'Origin' in shot and .5 < magnitude < 1.5 else {}
                if len(self.shot_vectors) >= 1024:
                    self.shot_vectors.clear()
                old = self.shot_vectors[key] = (token, payload)
            result.update(old[1])
        return result

    def weapon_mount(self, pawn, component):
        u = self.ue
        socket = u.optional_name(component, 'AttachSocketName') or u.optional_name(pawn, 'AttachSocket3PName')
        if not socket or socket == 'None':
            return None
        character_mesh = u.optional_pointer(pawn, 'Mesh')
        asset = (u.optional_pointer(character_mesh, 'SkeletalMeshAsset') or
                 u.optional_pointer(character_mesh, 'SkeletalMesh')) if character_mesh else None
        fallback_bones = {'Bip01_Weapon1Socket': 'Bip01_Weapon1',
                          'Bip01_IK_R_Hand_Grenade_Socket': 'Bip01_R_Hand',
                          'Bip01_IK_WeaponSocket': 'Bip01_IK_Weapon'}
        cache_key = (u.info(asset).key() if asset else None, socket)
        if cache_key not in self.weapon_sockets:
            mount = None
            skeleton = u.optional_pointer(asset, 'Skeleton') if asset else None
            for holder in (asset, skeleton):
                if not holder:
                    continue
                try:sockets = u.array(holder, 'Sockets', 1024)
                except BridgeError:continue
                for candidate in sockets:
                    if not candidate or u.optional_name(candidate, 'SocketName') != socket:
                        continue
                    mount = {'bone': u.optional_name(candidate, 'BoneName'),
                             'position': u.property_triple(candidate, 'RelativeLocation'),
                             'rotation': u.property_triple(candidate, 'RelativeRotation'),
                             'scale': u.property_triple(candidate, 'RelativeScale')}
                    break
                if mount:
                    break
            if not mount and socket in fallback_bones:
                mount = {'bone': fallback_bones[socket], 'position': (0, 0, 0),
                         'rotation': (0, 0, 0), 'scale': (1, 1, 1)}
            if len(self.weapon_sockets) >= 256:
                self.weapon_sockets.clear()
            self.weapon_sockets[cache_key] = mount
        mount = self.weapon_sockets[cache_key]
        if not mount or not mount['bone']:
            return None
        return {'socket': socket, **mount,
                'relativePosition': u.property_triple(component, 'RelativeLocation'),
                'relativeRotation': u.property_triple(component, 'RelativeRotation'),
                'relativeScale': u.property_triple(component, 'RelativeScale3D')}

    def soldier_presentation(self, pawn, controller):
        u = self.ue
        prone = u.optional_scalar(pawn, 'bIsProne')
        crouched = u.optional_scalar(pawn, 'bIsCrouched')
        stance = 'prone' if prone else 'crouched' if crouched else 'standing' if prone is not None or crouched is not None else None
        capsule = u.optional_pointer(pawn, 'CapsuleComponent')
        height = u.optional_scalar(capsule, 'CapsuleHalfHeight') if capsule else None
        if height is not None and not 10 <= height <= 180:
            height = None
        pitch = u.struct_scalars_any(controller, 'ControlRotation', ROTATION_FIELDS)['pitch']
        if pitch is None:
            packed = u.optional_scalar(pawn, 'RemoteViewPitch16')
            if packed is not None:
                pitch = packed * (360 / 65536)
        movement = u.optional_pointer(pawn, 'SoldierMovement') or u.optional_pointer(pawn, 'CharacterMovement')
        aiming = u.optional_scalar(movement, 'bAimDownSights') if movement else None
        velocity = None
        if movement:
            try:velocity = dict(zip('xyz', u.property_triple(movement, 'Velocity')))
            except BridgeError:pass
        lean = u.optional_scalar(pawn, 'LeaningDirection')
        return {'stance': stance, 'capsuleHalfHeight': height, 'aiming': aiming,
                'pitch': signed_degrees(pitch) if pitch is not None else None,
                'velocity': velocity, 'lean': {0: -1, 1: 0, 2: 1}.get(lean),
                'sprinting': u.optional_scalar(pawn, 'bCachedIsSprinting'),
                'airborne': u.optional_scalar(movement, 'MovementMode') == 3 if movement else None}

    def player_metadata(self, ps):
        u = self.ue
        metadata={'playerId':u.optional_scalar(ps,'PlayerId'),
            'name':self.optional_string(ps,'PlayerNamePrivate') or u.name(ps),'class':u.class_name(ps),
            'teamId':u.optional_scalar(ps,'TeamId'),'squadId':None,
            'fireteamIndex':u.scalar_any(ps,('FireteamIndex','FireTeamIndex')),
            'fireteamPosition':u.scalar_any(ps,('FireteamPosition','FireTeamPosition')),
            'isLeader':False,'role':self.optional_object_name(ps,'CurrentRole') or self.optional_object_name(ps,'DeployRole')}
        try:
            squad=u.pointer(ps,'SquadState')
            if squad:
                metadata['squadId']=u.optional_scalar(squad,'ID')
                leader=None
                for name in ('LeaderPlayerState','Leader','SquadLeader'):
                    leader=u.optional_pointer(squad,name)
                    if leader:break
                metadata['isLeader']=bool(leader and leader==ps)
        except BridgeError:pass
        return metadata

    def player(self,ps,refresh_details=True,player_key=None):
        u=self.ue;identity=u.info(ps)
        if not u.is_a(ps,'PlayerState'):raise BridgeError('player_class','Unexpected PlayerArray entry.')
        if player_key is None:
            player_key=u.entity_id(self.epoch,ps)
        cached=self.player_details.get(player_key)
        details=cached if not refresh_details else None
        if details is None:
            combat,combat_source=self.player_combat(ps)
            details={
                'fields': {**self.player_metadata(ps), 'combat':combat,'combatSource':combat_source,
                    'combatStatus':'ok' if any(value is not None for value in combat.values()) else 'unknown',
                    'combatObservedAt':time.time()},
                'pawn': None,
                'vitals': {'current':None,'maximum':None,'percent':None,'source':None,'status':'unknown'},
            }
        result={'id':player_key, **details['fields'], 'connectionKind':'unknown','hasPawn':False,
            'position':None,'positionMeters':None,'positionStatus':'no_controller',
            'weaponClass':None,'weaponMesh':None,'stance':None,'pitch':None,'vehicleId':None,'yaw':None,
            'vitals':{'current':None,'maximum':None,'percent':None,'source':None,'status':'unknown'}}
        pc=u.pointer(ps,'Owner')
        if not pc:
            self.player_details[player_key]=details
            return result
        pc_info=u.info(pc)
        if not u.is_a(pc,'Controller'):
            self.player_details[player_key]=details
            return result
        if u.pointer(pc,'PlayerState')!=ps:raise BridgeError('player_link_changed','Controller/PlayerState link changed.')
        if u.is_a(pc,'PlayerController'):
            connection=u.pointer(pc,'NetConnection')
            result['connectionKind']='network_player' if connection else 'local_controller'
        elif u.is_a(pc,'AIController'):result['connectionKind']='ai_controller'
        pawn=u.pointer(pc,'Pawn')
        result['positionStatus']='no_pawn'
        if pawn:
            pawn_info=u.info(pawn)
            is_vehicle_seat = u.is_a(pawn, 'SQVehicleSeat')
            pawn_player = u.optional_pointer(pawn, 'PlayerState')
            if u.pointer(pawn,'Controller')!=pc or (pawn_player != ps and (not is_vehicle_seat or pawn_player)):
                raise BridgeError('player_link_changed','Pawn/Controller link changed.')
            result.update(hasPawn=True,pawnClass=u.class_name(pawn))
            if u.is_a(pawn, 'SQSoldier'):
                try:result.update(self.soldier_presentation(pawn, pc))
                except BridgeError:pass
                try:result.update(self.player_weapon(pawn))
                except BridgeError:pass
                seat = u.optional_pointer(pawn, 'CurrentSeat')
            else:
                seat = pawn if is_vehicle_seat else None
            if seat:
                result['seated'] = True
                turret = u.is_a(seat, 'SQVehicleTurret')
                result['seatKind'] = 'turret' if turret else 'vehicle'
                vehicle = seat if u.is_a(seat, 'SQVehicle') else self.vehicle_owner(seat)
                if vehicle:
                    result['vehicleId'] = u.entity_id(self.epoch, vehicle)
                if turret:
                    aim = u.struct_scalars_any(pc, 'ControlRotation', ROTATION_FIELDS)
                    result.update(pitch=aim['pitch'], aimYaw=aim['aimYaw'])
                    inventory = u.optional_pointer(seat, 'CachedVehicleInventory') or u.optional_pointer(seat, 'SQVehicleInventory')
                    gun = u.optional_pointer(inventory, 'CurrentWeapon') if inventory else None
                    if gun:
                        try:result.update(self.shot_telemetry(gun))
                        except BridgeError:pass
            pawn_key = pawn_info.key()
            if details['pawn'] != pawn_key:
                details={**details,'pawn':pawn_key,'vitals':self.player_vitals(pawn)}
            result['vitals']=details['vitals']
            try:
                transform=u.actor_transform(pawn)
                position=transform['position']
                x,y,z,w=transform['quaternion']
                result['yaw']=math.degrees(math.atan2(2*(w*z+x*y),1-2*(y*y+z*z)))%360
                result['yawSource']='root_component_quaternion'
                if result.get('aimYaw') is not None:
                    result.update(yaw=result['aimYaw'] % 360, yawSource='turret_control_rotation')
                if u.pointer(pc,'Pawn')!=pawn or not u.unchanged(pawn_info):raise BridgeError('object_changed','Pawn changed during sampling.')
                result.update(position=position,positionMeters=metres(position),positionStatus='ok',positionSource='component_to_world')
            except BridgeError as error:result['positionStatus']=error.code
            if u.pointer(pc,'Pawn')!=pawn or not u.unchanged(pawn_info):
                raise BridgeError('player_link_changed','Pawn changed while reading player telemetry.')
        if not u.unchanged(identity) or not u.unchanged(pc_info) or u.pointer(pc,'PlayerState')!=ps:
            raise BridgeError('player_link_changed','Player identity changed during sampling.')
        self.player_details[player_key]=details
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

    def live_kind(self, actor):
        chain = self.ue.hierarchy(actor)
        if 'SQVehicle' in chain:
            return 'vehicle'
        if 'SQSquadRallyPoint' in chain:
            return 'rally'
        if 'SQForwardBase' in chain:
            return 'fob'
        names = ' '.join(chain).lower()
        if 'spawner' in names or 'marker' in names or 'tutorial' in names or 'commandzone' in names:
            return None
        if ('fob' in names and 'radio' in names) or 'SQFOB' in chain:
            return 'fob'
        if 'SQDeployable' not in chain or 'SQDeployableItem' in chain:
            return None
        tokens = self.ue.class_name(actor).lower().removesuffix('_c').split('_')
        return 'hab' if 'hab' in tokens or 'deployable_hab' in names else 'deployable'

    def live_parts(self, actor, kind):
        u = self.ue
        vehicle = kind in ('vehicle', 'turret', 'weapon')
        primary = u.optional_pointer(actor, 'VehicleMesh') if kind == 'vehicle' else None
        field_names = ('mesh', 'hull', 'rotor', 'decoration') if vehicle else ('mesh', 'radio')
        fields = ('RootComponent',) + tuple(name for name, prop in u.properties(actor).items()
                  if any(part in name.lower() for part in field_names)
                  and not NON_RENDER_MESH.search(name) and prop.kind in ('ObjectProperty', 'ObjectPtrProperty'))
        pending = [component for name in fields if (component := u.optional_pointer(actor, name))]
        if vehicle:
            pending.extend(component for field in ('CachedTurretMesh', 'CachedWeaponMesh')
                           if (component := u.optional_weak_pointer(actor, field)))
        if primary:
            pending.append(primary)
        parts, seen = [], set()
        while pending and len(parts) < 24 and len(seen) < 96:
            component = pending.pop()
            if component in seen:
                continue
            seen.add(component)
            try:
                if u.info(component).outer != actor:
                    continue
                if NON_RENDER_MESH.search(u.name(component)) or u.is_a(component, 'SQArmorMeshComponent'):
                    continue
                if u.is_a(component, 'SceneComponent'):
                    try:pending.extend(child for child in u.array(component, 'AttachChildren', 96) if child)
                    except BridgeError:pass
                if any(cls in u.hierarchy(component) for cls in ('StaticMeshComponent', 'SkeletalMeshComponent')):
                    if (mesh := self.mesh_name(component)) and not NON_RENDER_MESH.search(mesh):
                        role = 'body' if component == primary else 'part' if kind == 'vehicle' else kind
                        parts.append((u.info(component), mesh, role))
            except BridgeError:
                continue
        return parts

    def vehicle_owner(self, actor):
        u = self.ue
        pending, seen = [actor], set()
        while pending and len(seen) < 12:
            current = pending.pop()
            if current in seen:
                continue
            seen.add(current)
            links = [u.optional_pointer(current, name) for name in ('Owner', 'ParentVehicle', 'Vehicle', 'OwningVehicle')]
            root = u.optional_pointer(current, 'RootComponent')
            parent = u.optional_pointer(root, 'AttachParent') if root else None
            if parent:
                links.append(u.info(parent).outer)
            for value in links:
                if not value:
                    continue
                try:
                    chain = u.hierarchy(value)
                    if 'SQVehicle' in chain:
                        return value
                    if any(name in chain for name in ('SQVehicleSeat', 'SQVehicleWeapon')):
                        pending.append(value)
                except BridgeError:
                    continue
        return None

    def live_actor(self, entry, current_levels):
        u = self.ue
        info, level, kind, parts = entry
        actor = info.address
        if level.address not in current_levels or not u.unchanged(info):
            return None
        if u.optional_scalar(actor, 'bActorIsBeingDestroyed') or u.optional_scalar(actor, 'bHasBeenDestroyed'):
            return None
        transform = u.actor_transform(actor)
        meshes, overlaps = [], set()
        for component_info, mesh, role in parts:
            try:
                component = component_info.address
                if role != 'body' and (u.optional_scalar(component, 'bVisible') is False
                                       or u.optional_scalar(component, 'bHiddenInGame') is True):
                    continue
                part_transform = u.component_transform(component)
                if u.unchanged(component_info):
                    key = (mesh, *(round(value, 1) for value in part_transform['position'].values()),
                           *(round(value, 3) for value in part_transform['quaternion']))
                    if key in overlaps:
                        continue
                    overlaps.add(key)
                    meshes.append({'id': u.entity_id(self.epoch, component), 'mesh': mesh, 'role': role, **part_transform})
            except BridgeError:
                continue
        result = {'id': u.entity_id(self.epoch, actor), 'kind': kind, 'class': u.class_name(actor),
                  'teamId': u.scalar_any(actor, ('Team', 'TeamId', 'OwningTeam')), 'parts': meshes,
                  'observedAt': time.time(), **transform}
        if kind == 'rally':
            squad = u.optional_pointer(actor, 'SquadState') or u.optional_pointer(actor, 'AuthoritySquad')
            result['squadId'] = u.optional_scalar(squad, 'ID') if squad else None
        if kind == 'fob':
            result['radii'] = {}
            for key, field in (('inner', 'DeploymentRadius'), ('outer', 'ConstructionRadius')):
                component = u.optional_pointer(actor, field)
                radius = u.optional_scalar(component, 'SphereRadius') if component else None
                if radius and radius > 0:
                    try:
                        state = u.component_transform(component)
                        result['radii'][key] = {'radius': radius * min(map(abs, state['scale'])),
                                                'position': state['position']}
                    except BridgeError:
                        continue
        return result

    def discover(self, levels):
        u=self.ue;rows=[];live_actors=[];seen=set();actors=0;skipped=0
        vehicle_children = {}
        allowed=set(self.target.get('pointKinds',['capture_zone','main_base','spawn_point','spawn_group']))
        processed = 0
        for level in levels:
            level_info=u.info(level)
            if not u.is_a(level,'Level'):continue
            values=u.array_at(level,int(self.profile['layout']['levelActorsOffset'],0),50000)
            actors+=len(values)
            if actors>150000:raise BridgeError('actor_limit','Current world exceeds actor discovery limit.')
            for actor in values:
                processed += 1
                if processed % 32 == 0:
                    yield
                if not actor or actor in seen:continue
                seen.add(actor)
                try:
                    info=u.info(actor)
                    if info.outer!=level:continue
                    self.track_projectile(actor)
                    kind=self.kind(actor)
                    if kind in allowed:rows.append((info,level_info,kind))
                    if len(live_actors) < LIVE_ACTOR_LIMIT:
                        live_kind = self.live_kind(actor)
                        if live_kind:
                            live_actors.append((info, level_info, live_kind, self.live_parts(actor, live_kind)))
                        elif 'SQVehicleTurret' in u.hierarchy(actor) or 'SQVehicleWeapon' in u.hierarchy(actor):
                            owner = self.vehicle_owner(actor)
                            if owner:
                                parts = vehicle_children.setdefault(owner, [])
                                if len(parts) < 48:
                                    kind = 'turret' if u.is_a(actor, 'SQVehicleTurret') else 'weapon'
                                    parts.extend(self.live_parts(actor, kind))
                except BridgeError:skipped+=1
            if not u.unchanged(level_info):raise BridgeError('world_changed','Level changed during discovery.')
        self.points=rows
        self.live_actors = [(info, level, kind, (parts + vehicle_children.get(info.address, []))[:48])
                            for info, level, kind, parts in live_actors]
        current = {entry[0].key() for entry in self.live_actors}
        self.live_cache = {key:value for key,value in self.live_cache.items() if key in current}
        self.discovery_at=time.monotonic();self.discovery_stats={'actorsScanned':actors,'skippedActors':skipped}

    def advance_discovery(self, levels, interval):
        # Process the heavy actor classification in small slices between player snapshots.
        level_key = frozenset(levels)
        if self.discovery_job is not None and self.discovery_levels != level_key:
            self.discovery_job.close()
            self.discovery_job = None
        if self.discovery_job is None and time.monotonic() - self.discovery_at >= interval:
            self.discovery_levels = level_key
            self.discovery_job = self.discover(levels)
        if self.discovery_job is None:
            return
        deadline = time.monotonic() + .009
        try:
            while time.monotonic() < deadline:
                next(self.discovery_job)
        except StopIteration:
            self.discovery_job = None
        except BridgeError:
            self.discovery_job = None
            raise

    def track_projectile(self, actor):
        if len(self.projectiles) >= 192 or actor in self.projectiles:
            return
        u = self.ue
        if not u.is_a(actor, 'SQProjectile'):
            return
        kind = 'smoke' if u.is_a(actor, 'SQSmokeGrenadeProjectile') else (
               'grenade' if u.is_a(actor, 'SQGrenadeProjectile') else 'projectile')
        mesh = None
        for field in ('SkeletalMeshComp', 'SkeletalMesh', 'ProjectileMesh', 'StaticMesh', 'Mesh', 'RootComponent'):
            component = u.optional_pointer(actor, field)
            if mesh := self.mesh_name(component):
                break
        self.projectiles[actor] = (u.info(actor), kind, mesh)

    def active_projectiles(self, persistent):
        u = self.ue
        active = set(u.array_at(persistent, int(self.profile['layout']['levelActorsOffset'], 0), 50000))
        additions = active - self.persistent_actors
        self.persistent_actors = active
        for actor in list(additions - {0})[:256]:
            try:self.track_projectile(actor)
            except BridgeError:continue
        rows = []
        for actor, (identity, kind, mesh) in list(self.projectiles.items()):
            try:
                if not u.unchanged(identity) or u.optional_scalar(actor, 'bActorIsBeingDestroyed'):
                    self.projectiles.pop(actor, None)
                    continue
                if kind != 'smoke' and (u.optional_scalar(actor, 'bIsExploding') or
                                        u.optional_scalar(actor, 'bHasExploded')):
                    continue
                result = {'id': u.entity_id(self.epoch, actor), 'kind': kind, 'mesh': mesh,
                          'activeSmoke': False, **u.actor_transform(actor)}
                if kind == 'smoke':
                    result['activeSmoke'] = (u.optional_scalar(actor, 'TimeDetonated') or 0) > 0
                    if result['activeSmoke']:
                        color = u.struct_scalars_any(actor, 'SmokeColor', COLOR_FIELDS)
                        if all(value is not None for value in color.values()):
                            result['color'] = [min(1, max(0, value)) for value in color.values()]
                rows.append(result)
            except BridgeError:
                self.projectiles.pop(actor, None)
        return rows

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
            u.reset_metadata();self.points=[];self.live_actors=[];self.live_cache.clear();self.weapons.clear();self.weapon_sockets.clear();self.shot_vectors.clear();self.projectiles.clear();self.persistent_actors.clear();self.discovery_at=0;self.player_details.clear();self.player_details_at=0;self.world_key=key
            self.point_samples = []
            self.sampled_point_entries = None
            self.point_samples_at = 0
            self.layer_settings = None
            if self.discovery_job is not None:
                self.discovery_job.close()
                self.discovery_job = None
            self.discovery_stats = {'actorsScanned': 0, 'skippedActors': 0}
            self.epoch=hashlib.sha256(json.dumps((m.pid,m.start,key)).encode()).hexdigest()
        levels=u.array(world,'Levels',2048)
        if persistent not in levels:levels.insert(0,persistent)
        point_interval=self.target.get('pointScanIntervalSeconds',5)
        self.advance_discovery(levels, point_interval)
        players=[];errors={}
        now=time.monotonic()
        stats_due=now-self.player_details_at>=float(self.target.get('playerStatsIntervalSeconds',1))
        live_player_keys=set()
        def error(code):errors[code]=errors.get(code,0)+1
        for ps in u.array(game,'PlayerArray',256):
            try:
                player_key=u.entity_id(self.epoch,ps);live_player_keys.add(player_key)
                players.append(self.player(ps,stats_due,player_key))
            except BridgeError as exc:error(exc.code)
        if stats_due:
            self.player_details={key:value for key,value in self.player_details.items() if key in live_player_keys}
            self.player_details_at=time.monotonic()
        current_levels = set(levels)
        if self.sampled_point_entries is not self.points or now-self.point_samples_at >= 1:
            samples=[]
            for entry in self.points:
                try:samples.append((entry[1].address,self.point(entry,current_levels)))
                except BridgeError as exc:error(exc.code)
            self.point_samples=samples
            self.sampled_point_entries=self.points
            self.point_samples_at=now
        points=[point for level,point in self.point_samples if level in current_levels]
        live_actors = []
        # A rotating subset keeps multi-part vehicles from delaying soldier samples.
        phases = 3
        for index, entry in enumerate(self.live_actors):
            key = entry[0].key()
            try:
                if entry[1].address not in current_levels:
                    self.live_cache.pop(key, None)
                    continue
                if index % phases == self.live_phase:
                    actor = self.live_actor(entry, current_levels)
                    if actor:
                        self.live_cache[key] = actor
                    else:
                        self.live_cache.pop(key, None)
                actor = self.live_cache.get(key)
                if actor:
                    live_actors.append(actor)
            except BridgeError as exc:
                self.live_cache.pop(key, None)
                error(exc.code)
        self.live_phase = (self.live_phase + 1) % phases
        try:
            projectiles = self.active_projectiles(persistent)
        except BridgeError as exc:
            error(exc.code)
            projectiles = []
        world_name=u.name(world)
        if '_invasion_' in world_name.lower():
            points.sort(key=lambda point: (point['kind'] != 'capture_zone', point['name']))
        if stats_due or self.layer_settings is None:
            try:self.layer_settings=u.struct_names(game,'CurrentLayerInfo')
            except BridgeError:self.layer_settings=None
        map_data={'worldName':world_name,'mapName':world_name,'mapNameSource':'world_object',
            'layerSettings':self.layer_settings,'units':'centimeters','coordinateSpace':'ue_world'}
        m.validate_process()
        if (m.u64(int(self.profile['layout']['gworldAddress'],0))!=world or not u.unchanged(wi)
            or m.u64(world+int(self.profile['layout']['worldGameStateOffset'],0))!=game or not u.unchanged(gi)):
            raise BridgeError('world_changed','World changed during sampling; snapshot discarded.')
        return {'schema':1,'module':'BZSS-MEM-BRIDGE','version':__version__,'readOnly':True,'target':self.target['id'],
            'observedAt':time.time(),'epoch':self.epoch,'process':{'pid':m.pid,'startTicks':m.start,'gameSha256':m.sha256},
            'map':map_data,
            'players':players,'mapPoints':points,'liveActors':live_actors,'projectiles':projectiles,
            'health':{'status':'ok','consistency':'world_validated_non_atomic','readDurationMs':round((time.monotonic()-started)*1000,2),
                'readCalls':m.read_calls,'readBytes':m.read_bytes,'levels':len(levels),'playerStates':len(players),
                'playersWithPosition':sum(p['positionStatus']=='ok' for p in players),'mapPointCount':len(points),
                'playersWithVitals':sum(p['vitals']['status']=='ok' for p in players),
                'playersWithCombatStats':sum(p['combatStatus']=='ok' for p in players),
                'discoveryAgeSeconds':round(time.monotonic()-self.discovery_at,3) if self.discovery_at else None,
                'discoveryPending':self.discovery_job is not None,'skipped':errors,**self.discovery_stats}}
