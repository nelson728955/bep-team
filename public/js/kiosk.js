let code='',busy=false,resetTimer;
const el=id=>document.getElementById(id);
const terminal=el('terminal');
const screen=document.createElement('section');screen.className='employee-screen';screen.hidden=true;terminal.after(screen);
const back=document.createElement('button');back.className='btn kiosk-back';back.textContent='← Back to keypad';back.hidden=true;screen.before(back);back.onclick=reset;
const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=value=>new Date(value).toLocaleTimeString('en-CA',{timeZone:'America/Toronto',hour:'numeric',minute:'2-digit'});
async function request(path,body){const r=await fetch('/api/'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw new Error(data.error||'Request failed');return data;}
function draw(){el('dots').innerHTML=Array.from({length:4},(_,i)=>`<span>${i<code.length?'●':'○'}</span>`).join('');el('dots').setAttribute('aria-label',`Work ID, ${code.length} digits entered`);el('punch').disabled=busy||code.length!==4;el('pad').querySelectorAll('button').forEach(b=>b.disabled=busy);}
function reset(){clearTimeout(resetTimer);code='';screen.hidden=true;back.hidden=true;screen.innerHTML='';terminal.hidden=false;busy=false;draw();}
function show(data){
 terminal.hidden=true;screen.hidden=false;back.hidden=false;
 const initials=data.name.split(/\s+/).map(n=>n[0]).slice(0,2).join('');
 const status=data.punch?(data.punch.break_start?'On break':'Punched in'):'Punched out';
 screen.innerHTML=`<div class="employee-avatar">${safe(initials)}</div><h2>${safe(data.name)}</h2><span class="pill pill-good">${status}</span>${data.punch?`<p>${Math.max(0,Math.floor((data.now-data.punch.clock_in)/60000))} minutes since punch-in · ${time(data.punch.clock_in)}</p>`:''}<div class="shift-card"><h3>Current shift</h3>${data.shift?`<p>${safe(data.shift.start)} – ${safe(data.shift.end)}<br>${safe(data.shift.position)}</p>`:'<p>No scheduled shift linked</p>'}${data.punch?'<button class="btn btn-danger" data-end>End shift</button>':'<button class="btn btn-primary" data-in>Punch in</button>'}</div>`;

 screen.querySelector('[data-in]')?.addEventListener('click',()=>act('in'));
 screen.querySelector('[data-end]')?.addEventListener('click',()=>{
  clearTimeout(resetTimer);
  screen.querySelector('.shift-card').innerHTML=`<h3>Finish your shift?</h3><button class="btn btn-danger" data-out>Punch out</button>`;
  screen.querySelector('[data-out]').onclick=()=>act('out');
  resetTimer=setTimeout(reset,20000);
 });
 clearTimeout(resetTimer);resetTimer=setTimeout(reset,20000);
}
async function act(action){if(busy)return;busy=true;screen.querySelectorAll('button').forEach(b=>b.disabled=true);try{const data=await request('kiosk/punch',{code,action});show(data);const message=document.createElement('p');message.setAttribute('role','status');message.textContent=action==='out'?`Punched out at ${time(data.now)}`:action==='break'?(data.action==='resume'?'Break ended':'Break started'):`Punched in at ${time(data.now)}`;screen.append(message);clearTimeout(resetTimer);resetTimer=setTimeout(reset,action==='in'?10000:4000);}catch(error){reset();el('message').textContent=error.message;}finally{busy=false;}}
for(const key of ['1','2','3','4','5','6','7','8','9','Clear','0','⌫']){const b=document.createElement('button');b.textContent=key;b.type='button';b.onclick=()=>{if(busy)return;el('message').textContent='';if(key==='Clear')code='';else if(key==='⌫')code=code.slice(0,-1);else if(code.length<4)code+=key;draw();};el('pad').append(b);}
el('punch').textContent='Continue';el('punch').onclick=async()=>{if(busy||code.length!==4)return;busy=true;draw();try{const data=await request('kiosk/punch',{code,action:'status'});if(data.punch)show(data);else{busy=false;await act('in');}}catch(error){el('message').textContent=error.message;code='';}finally{busy=false;draw();}};
async function load(){try{const data=await request('kiosk/status');el('name').textContent=data.name;terminal.hidden=false;el('setup').hidden=true;}catch{terminal.hidden=true;el('setup').hidden=false;}}
document.querySelector('#setup a').onclick=()=>sessionStorage.setItem('tablet-setup','1');
el('activate').onclick=async()=>{try{await request('kiosk-setup',{});await request('logout',{});await load();}catch(error){alert(error.message);}};
el('fullscreen').onclick=()=>document.documentElement.requestFullscreen?.().catch(()=>{});
function clock(){el('clock').textContent=new Date().toLocaleString('en-CA',{timeZone:'America/Toronto',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}clock();setInterval(clock,1000);
document.addEventListener('visibilitychange',()=>{if(document.hidden)reset();});await load();draw();
