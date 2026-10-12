"""Real Windows WSL handoff through ConPTY; uses an existing, explicitly selected distribution."""
import os
import sys
import time
import subprocess
import json
import base64
import tempfile
from pathlib import Path
from terminal_process import TerminalProcess

if os.name != 'nt':
    raise RuntimeError('WSL acceptance requires a real Windows host')
distro = os.environ.get('MYSSH_TEST_WSL_DISTRO')
if not distro:
    raise RuntimeError('Set MYSSH_TEST_WSL_DISTRO to the installed distribution to verify')
root = Path(__file__).resolve().parent.parent
wsl = str(Path(os.environ['SystemRoot']) / 'System32' / 'wsl.exe')
probe = subprocess.run([wsl, '--distribution', distro, '--exec', '/bin/echo', 'WSL_READY'], capture_output=True, timeout=30)
assert probe.returncode == 0 and b'WSL_READY' in probe.stdout, 'Real WSL distribution must start'
command = [sys.argv[2], '--wsl'] if len(sys.argv) > 2 else [sys.argv[1], str(root / 'out/tui/myssh.cjs'), '--wsl']
with tempfile.TemporaryDirectory(prefix='myssh-wsl-verify-') as directory:
    environment = {**os.environ, 'MYSSH_TUI_HOME': directory}
    if len(sys.argv) > 2:
        environment['PATH'] = directory
    terminal = TerminalProcess(command, directory, environment)
    reader = subprocess.Popen([sys.argv[1], str(root / 'scripts/tui-test-screen.mjs')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding='utf-8')
    output = bytearray()
    position = 0
    screen = ''

    def read():
        global screen
        data = terminal.read(0.05)
        output.extend(data)
        if data:
            reader.stdin.write(base64.b64encode(data).decode() + '\n')
            reader.stdin.flush()
            screen = json.loads(reader.stdout.readline())

    def expect(text, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            read()
            if text.encode() in output[position:] or text in screen:
                return
        raise AssertionError('WSL expected ' + repr(text) + ': ' + output[-1600:].decode(errors='replace'))

    def send(text):
        global position
        read()
        position = len(output)
        terminal.write(text.encode())

    try:
        expect('WSL · 输入 exit 返回 MySSH')
        # Select the requested installed distribution through the menu's search UI.
        send('/' + distro)
        expect('› ' + distro)
        send('\r')
        time.sleep(0.3)
        send("printf '%s%s\\n' 'WSL_' 'OK_你好'\r")
        expect('WSL_OK_你好')  # Marker isn't present verbatim in the echoed input.
        send('exit\r')
        deadline = time.monotonic() + 15
        while terminal.poll() is None and time.monotonic() < deadline:
            read()
        assert terminal.poll() == 0, 'WSL exit should return and restore the host terminal'
        target = root / '.dev' / 'wsl-acceptance'
        target.mkdir(parents=True, exist_ok=True)
        (target / ('standalone.ansi' if len(sys.argv) > 2 else 'node.ansi')).write_bytes(output)
        print('REAL_WSL_OK: installed Linux distribution, ConPTY handoff, Unicode command, exit and host restoration.')
    finally:
        terminal.close()
        reader.stdin.close()
        reader.wait(timeout=5)
