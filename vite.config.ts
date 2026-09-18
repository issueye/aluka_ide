import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri 约定：固定端口、关闭清屏以保留 Rust 编译日志、构建目标对齐 WebView2
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "chrome105",
    rollupOptions: {
      output: {
        // Monaco 核心（editor.api + contrib + 语言服务）稳定且体积大，拆到独立 vendor chunk：
        // 1) 主应用 chunk 显著变小，应用更新时用户无需重新下载 3MB Monaco；
        // 2) Monaco chunk 带长缓存，仅当升级 monaco-editor 时才失效。
        manualChunks: {
          monaco: [
            "monaco-editor/esm/vs/editor/editor.api",
            "monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard.js",
            "monaco-editor/esm/vs/editor/contrib/find/browser/findController.js",
            "monaco-editor/esm/vs/editor/contrib/comment/browser/comment.js",
            "monaco-editor/esm/vs/editor/contrib/multicursor/browser/multicursor.js",
            "monaco-editor/esm/vs/editor/contrib/smartSelect/browser/smartSelect.js",
            "monaco-editor/esm/vs/editor/contrib/wordHighlighter/browser/wordHighlighter.js",
            "monaco-editor/esm/vs/editor/editor.worker?worker",
          ],
        },
      },
    },
    // Monaco 核心 chunk 拆出后仍会超过默认 500KB 告警阈值（编辑器引擎自身体积约 2.4MB），
    // 显式上调阈值避免每次构建的噪音告警（体积无变化，仅归因到独立 vendor chunk）。
    chunkSizeWarningLimit: 3000,
  },
});
