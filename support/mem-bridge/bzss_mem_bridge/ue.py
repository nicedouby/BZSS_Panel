from dataclasses import dataclass
import hashlib
import math
import struct
from .memory import BridgeError


def vector(data):
    value=struct.unpack('<ddd',data)
    if any(not math.isfinite(v) or abs(v)>100_000_000 for v in value):
        raise BridgeError('invalid_vector','Non-finite or out-of-range world position.')
    return {'x':value[0],'y':value[1],'z':value[2]}


@dataclass(frozen=True)
class Object:
    address:int
    index:int
    serial:int
    cls:int
    name_index:int
    name_number:int
    outer:int

    def key(self):return (self.address,self.index,self.serial,self.cls,self.name_index,self.name_number,self.outer)


@dataclass(frozen=True)
class Property:
    name:str
    kind:str
    offset:int
    size:int
    descriptor:int


class UE:
    def __init__(self,memory):
        self.m=memory;self.layout=memory.profile['layout'];self.names={};self.props={};self.chains={}

    def begin(self):
        self.headers={};self.chunks={}
        self.table=int(self.layout['objectsAddress'],0);self.chunk_table=self.m.u64(self.table);self.object_count=self.m.i32(self.table+20)
        if not 1<=self.object_count<=2_000_000:raise BridgeError('object_table_unavailable','UE object table is not ready.')

    def reset_metadata(self):self.names.clear();self.props.clear();self.chains.clear()

    def info(self,obj,fresh=False):
        if not obj:raise BridgeError('null_object','UE object is null.')
        if not fresh and obj in self.headers:return self.headers[obj]
        raw=self.m.read(obj,40);flags,index=struct.unpack_from('<Ii',raw,8)
        cls=struct.unpack_from('<Q',raw,16)[0];ni,nn=struct.unpack_from('<II',raw,24);outer=struct.unpack_from('<Q',raw,32)[0]
        if flags&0x18010 or not 0<=index<self.object_count:raise BridgeError('invalid_object','UE object is being destroyed or is a default object.')
        chunk_index=index//65536
        if chunk_index not in self.chunks:self.chunks[chunk_index]=self.m.u64(self.chunk_table+chunk_index*8)
        slot=self.m.read(self.chunks[chunk_index]+(index%65536)*24,24)
        slot_flags,pointer,serial,_=struct.unpack('<QQii',slot)
        if pointer!=obj or serial<0 or slot_flags&0x1020000000000000:raise BridgeError('invalid_object','UE object slot identity changed.')
        result=Object(obj,index,serial,cls,ni,nn,outer);self.headers[obj]=result;return result

    def unchanged(self,info):return self.info(info.address,fresh=True).key()==info.key()

    def fname(self,index,number=0):
        if index not in self.names:
            if not 0<=index>>16<=1024:raise BridgeError('invalid_name','FName index exceeds profile limits.')
            block=self.m.u64(int(self.layout['nameBlocksAddress'],0)+(index>>16)*8);entry=block+(index&65535)*2
            header=struct.unpack('<H',self.m.read(entry,2))[0];size=header>>6
            if not 0<size<=1024:raise BridgeError('invalid_name','FName length is invalid.')
            self.names[index]=self.m.read(entry+2,size*(2 if header&1 else 1)).decode('utf-16le' if header&1 else 'utf-8','replace')
        name=self.names[index]
        return f'{name}_{number-1}' if number else name

    def name(self,obj):
        # Metadata classes can have default/static flags; read only their FName.
        ni,nn=struct.unpack('<II',self.m.read(obj+24,8));return self.fname(ni,nn)

    def class_name(self,obj):return self.name(self.info(obj).cls)

    def hierarchy(self,obj):
        cls=self.info(obj).cls
        if cls in self.chains:return self.chains[cls]
        rows=[];seen=set();current=cls
        while current:
            if current in seen or len(seen)>=64:raise BridgeError('invalid_class','UE class hierarchy is cyclic.')
            seen.add(current);rows.append(self.name(current));current=self.m.u64(current+0x40)
        self.chains[cls]=tuple(rows);return self.chains[cls]

    def is_a(self,obj,name):return name in self.hierarchy(obj)

    def properties(self,obj):
        cls=self.info(obj).cls
        if cls in self.props:return self.props[cls]
        result={};seen=set();current=cls
        while current:
            if current in seen or len(seen)>=64:raise BridgeError('invalid_class','UE class hierarchy is cyclic.')
            seen.add(current);field=self.m.u64(current+0x50);fields=set()
            while field:
                if field in fields or len(fields)>=4096:raise BridgeError('invalid_property','UE property list is cyclic.')
                fields.add(field);name=self.fname(self.m.u32(field+0x20));offset=self.m.i32(field+0x44);size=self.m.i32(field+0x30)
                kind=self.fname(self.m.u32(self.m.u64(field+8)))
                if not 0<=offset<262144 or not 0<size<=65536:raise BridgeError('invalid_property','UE property layout exceeds limits.')
                result.setdefault(name,Property(name,kind,offset,size,field));field=self.m.u64(field+0x18)
            current=self.m.u64(current+0x40)
        self.props[cls]=result;return result

    def prop(self,obj,name):
        prop=self.properties(obj).get(name)
        if not prop:raise BridgeError('missing_field',f'UE field {name} is unavailable.')
        return prop

    def pointer(self,obj,name):
        p=self.prop(obj,name)
        if p.kind not in ('ObjectProperty','ObjectPtrProperty'):raise BridgeError('field_type','Expected an object property.')
        return self.m.u64(obj+p.offset)

    def array_at(self,obj,offset,maximum=256):
        data,n,cap=struct.unpack('<Qii',self.m.read(obj+offset,16))
        if not 0<=n<=maximum or not n<=cap<=200000:raise BridgeError('array_changed','UE array header is invalid.')
        if n and not data:raise BridgeError('array_changed','UE array storage is null.')
        return list(struct.unpack('<'+'Q'*n,self.m.block(data,n*8))) if n else []

    def array(self,obj,name,maximum=256):
        p=self.prop(obj,name)
        if p.kind!='ArrayProperty':raise BridgeError('field_type','Expected an object array.')
        inner=self.m.u64(p.descriptor+int(self.layout['arrayInnerOffset'],0));kind=self.fname(self.m.u32(self.m.u64(inner+8)))
        if kind not in ('ObjectProperty','ObjectPtrProperty'):raise BridgeError('field_type','Expected an array of object pointers.')
        return self.array_at(obj,p.offset,maximum)

    def scalar(self,obj,name):
        return self.scalar_property(obj,self.prop(obj,name))

    def scalar_property(self,base,p):
        at=base+p.offset
        formats={'IntProperty':'i','UInt32Property':'I','UInt16Property':'H','ByteProperty':'B','FloatProperty':'f','DoubleProperty':'d','Int64Property':'q','UInt64Property':'Q'}
        if p.kind=='BoolProperty':
            _,byte,_,mask=self.m.read(p.descriptor+0x70,4);return bool(self.m.read(at+byte,1)[0]&mask)
        fmt=formats.get(p.kind)
        if p.kind=='EnumProperty':fmt={1:'B',2:'H',4:'I',8:'Q'}.get(p.size)
        if not fmt:raise BridgeError('field_type',f'Unsupported scalar field {p.name}.')
        value=struct.unpack('<'+fmt,self.m.read(at,struct.calcsize(fmt)))[0]
        if isinstance(value,float) and not math.isfinite(value):raise BridgeError('invalid_scalar','Non-finite scalar value.')
        return value

    def scalar_any(self,obj,names):
        try:properties=self.properties(obj)
        except BridgeError:return None
        for name in names:
            prop=properties.get(name)
            if prop is None:
                prop=next((value for key,value in properties.items() if key.casefold()==name.casefold()),None)
            if prop is None:continue
            try:return self.scalar_property(obj,prop)
            except BridgeError:continue
        return None

    def struct_scalars_any(self,obj,struct_name,fields):
        values={key:None for key in fields}
        try:prop=self.prop(obj,struct_name)
        except BridgeError:return values
        if prop.kind!='StructProperty' or prop.size>4096:return values
        struct_object=self.m.u64(prop.descriptor+0x70)
        if not struct_object:return values
        aliases={name.casefold():key for key,names in fields.items() for name in names}
        field=self.m.u64(struct_object+0x50);seen=set()
        while field:
            if field in seen or len(seen)>=1024:raise BridgeError('invalid_property','Struct property list is cyclic or too large.')
            seen.add(field)
            field_name=self.fname(self.m.u32(field+0x20))
            key=aliases.get(field_name.casefold())
            if key is not None and values[key] is None:
                kind=self.fname(self.m.u32(self.m.u64(field+8)))
                offset=self.m.i32(field+0x44);size=self.m.i32(field+0x30)
                if 0<=offset<prop.size and 0<size<=prop.size-offset:
                    try:values[key]=self.scalar_property(obj+prop.offset,Property(field_name,kind,offset,size,field))
                    except BridgeError:pass
            field=self.m.u64(field+0x18)
        return values

    def optional_pointer(self,obj,name):
        try:
            value=self.pointer(obj,name)
            if value:self.info(value)
            return value
        except BridgeError:return None

    def optional_scalar(self,obj,name):
        try:return self.scalar(obj,name)
        except BridgeError:return None

    def weak_pointer(self, obj, name):
        prop = self.prop(obj, name)
        if prop.kind != 'WeakObjectProperty' or prop.size != 8:
            raise BridgeError('field_type', 'Expected a weak object reference.')
        index, serial = struct.unpack('<ii', self.m.read(obj + prop.offset, 8))
        if not 0 <= index < self.object_count or serial <= 0:
            return None
        chunk = index // 65536
        if chunk not in self.chunks:
            self.chunks[chunk] = self.m.u64(self.chunk_table + chunk * 8)
        slot = self.chunks[chunk] + (index % 65536) * 24
        _, address, current_serial, _ = struct.unpack('<QQii', self.m.read(slot, 24))
        if not address or current_serial != serial:
            return None
        identity = self.info(address)
        return address if identity.index == index and identity.serial == serial else None

    def optional_weak_pointer(self, obj, name):
        try:return self.weak_pointer(obj, name)
        except BridgeError:return None

    def optional_name(self, obj, name):
        try:
            prop = self.prop(obj, name)
            if prop.kind == 'NameProperty' and prop.size == 8:
                return self.fname(*struct.unpack('<II', self.m.read(obj + prop.offset, 8)))
        except BridgeError:
            pass
        return None

    def property_triple(self, obj, name):
        prop = self.prop(obj, name)
        return self.read_triple(obj, prop)

    def read_triple(self, base, prop):
        if prop.kind != 'StructProperty' or prop.size not in (12, 24):
            raise BridgeError('field_type', 'Expected a three component struct.')
        data = self.m.read(base + prop.offset, prop.size)
        triple = struct.unpack('<3d' if prop.size == 24 else '<3f', data)
        if not all(math.isfinite(value) and abs(value) <= 100_000_000 for value in triple):
            raise BridgeError('invalid_vector', 'Invalid relative transform.')
        return triple

    def struct_triples(self, obj, name, names):
        result = {}
        parent = self.prop(obj, name)
        if parent.kind != 'StructProperty' or parent.size > 4096:
            return result
        kind = self.m.u64(parent.descriptor + 0x70)
        if not kind:
            return result
        field = self.m.u64(kind + 0x50)
        for _ in range(128):
            if not field:
                break
            label = self.fname(self.m.u32(field + 0x20))
            if label in names:
                offset, size = self.m.i32(field + 0x44), self.m.i32(field + 0x30)
                kind_name = self.fname(self.m.u32(self.m.u64(field + 8)))
                if 0 <= offset < parent.size and size <= parent.size - offset:
                    prop = Property(label, kind_name, offset, size, field)
                    result[label] = self.read_triple(obj + parent.offset, prop)
            field = self.m.u64(field + 0x18)
        return result

    def string(self,obj,name):
        p=self.prop(obj,name)
        if p.kind!='StrProperty':raise BridgeError('field_type','Expected FString.')
        data,n,cap=struct.unpack('<Qii',self.m.read(obj+p.offset,16))
        if not 0<=n<=4096 or not n<=cap<=65536:raise BridgeError('invalid_string','FString header exceeds limits.')
        return self.m.read(data,(n-1)*2).decode('utf-16le','replace') if n>1 else ''

    def struct_names(self,obj,name):
        prop=self.prop(obj,name)
        if prop.kind!='StructProperty' or prop.size>512:raise BridgeError('field_type','Expected a small reflected struct.')
        struct_object=self.m.u64(prop.descriptor+0x70);field=self.m.u64(struct_object+0x50);values={};seen=set()
        while field:
            if field in seen or len(seen)>=64:raise BridgeError('invalid_property','Struct fields exceed limits.')
            seen.add(field);kind=self.fname(self.m.u32(self.m.u64(field+8)));offset=self.m.i32(field+0x44)
            if kind=='NameProperty' and 0<=offset<=prop.size-8:
                key=self.fname(self.m.u32(field+0x20));ni,nn=struct.unpack('<II',self.m.read(obj+prop.offset+offset,8))
                values[key]=self.fname(ni,nn)
            field=self.m.u64(field+0x18)
        return {'type':self.name(struct_object),'fields':values}

    def component_transform(self, component):
        offset = int(self.layout['componentWorldLocationOffset'], 0)
        data = self.m.read(component + offset - 32, 96)
        x, y, z, w, _, _, _, _, sx, sy, sz, _ = struct.unpack('<12d', data)
        if not math.isclose(x*x + y*y + z*z + w*w, 1, abs_tol=.005):
            raise BridgeError('invalid_rotation', 'Component rotation is unavailable.')
        if not all(math.isfinite(s) and .001 <= abs(s) <= 100 for s in (sx, sy, sz)):
            raise BridgeError('invalid_scale', 'Component scale is unavailable.')
        return {'position': vector(data[32:56]), 'quaternion': [x, y, z, w], 'scale': [sx, sy, sz]}

    def actor_transform(self, actor):
        info = self.info(actor)
        root = self.pointer(actor, 'RootComponent')
        root_info = self.info(root)
        transform = self.component_transform(root)
        if self.pointer(actor, 'RootComponent') != root or not self.unchanged(root_info) or not self.unchanged(info):
            raise BridgeError('object_changed', 'Actor transform changed ownership while reading.')
        return transform

    def location(self,actor):
        info=self.info(actor);root=self.pointer(actor,'RootComponent');root_info=self.info(root)
        location=vector(self.m.read(root+int(self.layout['componentWorldLocationOffset'],0),24))
        if self.pointer(actor,'RootComponent')!=root or not self.unchanged(root_info) or not self.unchanged(info):
            raise BridgeError('object_changed','Actor location changed ownership while reading.')
        return location

    def entity_id(self,epoch,obj):
        info=self.info(obj)
        value=f'{epoch}:{info.index}:{info.serial}:{info.address}:{info.name_index}:{info.name_number}'
        return hashlib.sha256(value.encode()).hexdigest()[:24]
