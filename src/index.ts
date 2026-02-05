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

		// 预处理 HTML 内容，处理懒加载图片
		const processedHtml = preprocessHtml(htmlContent);

		// 提取文章标题用于文件名
		const title = getArticleTitle(processedHtml, fallbackTitle);

		// 将 HTML 内容转换为 Markdown
		console.log('开始转换为 Markdown');
		const mdResult = await env.AI.toMarkdown([
			{
				name: `${title}.html`,
				blob: new Blob([processedHtml], { type: 'text/html' }),
			},
		]);

		if (!mdResult || mdResult.length === 0) {
			return new Response('Markdown 转换失败', {
				status: 500,
				headers: { 'Content-Type': 'text/plain; charset=utf-8' },
			});
		}

		// 获取转换后的 Markdown 内容
		const result = mdResult[0];
		if (!('data' in result) || !result.data) {
			return new Response('Markdown 转换失败: 无法获取转换结果', {
				status: 500,
				headers: { 'Content-Type': 'text/plain; charset=utf-8' },
			});
		}
		let markdownContent = result.data;

		// 处理微信图片：下载并上传到 R2，替换链接（绕过防盗链）
		markdownContent = await processImagesInMarkdown(processedHtml, markdownContent, env);

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
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error('处理请求时发生错误:', error);
		return new Response(`处理请求时发生错误: ${errorMessage}`, {
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
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error('处理请求时发生错误:', error);
			return new Response(`处理请求时发生错误: ${errorMessage}`, {
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
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.log(`请求失败 (${i + 1}/${retries})，${delay}ms 后重试: ${errorMessage}`);
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

/**
 * HTML属性值转义（用于双引号包裹的属性）
 */
function escapeHtmlAttr(unsafe: string): string {
	return unsafe
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;');
}

/**
 * 预处理 HTML 内容
 * 主要处理懒加载图片的 data-src 属性，将其转换为 src 属性
 * 微信公众号文章使用懒加载，图片的真实 URL 存储在 data-src 中
 */
function preprocessHtml(html: string): string {
	// 处理 img 标签的懒加载属性
	// 匹配 <img ... data-src="url" ... > 格式
	// 将 data-src 的值复制到 src 属性中
	return html.replace(/<img\s+([^>]*?)data-src=["']([^"']+)["']([^>]*)>/gi, (match, before, dataSrc, after) => {
		// 合并前后属性以便检查
		const otherAttrs = before + after;
		// 检查是否已经有 src 属性且有有效值（非空、非占位符）
		const srcMatch = otherAttrs.match(/src=["']([^"']*)["']/i);
		const srcValue = srcMatch ? srcMatch[1] : '';

		// 如果 src 为空或是占位符，则用 data-src 替换
		if (!srcValue || srcValue.startsWith('data:')) {
			// 移除现有的空 src 属性
			const cleanedBefore = before.replace(/src=["'][^"']*["']\s*/gi, '');
			const cleanedAfter = after.replace(/src=["'][^"']*["']\s*/gi, '');
			// 转义 dataSrc 以防止潜在的属性注入
			const safeSrc = escapeHtmlAttr(dataSrc);
			return `<img ${cleanedBefore}src="${safeSrc}" data-src="${safeSrc}"${cleanedAfter}>`;
		}

		return match;
	});
}

/**
 * ============================================
 * R2 图片存储相关函数
 * 解决微信图片防盗链问题
 * ============================================
 */

/**
 * 检查是否为微信图片 URL
 */
function isWechatImageUrl(url: string): boolean {
	return url.includes('mmbiz.qpic.cn') || url.includes('mmbiz.qlogo.cn');
}

/**
 * 从 HTML 和 Markdown 中提取所有微信图片 URL
 * 返回去重后的 URL 列表
 */
function extractWechatImageUrls(html: string, markdown: string): string[] {
	// 匹配微信图片域名的 URL
	const regex = /https?:\/\/mmbiz\.q(?:pic|logo)\.cn[^\s"'<>)\]]+/gi;

	const htmlMatches = html.match(regex) || [];
	const mdMatches = markdown.match(regex) || [];

	// 合并并去重
	const allUrls = [...new Set([...htmlMatches, ...mdMatches])];

	// 清理 URL（移除可能的尾部标点）
	return allUrls.map((url) => url.replace(/[),.\]]+$/, ''));
}

/**
 * 下载图片内容（绕过微信防盗链）
 * 使用正确的 Referer 头模拟微信内访问
 */
async function downloadWechatImage(
	url: string
): Promise<{ data: ArrayBuffer; contentType: string; extension: string } | null> {
	try {
		console.log(`下载微信图片: ${url}`);

		const response = await fetch(url, {
			headers: {
				'User-Agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
				Accept: 'image/webp,image/avif,image/jxl,image/heic,image/heic-sequence,video/*;q=0.9,*/*;q=0.8',
				'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
				// 关键：使用微信域名作为 Referer 绕过防盗链
				Referer: 'https://mp.weixin.qq.com/',
			},
		});

		if (!response.ok) {
			console.error(`下载图片失败: ${url}, 状态码: ${response.status}`);
			return null;
		}

		const contentType = response.headers.get('content-type') || 'image/jpeg';
		const data = await response.arrayBuffer();

		// 根据 Content-Type 确定文件扩展名
		let extension = 'jpg';
		if (contentType.includes('png')) {
			extension = 'png';
		} else if (contentType.includes('gif')) {
			extension = 'gif';
		} else if (contentType.includes('webp')) {
			extension = 'webp';
		} else if (contentType.includes('svg')) {
			extension = 'svg';
		}

		console.log(`图片下载成功: ${url}, 大小: ${data.byteLength} bytes, 类型: ${contentType}`);
		return { data, contentType, extension };
	} catch (error) {
		console.error(`下载图片异常: ${url}`, error);
		return null;
	}
}

/**
 * 计算字符串的 SHA-256 哈希值（用于生成唯一文件名）
 */
async function sha256(str: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(str);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 生成图片在 R2 中的存储路径
 * 格式: images/{年月}/{hash前8位}.{扩展名}
 */
async function generateImageKey(url: string, extension: string): Promise<string> {
	const hash = await sha256(url);
	const date = new Date();
	const yearMonth = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
	// 使用哈希前16位作为文件名，足够避免冲突
	return `images/${yearMonth}/${hash.substring(0, 16)}.${extension}`;
}

/**
 * 上传图片到 R2 存储
 * 返回公开访问 URL
 */
async function uploadImageToR2(
	env: Env,
	imageData: ArrayBuffer,
	key: string,
	contentType: string
): Promise<string | null> {
	try {
		console.log(`上传图片到 R2: ${key}`);

		// 检查 R2 bucket 是否可用
		if (!env.IMAGES_BUCKET) {
			console.error('R2 bucket 未配置');
			return null;
		}

		// 先检查是否已存在（避免重复上传）
		const existing = await env.IMAGES_BUCKET.head(key);
		if (existing) {
			console.log(`图片已存在于 R2: ${key}`);
			return `${env.R2_PUBLIC_URL}/${key}`;
		}

		// 上传到 R2
		await env.IMAGES_BUCKET.put(key, imageData, {
			httpMetadata: {
				contentType: contentType,
				// 设置缓存控制，图片可长期缓存
				cacheControl: 'public, max-age=31536000',
			},
		});

		console.log(`图片上传成功: ${key}`);
		return `${env.R2_PUBLIC_URL}/${key}`;
	} catch (error) {
		console.error(`上传图片到 R2 失败: ${key}`, error);
		return null;
	}
}

/**
 * 处理所有微信图片：下载并上传到 R2，返回 URL 映射表
 */
async function processWechatImages(
	imageUrls: string[],
	env: Env
): Promise<Map<string, string>> {
	const urlMapping = new Map<string, string>();

	if (imageUrls.length === 0) {
		return urlMapping;
	}

	console.log(`开始处理 ${imageUrls.length} 张微信图片...`);

	// 并发处理所有图片（限制并发数避免请求过多）
	const CONCURRENCY_LIMIT = 5;
	const chunks: string[][] = [];

	for (let i = 0; i < imageUrls.length; i += CONCURRENCY_LIMIT) {
		chunks.push(imageUrls.slice(i, i + CONCURRENCY_LIMIT));
	}

	for (const chunk of chunks) {
		const results = await Promise.allSettled(
			chunk.map(async (originalUrl) => {
				// 下载图片
				const imageResult = await downloadWechatImage(originalUrl);
				if (!imageResult) {
					return { originalUrl, newUrl: null };
				}

				// 生成存储路径
				const key = await generateImageKey(originalUrl, imageResult.extension);

				// 上传到 R2
				const newUrl = await uploadImageToR2(
					env,
					imageResult.data,
					key,
					imageResult.contentType
				);

				return { originalUrl, newUrl };
			})
		);

		// 收集成功的映射
		for (const result of results) {
			if (result.status === 'fulfilled' && result.value.newUrl) {
				urlMapping.set(result.value.originalUrl, result.value.newUrl);
			}
		}
	}

	console.log(`图片处理完成，成功: ${urlMapping.size}/${imageUrls.length}`);
	return urlMapping;
}

/**
 * 替换 Markdown 中的微信图片链接为 R2 链接
 */
function replaceImageUrls(markdown: string, urlMapping: Map<string, string>): string {
	let result = markdown;

	for (const [originalUrl, newUrl] of urlMapping) {
		// 全局替换所有出现的原始 URL
		// 需要转义 URL 中的特殊正则字符
		const escapedUrl = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const regex = new RegExp(escapedUrl, 'g');
		result = result.replace(regex, newUrl);
	}

	return result;
}

/**
 * 主图片处理函数
 * 提取、下载、上传微信图片，并替换 Markdown 中的链接
 */
async function processImagesInMarkdown(
	html: string,
	markdown: string,
	env: Env
): Promise<string> {
	// 检查 R2 配置是否完整
	if (!env.IMAGES_BUCKET || !env.R2_PUBLIC_URL || env.R2_PUBLIC_URL === 'https://your-r2-domain.example.com') {
		console.log('R2 未配置或使用默认配置，跳过图片处理');
		return markdown;
	}

	try {
		// 提取所有微信图片 URL
		const imageUrls = extractWechatImageUrls(html, markdown);

		if (imageUrls.length === 0) {
			console.log('未发现微信图片，无需处理');
			return markdown;
		}

		console.log(`发现 ${imageUrls.length} 张微信图片，开始处理...`);

		// 下载并上传所有图片
		const urlMapping = await processWechatImages(imageUrls, env);

		// 替换 Markdown 中的链接
		const processedMarkdown = replaceImageUrls(markdown, urlMapping);

		return processedMarkdown;
	} catch (error) {
		console.error('处理图片时发生错误:', error);
		// 出错时返回原始 Markdown，不影响主流程
		return markdown;
	}
}

