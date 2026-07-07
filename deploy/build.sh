#!/usr/bin/env bash
# 构建生产 fat jar：前端 build 产物打入 Spring Boot static/，SPA fallback 由 WebConfig 提供。
# 用法：./deploy/build.sh
# 产物：backend/target/projectmanager-*.jar
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATIC_DIR="$ROOT/backend/src/main/resources/static"

echo "==> 前端构建"
cd "$ROOT/frontend"
npm run build

echo "==> 复制 dist -> backend static/"
rm -rf "$STATIC_DIR"
mkdir -p "$STATIC_DIR"
cp -R "$ROOT/frontend/dist/." "$STATIC_DIR/"

echo "==> 后端打包（跳过测试，测试请单独跑 mvn test）"
cd "$ROOT/backend"
mvn -q -DskipTests package

ls -lh "$ROOT"/backend/target/projectmanager-*.jar
echo "==> 构建完成"
