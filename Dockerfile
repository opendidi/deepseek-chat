# 多阶段构建：Node 构建前端 → Python 运行时托管 dist 与存储 API
FROM node:22-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm i -g pnpm@12 && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt
ENV PATH="/opt/venv/bin:$PATH"
COPY --from=build /app/dist ./dist
COPY server ./server

# 数据目录挂载卷：data/chats.db 单文件即全部数据
ENV DATA_DIR=/app/data
VOLUME ["/app/data"]

# 公网部署请配合 nginx（HTTPS + Basic Auth）或设置 ACCESS_PASSWORD 环境变量
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8000"]
