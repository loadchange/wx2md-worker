/**
 * 微信公众号文章转 Markdown 工具
 *
 * 这个 Cloudflare Worker 可以将微信公众号文章和通用网页转换为 Markdown 格式，
 * 解决微信公众号内容访问限制和排版问题，方便内容提供给 LLM 使用。
 *
 * 使用方法:
 * 原微信文章: https://mp.weixin.qq.com/s/MhzcF7u_p3UHZ9qR6hptww
 * 转换后访问: https://wx2md-worker.[:username].workers.dev/s/MhzcF7u_p3UHZ9qR6hptww
 * HTML格式访问: https://wx2md-worker.[:username].workers.dev/html/s/MhzcF7u_p3UHZ9qR6hptww
 * 通用网页转换: https://wx2md-worker.[:username].workers.dev/md?url=https%3A%2F%2Fexample.com
 * HTML格式通用网页: https://wx2md-worker.[:username].workers.dev/html/md?url=https%3A%2F%2Fexample.com
 */

// 引入首页HTML内容文件
import INDEX_HTML from '../index.html';

/**
 * 微信公众号文章 URL 前缀
 */
const WECHAT_URL_PREFIX = 'https://mp.weixin.qq.com/';

/**
 * 处理网页转换为Markdown的核心逻辑
 * 将常用功能封装为独立函数，提高代码复用性
 */
async function convertWebpageToMarkdown(
	url: string,
	env: Env,
	fallbackTitle: string,
	isHtmlMode: boolean = false,
	download: boolean = false
): Promise<Response> {
	try {
		console.log(`请求网页内容: ${url}`);

		// 请求网页内容
		const articleResponse = await fetchWithRetry(url);

		if (!articleResponse.ok) {
			console.error(`无法获取网页内容，状态码: ${articleResponse.status}`);
			return new Response(`无法获取网页内容，状态码: ${articleResponse.status}`, {
				status: 502,
				headers: { 'Content-Type': 'text/plain; charset=utf-8' },
			});
		}

		// 获取原始 HTML 内容
		const htmlContent = await articleResponse.text();

		// 提取文章标题用于文件名
		const title = getArticleTitle(htmlContent, fallbackTitle);

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

		// 检查是否是HTML模式
		if (isHtmlMode) {
			// 返回HTML包装的Markdown内容
			const htmlResponse = generateHtmlWrapper(title, markdownContent);
			return new Response(htmlResponse, {
				status: 200,
				headers: { 'Content-Type': 'text/html; charset=utf-8' },
			});
		}

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
}

/**
 * 处理通用网页转Markdown请求
 */
async function handleGenericWebpage(
	url: URL,
	env: Env,
	isHtmlMode: boolean = false
): Promise<Response> {
	const targetUrl = url.searchParams.get('url');
	if (!targetUrl) {
		return new Response('缺少必要的url参数，请提供要转换的网页地址', {
			status: 400,
			headers: { 'Content-Type': 'text/plain; charset=utf-8' },
		});
	}

	let decodedUrl;
	try {
		decodedUrl = decodeURIComponent(targetUrl);
	} catch (e) {
		// 如果URL已经是解码状态，直接使用
		decodedUrl = targetUrl;
	}

	try {
		// 验证URL是否有效
		const urlObj = new URL(decodedUrl);
		const fallbackId = urlObj.hostname + urlObj.pathname.replace(/\//g, '_');

		// 检查是否请求下载文件
		const download = url.searchParams.get('download') === 'true';

		// 处理页面转换
		return await convertWebpageToMarkdown(
			decodedUrl,
			env,
			fallbackId,
			isHtmlMode,
			download
		);
	} catch (e) {
		return new Response(`无效的URL: ${decodedUrl}`, {
			status: 400,
			headers: { 'Content-Type': 'text/plain; charset=utf-8' },
		});
	}
}

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
				// 读取项目根目录下的index.html文件
				const indexHtml = INDEX_HTML;
				return new Response(indexHtml, {
					status: 200,
					headers: { 'Content-Type': 'text/html; charset=utf-8' },
				});
			}

			// 处理HTML格式通用网页请求 (/html/md)
			if (path === '/html/md') {
				return await handleGenericWebpage(url, env, true);
			}

			// 处理通用网页URL转Markdown请求 (/md)
			if (path === '/md') {
				// 检查是否明确请求HTML格式
				const isHtmlMode = url.searchParams.get('format') === 'html';
				return await handleGenericWebpage(url, env, isHtmlMode);
			}

			// 检查是否是新的HTML格式路径: /html/s/{article_id}
			let isHtmlMode = false;
			let articleId = '';

			if (path.startsWith('/html/s/')) {
				isHtmlMode = true;
				articleId = path.substring(8); // 去掉 '/html/s/' 前缀
			}
			// 检查常规路径和旧的HTML格式: /s/{article_id}.html
			else if (path.startsWith('/s/')) {
				articleId = path.substring(3); // 去掉 '/s/' 前缀

				// 检测是否是旧格式的HTML模式
				if (articleId.endsWith('.html')) {
					isHtmlMode = true;
					articleId = articleId.slice(0, -5); // 移除 .html 后缀
				}
			}
			else {
				return new Response('请提供正确的微信公众号文章路径，格式: /s/{article_id} 或 /html/s/{article_id}，或使用 /md?url=网址 转换其他网页', {
					status: 400,
					headers: { 'Content-Type': 'text/plain; charset=utf-8' },
				});
			}

			if (!articleId) {
				return new Response('请提供微信公众号文章 ID', {
					status: 400,
					headers: { 'Content-Type': 'text/plain; charset=utf-8' },
				});
			}

			// 构建完整的微信文章 URL
			const wxArticleUrl = `${WECHAT_URL_PREFIX}s/${articleId}`;

			// 检查是否请求下载文件
			const download = url.searchParams.get('download') === 'true';

			// 使用通用转换函数处理微信公众号文章
			return await convertWebpageToMarkdown(
				wxArticleUrl,
				env,
				articleId,
				isHtmlMode,
				download
			);
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
 * 支持自定义 Referer 和错误重试
 */
async function fetchWithRetry(url: string, retries = 3, delay = 1000, customReferer?: string): Promise<Response> {
	// 从URL中提取域名作为默认Referer
	const urlObj = new URL(url);
	const defaultReferer = `${urlObj.protocol}//${urlObj.hostname}`;

	const headers = {
		'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
		Accept: 'text/html,application/xhtml+xml,application/xml',
		'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
		'Cache-Control': 'no-cache',
		Pragma: 'no-cache',
		// 使用自定义Referer或默认值
		Referer: customReferer || defaultReferer,
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
 * 生成HTML包装的Markdown内容
 */
function generateHtmlWrapper(title: string, markdownContent: string): string {
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
    pre {
      background-color: #f5f5f5;
      padding: 15px;
      border-radius: 5px;
      white-space: pre-wrap;
      word-wrap: break-word;
      overflow-x: auto;
      font-family: monospace;
      border: 1px solid #ddd;
    }
  </style>
</head>
<body>
  <pre>${escapeHtml(markdownContent)}</pre>
</body>
</html>`;
}

/**
 * HTML内容转义
 */
function escapeHtml(unsafe: string): string {
	return unsafe
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}
