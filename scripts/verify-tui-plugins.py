"""Public terminal plugin workflow against synthetic market, SSH and MySQL services."""
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from terminal_process import TerminalProcess

ssh_port, mysql_port, registry, node = sys.argv[1:5]
root = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='myssh plugins verify ') as directory:
    command = [sys.argv[5]] if len(sys.argv) > 5 else [node, str(root / 'out/tui/myssh.cjs')]
    env = {**os.environ, 'MYSSH_TUI_HOME': directory}
    if len(sys.argv) > 5:
        env['PATH'] = directory
    terminal = TerminalProcess(command, directory, env)
    use_screen = os.name == 'nt' or os.environ.get('MYSSH_VERIFY_SCREEN') == '1'
    screen_reader = subprocess.Popen([node, str(root / 'scripts/tui-test-screen.mjs')], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, text=True, encoding='utf-8') if use_screen else None
    output = bytearray()
    position = 0
    screen = ''
    captures = {}

    def read_once(timeout=0.05):
        global screen
        data = terminal.read(timeout)
        output.extend(data)
        if data and screen_reader:
            screen_reader.stdin.write(base64.b64encode(data).decode() + '\n')
            screen_reader.stdin.flush()
            screen = json.loads(screen_reader.stdout.readline())

    def expect(text, timeout=15):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            read_once()
            if text.encode() in output[position:] or len(output) > position and text in screen:
                return
        raise AssertionError(f'Expected {text!r}; tail {output[-2500:].decode(errors="replace")}')

    def send(text):
        global position
        read_once(0.02)
        position = len(output)
        terminal.write(text.encode())

    def choose(text):
        send('/' + text + '\r')

    def capture(name):
        read_once(0.05)
        captures[name] = bytes(output)

    def install(name):
        choose('插件市场')
        expect('插件市场地址')
        send('\x15' + registry + '\r')
        expect(name)
        choose(name)
        expect('来源：')
        send('\r')
        expect('默认停用')
        send('\x1b[B\r')
        expect('[停用] ' + name)
        choose(name)
        expect('启用插件')
        choose('启用插件')
        expect('[启用] ' + name)

    def open_plugin(name):
        choose(name)
        expect('打开 ·')
        choose('打开 ·')

    try:
        expect('设置主密码', timeout=30)
        send('fixture-master\r')
        expect('再次输入主密码')
        send('fixture-master\r')
        expect('终端工作区')
        choose('插件')
        expect('插件市场')
        install('MySQL fixture')
        open_plugin('MySQL fixture')
        expect('新建数据库连接')
        send('\r')
        for label, value in [('数据库连接名称', 'DB demo'), ('数据库主机', '127.0.0.1'),
                             ('数据库端口', mysql_port), ('数据库用户名', 'demo'),
                             ('数据库密码', 'demo-fixture'), ('默认数据库', '')]:
            expect(label)
            send('\x15' + value + '\r')
        expect('数据库 TLS')
        send('\x1b[B\r')
        expect('DB demo')
        send('\r')
        expect('连接数据库')
        send('\r')
        expect('执行 SQL')
        send('\r')
        expect('数据库')
        send('\r')
        expect('items')
        send('\r')
        expect('查看表结构')
        send('\r')
        expect('varchar(255)')
        capture('mysql-schema')
        send('\r')
        expect('导出当前结果 CSV')
        send('\r')
        expect('执行 SQL')
        choose('执行 SQL')
        expect('SQL（Enter')
        send('\x15SELECT fixture\r')
        expect('预览并执行')
        send('\r')
        expect('即将在 DB demo')
        send('\r')
        expect('执行上面的 SQL')
        send('\x1b[B\r')
        expect('MYSQL_OK 你好')
        capture('mysql-query')
        send('\r')
        expect('导出当前结果 CSV')
        choose('导出当前结果 CSV')
        expect('CSV 保存路径')
        csv = Path(directory, 'result.csv')
        send('\x15' + str(csv) + '\r')
        expect('CSV 已导出')
        assert 'MYSQL_OK 你好' in csv.read_text(encoding='utf-8-sig')
        send('\r')
        expect('MYSQL_OK 你好')
        send('\r')
        expect('导出当前结果 CSV')
        send('\r')
        expect('查询历史')
        choose('查询历史')
        expect('SELECT fixture')
        send('\r')
        expect('SQL（Enter')
        send('\x1b')
        expect('数据库 / 表')
        send('\r')
        expect('数据库')
        send('\r')
        expect('items')
        send('\r')
        expect('行编辑')
        choose('查看表数据')
        expect('新增行')
        send('\r')
        expect('当前行')
        send('\r')
        expect('修改一个字段')
        choose('修改一个字段')
        expect('修改字段')
        choose('message')
        expect(':null = NULL')
        send('\x15Edited fixture row\r')
        expect('行修改预览')
        send('\r')
        expect('提交行修改')
        send('\x1b[B\r')
        expect('行修改结果')
        send('\r')
        expect('Edited fixture row')
        send('\x1b')
        expect('断开数据库')
        choose('断开数据库')
        expect('新建数据库连接')
        send('\x1b')
        expect('终端插件')
        install('Commands fixture')
        install('Monitor fixture')
        send('\x1b')
        expect('终端工作区')
        choose('服务器')
        expect('新建连接')
        send('\r')
        for label, value in [('连接名称', 'SSH demo'), ('主机名 / IP', '127.0.0.1'),
                             ('SSH 端口', ssh_port), ('用户名', 'demo')]:
            expect(label)
            send('\x15' + value + '\r')
        expect('认证方式')
        send('\r')
        expect('SSH 密码')
        send('demo-fixture\r')
        expect('SSH demo')
        send('\r')
        expect('测试连接')
        send('\r')
        expect('myssh-demo$')
        send('\x1d')
        expect('终端插件')
        choose('终端插件')
        expect('Commands fixture')
        open_plugin('Commands fixture')
        expect('Synthetic SSH echo')
        send('\r')
        expect('hello')
        send('\r')
        expect('发送到 SSH')
        choose('发送到 SSH')
        expect('发送的命令')
        send('\r')
        expect('选择终端')
        send('\r')
        expect('myssh-demo$')
        assert b'CORE_OK' not in output[position:], 'Catalog must not send Enter automatically'
        send('\r')
        expect('CORE_OK 你好')
        send('\x1d')
        expect('终端插件')
        open_plugin('Monitor fixture')
        expect('CPU')
        capture('monitor-live')
        send('r')
        expect('B/s')
        send('\x1b')
        expect('终端插件')
        choose('Commands fixture')
        expect('停用插件')
        choose('停用插件')
        expect('[停用] Commands fixture')
        choose('Commands fixture')
        expect('卸载插件')
        choose('卸载插件')
        expect('卸载 Commands fixture')
        send('\x1b[B\r')
        expect('终端插件')
        send('\x03')
        deadline = time.monotonic() + 10
        status = None
        while time.monotonic() < deadline:
            read_once()
            status = terminal.poll()
            if status is not None:
                break
        assert status == 0, f'Plugin TUI did not exit: {status}'
        vault = Path(directory, 'databases.vault.json').read_text()
        assert 'demo-fixture' not in vault and 'SELECT fixture' not in vault
        assert not Path(directory, 'plugins/fixture-commands.json').exists()
        destination = root / '.dev' / 'tui-plugins'
        destination.mkdir(parents=True, exist_ok=True)
        for name, data in captures.items():
            (destination / (name + '.ansi')).write_bytes(data)
        print('Terminal plugins verified: market install/enable/disable/remove, encrypted MySQL profiles/history, catalog/SQL/CSV/parameterized row update, command insertion and live monitor.')
    finally:
        terminal.close()
        if screen_reader:
            screen_reader.stdin.close()
            try:
                screen_reader.wait(timeout=5)
            except subprocess.TimeoutExpired:
                screen_reader.kill()
                screen_reader.wait()
