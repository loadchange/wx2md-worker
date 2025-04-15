/**
 * 微信公众号文章转 Markdown 工具
 *
 * 这个 Cloudflare Worker 可以将微信公众号文章转换为 Markdown 格式，
 * 解决微信公众号内容访问限制和排版问题，方便内容提供给 LLM 使用。
 *
 * 使用方法:
 * 原微信文章: https://mp.weixin.qq.com/s/MhzcF7u_p3UHZ9qR6hptww
 * 转换后访问: https://wx2md-worker.[:username].workers.dev/s/MhzcF7u_p3UHZ9qR6hptww
 */

/**
 * 微信公众号文章 URL 前缀
 */
const WECHAT_URL_PREFIX = 'https://mp.weixin.qq.com/';

/**
 * 处理微信公众号文章转换为 Markdown
 */
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		try {
			// 获取请求 URL 和路径
			const url = new URL(request.url);
			const path = url.pathname;

			console.log(`处理请求路径: ${path}`);

			// 处理健康检查请求
			if (path === '/health' || path === '/healthz') {
				return new Response(
					JSON.stringify({
						status: 'ok',
						version: '1.0.0',
						timestamp: new Date().toISOString(),
					}),
					{
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					},
				);
			}

			// 处理主页请求
			if (path === '/' || path === '') {
				return new Response(generateHomePage(), {
					status: 200,
					headers: { 'Content-Type': 'text/html; charset=utf-8' },
				});
			}

			// 检查请求路径格式是否正确
			if (!path.startsWith('/s/')) {
				return new Response('请提供正确的微信公众号文章路径，格式: /s/{article_id}', {
					status: 400,
					headers: { 'Content-Type': 'text/plain; charset=utf-8' },
				});
			}

			// 从路径中提取文章 ID
			const articleId = path.substring(3); // 去掉 '/s/' 前缀

			if (!articleId) {
				return new Response('请提供微信公众号文章 ID', {
					status: 400,
					headers: { 'Content-Type': 'text/plain; charset=utf-8' },
				});
			}

			// 构建完整的微信文章 URL
			const wxArticleUrl = `${WECHAT_URL_PREFIX}s/${articleId}`;
			console.log(`请求微信文章: ${wxArticleUrl}`);

			// 请求微信公众号文章内容
			const articleResponse = await fetchWithRetry(wxArticleUrl);

			if (!articleResponse.ok) {
				console.error(`无法获取微信文章，状态码: ${articleResponse.status}`);
				return new Response(`无法获取微信文章，状态码: ${articleResponse.status}`, {
					status: 502,
					headers: { 'Content-Type': 'text/plain; charset=utf-8' },
				});
			}

			// 获取原始 HTML 内容
			const htmlContent = await articleResponse.text();

			// 提取文章标题用于文件名
			const title = getArticleTitle(htmlContent, articleId);

			// 将 HTML 内容转换为 Markdown
			console.log('开始转换为 Markdown');
			const mdResult = await env.AI.toMarkdown([
				{
					name: `${title}.html`,
					blob: new Blob([htmlContent], { type: 'text/html' }),
				},
			]);

			if (!mdResult || mdResult.length === 0) {
				return new Response('Markdown 转换失败', {
					status: 500,
					headers: { 'Content-Type': 'text/plain; charset=utf-8' },
				});
			}

			// 获取转换后的 Markdown 内容
			const markdownContent = mdResult[0].data;

			// 检查是否请求下载文件
			const download = url.searchParams.get('download') === 'true';

			// 设置响应头
			const headers: HeadersInit = {
				'Content-Type': 'text/markdown; charset=utf-8',
			};

			// 如果是下载请求，设置 Content-Disposition 头
			if (download) {
				headers['Content-Disposition'] = `attachment; filename="${title}.md"`;
			}

			// 返回 Markdown 内容
			return new Response(markdownContent, { headers });
		} catch (error) {
			console.error('处理请求时发生错误:', error);
			return new Response(`处理请求时发生错误: ${error.message}`, {
				status: 500,
				headers: { 'Content-Type': 'text/plain; charset=utf-8' },
			});
		}
	},
} satisfies ExportedHandler<Env>;

/**
 * 带重试功能的 fetch 请求
 * 微信可能会限制某些 IP，所以我们添加重试机制和自定义 User-Agent
 */
async function fetchWithRetry(url: string, retries = 3, delay = 1000): Promise<Response> {
	const headers = {
		'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
		Accept: 'text/html,application/xhtml+xml,application/xml',
		'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
		'Cache-Control': 'no-cache',
		Pragma: 'no-cache',
		Referer: 'https://mp.weixin.qq.com/',
	};

	for (let i = 0; i < retries; i++) {
		try {
			return await fetch(url, { headers });
		} catch (error) {
			if (i === retries - 1) throw error;
			console.log(`请求失败 (${i + 1}/${retries})，${delay}ms 后重试: ${error.message}`);
			await new Promise((resolve) => setTimeout(resolve, delay));
			// 增加重试延迟
			delay *= 1.5;
		}
	}

	throw new Error('超过最大重试次数');
}

/**
 * 从 HTML 内容中提取文章标题
 * 优先从 og:title 或 twitter:title meta 标签获取，失败则尝试 title 标签
 * 并进行文件名安全处理（将空格替换为下划线）
 */
function getArticleTitle(html: string, fallbackId: string): string {
	// 尝试从 og:title 或 twitter:title meta 标签获取标题
	const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["'](.*?)["']\s*\/?>/i);
	const twitterTitleMatch = html.match(/<meta\s+property=["']twitter:title["']\s+content=["'](.*?)["']\s*\/?>/i);
	const titleTagMatch = html.match(/<title>(.*?)<\/title>/i);

	// 按优先级获取标题
	let title = '';
	if (ogTitleMatch && ogTitleMatch[1]) {
		title = ogTitleMatch[1].trim();
	} else if (twitterTitleMatch && twitterTitleMatch[1]) {
		title = twitterTitleMatch[1].trim();
	} else if (titleTagMatch && titleTagMatch[1]) {
		title = titleTagMatch[1].trim();
	} else {
		title = `wechat-article-${fallbackId}`;
	}

	// 处理文件名：
	// 1. 替换空格为下划线
	// 2. 移除不安全的文件名字符
	// 3. 确保文件名长度合理
	return title
		.replace(/\s+/g, '_') // 替换空格为下划线
		.replace(/[\\/:*?"<>|]/g, '') // 移除不安全的文件名字符
		.replace(/[^\w\u4e00-\u9fa5_\-.]/g, '') // 只保留字母、数字、中文、下划线、连字符和点
		.substring(0, 100); // 限制长度
}

/**
 * 生成简单的主页 HTML
 */
function generateHomePage(): string {
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>微信公众号文章转 Markdown 工具</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
    h1 {
      border-bottom: 1px solid #eee;
      padding-bottom: 10px;
      margin-bottom: 20px;
    }
    code {
      background-color: #f5f5f5;
      padding: 2px 4px;
      border-radius: 3px;
      font-family: monospace;
    }
    .example {
      background-color: #f8f9fa;
      padding: 15px;
      border-radius: 5px;
      margin: 20px 0;
    }
    .footer {
      margin-top: 40px;
      font-size: 0.9em;
      color: #666;
      border-top: 1px solid #eee;
      padding-top: 10px;
    }
    .highlight {
      font-weight: bold;
      color: #0066cc;
    }
  </style>
</head>
<body>
  <h1>微信公众号文章转 Markdown 工具</h1>

  <p>
    这是一个将微信公众号文章转换为 Markdown 格式的工具，可解决以下问题：
  </p>
  <ul>
    <li>绕过微信对某些 IP 的访问限制</li>
    <li>将公众号内容转换为结构化的 Markdown，提高可读性</li>
    <li>便于将内容导入到 AI 模型、知识库或笔记系统</li>
  </ul>

  <h2>使用方法</h2>
  <p>只需将微信公众号文章链接中的参数部分添加到本工具的 URL 后即可。</p>

  <div class="example">
    <p><strong>原微信文章:</strong></p>
    <code>https://mp.weixin.qq.com/s/MhzcF7u_p3UHZ9qR6hptww</code>

    <p><strong>转换后访问:</strong></p>
    <code>https://wx2md-worker.[:username].workers.dev/s/MhzcF7u_p3UHZ9qR6hptww</code>
  </div>

  <h2>参数说明</h2>
  <ul>
    <li><code>?download=true</code> - 添加此参数将触发文件下载，而不是在浏览器中显示</li>
  </ul>

  <h2>示例</h2>
  <ul>
    <li>
      <p>在浏览器中查看转换后的 Markdown:</p>
      <code>https://wx2md-worker.[:username].workers.dev/s/MhzcF7u_p3UHZ9qR6hptww</code>
    </li>
    <li>
      <p>直接下载 Markdown 文件:</p>
      <code>https://wx2md-worker.[:username].workers.dev/s/MhzcF7u_p3UHZ9qR6hptww?download=true</code>
    </li>
  </ul>

  <div class="footer">
    <p>© 2025 wx2md-worker - 基于 Cloudflare Workers 和 AI 技术构建</p>
    <p>此服务使用 Cloudflare Workers AI 的 <a href="https://developers.cloudflare.com/workers-ai/markdown-conversion/" target="_blank">Markdown Conversion</a> 功能</p>
  </div>
</body>
</html>`;
}
