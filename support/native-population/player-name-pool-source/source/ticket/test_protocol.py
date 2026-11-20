"""Check the native wire parser/formatter against the real backend protocol."""
import ctypes
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'backend'))
import ticket_protocol as reference

class Request(ctypes.Structure):
    _fields_ = [('is_set', ctypes.c_int), ('operation_id', ctypes.c_char * 33),
                ('expected_epoch', ctypes.c_char * 161), ('team1', ctypes.c_int), ('team2', ctypes.c_int)]

class Snapshot(ctypes.Structure):
    _fields_ = [('available', ctypes.c_int), ('epoch', ctypes.c_char * 161),
                ('map', ctypes.c_char * 257), ('tickets', ctypes.c_int32 * 2),
                ('reason', ctypes.c_char * 65), ('observed_at', ctypes.c_double)]

base = {'op': 'set', 'operation_id': 'a' * 32, 'expected_epoch': 'session:100:20:3', 'team1': 9999, 'team2': 1}
cases = [json.dumps({'op': 'status'}), json.dumps(base), ' { "op":"status" } ',
         json.dumps({'op': 'status', 'team1': 5}), '{"op":"status","op":"status"}', '{}', '[]',
         '{"op":"status",}', json.dumps(dict(base, team1=0)), json.dumps(dict(base, team2=10000)),
         json.dumps(dict(base, team1=True)), json.dumps(dict(base, team1=1.0)),
         json.dumps(dict(base, expected_epoch='bad epoch')), json.dumps(dict(base, expected_epoch='x' * 161)),
         json.dumps(dict(base, operation_id='A' * 32)), json.dumps(dict(base, expected_epoch='quote"back\\slash')),
         json.dumps({'op': 'set', 'operation_id': 'a' * 32, 'expected_epoch': 'good', 'team2': 10}),
         '{"op":"set","operation_id":"' + 'a' * 32 + '","expected_epoch":"x","team1":01}',
         json.dumps(dict(base, expected_epoch='é')), '{"op":"st\\u0061tus"}',
         json.dumps(dict(base, extra=1)), json.dumps(dict(base, expected_epoch='x\x7f'))]

with tempfile.TemporaryDirectory(prefix='ticket-native-protocol-') as temp:
    library = Path(temp) / 'protocol.so'
    subprocess.run([os.environ.get('CC', 'cc'), '-std=c11', '-Wall', '-Wextra', '-Werror',
                    '-fPIC', '-shared', '-o', str(library), str(HERE / 'native_protocol.c'),
                    str(HERE / 'sha256.c')], check=True)
    lib = ctypes.CDLL(str(library))
    lib.nt_parse_request.argtypes = [ctypes.c_char_p, ctypes.c_size_t, ctypes.POINTER(Request)]
    lib.nt_format_status.argtypes = [ctypes.c_char_p, ctypes.c_size_t, ctypes.c_char_p, ctypes.POINTER(Snapshot)]
    lib.nt_format_result.argtypes = [ctypes.c_char_p, ctypes.c_size_t, ctypes.POINTER(Request), ctypes.c_char_p,
                                     ctypes.POINTER(Snapshot), ctypes.POINTER(Snapshot), ctypes.c_char_p]
    for raw in cases:
        try:
            reference.validate_request(reference.loads(raw), native=True)
            expected = True
        except (ValueError, TypeError):
            expected = False
        request = Request()
        encoded = raw.encode()
        accepted = bool(lib.nt_parse_request(encoded, len(encoded), ctypes.byref(request)))
        assert accepted == expected, (raw, expected, accepted)
        if accepted and request.is_set:
            assert request.team1 == json.loads(raw).get('team1', -1)
            assert request.team2 == json.loads(raw).get('team2', -1)
    snapshot = Snapshot()
    snapshot.available = 1
    snapshot.epoch = base['expected_epoch'].encode()
    snapshot.map = b'Tallil_AAS_v1'
    snapshot.tickets[:] = [777, 888]
    snapshot.observed_at = time.time()
    output = ctypes.create_string_buffer(2048)
    assert lib.nt_format_status(output, len(output), b'a' * 32, ctypes.byref(snapshot)) > 0
    reference.validate_status(json.loads(output.value), now=time.time())
    request = Request()
    encoded = json.dumps(base).encode()
    assert lib.nt_parse_request(encoded, len(encoded), ctypes.byref(request))
    before = snapshot
    after = Snapshot()
    after.available = 1
    after.epoch = snapshot.epoch
    after.map = snapshot.map
    after.tickets[:] = [9999, 1]
    after.observed_at = time.time()
    assert lib.nt_format_result(output, len(output), ctypes.byref(request), b'applied', ctypes.byref(before), ctypes.byref(after), b'') > 0
    reference.validate_set(json.loads(output.value), base, native=True)
    for outcome in ('rejected', 'unknown', 'not_submitted'):
        assert lib.nt_format_result(output, len(output), ctypes.byref(request), outcome.encode(), None, None, b'epoch_changed') > 0
        reference.validate_set(json.loads(output.value), base, native=True)
    snapshot.available = 0
    snapshot.reason = b'discovering_match'
    assert lib.nt_format_status(output, len(output), b'a' * 32, ctypes.byref(snapshot)) > 0
    reference.validate_status(json.loads(output.value), now=time.time())
print(json.dumps({'protocol_parity_cases': len(cases), 'formatted_statuses_validated': 2,
                  'formatted_results_validated': 4, 'result': 'passed'}))
