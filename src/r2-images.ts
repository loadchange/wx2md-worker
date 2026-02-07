/**
 * R2 图片存储模块
 * 1. 白名单机制：只处理 qpic.cn 域名
 * 2. 确定性路径：基于URL生成唯一路径，避免重复上传
 * 3. 8小时过期：自动删除旧图片
 * 4. 异步上传：快速响应，后台处理
 */

/**
 * 检查是否为微信 qpic.cn 域名（白名单）
 */
export function isQpicDomain(url: string): boolean {
	return url.includes('qpic.cn');
}

/**
 * 从原始URL生成R2存储路径
 * 示例：
 * 输入：https://mmbiz.qpic.cn/sz_mmbiz_png/xxx/640?wx_fmt=png&from=appmsg
 * 输出：/mmbiz_qpic_cn/sz_mmbiz_png/xxx/640.png
 */
export function generateR2PathFromUrl(originalUrl: string): { path: string; extension: string } | null {
	try {
		const urlObj = new URL(originalUrl);

		// 只处理 qpic.cn 域名
		if (!isQpicDomain(originalUrl)) {
			return null;
		}

		// 提取域名，转换为路径前缀（点替换为下划线）
		const domainPrefix = urlObj.hostname.replace(/\./g, '_');

		// 提取路径部分（去掉开头的斜杠）
		const urlPath = urlObj.pathname.substring(1);

		// 从查询参数或路径推断文件扩展名
		let extension = 'jpg'; // 默认
		const wxFmt = urlObj.searchParams.get('wx_fmt');
		if (wxFmt) {
			extension = wxFmt === 'jpeg' ? 'jpg' : wxFmt;
		} else if (urlPath.includes('_png')) {
			extension = 'png';
		} else if (urlPath.includes('_gif')) {
			extension = 'gif';
		} else if (urlPath.includes('_jpg') || urlPath.includes('_jpeg')) {
			extension = 'jpg';
		}

		// 拼接完整路径
		const r2Path = `/${domainPrefix}/${urlPath}.${extension}`;

		return { path: r2Path, extension };
	} catch (error) {
		console.error('生成R2路径失败:', originalUrl, error);
		return null;
	}
}

/**
 * 从 HTML 和 Markdown 中提取所有微信图片 URL
 * 返回去重后的 URL 列表
 */
export function extractWechatImageUrls(html: string, markdown: string): string[] {
	// 匹配微信图片域名的 URL（改进的正则，在遇到&时停止，避免匹配HTML实体）
	const regex = /https?:\/\/mmbiz\.q(?:pic|logo)\.cn\/[^?\s"'<>)\]]+(?:\?[^&\s"'<>)\]]+)?/gi;

	const htmlMatches = html.match(regex) || [];
	const mdMatches = markdown.match(regex) || [];

	// 合并并去重
	const allUrls = [...new Set([...htmlMatches, ...mdMatches])];

	// 清理 URL（移除尾部的标点符号）
	return allUrls.map((url) => url.replace(/[,.)\]]+$/, ''));
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
 * 同步替换图片链接（不上传，只替换为R2链接）
 */
export function replaceImageUrlsSync(html: string, markdown: string, env: Env): string {
	// 检查R2配置
	if (!env.IMAGES_BUCKET || !env.R2_PUBLIC_URL) {
		console.log('R2未配置，跳过图片处理');
		return markdown;
	}

	const imageUrls = extractWechatImageUrls(html, markdown);
	if (imageUrls.length === 0) {
		return markdown;
	}

	console.log(`发现 ${imageUrls.length} 张图片，开始替换链接`);
	let result = markdown;

	for (const originalUrl of imageUrls) {
		const r2PathInfo = generateR2PathFromUrl(originalUrl);
		if (!r2PathInfo) {
			continue; // 跳过非白名单域名
		}

		const newUrl = `${env.R2_PUBLIC_URL}${r2PathInfo.path}`;
		const escapedUrl = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

		// 匹配URL及其后续HTML实体查询参数（&amp;from=appmsg等）
		const htmlEscapedUrl = escapedUrl.replace(/&/g, '&amp;');
		const htmlRegexWithParams = new RegExp(htmlEscapedUrl + '(?:&amp;[^)\\s"\'<>\\]]+)*', 'g');
		result = result.replace(htmlRegexWithParams, newUrl);

		// 同样处理普通的&参数
		const regexWithParams = new RegExp(escapedUrl + '(?:&[^)\\s"\'<>\\]]+)*', 'g');
		result = result.replace(regexWithParams, newUrl);
	}

	console.log('图片链接替换完成');
	return result;
}

/**
 * 异步上传图片到R2（后台处理，不阻塞响应）
 */
export async function uploadImagesToR2Async(html: string, markdown: string, env: Env): Promise<void> {
	try {
		if (!env.IMAGES_BUCKET || !env.R2_PUBLIC_URL) {
			console.log('R2未配置，跳过图片上传');
			return;
		}

		const imageUrls = extractWechatImageUrls(html, markdown);
		if (imageUrls.length === 0) {
			console.log('未发现图片，无需上传');
			return;
		}

		console.log(`开始异步上传 ${imageUrls.length} 张图片...`);

		// 并发上传（限制并发数）
		const CONCURRENCY_LIMIT = 5;
		const chunks: string[][] = [];
		for (let i = 0; i < imageUrls.length; i += CONCURRENCY_LIMIT) {
			chunks.push(imageUrls.slice(i, i + CONCURRENCY_LIMIT));
		}

		let successCount = 0;
		let skipCount = 0;

		for (const chunk of chunks) {
			const results = await Promise.allSettled(
				chunk.map(async (originalUrl) => {
					const r2PathInfo = generateR2PathFromUrl(originalUrl);
					if (!r2PathInfo) {
						console.log(`跳过非白名单图片: ${originalUrl}`);
						return { success: false, skipped: true };
					}

					const r2Key = r2PathInfo.path.substring(1);

					// 检查是否已存在
					const existing = await env.IMAGES_BUCKET.head(r2Key);
					if (existing) {
						console.log(`图片已存在，跳过: ${r2Key}`);
						return { success: false, skipped: true };
					}

					// 下载图片
					console.log(`下载图片: ${originalUrl}`);
					const imageData = await downloadWechatImage(originalUrl);
					if (!imageData) {
						console.error(`下载失败: ${originalUrl}`);
						return { success: false, skipped: false };
					}

					// 上传到R2（设置8小时后过期）
					console.log(`上传到R2: ${r2Key}`);
					const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);

					await env.IMAGES_BUCKET.put(r2Key, imageData.data, {
						httpMetadata: {
							contentType: imageData.contentType,
							cacheControl: 'public, max-age=28800',
						},
						customMetadata: {
							expiresAt: expiresAt.toISOString(),
							originalUrl: originalUrl,
						},
					});

					console.log(`上传成功: ${r2Key}`);
					return { success: true, skipped: false };
				})
			);

			for (const result of results) {
				if (result.status === 'fulfilled') {
					if (result.value.success) successCount++;
					else if (result.value.skipped) skipCount++;
				}
			}
		}

		console.log(`异步上传完成: 成功 ${successCount}, 跳过 ${skipCount}, 总计 ${imageUrls.length}`);
	} catch (error) {
		console.error('异步上传图片时发生错误:', error);
	}
}
