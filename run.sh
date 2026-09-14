#!/usr/bin/env bash
#
# Aluka IDE 启动脚本：安装缺失依赖后以开发模式启动（热重载窗口）
# 用法：./run.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "错误：未找到 npm，请先安装 Node.js（>= 18）" >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "==> 未检测到 node_modules，先安装前端依赖 ..."
  npm install
fi

echo "==> 启动 Aluka IDE 开发模式（npm run tauri dev）..."
exec npm run tauri dev