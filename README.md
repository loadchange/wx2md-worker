# wx2md-worker

将微信公众号文章一键转换为 Markdown 格式，基于 Cloudflare Workers 部署。

Playground: [https://mp.084817.xyz](https://mp.084817.xyz/)

[![Deploy to Cloudflare Workers](https://img.shields.io/badge/Deploy%20to-CF%20Workers-%23F38020?style=for-the-badge&logo=cloudflare)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Floadchange%2Fwx2md-worker)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)


## 项目简介

本项目旨在解决以下问题：
- 微信公众号部分内容对云厂商 IP 有访问限制，导致无法直接抓取
- 公众号文章排版不利于 AI 理解或知识库收录
- 需要将优质内容结构化为 Markdown，便于后续处理

通过本服务，只需更换文章链接前缀，即可获取 Markdown 格式的内容。

## 使用方法

1. 找到目标公众号文章链接，例如：

   `https://mp.weixin.qq.com/s/MhzcF7u_p3UHZ9qR6hptww`

2. 替换为本服务地址：

   `https://wx2md-worker.[:username].workers.dev/s/MhzcF7u_p3UHZ9qR6hptww`

3. 支持以下功能：
   - `?download=true` 直接下载 Markdown 文件
   - HTML 格式查看 (推荐格式)：使用 `/html/s/` 路径

     例如：`https://wx2md-worker.[:username].workers.dev/html/s/MhzcF7u_p3UHZ9qR6hptww`

   - HTML 格式查看 (兼容格式)：在链接末尾添加 `.html`

     例如：`https://wx2md-worker.[:username].workers.dev/s/MhzcF7u_p3UHZ9qR6hptww.html`

4. 也可访问 `/` 查看主页说明，或 `/health` 检查服务健康状态。


## 部署

```bash
npm install
npx wrangler r2 bucket create wx2md-images   # 首次部署需先建桶
npm run deploy
```

### R2 图片缓存与保留期（重要）

文章里的微信图片有防盗链，无法直接外链，所以会被抓取后转存到 R2 桶 `wx2md-images`，
Markdown 里的图片地址替换为 `R2_PUBLIC_URL` 下的路径。

**这些图片是临时缓存，必须配置 R2 lifecycle 规则来回收，否则会无限增长。**
保留期由仓库根目录的 [`r2-lifecycle.json`](r2-lifecycle.json) 声明（当前：1 天后删除），
`npm run deploy` 会在部署前自动应用它：

```bash
npm run r2:lifecycle   # 单独应用，等价于 wrangler r2 bucket lifecycle set
```

改保留期直接改 `r2-lifecycle.json` 里的 `maxAge`（单位：秒，最小 86400 = 1 天），
重新部署即可。桶被清空后图片会 404，重新转换同一篇文章会自动重新抓取上传。

> **为什么这条必须存在**：`src/r2-images.ts` 的 `put()` 里写了
> `customMetadata.expiresAt`，但 **R2 不会根据自定义元数据删除任何对象**，
> 对象过期只认 lifecycle 规则。早期误以为那个字段能生效、又没配 lifecycle，
> 结果本应活 8 小时的图片累积到了 105 万个 / 351 GB，远超 R2 免费额度（10 GB/月）。
>
> 注意 `wrangler.jsonc` 的 `r2_buckets` 无法声明 lifecycle（只支持 `binding` /
> `bucket_name` / `jurisdiction` / `preview_bucket_name` / `remote`），
> 这也是为什么它要单独放一个 JSON 文件 + npm script。
> 如果你绕过 `npm run deploy` 直接跑 `npx wrangler deploy`，规则不会被应用。


## 贡献

- 如果你觉得项目有用，欢迎点个 ⭐Star
- 有任何建议或想法，欢迎提 [Issue](https://github.com/loadchange/wx2md-worker/issues) 或 [Pull Request](https://github.com/loadchange/wx2md-worker/pulls)

---

- 技术栈：Cloudflare Workers + Workers AI Markdown Conversion
- 仅供学习与交流，严禁用于非法用途
