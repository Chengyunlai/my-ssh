"""Drive the compiled TUI through a real Unix PTY or Windows ConPTY."""
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from terminal_process import TerminalProcess

port = sys.argv[1]
root = Path(__file__).resolve().parent.parent
output = bytearray()
marks = {}

with tempfile.TemporaryDirectory(prefix='myssh tui verify ') as directory:
    node = sys.argv[2]
    editor = Path(directory, 'fixture editor.cjs')
    editor.write_text("require('node:fs').appendFileSync(process.argv[2], 'Edited via terminal fixture\\n')", encoding='utf-8')
    upload = Path(directory, 'upload-fixture.txt')
    upload.write_text('Portable transfer fixture\n', encoding='utf-8')
    downloaded = Path(directory, 'downloaded-fixture.txt')
    command = [sys.argv[3]] if len(sys.argv) > 3 else [node, str(root / 'out/tui/myssh.cjs')]
    app_env = {**os.environ, 'MYSSH_TUI_HOME': directory, 'VISUAL': f'"{node}" "{editor}"'}
    if len(sys.argv) > 3:
        app_env['PATH'] = directory  # no node/npm in the application environment
    terminal = TerminalProcess(command, directory if len(sys.argv) > 3 else root, app_env)
    use_screen = os.name == 'nt' or os.environ.get('MYSSH_VERIFY_SCREEN') == '1'
    screen_reader = subprocess.Popen([node, str(root / 'scripts/tui-test-screen.mjs')], cwd=root,
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding='utf-8') if use_screen else None
    screen = ''
    position = 0

    def read_once(timeout=0.05):
        global screen
        data = terminal.read(timeout)
        if data:
            output.extend(data)
            if screen_reader:
                screen_reader.stdin.write(base64.b64encode(data).decode() + '\n')
                screen_reader.stdin.flush()
                screen = json.loads(screen_reader.stdout.readline())

    def expect(value, timeout=8):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            read_once()
            if value.encode() in output[position:] or len(output) > position and value in screen:
                return
        raise AssertionError(f'Expected {value!r}; tail: {output[-1500:].decode(errors="replace")}')

    def send(value):
        global position
        read_once(0.01)
        position = len(output)
        terminal.write(value.encode())

    def frame(name):
        read_once(0.1)
        marks[name] = output.decode(errors='replace')

    try:
        expect('设置主密码')
        send('fixture-master\r')
        expect('再次输入主密码')
        send('fixture-master\r')
        expect('终端工作区')
        frame('home')
        send('\r')
        expect('新建连接')
        send('\r')
        expect('连接名称')
        send('Local demo\r')
        expect('主机名 / IP')
        send('127.0.0.1\r')
        expect('SSH 端口')
        send('\x15' + port + '\r')
        expect('用户名')
        send('\x15demo\r')
        expect('认证方式')
        send('\r')
        expect('SSH 密码')
        send('demo-fixture\r')
        expect('Local demo')
        frame('profiles')
        send('\r')
        expect('编辑配置')
        send('\x1b[B' * 2 + '\r')
        expect('连接名称')
        send('\x15Local demo renamed\r')
        expect('主机名 / IP')
        send('\r')
        expect('SSH 端口')
        send('\r')
        expect('用户名')
        send('\r')
        expect('认证方式')
        send('\r')
        expect('SSH 密码')
        send('\r')
        expect('Local demo renamed')
        send('\r')
        expect('测试连接')
        send('\x1b[B\r')
        expect('连接测试成功')
        send('\r')
        expect('Local demo')
        send('\r')
        expect('测试连接')
        send('\r')
        expect('myssh-demo$')
        send('hello\r')
        expect('CORE_OK 你好')
        frame('shell')
        send('\x1d')
        expect('SFTP 文件管理')
        send('\r')
        expect('新建终端')
        send('\x1b[B\r')
        expect('进入终端')
        send('\r')
        expect('myssh-demo$')
        send('hello\r')
        expect('CORE_OK 你好')
        send('\x1d')
        expect('SFTP 文件管理')
        send('\r')
        expect('终端 2')
        send('\r')
        expect('进入终端')
        send('\r')
        expect('CORE_OK 你好')  # restored first Shell framebuffer
        send('\x1d')
        expect('SFTP 文件管理')
        send('\x1b[B\r')
        expect('hello.txt')
        frame('sftp')
        send('\x1b[B' * 4 + '\r')
        expect('文件预览 / 文本编辑')
        send('\r')
        expect('Hello SFTP')
        send('\r')
        expect('用本地编辑器编辑')
        send('\x1b[B\r')
        expect('写回远端文件')
        send('\x1b[B\r')
        expect('SFTP · /home/demo')
        expect('hello.txt')
        send('/hello.txt\r')
        expect('文件预览 / 文本编辑')
        send('\r')
        expect('Edited via terminal fixture')
        send('\r')
        expect('用本地编辑器编辑')
        send('\x1b')
        expect('hello.txt')
        send('/新建目录\r')
        expect('新目录名称')
        send('fixture-dir\r')
        expect('SFTP · /home/demo')
        expect('fixture-dir')
        send('/fixture-dir\r')
        expect('进入目录')
        send('\r')
        expect('SFTP · /home/demo/fixture-dir')
        send('/上传文件\r')
        expect('本地文件路径')
        send(str(upload) + '\r')
        expect('传输完成')
        send('\r')
        expect('upload-fixture.txt')
        send('/upload-fixture.txt\r')
        expect('下载文件')
        send('\x1b[B\r')
        expect('保存到本地路径')
        send('\x15' + str(downloaded) + '\r')
        expect('传输完成')
        assert downloaded.read_text(encoding='utf-8') == upload.read_text(encoding='utf-8')
        send('\r')
        expect('upload-fixture.txt')
        send('\r')  # parent directory
        expect('hello.txt')
        send('/fixture-dir\r')
        expect('删除目录')
        send('\x1b[B\r')
        expect('永久删除远端')
        send('\x1b[B\r')
        expect('hello.txt')
        send('\x1b')
        expect('SFTP 文件管理')
        send('\x1b[B' * 2 + '\r')
        expect('Swap')
        frame('monitor')
        send('\r')
        expect('刷新')
        send('\x1b')
        expect('SFTP 文件管理')
        send('\x1b[B' * 3 + '\r')
        expect('3000')
        frame('services')
        send('\x1b')
        expect('SFTP 文件管理')
        send('/断开连接\r')
        expect('全部终端')
        send('\x1b[B\r')
        expect('Local demo')
        send('\r')
        expect('删除配置')
        send('\x1b[B' * 3 + '\r')
        expect('删除连接配置')
        send('\x1b[B\r')
        expect('新建连接')
        send('\x03')
        deadline = time.monotonic() + 5
        status = None
        while time.monotonic() < deadline:
            read_once()
            status = terminal.poll()
            if status is not None:
                break
        assert status == 0, f'TUI did not exit cleanly: {status}'
        vault = Path(directory, 'profiles.vault.json').read_text()
        assert 'demo-fixture' not in vault and 'fixture-master' not in vault
        if os.name != 'nt':
            assert '\x1b[?25h\x1b[?1049l' in output.decode(errors='replace')
        print(f'{"ConPTY" if os.name == "nt" else "PTY"} verified: encrypted profile CRUD, connection test, SSH, multi-shell screen restore, Ctrl+], SFTP preview/edit/transfers/recursive delete, metrics, services, disconnect and clean exit.')
        destination = root / '.dev' / 'tui-verify'
        destination.mkdir(parents=True, exist_ok=True)
        for name, transcript in marks.items():
            (destination / f'{name}.ansi').write_text(transcript, encoding='utf-8')
        (destination / 'result.json').write_text(json.dumps({'steps': list(marks), 'result': 'passed'}, ensure_ascii=False), encoding='utf-8')
    finally:
        terminal.close()
        if screen_reader:
            screen_reader.stdin.close()
            try:
                screen_reader.wait(timeout=5)
            except subprocess.TimeoutExpired:
                screen_reader.kill()
                screen_reader.wait()
