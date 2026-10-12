"""Exercise the public --preview entry through PTY/ConPTY, including native decoders."""
import os
import sys
import time
import json
import base64
import subprocess
from pathlib import Path
from terminal_process import TerminalProcess

binary, directory = sys.argv[1:3]
root = Path(__file__).resolve().parent.parent

def check(extension, label, text=None, second=None):
    terminal = TerminalProcess([binary, '--preview', os.path.join(directory, 'fixture.' + extension)], directory,
                               {**os.environ, 'PATH': directory})
    output = bytearray()
    position = 0
    screen = {'text': '', 'coloredBlock': False}
    use_screen = os.name == 'nt' or os.environ.get('MYSSH_VERIFY_SCREEN') == '1'
    screen_reader = subprocess.Popen([sys.argv[3], str(root / 'scripts/tui-test-screen.mjs'), '--colors'],
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding='utf-8') if use_screen else None

    def read_once():
        nonlocal screen
        data = terminal.read(0.05)
        output.extend(data)
        if data and screen_reader:
            screen_reader.stdin.write(base64.b64encode(data).decode() + '\n')
            screen_reader.stdin.flush()
            screen = json.loads(screen_reader.stdout.readline())

    def expect(value):
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            read_once()
            if value.encode() in output[position:] or len(output) > position and value in screen['text']:
                return
        raise AssertionError(f'Preview {extension}: expected {value!r}, tail {output[-1800:].decode(errors="replace")}')

    def send(value):
        nonlocal position
        read_once()
        position = len(output)
        terminal.write(value.encode())

    try:
        expect(label)
        if extension in ('png', 'pdf'):
            if screen_reader:
                assert screen['coloredBlock'], 'Expected rendered RGB pixel cells'
            else:
                expect('\x1b[38;2;')
            expect('图片使用终端 RGB 色块')
        destination = root / '.dev' / 'tui-preview'
        destination.mkdir(parents=True, exist_ok=True)
        (destination / (extension + '.ansi')).write_bytes(output)
        if extension in ('docx', 'xlsx'):
            expect(text)
        send('\r')
        expect('返回文件列表')
        if extension == 'pdf':
            send('\x1b[B\r')
            expect(text)
            send('\r')
            expect('返回文件列表')
        if second:
            # PDF menu also includes a text action.
            send(('\x1b[B' * (2 if extension == 'pdf' else 1)) + '\r')
            expect('2/2')
            if extension == 'xlsx':
                expect(second)
            send('\r')
            expect('返回文件列表')
        send('\r')
        deadline = time.monotonic() + 10
        status = None
        while time.monotonic() < deadline:
            read_once()
            status = terminal.poll()
            if status is not None:
                break
        assert status == 0, f'Preview did not exit cleanly: {status}'
    finally:
        terminal.close()
        if screen_reader:
            screen_reader.stdin.close()
            try:
                screen_reader.wait(timeout=5)
            except subprocess.TimeoutExpired:
                screen_reader.kill()
                screen_reader.wait()

check('png', '图片')
check('pdf', 'PDF · 1/2', 'PDFfixture', 'PDFsecond')
check('xlsx', '工作表 1/2', 'SHEETfirst', 'SHEETsecond')
check('docx', 'DOCX', 'DOCXfixture 你好')
print('Public --preview verified: PNG pixels, PDF render/text/pages, XLSX sheets, DOCX text.')
