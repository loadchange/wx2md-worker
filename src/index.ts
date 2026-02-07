/**
 * 微信公众号文章转 Markdown 工具 - Worker 入口
 *
 * 路由说明:
 * - /                    首页
 * - /health, /healthz    健康检查
 * - /s/{article_id}      微信文章转 Markdown
 * - /html/s/{article_id} 微信文章 HTML 预览
 * - /md?url=...          通用网页转 Markdown
 * - /html/md?url=...     通用网页 HTML 预览
 */

import INDEX_HTML from '../index.html';
import { convertWebpageToMarkdown, handleGenericWebpage } from './converter';

/** 微信公众号文章 URL 前缀 */
const WECHAT_URL_PREFIX = 'https://mp.weixin.qq.com/';

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		try {
			const url = new URL(request.url);
			const path = url.pathname;

			console.log(`处理请求路径: ${path}`);

			// 健康检查
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
					}
				);
			}

			// 首页
			if (path === '/' || path === '') {
				return new Response(INDEX_HTML, {
					status: 200,
					headers: { 'Content-Type': 'text/html; charset=utf-8' },
				});
			}

			// HTML 格式通用网页转换
			if (path === '/html/md') {
				return await handleGenericWebpage(url, env, ctx, true);
			}

			// 通用网页转 Markdown
			if (path === '/md') {
				const isHtmlMode = url.searchParams.get('format') === 'html';
				return await handleGenericWebpage(url, env, ctx, isHtmlMode);
			}

			// 微信公众号文章路由
			let isHtmlMode = false;
			let articleId = '';

			if (path.startsWith('/html/s/')) {
				isHtmlMode = true;
				articleId = path.substring(8);
			} else if (path.startsWith('/s/')) {
				articleId = path.substring(3);

				// 兼容旧格式: /s/{id}.html
				if (articleId.endsWith('.html')) {
					isHtmlMode = true;
					articleId = articleId.slice(0, -5);
				}
			} else {
				return new Response(
					'请提供正确的微信公众号文章路径，格式: /s/{article_id} 或 /html/s/{article_id}，或使用 /md?url=网址 转换其他网页',
					{
						status: 400,
						headers: { 'Content-Type': 'text/plain; charset=utf-8' },
					}
				);
			}

			if (!articleId) {
				return new Response('请提供微信公众号文章 ID', {
					status: 400,
					headers: { 'Content-Type': 'text/plain; charset=utf-8' },
				});
			}

			const wxArticleUrl = `${WECHAT_URL_PREFIX}s/${articleId}`;
			const download = url.searchParams.get('download') === 'true';

			return await convertWebpageToMarkdown(wxArticleUrl, env, ctx, articleId, isHtmlMode, download);
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
