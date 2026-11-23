"""模型代理的按 IP 限流：令牌桶 + 每日配额，防止服务端 Key 被盗刷。

Key 移到服务端后（/api/deepseek/* 代理），公网或共享口令部署下任何人都能消耗
服务器的 DeepSeek 余额——这里在请求进入路由前按客户端 IP 做两道限制：
- 令牌桶：每分钟补充 RATE_PER_MIN 个，桶容量 BURST（吸收工具轮次等合法突发）；
- 每日配额：每 IP 每个自然日最多 DAILY_LIMIT 次。
超限返回 429 + 固定 JSON code（RATE_LIMITED / QUOTA_EXCEEDED），与代理错误格式一致。

客户端 IP 只信任本机反代（peer 为回环地址时取 X-Forwarded-For 首段）：
远端直连时该头可伪造，一律用真实连接地址。状态保存在进程内存（单 worker 部署形态），
重启即清零；多 worker 会让桶被稀释，本项目的部署形态不适用。
"""

from __future__ import annotations

import time

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .config import (
    DEEPSEEK_DAILY_LIMIT,
    DEEPSEEK_PROXY_PREFIX,
    DEEPSEEK_RATE_BURST,
    DEEPSEEK_RATE_LIMIT_PER_MIN,
)

# 引用进模块命名空间，测试可以 monkeypatch 而不用动 config
RATE_PER_MIN = DEEPSEEK_RATE_LIMIT_PER_MIN
BURST = DEEPSEEK_RATE_BURST
DAILY_LIMIT = DEEPSEEK_DAILY_LIMIT

PREFIX = DEEPSEEK_PROXY_PREFIX
TRUSTED_PROXY_PEERS = frozenset({'127.0.0.1', '::1'})
IDLE_TTL = 3600.0
_PRUNE_THRESHOLD = 4096

_buckets: dict[str, list[float]] = {}    # ip -> [剩余令牌, 上次补充时间(monotonic)]
_daily: dict[str, tuple[str, int]] = {}  # ip -> (yyyymmdd, 当日计数)


def _client_ip(scope: Scope) -> str:
    peer = (scope.get('client') or ('', 0))[0]
    if peer in TRUSTED_PROXY_PEERS:
        forwarded = Headers(scope=scope).get('x-forwarded-for')
        if forwarded:
            return forwarded.split(',')[0].strip() or peer
    return peer


def _check(ip: str) -> str | None:
    """None = 放行；'quota' / 'rate' = 拒绝原因。只有放行的请求才计入配额与令牌桶。"""
    today = time.strftime('%Y%m%d')
    day, count = _daily.get(ip, (today, 0))
    if day != today:
        day, count = today, 0
    if DAILY_LIMIT > 0 and count >= DAILY_LIMIT:
        return 'quota'

    now = time.monotonic()
    tokens, last = _buckets.get(ip, [float(BURST), now])
    tokens = min(float(BURST), tokens + (now - last) / 60.0 * RATE_PER_MIN)
    if RATE_PER_MIN > 0 and tokens < 1.0:
        # 被限流：只更新补充时间，不消耗配额，也不记入日计数
        _buckets[ip] = [tokens, now]
        return 'rate'

    # 两道限制都通过才计数
    if DAILY_LIMIT > 0:
        _daily[ip] = (day, count + 1)
    if RATE_PER_MIN > 0:
        _buckets[ip] = [tokens - 1.0, now]

    if len(_buckets) > _PRUNE_THRESHOLD or len(_daily) > _PRUNE_THRESHOLD:
        _prune(now, today)
    return None


def _prune(now: float, today: str) -> None:
    """独特 IP 过多时丢掉过期状态：闲置超过 TTL 的桶、非当日的配额。"""
    for ip in [ip for ip, (_, last) in _buckets.items() if now - last > IDLE_TTL]:
        _buckets.pop(ip, None)
    for ip in [ip for ip, (day, _) in _daily.items() if day != today]:
        _daily.pop(ip, None)


class DeepSeekRateLimitMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope['type'] != 'http'
            or not scope.get('path', '').startswith(PREFIX)
            or (RATE_PER_MIN <= 0 and DAILY_LIMIT <= 0)
        ):
            await self.app(scope, receive, send)
            return
        reason = _check(_client_ip(scope))
        if reason is None:
            await self.app(scope, receive, send)
            return
        if reason == 'quota':
            body: dict[str, str] = {'detail': '今日调用次数已达上限，请明天再试', 'code': 'QUOTA_EXCEEDED'}
        else:
            body = {'detail': '请求过于频繁，请稍后再试', 'code': 'RATE_LIMITED'}
        await JSONResponse(body, status_code=429)(scope, receive, send)
