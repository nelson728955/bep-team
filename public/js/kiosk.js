let code='',busy=false;
const el=id=>document.getElementById(id);
async function request(path,body){const r=await fetch('/api/'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw new Error(data.error || 'Request failed');return data;}
function draw(){el('dots').textContent='●'.repeat(code.length)+'○'.repeat(4-code.length);el('dots').setAttribute('aria-label',`Work ID, ${code.length} digits entered`);el('punch').disabled=busy||code.length!==4;el('pad').querySelectorAll('button').forEach(b=>b.disabled=busy);}
for(const key of ['1','2','3','4','5','6','7','8','9','Clear','0','⌫']){const b=document.createElement('button');b.textContent=key;b.type='button';b.addEventListener('click',()=>{if(busy)return;if(key==='Clear')code='';else if(key==='⌫')code=code.slice(0,-1);else if(code.length<4)code+=key;draw();});el('pad').append(b);}
el('punch').onclick=async()=>{if(busy||code.length!==4)return;busy=true;draw();try{const data=await request('kiosk/punch',{code});el('message').textContent=`${data.name} — clocked ${data.action} at ${new Date(data.now).toLocaleTimeString('en-CA',{timeZone:'America/Toronto',hour:'numeric',minute:'2-digit'})}`;}catch(error){el('message').textContent=error.message;}finally{code='';busy=false;draw();setTimeout(()=>{if(!busy)el('message').textContent='';},8000);}};
async function load(){try{const data=await request('kiosk/status');el('name').textContent=data.name;el('terminal').hidden=false;el('setup').hidden=true;}catch{el('terminal').hidden=true;el('setup').hidden=false;}}
el('activate').onclick=async()=>{try{await request('kiosk-setup',{});await request('logout',{});await load();}catch(error){alert(error.message);}};
el('fullscreen').onclick=()=>document.documentElement.requestFullscreen?.().catch(()=>{});
function clock(){el('clock').textContent=new Date().toLocaleString('en-CA',{timeZone:'America/Toronto',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}clock();setInterval(clock,1000);
document.addEventListener('visibilitychange',()=>{if(document.hidden){code='';draw();}});
await load();draw();
