import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFallbackAnalysis } from './src/analysis.mjs';
import { analyzeWithDeepSeek } from './src/deepseek.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let text = '';
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 1_200_000) throw new Error('论文文本过长，请先选择较短的论文。');
  }
  return JSON.parse(text);
}

async function modelAnalysis(pages) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return buildFallbackAnalysis(pages);
  return analyzeWithDeepSeek(pages, { apiKey, model: process.env.DEEPSEEK_MODEL || 'deepseek-flash' });
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(response, 200, { ok: true, aiConfigured: Boolean(process.env.DEEPSEEK_API_KEY), provider: 'DeepSeek' });
    }
    if (request.method === 'POST' && url.pathname === '/api/analyze') {
      const { pages } = await readJson(request);
      if (!Array.isArray(pages) || !pages.length || pages.length > 100 ||
          pages.some(page => !Number.isInteger(page.page) || page.page < 1 || typeof page.text !== 'string')) {
        return sendJson(response, 400, { error: '论文页面数据无效。' });
      }
      if (pages.every(page => !page.text.trim())) {
        return sendJson(response, 400, { error: '没有提取到文字；当前原型暂不支持扫描版 PDF。' });
      }
      return sendJson(response, 200, await modelAnalysis(pages));
    }
    if (request.method !== 'GET') return sendJson(response, 405, { error: '不支持的请求方法。' });
    const decoded = decodeURIComponent(url.pathname);
    const requested = decoded === '/' ? '/index.html' : decoded;
    const file = path.resolve(root, `.${requested}`);
    if (!file.startsWith(root + path.sep)) return sendJson(response, 403, { error: '禁止访问。' });
    if (!(await stat(file)).isFile()) return sendJson(response, 404, { error: '文件不存在。' });
    response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
    response.end(await readFile(file));
  } catch (error) {
    const status = error.code === 'ENOENT' ? 404 : error instanceof SyntaxError ? 400 : 500;
    sendJson(response, status, { error: status === 500 ? `处理失败：${error.message}` : '请求或文件无效。' });
  }
});

server.listen(port, host, () => {
  console.log(`原型已启动：http://${host}:${port}`);
  console.log(process.env.DEEPSEEK_API_KEY ? 'DeepSeek 模式已启用' : '未配置 DeepSeek 密钥：使用规则提取演示模式');
});
