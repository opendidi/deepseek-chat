"""一条命令启动本机服务：python starter.py

自动完成三件事：
1. 虚拟环境自举：.venv 不存在时创建并安装 requirements.txt（仅首次，全局 python 即可运行本脚本）；
2. 前端构建：dist/index.html 缺失时自动执行 pnpm/npm build（可用 --no-build 跳过）；
3. 启动存储后端（托管 dist 与 /api），就绪后自动打开浏览器。

常用参数：
    python starter.py                     # 默认 http://127.0.0.1:8000
    python starter.py --port 8010         # 换端口
    python starter.py --no-open           # 不自动开浏览器
    python starter.py --no-build          # 跳过前端构建检查
数据保存在 data/chats.db（可用 DATA_DIR 环境变量改位置）。
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import venv
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV_DIR = ROOT / '.venv'
IS_WINDOWS = os.name == 'nt'
VENV_PYTHON = VENV_DIR / ('Scripts' if IS_WINDOWS else 'bin') / ('python.exe' if IS_WINDOWS else 'python')


def log(message: str) -> None:
    print(f'[starter] {message}', flush=True)


def ensure_venv() -> Path:
    """venv 缺失时创建并安装依赖；返回后端解释器路径。

    已有 venv 也会做一次依赖完整性校验：上次安装中途失败（断网）会留下
    「解释器存在但缺包」的半成品环境，这里自动补装，避免裸 traceback。
    """
    fresh = not VENV_PYTHON.exists()
    if fresh:
        log('首次运行：创建虚拟环境 .venv ...')
        venv.create(VENV_DIR, with_pip=True)
    check = subprocess.run(
        [str(VENV_PYTHON), '-c', 'import fastapi, uvicorn, multipart'],
        capture_output=True,
    )
    if check.returncode != 0 or fresh:
        log('安装后端依赖（fastapi / uvicorn，可能需要一两分钟）...')
        try:
            subprocess.run(
                [str(VENV_PYTHON), '-m', 'pip', 'install', '--quiet', '--disable-pip-version-check',
                 '-r', str(ROOT / 'requirements.txt')],
                check=True,
            )
        except subprocess.CalledProcessError:
            log('依赖安装失败，请检查网络后重新运行本脚本。也可以手动执行：')
            log(f'  {VENV_PYTHON} -m pip install -r requirements.txt')
            sys.exit(1)
    log('后端依赖就绪')
    return VENV_PYTHON


def ensure_dist(no_build: bool) -> None:
    """dist/index.html 缺失时自动构建前端；没有 Node 环境则给出明确指引"""
    if (ROOT / 'dist' / 'index.html').exists() or no_build:
        return
    package_manager = shutil.which('pnpm') or shutil.which('npm')
    if package_manager is None or not (ROOT / 'node_modules').exists():
        log('dist/ 不存在且未检测到可用的构建环境。')
        log('请先安装 Node.js 与 pnpm，然后在项目根目录执行：pnpm install && pnpm build')
        sys.exit(1)
    log('dist/ 不存在，自动构建前端（约十几秒）...')
    # pnpm 直接子命令 build；npm 需要 run build
    build_cmd = ['build'] if 'pnpm' in package_manager.lower() else ['run', 'build']
    try:
        subprocess.run([package_manager, *build_cmd], cwd=ROOT, check=True)
    except subprocess.CalledProcessError:
        log('前端构建失败，请检查上方构建日志（常见原因：依赖未安装 pnpm install）。')
        sys.exit(1)


def open_when_ready(host: str, port: int, enabled: bool) -> None:
    """后台轮询 /api/health，服务就绪后打开浏览器（0.0.0.0 时浏览器固定用 127.0.0.1）"""
    if not enabled:
        return
    browser_host = '127.0.0.1' if host == '0.0.0.0' else host

    def wait_and_open() -> None:
        url = f'http://{browser_host}:{port}/api/health'
        for _ in range(120):
            try:
                if urllib.request.urlopen(url, timeout=1).status == 200:
                    webbrowser.open(f'http://{browser_host}:{port}/')
                    return
            except OSError:
                pass
            time.sleep(0.5)

    threading.Thread(target=wait_and_open, daemon=True).start()


def ensure_port_free(host: str, port: int) -> None:
    """启动前预检端口：被占用时直接给出明确指引，不等 uvicorn 报错。

    用连接探测而非 bind 测试：bind 会撞上 TIME_WAIT 状态的连接产生假阳性
    （Windows 上尤其常见，uvicorn 本身会设 SO_REUSEADDR 正常绑定）。
    """
    import socket
    probe_host = '127.0.0.1' if host == '0.0.0.0' else host
    probe = socket.socket()
    try:
        probe.connect((probe_host, port))
    except OSError:
        return  # 连不上 = 端口空闲
    else:
        log(f'端口 {port} 已被占用。可能已经有一个服务在运行（浏览器里直接打开 '
            f'http://{probe_host}:{port}/ 即可），或改用 --port 换个端口。')
        sys.exit(1)
    finally:
        probe.close()


def _serve(backend_python: Path, host: str, port: int) -> int:
    """在子进程里跑 uvicorn；父进程无论因何退出（Ctrl+C / 关终端 / 被强杀）都保证子进程一起退出。

    Windows 用 Job Object（KILL_ON_JOB_CLOSE）：子进程挂进作业对象，父进程句柄关闭即整组终止，
    从机制上杜绝「孤儿服务占着端口」；其他平台用 finally + terminate。
    返回 uvicorn 的退出码。
    """
    command = [str(backend_python), '-m', 'uvicorn', 'server.app:app', '--host', host, '--port', str(port)]
    child = subprocess.Popen(command, cwd=ROOT)
    if IS_WINDOWS:
        import ctypes

        class _IO_COUNTERS(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint64) for name in (
                'ReadOperationCount', 'WriteOperationCount', 'OtherOperationCount',
                'ReadTransferCount', 'WriteTransferCount', 'OtherTransferCount',
            )]

        class _BASIC_LIMIT_INFO(ctypes.Structure):
            _fields_ = [
                ('PerProcessUserTimeLimit', ctypes.c_int64),
                ('PerJobUserTimeLimit', ctypes.c_int64),
                ('LimitFlags', ctypes.c_uint32),
                ('MinimumWorkingSetSize', ctypes.c_size_t),
                ('MaximumWorkingSetSize', ctypes.c_size_t),
                ('ActiveProcessLimit', ctypes.c_uint32),
                ('Affinity', ctypes.c_size_t),
                ('PriorityClass', ctypes.c_uint32),
                ('SchedulingClass', ctypes.c_uint32),
            ]

        class _EXTENDED_LIMIT_INFO(ctypes.Structure):
            _fields_ = [
                ('BasicLimitInformation', _BASIC_LIMIT_INFO),
                ('IoInfo', _IO_COUNTERS),
                ('ProcessMemoryLimit', ctypes.c_size_t),
                ('JobMemoryLimit', ctypes.c_size_t),
                ('PeakProcessMemoryUsed', ctypes.c_size_t),
                ('JobPeakMemoryUsed', ctypes.c_size_t),
            ]

        kernel32 = ctypes.windll.kernel32
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
        JobObjectExtendedLimitInformation = 9
        job = kernel32.CreateJobObjectW(None, None)
        if not job:
            log('警告：进程组保护未能启用，异常退出时请手动确认没有残留的后台进程占用端口。')
        else:
            info = _EXTENDED_LIMIT_INFO()
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if not kernel32.SetInformationJobObject(
                job, JobObjectExtendedLimitInformation, ctypes.byref(info), ctypes.sizeof(info)
            ) or not kernel32.AssignProcessToJobObject(job, int(child._handle)):
                log('警告：进程组保护未能启用，异常退出时请手动确认没有残留的后台进程占用端口。')
        # job 句柄故意不 CloseHandle：KILL_ON_JOB_CLOSE 依赖父进程退出时关闭句柄来整组终止子进程
    try:
        return child.wait()
    finally:
        # 信号路径的兜底（Job Object 覆盖不到的极端情况也要清干净）
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()


def main() -> None:
    parser = argparse.ArgumentParser(description='启动 deepseek-chat 本机服务')
    parser.add_argument('--host', default='127.0.0.1', help='监听地址（默认 127.0.0.1，仅本机可访问）')
    parser.add_argument('--port', type=int, default=8000, help='监听端口（默认 8000）')
    parser.add_argument('--no-build', action='store_true', help='跳过前端构建检查')
    parser.add_argument('--no-open', action='store_true', help='不自动打开浏览器')
    args = parser.parse_args()

    backend_python = ensure_venv()
    ensure_dist(args.no_build)
    ensure_port_free(args.host, args.port)
    # DATA_DIR 只在未显式设置时给默认值；config.py 在导入时读取环境变量
    os.environ.setdefault('DATA_DIR', str(ROOT / 'data'))

    log(f'启动服务：http://{args.host}:{args.port}/ （数据目录 {os.environ["DATA_DIR"]}）')
    log('停止：Ctrl+C')
    open_when_ready(args.host, args.port, not args.no_open)
    try:
        # 服务本体跑在 venv 解释器里；本脚本自身只需标准库
        code = _serve(backend_python, args.host, args.port)
        if code != 0:
            log(f'服务异常退出（退出码 {code}），请查看上方 uvicorn 的报错信息。')
    except KeyboardInterrupt:
        pass
    log('已退出')


if __name__ == '__main__':
    main()
