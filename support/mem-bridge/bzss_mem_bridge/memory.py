import ctypes
import hashlib
import os
from pathlib import Path
import struct
import sys
import time


class BridgeError(Exception):
    def __init__(self, code, message):
        self.code=code
        super().__init__(message)


class Iovec(ctypes.Structure):
    _fields_=[('base',ctypes.c_void_p),('length',ctypes.c_size_t)]


def start_ticks(path):
    return (path/'stat').read_text().rsplit(')',1)[1].split()[19]


def find_process(target, proc_root=Path('/proc')):
    matches=[]
    for path in proc_root.glob('[0-9]*'):
        try:
            executable=os.readlink(path/'exe').removesuffix(' (deleted)')
            if executable!=target['executable']:continue
            if target.get('cgroupContains') and target['cgroupContains'] not in (path/'cgroup').read_text():continue
            if target.get('pid') is not None and int(path.name)!=target['pid']:continue
            matches.append(path)
        except (OSError,ValueError,IndexError):continue
    if len(matches)!=1:
        raise BridgeError('process_not_unique',f'Expected one matching game process; found {len(matches)}.')
    return matches[0]


class RemoteMemory:
    """No write, ptrace, injected calls, signals or game-library dependency."""
    def __init__(self,target,profile):
        if sys.platform!='linux' or ctypes.sizeof(ctypes.c_void_p)!=8:raise BridgeError('linux_required','Memory reading requires 64-bit Linux.')
        self.target=target;self.profile=profile;self.proc=find_process(target)
        self.pid=int(self.proc.name);self.start=start_ticks(self.proc)
        with (self.proc/'exe').open('rb') as stream:
            self.sha256=hashlib.file_digest(stream,'sha256').hexdigest()
        if self.sha256!=profile['gameSha256']:
            raise BridgeError('build_mismatch','Game SHA256 does not match the selected layout profile.')
        with (self.proc/'exe').open('rb') as stream:header=stream.read(64)
        if header[:7]!=b'\x7fELF\x02\x01\x01' or struct.unpack_from('<H',header,18)[0]!=62:
            raise BridgeError('elf_mismatch','Expected a Linux x86-64 ELF executable.')
        if struct.unpack_from('<H',header,16)[0]!=2:
            raise BridgeError('elf_mismatch','This profile expects a fixed-address ET_EXEC game build.')
        self.libc=ctypes.CDLL(None,use_errno=True)
        self.libc.process_vm_readv.argtypes=[ctypes.c_int,ctypes.POINTER(Iovec),ctypes.c_ulong,ctypes.POINTER(Iovec),ctypes.c_ulong,ctypes.c_ulong]
        self.libc.process_vm_readv.restype=ctypes.c_ssize_t
        self.begin()
        for guard in profile['guards']:
            if self.read(int(guard['address'],0),len(bytes.fromhex(guard['bytes'])))!=bytes.fromhex(guard['bytes']):
                raise BridgeError('layout_guard_mismatch','Component location layout guard does not match.')

    def begin(self):
        self.read_calls=0;self.read_bytes=0;self.deadline=time.monotonic()+3

    def read(self,address,size):
        if type(address) is not int or type(size) is not int or address<4096 or size<1 or size>65536 or address+size>=2**63:
            raise BridgeError('invalid_read','Invalid read range.')
        self.read_calls+=1;self.read_bytes+=size
        if self.read_calls>150000 or self.read_bytes>32*1024*1024 or time.monotonic()>self.deadline:
            raise BridgeError('read_budget','Snapshot exceeded its read budget.')
        buffer=ctypes.create_string_buffer(size)
        local=Iovec(ctypes.cast(buffer,ctypes.c_void_p),size);remote=Iovec(ctypes.c_void_p(address),size)
        count=self.libc.process_vm_readv(self.pid,ctypes.byref(local),1,ctypes.byref(remote),1,0)
        if count!=size:
            error=ctypes.get_errno()
            if error in (1,13):raise BridgeError('permission_denied','Reading the game requires root or suitable CAP_SYS_PTRACE access.')
            raise BridgeError('object_changed','Memory became unavailable during the read.')
        return buffer.raw

    def block(self,address,size):
        if not 0<=size<=4*1024*1024:raise BridgeError('invalid_read','Array read exceeds limit.')
        return b''.join(self.read(address+at,min(65536,size-at)) for at in range(0,size,65536))

    def u64(self,at):return struct.unpack('<Q',self.read(at,8))[0]
    def u32(self,at):return struct.unpack('<I',self.read(at,4))[0]
    def i32(self,at):return struct.unpack('<i',self.read(at,4))[0]

    def validate_process(self):
        try:
            if start_ticks(self.proc)!=self.start or os.readlink(self.proc/'exe').removesuffix(' (deleted)')!=self.target['executable']:
                raise BridgeError('process_changed','Game process identity changed.')
        except (OSError,IndexError):raise BridgeError('process_changed','Game process exited.')
