"""Drive the actual TUI into a real Vim/tmux behind the loopback SSH service."""
import os
import sys
import json
import time
import base64
import tempfile
import subprocess
import select
from pathlib import Path
from terminal_process import TerminalProcess

port, mode, fixture, node = sys.argv[1:5]
root = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='myssh-terminal-client-') as directory:
    command = [sys.argv[5]] if len(sys.argv) > 5 else [node, str(root / 'out/tui/myssh.cjs')]
    environment = {**os.environ, 'MYSSH_TUI_HOME': directory}
    if len(sys.argv) > 5:
        environment['PATH'] = directory
    terminal = TerminalProcess(command, directory, environment)
    reader = subprocess.Popen([node, str(root / 'scripts/tui-test-screen.mjs'), '--responses'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding='utf-8')
    output = bytearray()
    screen = ''

    def read():
        global screen
        data = terminal.read(0.05)
        if data:
            output.extend(data)
            reader.stdin.write(base64.b64encode(data).decode() + '\n')
            reader.stdin.flush()
            if not select.select([reader.stdout], [], [], 5)[0]:
                raise AssertionError('VT screen parser did not respond')
            frame = json.loads(reader.stdout.readline())
            screen = frame['text']
            if frame['responses']:
                terminal.write(frame['responses'].encode())
            Path(directory, 'screen.txt').write_text(screen)

    def expect(value):
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            read()
            if value in screen:
                return
        raise AssertionError('Real ' + mode + ': expected ' + repr(value) + ', screen ' + screen[-1600:])

    def send(value):
        read()
        terminal.write(value.encode())

    def resume():
        send('\x1d')
        expect('SFTP 文件管理')
        send('\r')
        expect('新建终端')
        send('\r')
        expect('进入终端')
        send('\r')

    try:
        expect('设置主密码'); send('fixture-master\r')
        expect('再次输入主密码'); send('fixture-master\r')
        expect('终端工作区'); send('\r')
        expect('新建连接'); send('\r')
        expect('连接名称'); send('Fullscreen fixture\r')
        expect('主机名 / IP'); send('127.0.0.1\r')
        expect('SSH 端口'); send('\x15' + port + '\r')
        expect('用户名'); send('\x15demo\r')
        expect('认证方式'); send('\r')
        expect('SSH 密码'); send('demo-fixture\r')
        expect('Fullscreen fixture'); send('\r')
        expect('测试连接'); send('\r')
        expect('real-terminal$')
        if mode == 'vim':
            send("vim -Nu NONE -i NONE -n -c 'set encoding=utf-8' document.txt\r")
            expect('VIM_START 你好')
            send('iVIM_EDIT')
            for byte in '你好'.encode():
                terminal.write(bytes([byte]))
                time.sleep(0.02)
            expect('VIM_EDIT你好VIM_START 你好')
            resume()
            expect('VIM_EDIT你好VIM_START 你好')
            send('\x1b:wq\r')
        else:
            socket = 'myssh-' + Path(fixture).name
            send('tmux -u -L ' + socket + " -f /dev/null new-session -s fixture /bin/sh -i \\; set -g status-left 'TMUX_'READY \\; set -g status-right ''\r")
            expect('TMUX_READY')
            send("printf '%s%s\\n' 'TMUX_' 'OK_你好'; test -n \"$TMUX\" && printf '%s%s\\n' 'SESSION_' 'REAL'\r")
            expect('TMUX_OK_你好')
            expect('SESSION_REAL')
            resume()
            expect('TMUX_OK_你好')
            send("printf '%s%s\\n' 'TMUX_' 'RETURN_OK'\r")
            expect('TMUX_RETURN_OK')
            send('exit\r')
        expect('real-terminal$')
        send('\x1d')
        expect('SFTP 文件管理')
        destination = root / '.dev' / 'tui-terminal'
        destination.mkdir(parents=True, exist_ok=True)
        (destination / (mode + '.ansi')).write_bytes(output)
        print('Real ' + mode + ' interaction and fullscreen restoration passed.')
    finally:
        terminal.close()
        reader.stdin.close()
        reader.wait(timeout=5)
