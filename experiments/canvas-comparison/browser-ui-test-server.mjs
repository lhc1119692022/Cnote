import http from 'node:http';

const server = http.createServer((request, response) => {
  const secondPage = request.url === '/second';
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(`<!doctype html><html lang="zh"><meta charset="utf-8"><title>Cnote 本地浏览器验收</title><style>body{font:20px sans-serif;padding:24px}textarea{width:90%;height:100px}section{height:280px;border-bottom:1px solid #aaa}</style><h1>${secondPage ? '第二页' : '本地测试页面'}</h1><label>验收表单<textarea aria-label="验收表单" placeholder="输入测试文字，不会提交"></textarea></label><p><a href="${secondPage ? '/' : '/second'}">${secondPage ? '返回首页' : '打开第二页'}</a></p>${Array.from({ length: 15 }, (_, index) => `<section>滚动段落 ${index + 1}：中文 ABC 123</section>`).join('')}</html>`);
});
server.listen(18763, '127.0.0.1', () => console.log('Local UI test page: http://127.0.0.1:18763'));
