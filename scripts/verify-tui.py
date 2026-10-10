"""Drive the actual compiled TUI through a Unix PTY against the local fixture."""
import errno
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import tempfile
import termios
import time
from pathlib import Path

port = sys.argv[1]
root = Path(__file__).resolve().parent.parent
output = bytearray()
marks = {}

with tempfile.TemporaryDirectory(prefix='myssh-tui-verify-') as directory:
    pid, fd = pty.fork()
    if pid == 0:
        os.environ['MYSSH_TUI_HOME'] = directory
        os.chdir(root)
        os.execvp('node', ['node', 'out/tui/myssh.cjs'])
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 110, 0, 0))
    position = 0

    def read_once(timeout=0.05):
        if select.select([fd], [], [], timeout)[0]:
            try:
                data = os.read(fd, 65536)
                if data:
                    output.extend(data)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise

    def expect(value, timeout=8):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            read_once()
            if value.encode() in output[position:]:
                return
        raise AssertionError(f'Expected {value!r}; tail: {output[-1500:].decode(errors="replace")}')

    def send(value):
        global position
        read_once(0.01)
        position = len(output)
        os.write(fd, value.encode())

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
        expect('文本预览 / 编辑')
        send('\r')
        expect('Hello SFTP')
        send('\r')
        expect('用本地编辑器编辑')
        send('\x1b')
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
        send('\x1b[B' * 4 + '\r')
        expect('全部终端')
        send('\x1b[B\r')
        expect('Local demo')
        send('\x03')
        deadline = time.monotonic() + 5
        status = None
        while time.monotonic() < deadline:
            read_once()
            child, child_status = os.waitpid(pid, os.WNOHANG)
            if child:
                status = child_status
                break
        assert status == 0, f'TUI did not exit cleanly: {status}'
        vault = Path(directory, 'profiles.vault.json').read_text()
        assert 'demo-fixture' not in vault and 'fixture-master' not in vault
        assert '\x1b[?25h\x1b[?1049l' in output.decode(errors='replace')
        print('PTY verified: encrypted profile CRUD, connection test, SSH, multi-shell screen restore, Ctrl+], SFTP preview, metrics, services, disconnect and clean exit.')
        destination = root / '.dev' / 'tui-verify'
        destination.mkdir(parents=True, exist_ok=True)
        for name, transcript in marks.items():
            (destination / f'{name}.ansi').write_text(transcript)
        (destination / 'result.json').write_text(json.dumps({'steps': list(marks), 'result': 'passed'}, ensure_ascii=False))
    finally:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        os.close(fd)
