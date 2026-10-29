const http = require('http');
function getJson(url){return new Promise((res,rej)=>{http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
(async()=>{
 const targets = await getJson('http://127.0.0.1:9333/json');
 console.log('targets:', targets.map(t=>t.type+' '+t.url).join(' | '));
 const page = targets.find(t=>t.type==='page' && /59602/.test(t.url)) || targets.find(t=>t.type==='page');
 if(!page){ console.log('NO PAGE TARGET'); process.exit(0); }
 const ws = new WebSocket(page.webSocketDebuggerUrl);
 let id=0; const pending=new Map(); const events=[];
 await new Promise(r=>{ws.onopen=r;});
 ws.onmessage=(ev)=>{const m=JSON.parse(ev.data); if(m.id&&pending.has(m.id)){pending.get(m.id)(m.result);pending.delete(m.id);} else if(m.method==='Log.entryAdded'){events.push('LOG '+JSON.stringify(m.params.entry).slice(0,300));} else if(m.method==='Runtime.consoleAPICalled'){events.push('CONSOLE '+JSON.stringify(m.params.args.map(a=>a.value||a.description)).slice(0,220));} else if(m.method==='Runtime.exceptionThrown'){events.push('EXC '+JSON.stringify(m.params.exceptionDetails.exception&&m.params.exceptionDetails.exception.description||m.params.exceptionDetails.text).slice(0,300));}};
 const send=(method,params={})=>new Promise((resolve)=>{const mid=++id;pending.set(mid,resolve);ws.send(JSON.stringify({id:mid,method,params}));});
 await send('Log.enable'); await send('Runtime.enable'); await send('Page.enable');
 await send('Page.reload', { ignoreCache: true });
 await new Promise(r=>setTimeout(r,6000));
 const state = await send('Runtime.evaluate',{expression:"JSON.stringify({title:document.title, hasWB:!!document.querySelector('.monaco-workbench'), text:(document.body.innerText||'').slice(0,120)})",returnByValue:true});
 console.log('STATE:', state.result && state.result.value);
 console.log('EVENTS:\n'+(events.slice(0,30).join('\n')||'(none)'));
 process.exit(0);
})().catch(e=>{console.log('ERR',e.message);process.exit(1);});
