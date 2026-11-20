"""Exercise the real C queue/journal code in temporary directories, without a game."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--sanitize", choices=("thread", "address,undefined"))
args = parser.parse_args()

HERE = Path(__file__).resolve().parent
source = (HERE / 'native_runtime.c').read_text()
source_sha = hashlib.sha256(source.encode()).hexdigest()
with tempfile.TemporaryDirectory(prefix='ticket-native-runtime-') as temp:
    root = Path(temp)
    runtime, state = root / 'run', root / 'state'
    runtime.mkdir(mode=0o700)
    state.mkdir(mode=0o700)
    # Only fixed directory literals differ. No shipping source file is edited.
    assert source.count('"/run/squad-native"') == 1
    assert source.count('"/var/lib/squad-native"') == 1
    # The hash-bound build directory can exceed sockaddr_un.sun_path. The
    # fixture runs with its private temp directory as cwd, keeping every path
    # inside the allowed build tree while the socket address stays short.
    copy = source.replace('"/run/squad-native"', '"run"')
    copy = copy.replace('"/var/lib/squad-native"', '"state"')
    (root / 'runtime_under_test.c').write_text(copy)
    command = [os.environ.get('CC', 'cc'), '-std=c11', '-Wall', '-Wextra', '-Werror', '-pthread',
               '-I', str(HERE), '-I', str(root)]
    if args.sanitize:
        command += ["-g", "-O1", "-fno-omit-frame-pointer", "-fsanitize=" + args.sanitize]
    if sys.platform == 'darwin':
        compat = root / 'linux_api_declarations.h'
        compat.write_text('''#include <sys/types.h>
#ifndef SOCK_CLOEXEC
#define SOCK_CLOEXEC 0
#endif
#ifndef SOCK_NONBLOCK
#define SOCK_NONBLOCK 0
#endif
#ifndef SO_PEERCRED
#define SO_PEERCRED 17
struct ucred { pid_t pid; uid_t uid; gid_t gid; };
#endif
#ifndef MSG_NOSIGNAL
#define MSG_NOSIGNAL 0
#endif
struct sockaddr;
int accept4(int,struct sockaddr *,unsigned int *,int);
''')
        command += ['-include', str(compat)]
    executable = root / 'test-runtime'
    command += ['-o', str(executable), str(HERE / 'test_runtime_harness.c'),
                str(HERE / 'native_protocol.c'), str(HERE / 'sha256.c')]
    subprocess.run(command, check=True)
    result = subprocess.run([str(executable)], cwd=root, check=True, capture_output=True, text=True, timeout=20)
    evidence = json.loads(result.stdout)
    evidence['native_runtime_sha256'] = source_sha
    evidence['scope'] = 'Real C runtime queue/journal; graph apply is a counting test double. No game process used.'
    evidence['platform'] = sys.platform
    evidence['sanitizers'] = args.sanitize
    evidence['fixture_paths_relative_to_private_temp_cwd'] = True
    print(json.dumps(evidence, sort_keys=True))
