#!/usr/bin/env bash
#
# Aluka IDE 打包脚本：前端构建（tsc strict + vite）+ Rust release + 安装包
# 用法：./build.sh
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

echo "==> 开始打包（tsc + vite + cargo release + 安装包）..."
npm run tauri build

echo "==> 打包完成"
echo "    前端产物: dist/"
echo "    安装包:   src-tauri/target/release/bundle/"
