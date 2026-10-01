const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'server-data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ATTEMPTS_FILE = path.join(DATA_DIR, 'attempts.json');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const sessions = new Map();

function ensureData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) {
    const passwordHash = hashPassword('Admin@123');
    fs.writeFileSync(USERS_FILE, JSON.stringify([
      { id: 'admin_001', username: 'admin', fullName: 'Quản trị viên', role: 'admin', status: 'active', passwordHash, createdAt: Date.now(), lastLogin: null }
    ], null, 2));
  }
  if (!fs.existsSync(ATTEMPTS_FILE)) fs.writeFileSync(ATTEMPTS_FILE, '[]');
}
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  try {
    const [salt, expected] = String(stored).split(':');
    const actual = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
  } catch { return false; }
}
function safeUser(u) { return { id: u.id, username: u.username, fullName: u.fullName, role: u.role, status: u.status, createdAt: u.createdAt, lastLogin: u.lastLogin }; }
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(x => { const i=x.indexOf('='); return [x.slice(0,i).trim(), decodeURIComponent(x.slice(i+1).trim())]; })); }
function currentUser(req) { const sid = cookies(req).sid; return sid ? sessions.get(sid) || null : null; }
function send(res, status, data, headers={}) { const body = JSON.stringify(data); res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...headers }); res.end(body); }
function readBody(req) { return new Promise((resolve,reject)=>{ let b=''; req.on('data',c=>{ b+=c; if(b.length>8_000_000){ req.destroy(); reject(new Error('Payload too large')); }}); req.on('end',()=>{ try{resolve(b?JSON.parse(b):{});}catch(e){reject(e);} }); req.on('error',reject); }); }
function requireAuth(req,res,roles=[]) { const u=currentUser(req); if(!u){ send(res,401,{ok:false,error:'UNAUTHORIZED'}); return null; } if(roles.length && !roles.includes(u.role)){ send(res,403,{ok:false,error:'FORBIDDEN'}); return null; } return u; }
function normalizeAttempt(body,user){
  const allowed=['id','createdAt','examKey','examName','subjectKey','subjectName','score','maxScore','percent','correctCount','wrongCount','unansweredCount','usedSeconds','reason','breakdown','evaluations'];
  const out={}; for(const k of allowed) if(body[k]!==undefined) out[k]=body[k];
  out.id = String(out.id || `result_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`);
  out.userId=user.id; out.username=user.username; out.createdAt=Number(out.createdAt)||Date.now();
  out.score=Number(out.score)||0; out.maxScore=Number(out.maxScore)||0; out.percent=Number(out.percent)||0;
  out.examKey=String(out.examKey||''); out.subjectKey=String(out.subjectKey||'');
  return out;
}
function staticFile(req,res){
  let pathname = decodeURIComponent(new URL(req.url, `http://${HOST}:${PORT}`).pathname);
  if(pathname === '/') pathname='/index.html';
  const target = path.normalize(path.join(ROOT, pathname));
  if(!target.startsWith(ROOT)) return send(res,403,{error:'Forbidden'});
  fs.stat(target,(err,st)=>{
    if(err || !st.isFile()) return send(res,404,{error:'Not found'});
    const ext=path.extname(target).toLowerCase();
    const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'};
    res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'no-cache'}); fs.createReadStream(target).pipe(res);
  });
}

ensureData();
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,`http://${HOST}:${PORT}`);
    if(url.pathname.startsWith('/api/')){
      if(req.method==='GET' && url.pathname==='/api/me'){ const u=currentUser(req); return send(res,200,{ok:true,user:u?safeUser(u):null}); }
      if(req.method==='POST' && url.pathname==='/api/login'){
        const b=await readBody(req); const users=readJson(USERS_FILE,[]); const u=users.find(x=>x.username===String(b.username||'').trim());
        if(!u || !verifyPassword(b.password||'',u.passwordHash)) return send(res,401,{ok:false,error:'Tên đăng nhập hoặc mật khẩu không đúng.'});
        if(u.status!=='active') return send(res,403,{ok:false,error:'Tài khoản đang bị khóa.'});
        u.lastLogin=Date.now(); writeJson(USERS_FILE,users);
        const sid=crypto.randomBytes(32).toString('hex'); sessions.set(sid,safeUser(u));
        return send(res,200,{ok:true,user:safeUser(u)},{'Set-Cookie':`sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`});
      }
      if(req.method==='POST' && url.pathname==='/api/logout'){
        const sid=cookies(req).sid; if(sid) sessions.delete(sid); return send(res,200,{ok:true},{'Set-Cookie':'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});
      }
      if(req.method==='GET' && url.pathname==='/api/history'){
        const u=requireAuth(req,res); if(!u)return; const all=readJson(ATTEMPTS_FILE,[]); return send(res,200,{ok:true,items:all.filter(x=>x.userId===u.id).sort((a,b)=>b.createdAt-a.createdAt).slice(0,100)});
      }
      if(req.method==='POST' && url.pathname==='/api/attempts'){
        const u=requireAuth(req,res); if(!u)return; const b=await readBody(req); const item=normalizeAttempt(b,u); const all=readJson(ATTEMPTS_FILE,[]); all.unshift(item); writeJson(ATTEMPTS_FILE,all.slice(0,20000)); return send(res,201,{ok:true,item});
      }
      if(req.method==='GET' && url.pathname==='/api/stats'){
        const u=requireAuth(req,res); if(!u)return; const all=readJson(ATTEMPTS_FILE,[]).filter(x=>x.userId===u.id);
        const calc=(key)=>{const a=all.filter(x=>x.examKey===key); const scores=a.map(x=>Number(x.score)||0); const max=Math.max(0,...a.map(x=>Number(x.maxScore)||0)); return {attempts:a.length,best:scores.length?Math.max(...scores):0,average:scores.length?scores.reduce((s,n)=>s+n,0)/scores.length:0,last:scores[0]??0,maxScore:max};};
        return send(res,200,{ok:true,vsat:calc('vsat'),thptqg:calc('thptqg')});
      }
      if(req.method==='GET' && url.pathname==='/api/admin/users'){
        const u=requireAuth(req,res,['admin']); if(!u)return; return send(res,200,{ok:true,users:readJson(USERS_FILE,[]).map(safeUser)});
      }
      if(req.method==='POST' && url.pathname==='/api/admin/users'){
        const u=requireAuth(req,res,['admin']); if(!u)return; const b=await readBody(req); const username=String(b.username||'').trim(); const password=String(b.password||''); const fullName=String(b.fullName||username).trim();
        if(!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) return send(res,400,{ok:false,error:'Username 3-32 ký tự, chỉ chữ/số/._-.'});
        if(password.length<6) return send(res,400,{ok:false,error:'Mật khẩu tối thiểu 6 ký tự.'});
        const users=readJson(USERS_FILE,[]); if(users.some(x=>x.username===username)) return send(res,409,{ok:false,error:'Username đã tồn tại.'});
        const item={id:`user_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,username,fullName,role:'student',status:'active',passwordHash:hashPassword(password),createdAt:Date.now(),lastLogin:null}; users.push(item); writeJson(USERS_FILE,users); return send(res,201,{ok:true,user:safeUser(item)});
      }
      if(req.method==='PATCH' && url.pathname.startsWith('/api/admin/users/')){
        const u=requireAuth(req,res,['admin']); if(!u)return; const id=decodeURIComponent(url.pathname.split('/').pop()); const b=await readBody(req); const users=readJson(USERS_FILE,[]); const target=users.find(x=>x.id===id); if(!target)return send(res,404,{ok:false,error:'Không tìm thấy tài khoản.'});
        if(target.role==='admin') return send(res,400,{ok:false,error:'Không khóa tài khoản admin bằng màn hình này.'});
        if(b.status) target.status=b.status==='active'?'active':'disabled'; if(b.password) { if(String(b.password).length<6)return send(res,400,{ok:false,error:'Mật khẩu tối thiểu 6 ký tự.'}); target.passwordHash=hashPassword(String(b.password)); }
        writeJson(USERS_FILE,users); return send(res,200,{ok:true,user:safeUser(target)});
      }
      return send(res,404,{ok:false,error:'API endpoint not found'});
    }
    return staticFile(req,res);
  } catch(e){ console.error(e); if(!res.headersSent) send(res,500,{ok:false,error:e.message||'Server error'}); }
});
server.listen(PORT,HOST,()=>console.log(`My Exam Web V4: http://${HOST}:${PORT}`));
