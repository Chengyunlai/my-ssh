"""Real terminal test hosts: Unix PTY and Windows ConPTY, without extra packages.

Windows lifecycle follows Microsoft's pseudoconsole guide:
https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session
"""
import os
import subprocess


class UnixTerminal:
    def __init__(self, command, cwd, env, cols=110, rows=30):
        import fcntl
        import pty
        import struct
        import termios
        self.pid, self.fd = pty.fork()
        self.status = None
        if self.pid == 0:
            os.chdir(cwd)
            os.execvpe(command[0], command, env)
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))

    def read(self, timeout):
        import errno
        import select
        if select.select([self.fd], [], [], timeout)[0]:
            try:
                return os.read(self.fd, 65536)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
        return b''

    def write(self, data):
        os.write(self.fd, data)

    def poll(self):
        if self.status is None:
            child, status = os.waitpid(self.pid, os.WNOHANG)
            if child:
                self.status = os.waitstatus_to_exitcode(status)
        return self.status

    def close(self):
        import signal
        if self.poll() is None:
            os.kill(self.pid, signal.SIGTERM)
            os.waitpid(self.pid, 0)
        os.close(self.fd)


class WindowsTerminal:
    def __init__(self, command, cwd, env, cols=110, rows=30):
        import ctypes as c
        from ctypes import wintypes as w
        import queue
        import threading
        self.c, self.w = c, w
        self.api = c.WinDLL('kernel32', use_last_error=True)
        self.output = queue.Queue()
        self.lock = threading.Lock()
        self.handles = []
        self.console = w.HANDLE()
        self.process = w.HANDLE()
        self.reader = None

        class Coord(c.Structure):
            _fields_ = [('x', c.c_short), ('y', c.c_short)]

        class Startup(c.Structure):
            _fields_ = [('cb', w.DWORD), ('reserved', w.LPWSTR), ('desktop', w.LPWSTR),
                        ('title', w.LPWSTR), ('x', w.DWORD), ('y', w.DWORD),
                        ('x_size', w.DWORD), ('y_size', w.DWORD), ('x_chars', w.DWORD),
                        ('y_chars', w.DWORD), ('fill', w.DWORD), ('flags', w.DWORD),
                        ('show', w.WORD), ('reserved_size', w.WORD), ('reserved2', c.POINTER(w.BYTE)),
                        ('input', w.HANDLE), ('output', w.HANDLE), ('error', w.HANDLE)]

        class StartupEx(c.Structure):
            _fields_ = [('startup', Startup), ('attributes', c.c_void_p)]

        class ProcessInfo(c.Structure):
            _fields_ = [('process', w.HANDLE), ('thread', w.HANDLE),
                        ('pid', w.DWORD), ('tid', w.DWORD)]

        signatures = {
            'CreatePipe': ([c.POINTER(w.HANDLE), c.POINTER(w.HANDLE), c.c_void_p, w.DWORD], w.BOOL),
            'CreatePseudoConsole': ([Coord, w.HANDLE, w.HANDLE, w.DWORD, c.POINTER(w.HANDLE)], c.c_long),
            'ClosePseudoConsole': ([w.HANDLE], None),
            'InitializeProcThreadAttributeList': ([c.c_void_p, w.DWORD, w.DWORD, c.POINTER(c.c_size_t)], w.BOOL),
            'UpdateProcThreadAttribute': ([c.c_void_p, w.DWORD, c.c_size_t, c.c_void_p, c.c_size_t, c.c_void_p, c.c_void_p], w.BOOL),
            'DeleteProcThreadAttributeList': ([c.c_void_p], None),
            'CreateProcessW': ([w.LPCWSTR, w.LPWSTR, c.c_void_p, c.c_void_p, w.BOOL, w.DWORD,
                                c.c_void_p, w.LPCWSTR, c.POINTER(StartupEx), c.POINTER(ProcessInfo)], w.BOOL),
            'ReadFile': ([w.HANDLE, c.c_void_p, w.DWORD, c.POINTER(w.DWORD), c.c_void_p], w.BOOL),
            'WriteFile': ([w.HANDLE, c.c_void_p, w.DWORD, c.POINTER(w.DWORD), c.c_void_p], w.BOOL),
            'WaitForSingleObject': ([w.HANDLE, w.DWORD], w.DWORD),
            'GetExitCodeProcess': ([w.HANDLE, c.POINTER(w.DWORD)], w.BOOL),
            'TerminateProcess': ([w.HANDLE, w.UINT], w.BOOL),
            'CloseHandle': ([w.HANDLE], w.BOOL)
        }
        for name, (args, result) in signatures.items():
            function = getattr(self.api, name)
            function.argtypes, function.restype = args, result
        try:
            input_read, self.input_write = self.pipe()
            self.output_read, output_write = self.pipe()
            result = self.api.CreatePseudoConsole(Coord(cols, rows), input_read, output_write, 0, c.byref(self.console))
            if result != 0:
                raise OSError(f'CreatePseudoConsole failed: {result:#x}')
            size = c.c_size_t()
            self.api.InitializeProcThreadAttributeList(None, 1, 0, c.byref(size))
            attributes = c.create_string_buffer(size.value)
            self.check(self.api.InitializeProcThreadAttributeList(attributes, 1, 0, c.byref(size)))
            try:
                self.check(self.api.UpdateProcThreadAttribute(attributes, 0, 0x20016, self.console,
                                                              c.sizeof(w.HANDLE), None, None))
                startup = StartupEx()
                startup.startup.cb = c.sizeof(StartupEx)
                # Clear inherited CI pipe handles so ConPTY supplies console handles.
                # Microsoft node-pty uses STARTF_USESTDHANDLES with null std handles too.
                startup.startup.flags = 0x00000100
                startup.attributes = c.cast(attributes, c.c_void_p)
                info = ProcessInfo()
                command_line = c.create_unicode_buffer(subprocess.list2cmdline(command))
                environment = c.create_unicode_buffer('\0'.join(f'{key}={value}' for key, value in sorted(env.items(), key=lambda item: item[0].upper())) + '\0')
                self.check(self.api.CreateProcessW(command[0], command_line, None, None, False,
                                                   0x00080000 | 0x00000400, environment, str(cwd),
                                                   c.byref(startup), c.byref(info)))
                self.process = w.HANDLE(info.process)
                self.handles.append(self.process)
                self.api.CloseHandle(info.thread)
            finally:
                self.api.DeleteProcThreadAttributeList(attributes)
            # The child now owns its console sides; retaining them prevents EOF.
            for handle in (input_read, output_write):
                self.api.CloseHandle(handle)
                self.handles.remove(handle)
            self.reader = threading.Thread(target=self.drain, daemon=True)
            self.reader.start()
        except BaseException:
            self.close()
            raise

    def check(self, result):
        if not result:
            raise self.c.WinError(self.c.get_last_error())

    def pipe(self):
        read, write = self.w.HANDLE(), self.w.HANDLE()
        self.check(self.api.CreatePipe(self.c.byref(read), self.c.byref(write), None, 0))
        self.handles.extend([read, write])
        return read, write

    def drain(self):
        buffer = self.c.create_string_buffer(65536)
        count = self.w.DWORD()
        tail = b''
        while self.api.ReadFile(self.output_read, buffer, len(buffer), self.c.byref(count), None) and count.value:
            data = buffer.raw[:count.value]
            self.output.put(data)
            combined = tail + data
            if b'\x1b[6n' in combined:
                self.write(b'\x1b[1;1R')
            tail = combined[-3:]

    def read(self, timeout):
        import queue
        try:
            return self.output.get(timeout=timeout)
        except queue.Empty:
            return b''

    def write(self, data):
        with self.lock:
            while data:
                count = self.w.DWORD()
                self.check(self.api.WriteFile(self.input_write, data, len(data), self.c.byref(count), None))
                if not count.value:
                    raise OSError('ConPTY input pipe made no progress')
                data = data[count.value:]

    def poll(self):
        if not self.process.value or self.api.WaitForSingleObject(self.process, 0) != 0:
            return None
        code = self.w.DWORD()
        self.check(self.api.GetExitCodeProcess(self.process, self.c.byref(code)))
        return code.value

    def close(self):
        if self.process.value and self.poll() is None:
            self.api.TerminateProcess(self.process, 1)
            self.api.WaitForSingleObject(self.process, 5000)
        if self.console.value:
            # drain runs on another thread so ClosePseudoConsole cannot deadlock on output.
            self.api.ClosePseudoConsole(self.console)
            self.console = self.w.HANDLE()
        if self.reader:
            self.reader.join(timeout=5)
        for handle in reversed(self.handles):
            self.api.CloseHandle(handle)
        self.handles.clear()


TerminalProcess = WindowsTerminal if os.name == 'nt' else UnixTerminal
