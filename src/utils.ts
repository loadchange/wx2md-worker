/**
 * 工具函数模块
 * 包含 HTTP 请求、HTML 处理、标题提取等通用功能
 */

/**
 * 带重试功能的 fetch 请求
 * 支持自定义 Referer 和错误重试
 */
export async function fetchWithRetry(url: string, retries = 3, delay = 1000, customReferer?: string): Promise<Response> {
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
export function getArticleTitle(html: string, fallbackId: string): string {
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

	// 处理文件名：替换空格、移除不安全字符、限制长度
	return title
		.replace(/\s+/g, '_')
		.replace(/[\\/:*?"<>|]/g, '')
		.replace(/[^\w\u4e00-\u9fa5_\-.]/g, '')
		.substring(0, 100);
}

/**
 * HTML内容转义
 */
export function escapeHtml(unsafe: string): string {
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
export function escapeHtmlAttr(unsafe: string): string {
	return unsafe
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;');
}

/**
 * 预处理 HTML 内容
 * 主要处理懒加载图片的 data-src 属性，将其转换为 src 属性
 * 微信公众号文章使用懒加载，图片的真实 URL 存储在 data-src 中
 */
export function preprocessHtml(html: string): string {
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
