"""Real Windows WSL handoff through ConPTY; uses an existing, explicitly selected distribution."""
import os
import sys
import time
import subprocess
import json
import base64
import tempfile
import shutil
import re
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
listing = subprocess.run([wsl, '--list', '--quiet'], capture_output=True, check=True, timeout=30).stdout
names = list(dict.fromkeys(name.strip() for name in listing.decode('utf-16-le' if b'\x00' in listing else 'utf-8').replace('\ufeff', '').splitlines() if name.strip()))
assert distro in names, 'Requested distribution must be present in the real WSL list'
node = shutil.which(sys.argv[1]) or sys.argv[1]
command = [sys.argv[2], '--wsl'] if len(sys.argv) > 2 else None
target = root / '.dev' / 'wsl-acceptance'
target.mkdir(parents=True, exist_ok=True)

with tempfile.TemporaryDirectory(prefix='myssh-wsl-verify-') as directory:
    if command is None:
        wrapper = Path(directory, 'cli.cjs')
        # Some ConPTY hosts don't surface the Node stderr handle; capture CLI errors in its VT transcript.
        entry = Path(os.environ.get('MYSSH_WSL_TEST_ENTRY', root / 'out/tui/myssh.cjs')).resolve()
        loader = "import(" + json.dumps(entry.as_uri()) + ");" if entry.suffix == '.mjs' else "require(" + json.dumps(str(entry)) + ");"
        logfile = json.dumps(str(target / 'cli-errors.txt'))
        wrapper.write_text("const log=a=>require('node:fs').appendFileSync(" + logfile + ",a+'\\n');console.error=(...a)=>{log(a.map(String).join(' '));process.stdout.write('CLI_ERROR '+a.map(String).join(' ')+'\\r\\n')};const fail=e=>{log('CLI_FATAL '+(e?.stack||e));process.stdout.write('CLI_FATAL '+(e?.stack||e)+'\\r\\n',()=>process.exit(1))};process.on('uncaughtException',fail);process.on('unhandledRejection',fail);process.on('exit',code=>log('CLI_EXIT '+code));" + loader, encoding='utf8')
        command = [node, str(wrapper), '--wsl']
    environment = {**os.environ, 'MYSSH_TUI_HOME': directory}
    if len(sys.argv) > 2:
        environment['PATH'] = directory
    terminal = TerminalProcess(command, directory, environment)
    reader = subprocess.Popen([node, os.environ.get('MYSSH_SCREEN_READER', str(root / 'scripts/tui-test-screen.mjs'))], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding='utf-8')
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

    def expect(text, timeout=30, pattern=False):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            read()
            matches = bool(re.search(text, screen, re.MULTILINE)) if pattern else text.encode() in output[position:] or text in screen
            if matches:
                return
        raise AssertionError('WSL expected ' + repr(text) + ', process=' + str(terminal.poll()) + ', screen=' + repr(screen) + ': ' + output[-1600:].decode(errors='replace'))

    def send(text):
        global position
        read()
        position = len(output)
        terminal.write(text.encode())

    try:
        expect('WSL · 输入 exit 返回 MySSH')
        # Use the actual WSL list order, then wait for the selected row and Linux prompt.
        if names.index(distro):
            send('\x1b[B' * names.index(distro))
        expect('› ' + distro)
        send('\r')
        expect(r'[$#] *$', pattern=True)
        send("printf '%s%s\\n' 'WSL_' 'OK_你好'\r")
        expect('WSL_OK_你好')  # Marker isn't present verbatim in the echoed input.
        send('sleep 30\r')
        time.sleep(0.3)
        send('\x03')
        send("printf '%s%s\\n' 'CTRL_' 'RETURN_OK'\r")
        expect('CTRL_RETURN_OK')
        send('exit\r')
        deadline = time.monotonic() + 15
        while terminal.poll() is None and time.monotonic() < deadline:
            read()
        assert terminal.poll() == 0, 'WSL exit should return and restore the host terminal'
        print('REAL_WSL_OK: installed Linux distribution, ConPTY handoff, Unicode command, Ctrl+C continuation, exit and host restoration.')
    finally:
        (target / ('standalone.ansi' if len(sys.argv) > 2 else 'node.ansi')).write_bytes(output)
        (target / 'state.json').write_text(json.dumps({'screen': screen, 'exit': terminal.poll()}, ensure_ascii=True))
        terminal.close()
        reader.stdin.close()
        reader.wait(timeout=5)
