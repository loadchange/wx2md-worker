import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import worker from '../src/index';

// Mock global fetch for outbound requests (WeChat pages, external URLs, and images)
const mockFetch = vi.fn().mockImplementation((url: string) => {
	if (url.includes('mp.weixin.qq.com')) {
		return Promise.resolve(
			new Response(
				'<html><head><meta property="og:title" content="Test WeChat Article" /><title>Original Title</title></head><body><p>WeChat Content</p><img src="https://mmbiz.qpic.cn/sz_mmbiz_png/abc/640?wx_fmt=png&from=appmsg" /></body></html>',
				{
					status: 200,
					headers: { 'Content-Type': 'text/html; charset=utf-8' },
				}
			)
		);
	}
	if (url.includes('qpic.cn')) {
		return Promise.resolve(
			new Response(new ArrayBuffer(100), {
				status: 200,
				headers: { 'Content-Type': 'image/png' },
			})
		);
	}
	return Promise.resolve(
		new Response('<html><head><title>Generic Page</title></head><body>Generic Content</body></html>', {
			status: 200,
			headers: { 'Content-Type': 'text/html; charset=utf-8' },
		})
	);
});

describe('WX2MD Worker Test Suite', () => {
	beforeAll(() => {
		// Stub global fetch
		vi.stubGlobal('fetch', mockFetch);

		// Mock the AI binding on env
		env.AI = {
			toMarkdown: async (inputs: Array<{ name: string; blob: Blob }>) => {
				// Return a mock markdown string containing a WeChat image link to test replacement and R2 upload
				return [
					{
						name: inputs[0]?.name || 'article.html',
						data: '# Mocked AI Title\n\nHere is an image: ![](https://mmbiz.qpic.cn/sz_mmbiz_png/abc/640?wx_fmt=png&from=appmsg)',
					},
				];
			},
		} as any;
	});

	it('serves the homepage on GET /', async () => {
		const request = new Request('http://example.com/');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		const html = await response.text();
		expect(html).toContain('<!DOCTYPE html>');
		expect(html).toContain('WX2MD');
	});

	it('serves health check on GET /health', async () => {
		const request = new Request('http://example.com/health');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		const json = await response.json() as any;
		expect(json.status).toBe('ok');
		expect(json.version).toBe('1.0.0');
	});

	it('converts WeChat article, rewrites images, uploads to R2, and caches response', async () => {
		const articleId = 'test_article_123';
		const requestUrl = `http://example.com/s/${articleId}`;
		
		// First Request (Cache MISS)
		const request1 = new Request(requestUrl);
		const ctx1 = createExecutionContext();
		const response1 = await worker.fetch(request1, env, ctx1);
		
		// Wait for async operations (R2 uploads + caching) to complete
		await waitOnExecutionContext(ctx1);

		expect(response1.status).toBe(200);
		expect(response1.headers.get('X-Cache')).toBe('MISS');
		expect(response1.headers.get('Content-Type')).toContain('text/markdown');

		const markdown = await response1.text();
		expect(markdown).toContain('# Mocked AI Title');
		// Image URL should be replaced with the R2 public URL prefix
		expect(markdown).toContain('https://mp-r2.084817.xyz/mmbiz_qpic_cn/sz_mmbiz_png/abc/640.png');

		// Verify that the image was uploaded to the local R2 bucket mock
		const r2Object = await env.IMAGES_BUCKET.get('mmbiz_qpic_cn/sz_mmbiz_png/abc/640.png');
		expect(r2Object).not.toBeNull();
		if (r2Object) {
			expect(r2Object.httpMetadata?.contentType).toBe('image/png');
		}

		// Second Request (Cache HIT)
		const request2 = new Request(requestUrl);
		const ctx2 = createExecutionContext();
		const response2 = await worker.fetch(request2, env, ctx2);
		await waitOnExecutionContext(ctx2);

		expect(response2.status).toBe(200);
		expect(response2.headers.get('X-Cache')).toBe('HIT');
		
		const cachedMarkdown = await response2.text();
		expect(cachedMarkdown).toBe(markdown);
	});

	it('supports HTML preview mode', async () => {
		const request = new Request('http://example.com/html/s/test_article_123');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Type')).toContain('text/html');
		
		const html = await response.text();
		expect(html).toContain('<!DOCTYPE html>');
		expect(html).toContain('渲染预览'); // preview.html content
	});

	it('加载 Highlight.js 浏览器构建，并在依赖不可用时安全降级', async () => {
		const homepageContext = createExecutionContext();
		const homepageResponse = await worker.fetch(new Request('http://example.com/'), env, homepageContext);
		await waitOnExecutionContext(homepageContext);

		const previewContext = createExecutionContext();
		const previewResponse = await worker.fetch(
			new Request('http://example.com/html/s/highlight-fallback-test?nocache=1'),
			env,
			previewContext
		);
		await waitOnExecutionContext(previewContext);

		const pages = [await homepageResponse.text(), await previewResponse.text()];
		for (const html of pages) {
			expect(html).toContain(
				'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/highlight.min.js'
			);
			expect(html).not.toContain(
				'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/highlight.min.js'
			);
			expect(html).toMatch(/const\s+highlighter\s*=\s*window\.hljs\s*;/);
			expect(html).toMatch(/if\s*\(\s*!highlighter\s*\)\s*return\s*;/);
			expect(html).not.toMatch(/(?:^|[^\w$.])hljs\s*\./m);
		}
	});
});
