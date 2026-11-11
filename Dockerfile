# ---------- 前端构建 ----------
FROM node:22-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---------- 运行时 ----------
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/app backend/app
COPY data data
COPY --from=frontend /src/frontend/dist frontend/dist

RUN useradd --create-home appuser && mkdir -p backend/var && chown -R appuser backend/var
USER appuser
WORKDIR /app/backend
ENV PORT=8000
EXPOSE 8000
# Render 等平台通过 $PORT 指定端口
CMD ["sh", "-c", "python -m app --host 0.0.0.0 --port ${PORT}"]
