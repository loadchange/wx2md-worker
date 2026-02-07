# 重要：所有对话和代码注释文档都要用中文

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

基于 Cloudflare Workers 的微信公众号文章转 Markdown 工具。将微信公众号文章和通用网页转换为 Markdown 格式，支持 HTML 预览（左右分栏：Markdown 源码 + 实时预览）、R2 图片存储（微信防盗链绕过）、文件下载等功能。

## 开发命令

- `npm run dev` - 启动开发服务器（本地调试）
- `npm run start` - 启动开发服务器（同 dev）
- `npm run test` - 运行测试（使用 Vitest）
- `npm run deploy` - 部署到 Cloudflare Workers
- `npm run cf-typegen` - 生成 Cloudflare 类型定义

## 项目架构

### 文件结构

```
src/
├── index.ts        # Worker 入口，路由分发
├── converter.ts    # 核心转换逻辑
├── template.ts     # 预览页面模板注入（导入 preview.html）
├── r2-images.ts    # R2 图片存储模块
├── utils.ts        # 工具函数
├── env.d.ts        # 环境变量类型定义
└── html.d.ts       # HTML 文件模块声明
index.html          # 首页 HTML
preview.html        # 预览页前端页面（HTML + CSS + JS）
wrangler.jsonc      # Cloudflare Workers 配置
test/index.spec.ts  # 测试文件
```

### 模块依赖关系

```
index.ts → converter.ts → utils.ts
                        → template.ts → preview.html
                                      → utils.ts (escapeHtml)
                        → r2-images.ts
```

### 模块职责

#### 1. `src/index.ts` - Worker 入口和路由

- 导入首页 HTML 和转换模块
- 路由分发：健康检查、首页、微信文章、通用网页
- URL 格式：`/s/{id}`、`/html/s/{id}`、`/md?url=`、`/html/md?url=`

#### 2. `src/converter.ts` - 核心转换逻辑

- `convertWebpageToMarkdown()` - 请求网页 → 预处理 → AI 转换 → 图片链接替换 → 返回响应
- `handleGenericWebpage()` - 解析通用网页 URL 参数
- 使用 `ctx.waitUntil()` 异步上传图片到 R2，不阻塞响应

#### 3. `src/template.ts` + `preview.html` - HTML 预览页面

- `template.ts`：导入 `preview.html`，注入标题和 Markdown 内容（JSON 编码）
- `preview.html`：独立前端页面，包含完整 HTML 结构 + 内联 CSS + 内联 JS
- 内容通过 `<script type="application/json">` 安全注入，避免模板转义问题
- 前端功能：marked.js 实时预览、复制/打开按钮、编辑切换、frontmatter 过滤

#### 4. `src/r2-images.ts` - R2 图片存储

- 白名单：只处理 `qpic.cn` 域名，非白名单域名保留原链接
- 确定性路径：URL → R2 路径映射（`generateR2PathFromUrl()`），避免重复上传
- `replaceImageUrlsSync()` - 同步替换 Markdown 中的图片链接为 R2 链接
- `uploadImagesToR2Async()` - 异步并发上传（限制并发数 5），设置 8 小时过期元数据
- `downloadWechatImage()` - 使用微信 Referer 绕过防盗链下载图片

#### 7. `src/utils.ts` - 工具函数

- `fetchWithRetry()` - 带重试（3次）和延迟递增的 fetch
- `getArticleTitle()` - 从 og:title/twitter:title/title 提取标题
- `escapeHtml()` / `escapeHtmlAttr()` - HTML 内容/属性转义
- `preprocessHtml()` - 处理懒加载图片 data-src → src

### 关键技术点

1. **Workers AI 集成**：`env.AI.toMarkdown()` 进行 HTML → Markdown 转换
2. **R2 图片存储**：同步替换链接 + 异步上传，响应延迟仅 ~2.6s
3. **HTML 预览**：marked.js + highlight.js + github-markdown-css，左右分栏实时预览
4. **防盗链绕过**：使用微信域名 Referer 下载 qpic.cn 图片
5. **文件下载**：`?download=true` 参数设置 Content-Disposition 头
6. **安全处理**：HTML 转义防 XSS、属性注入防护、qpic.cn 白名单

### 环境依赖

- Cloudflare Workers AI binding (`env.AI`)
- R2 Bucket binding (`env.IMAGES_BUCKET`)
- 环境变量 `R2_PUBLIC_URL`（R2 公开访问域名）
- TypeScript、Vitest、pnpm
