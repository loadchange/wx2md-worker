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


## 贡献

- 如果你觉得项目有用，欢迎点个 ⭐Star
- 有任何建议或想法，欢迎提 [Issue](https://github.com/loadchange/wx2md-worker/issues) 或 [Pull Request](https://github.com/loadchange/wx2md-worker/pulls)

---

- 技术栈：Cloudflare Workers + Workers AI Markdown Conversion
- 仅供学习与交流，严禁用于非法用途
