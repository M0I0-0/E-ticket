import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAccounts } from './accounts.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const envFile=resolve(root,'.env');
if(existsSync(envFile)) process.loadEnvFile(envFile);
const dist=resolve(root,'dist');
if(!existsSync(resolve(dist,'index.html'))) throw new Error('Primero ejecuta npm run build.');
const accounts=createAccounts(process.env);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.zip':'application/zip'};
const server=createServer((req,res)=>accounts.middleware(req,res,async()=>{
  try {
    if(!['GET','HEAD'].includes(req.method)) {res.statusCode=405;res.end();return;}
    const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=resolve(dist,'.'+(path==='/'?'/index.html':path));
    if(!file.startsWith(dist+sep)) {res.statusCode=403;res.end();return;}
    if(!(await stat(file)).isFile()) throw new Error('Missing');
    res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'");
    if(process.env.COOKIE_SECURE==='true') res.setHeader('Strict-Transport-Security','max-age=31536000');
    if(req.method==='HEAD') res.end();
    else createReadStream(file).on('error',()=>res.destroy()).pipe(res);
  } catch {res.statusCode=404;res.end('Página no disponible.');}
}));
server.listen(Number(process.env.PORT||3000),process.env.HOST||'0.0.0.0',()=>{
  console.log(`eTicket disponible en el puerto ${server.address().port}`);
});
server.on('close',accounts.close);
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{server.close();server.closeIdleConnections();});
