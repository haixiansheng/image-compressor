# 🗜️ 图片压缩工具 · Image Compressor

上传一张图片 → 压缩 → 下载一张图片。**全流程在你的浏览器里完成，图片不上传任何服务器。**

> 语言：**中文** | [English](en/)

[![Deploy: GitHub Pages](https://img.shields.io/badge/deploy-GitHub%20Pages-222?logo=github)](https://pages.github.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Privacy: 100% local](https://img.shields.io/badge/privacy-100%25%20local-success)](#-隐私)

## ✨ 特性

- **1️⃣ 一张进，一张出** — 不打包、不解压、不批量出错，流程最简单
- **🎯 目标大小模式** — 指定"压到 200KB 以内"，二分搜索自动逼近
- **🎚️ 质量可调** — 1-100 滑块，改完立刻重新压缩
- **🔄 多格式输出** — WebP（默认，同画质小 25-35%）/ JPEG / PNG
- **📐 可选缩放** — 指定最大边长等比缩小，体积立降
- **⚖️ 左右对比** — 原图与压缩后并排，体积/尺寸一目了然
- **📋 支持粘贴** — 截图后 Ctrl+V 直接压缩
- **🔐 纯本地处理** — 图片不离开设备，无后端、无上传
- **🕵️ 自动去除 EXIF** — 顺带移除 GPS 位置隐私
- **🆓 零依赖** — 无第三方库，纯原生 JS + Canvas

## 🚀 使用

**在线版：**
- 中文：https://haixiansheng.github.io/image-compressor/
- English：https://haixiansheng.github.io/image-compressor/en/

**本地运行：**
```bash
git clone https://github.com/haixiansheng/image-compressor.git
cd image-compressor
python -m http.server 8080
# 打开 http://127.0.0.1:8080
```

## 🏗 技术实现

| 模块 | 方案 |
|---|---|
| 解码 | 浏览器原生 `Image` 解码 |
| 重绘 | Canvas 2D `drawImage`（高质量插值） |
| 编码 | `canvas.toBlob(mime, quality)` |
| 目标大小 | 对 quality 二分搜索（~8 次迭代） |
| 依赖 | **零依赖**（无 JSZip、无框架、无构建步骤） |

### 压缩流程

```
上传一张图片
   ↓
解码 → （可选）等比缩放 → 画到 Canvas
   ↓
按模式编码：
   质量优先 → toBlob(format, quality)
   目标大小 → 二分搜索 quality，逼近指定 KB
   ↓
生成 Blob → 左右对比预览 → 下载单张图片
```

### 为什么默认 WebP
同画质下 WebP 比 JPEG 小 25-35%。Canvas 在 Chrome/Edge/Firefox 均支持 WebP 编码，
不支持时自动回退 JPEG。

### 关于 EXIF
Canvas 重绘会丢弃原图 EXIF（拍摄时间、设备、GPS 位置）。
这是压缩的副产品，同时**保护了你的位置隐私**。

## 📁 目录结构

```
image-compressor/
├── index.html          # 中文
├── about.html
├── privacy.html
├── en/                 # 英文
│   ├── index.html
│   ├── about.html
│   └── privacy.html
├── style.css
├── app.js              # 全部逻辑（~250 行）
├── ads.txt
├── sitemap.xml
├── robots.txt
└── scripts/
    └── indexnow_submit.py
```

## ⚠️ 已知限制

| 限制 | 说明 |
|---|---|
| 一次一张 | 刻意设计，保证流程最简单 |
| PNG 压缩有限 | PNG 无损，压缩空间小；想显著减小请改用 WebP/JPEG 或缩放 |
| 已优化图可能变大 | 原图本身已高度优化时，重编码可能略增体积（工具会明确提示） |
| 无 AVIF 输出 | Canvas 尚不支持 AVIF 编码 |

## 🔐 隐私

- 图片**从不上传**，全部在浏览器内存中处理
- 无后端、无数据库、无埋点、无第三方库、无 CDN 依赖
- 可断网使用（首次加载后）
- 源码公开可审计（F12 → Network 面板即可自查）

## 📄 License

MIT
