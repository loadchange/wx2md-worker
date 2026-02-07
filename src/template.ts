/**
 * HTML 预览模板模块
 * 导入预览页面 HTML，注入标题和 Markdown 内容
 */

import PREVIEW_HTML from '../preview.html';
import { escapeHtml } from './utils';

/**
 * 生成 HTML 预览页面
 * 将标题和 Markdown 内容注入到 preview.html 模板中
 */
export function generateHtmlWrapper(title: string, markdownContent: string): string {
	const escapedTitle = escapeHtml(title);
	// JSON.stringify 安全编码所有特殊字符（反引号、引号、换行等）
	// replace 防止 </script> 意外关闭 script 标签
	const markdownJson = JSON.stringify(markdownContent).replace(/<\//g, '<\\/');

	return PREVIEW_HTML
		.replaceAll('{{TITLE}}', escapedTitle)
		.replace('{{MARKDOWN_JSON}}', markdownJson);
}
