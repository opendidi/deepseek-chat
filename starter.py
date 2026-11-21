"""启动存储后端（纯 API 服务）：python starter.py

自动完成两件事：
1. 虚拟环境自举：.venv 不存在时创建并安装 requirements.txt（仅首次，全局 python 即可运行本脚本）；
2. 启动后端 API（/api/*，不托管前端页面），就绪后日志给出前端地址。

前端服务独立运行：
    pnpm dev        # devServer 默认 8090，/api 自动代理到本后端（热更新开发）
    pnpm dev:all    # 后端 + 前端 dev 一起拉起（Ctrl+C 同时退出）
    pnpm build      # 生产构建；SERVE_DIST 默认开启时 uvicorn 可在单端口托管 dist

常用参数：
    python starter.py                     # 默认 http://127.0.0.1:8000
    python starter.py --port 8010         # 换端口
数据保存在 data/chats.db（可用 DATA_DIR 环境变量改位置）。
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
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
    # 纯 API 形态：显式关闭 dist 托管（app.py 默认开启，供生产单端口部署使用）
    child = subprocess.Popen(command, cwd=ROOT, env={**os.environ, 'SERVE_DIST': '0'})
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
    parser = argparse.ArgumentParser(description='启动 deepseek-chat 存储后端（纯 API 服务）')
    parser.add_argument('--host', default='127.0.0.1', help='监听地址（默认 127.0.0.1，仅本机可访问）')
    parser.add_argument('--port', type=int, default=8000, help='监听端口（默认 8000）')
    args = parser.parse_args()

    # 预加载根目录 .env（仅标准库），日志展示的数据目录与子进程实际使用的一致
    sys.path.insert(0, str(ROOT))
    from server.config import DATA_DIR

    backend_python = ensure_venv()
    ensure_port_free(args.host, args.port)
    # .env 与 DATA_DIR 默认值由 server/config.py 在子进程导入时统一处理
    log(f'启动后端 API：http://{args.host}:{args.port}/api （数据目录 {DATA_DIR}）')
    log('前端服务：pnpm dev（默认 http://localhost:8090，/api 自动代理到本后端）；或 pnpm dev:all 一键双启')
    log('停止：Ctrl+C')
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
