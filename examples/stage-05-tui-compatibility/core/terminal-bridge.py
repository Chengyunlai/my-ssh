"""Own a real Vim/tmux PTY and carry its bytes over the loopback SSH test channel."""
import os
import sys
import json
import base64
import select
import shutil
import subprocess
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'scripts'))
from terminal_process import TerminalProcess

mode, directory, cols, rows = sys.argv[1:5]
socket = 'myssh-' + Path(directory).name
env = {**os.environ, 'HOME': directory, 'TERM': 'xterm-256color', 'LANG': 'C.UTF-8', 'PS1': 'real-terminal$ '}
env.pop('ENV', None)
env.pop('TMUX', None)
command = ['/bin/sh', '-i']
terminal = TerminalProcess(command, directory, env, int(cols), int(rows))
pending = b''
try:
    while terminal.poll() is None:
        data = terminal.read(0.02)
        if data:
            print(json.dumps({'output': base64.b64encode(data).decode()}), flush=True)
        if select.select([sys.stdin], [], [], 0)[0]:
            chunk = os.read(sys.stdin.fileno(), 65536)
            if not chunk:
                break
            pending += chunk
            while b'\n' in pending:
                line, pending = pending.split(b'\n', 1)
                request = json.loads(line)
                if 'input' in request:
                    terminal.write(base64.b64decode(request['input']))
                if 'resize' in request:
                    terminal.resize(*request['resize'])
    print(json.dumps({'exit': terminal.poll()}), flush=True)
finally:
    terminal.close()
    if mode == 'tmux':
        subprocess.run([shutil.which('tmux'), '-L', socket, 'kill-server'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
