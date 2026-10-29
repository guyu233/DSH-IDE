const path=require('path'),os=require('os');
const puppeteer=require(path.join(os.homedir(),'.dsh/profiles/desktop/node_modules/puppeteer-core'));
(async()=>{
 const b=await puppeteer.launch({executablePath:'C:\Program Files\Google\Chrome\Application\chrome.exe',headless:'new',args:['--no-sandbox','--disable-gpu']});
 const p=await b.newPage();
 const resp=await p.goto('http://127.0.0.1:59602/vscode/',{waitUntil:'domcontentloaded',timeout:20000}).catch(e=>({status:()=>'ERR:'+e.message}));
 try{await p.waitForSelector('.monaco-workbench',{timeout:15000});}catch{}
 await new Promise(r=>setTimeout(r,2000));
 const ok=await p.evaluate(()=>!!document.querySelector('.monaco-workbench'));
 console.log(JSON.stringify({http:(resp&&resp.status&&resp.status())||'?', workbench:ok}));
 await b.close();
})();
