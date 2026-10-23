import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../../outputs');
const server = http.createServer((req, res) => {
  if (!['127.0.0.1:4330','localhost:4330'].includes(req.headers.host)) { res.writeHead(403); res.end('Invalid host'); return; }
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/runtime/')) {
    // Fixed target and route: never expose a general HTTP/debugger proxy.
    const routes = new Set(['bootstrap','boot','offer','pause','command','stop','status']);
    const route = url.pathname.slice('/runtime/'.length);
    if (!routes.has(route)) { res.writeHead(404); res.end(); return; }
    const upstream = http.request({host:'127.0.0.1',port:4331,path:'/'+route,method:req.method,
      headers:{'content-type':req.headers['content-type'] || 'application/json',...(req.headers.origin?{origin:req.headers.origin}:{})},timeout:route==='boot'?95000:30000}, response=>{
      res.writeHead(response.statusCode,{'Content-Type':'application/json','Cache-Control':'no-store'}); response.pipe(res);
    });
    upstream.on('timeout',()=>upstream.destroy());
    upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'本地 PSP 服务未启动，请运行 work/psp-runtime/start-runtime.ps1。'}));});
    req.on('aborted',()=>upstream.destroy()); req.pipe(upstream); return;
  }
  if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (!['/', '/psp-3000.html'].includes(url.pathname)) { res.writeHead(404); res.end('Not found'); return; }
  const file = path.join(root, 'psp-3000.html');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
server.listen(4330, '127.0.0.1', () => console.log('PSP-3000: http://127.0.0.1:4330'));
