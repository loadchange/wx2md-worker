// 声明 HTML 文件模块，允许 Wrangler 导入 HTML 作为字符串
declare module '*.html' {
    const content: string;
    export default content;
}
