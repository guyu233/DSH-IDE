const http=require('http');
function getJson(u){return new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
(async()=>{
 const t=await getJson('http://127.0.0.1:9333/json');
 const page=t.find(x=>x.type==='page'&&/59602/.test(x.url));
 if(!page){console.log('no page');return;}
 const ws=new WebSocket(page.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
 let id=0;const p=new Map(); ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&p.has(m.id)){p.get(m.id)(m.result);p.delete(m.id);}};
 const send=(me,pa={})=>new Promise(r=>{const i=++id;p.set(i,r);ws.send(JSON.stringify({id:i,method:me,params:pa}));});
 await send('Runtime.enable');
 const s=await send('Runtime.evaluate',{expression:"JSON.stringify({title:document.title,hasWB:!!document.querySelector('.monaco-workbench'),hasActivity:!!document.querySelector('.activitybar'),hasStatus:!!document.querySelector('.statusbar'),text:(document.body.innerText||'').slice(0,100)})",returnByValue:true});
 console.log(s.result.value); process.exit(0);
})();
