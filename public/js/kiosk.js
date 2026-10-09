let code='',busy=false,resetTimer,restaurant='Bếp Restaurant',generation=0;
const el=id=>document.getElementById(id);
const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials=name=>name.split(/\s+/).map(n=>n[0]).slice(0,2).join('');
const formatTime=t=>{const [h,m]=t.split(':').map(Number);return `${h%12||12}:${String(m).padStart(2,'0')} ${h<12?'a.m.':'p.m.'}`;};
async function request(path,body){const r=await fetch('/api/'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw new Error(data.error||'Request failed');return data;}
function brand(){el('identity').innerHTML=`<img class="logo" src="/img/bep-logo.png" alt="Bếp"><div><strong>${safe(restaurant)}</strong><small>Bếp · Cuisine Vietnamienne</small></div>`;}
function draw(){el('dots').innerHTML=Array.from({length:4},(_,i)=>`<span>${i<code.length?'●':''}</span>`).join('');el('dots').setAttribute('aria-label',`Work ID, ${code.length} digits entered`);el('punch').disabled=busy||code.length!==4;el('pad').querySelectorAll('button').forEach(b=>b.disabled=busy);}
function reset(){generation++;clearTimeout(resetTimer);code='';el('employee').hidden=true;el('employee').innerHTML='';el('back').hidden=true;el('terminal').hidden=false;busy=false;brand();draw();}
function show(data){
 el('terminal').hidden=true;el('employee').hidden=false;el('back').hidden=false;
 const first=data.name.split(/\s+/)[0];
 el('identity').innerHTML=`<div class="avatar">${safe(initials(data.name))}</div><div><strong>Hi, ${safe(first)}!</strong><small>${data.punch?'You are punched in.':'Have a great shift today.'}</small></div>`;
 const shift=data.shift;
 const date=shift?.date?new Date(shift.date+'T12:00:00').toLocaleDateString('en-CA',{weekday:'long',month:'long',day:'numeric',year:'numeric'}):new Date(data.now).toLocaleDateString('en-CA',{timeZone:'America/Toronto',weekday:'long',month:'long',day:'numeric',year:'numeric'});
 let info='No scheduled shift · punch-in will be recorded';
 if(shift){const minutes=t=>{const [h,m]=t.split(':').map(Number);return h*60+m;};let duration=minutes(shift.end)-minutes(shift.start);if(duration<=0)duration+=1440;info=`<strong>${safe(formatTime(shift.start))} – ${safe(formatTime(shift.end))} <span style="font-weight:400">(${Number((duration/60).toFixed(2))}h)</span></strong><small>${safe(shift.position||'No position')} | ${shift.department==='BOH'?'Back of house':'Front of house'}</small>`;}
 el('employee').innerHTML=`<h2 class="shift-heading">${data.punch?'Current shift':'Your shifts'}</h2><p class="shift-date">${safe(date)}</p><div class="card"><div class="shift-info"><div class="role-mark">${safe((shift?.position||data.name)[0])}</div><div>${info}</div></div>${data.punch?`<p>${Math.max(0,Math.floor((data.now-data.punch.clock_in)/60000))}m time on shift</p>`:''}<button class="primary ${data.punch?'danger':''}" data-action="${data.punch?'out':'in'}">${data.punch?'End shift ↪':'Start shift ↪'}</button></div>`;
 el('employee').querySelector('[data-action]').onclick=async e=>{
  if(busy)return;const action=e.currentTarget.dataset.action;
  if(action==='out'){e.currentTarget.textContent='Confirm punch out';e.currentTarget.onclick=()=>act('out',data.name);clearTimeout(resetTimer);resetTimer=setTimeout(reset,30000);}
  else await act('in',data.name);
 };
 clearTimeout(resetTimer);resetTimer=setTimeout(reset,30000);
}
async function act(action,name){if(busy)return;busy=true;clearTimeout(resetTimer);el('back').disabled=true;const version=generation;el('employee').querySelectorAll('button').forEach(b=>{b.disabled=true;b.textContent='Saving…';});try{const data=await request('kiosk/punch',{code,action});if(version!==generation)return;reset();el('confirm-title').textContent=action==='in'?'Punched in':'Punched out';el('confirm-message').textContent=action==='in'?`It's go-time, ${data.name.split(/\s+/)[0]}!`:`Have a great day, ${data.name.split(/\s+/)[0]}!`;el('confirm-avatar').textContent=initials(data.name);el('confirmation').showModal();resetTimer=setTimeout(()=>el('confirmation').close(),8000);}catch(error){if(version===generation){reset();el('message').textContent=error.message;}}finally{busy=false;el('back').disabled=false;draw();}}
for(const key of ['1','2','3','4','5','6','7','8','9','CLEAR','0','⌫']){const b=document.createElement('button');b.textContent=key;b.type='button';b.onclick=()=>{if(busy)return;el('message').textContent='';if(key==='CLEAR')code='';else if(key==='⌫')code=code.slice(0,-1);else if(code.length<4)code+=key;draw();};el('pad').append(b);}
el('back').onclick=()=>{if(!busy)reset();};el('confirm-ok').onclick=()=>{clearTimeout(resetTimer);el('confirmation').close();};
el('punch').onclick=async()=>{if(busy||code.length!==4)return;busy=true;draw();const version=generation;try{const data=await request('kiosk/punch',{code,action:'status'});if(version===generation)show(data);}catch(error){el('message').textContent=error.message;code='';}finally{busy=false;draw();}};
async function load(){try{const data=await request('kiosk/status');restaurant=data.name;brand();el('terminal').hidden=false;el('setup').hidden=true;}catch{el('terminal').hidden=true;el('setup').hidden=false;}}
document.querySelector('#setup a').onclick=()=>sessionStorage.setItem('tablet-setup','1');el('activate').onclick=async()=>{try{await request('kiosk-setup',{});await request('logout',{});await load();}catch(error){alert(error.message);}};
el('fullscreen').onclick=()=>document.documentElement.requestFullscreen?.().catch(()=>{});
function clock(){el('clock').textContent=new Date().toLocaleString('en-CA',{timeZone:'America/Toronto',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}clock();setInterval(clock,1000);
document.addEventListener('visibilitychange',()=>{if(document.hidden&&!busy){reset();if(el('confirmation').open)el('confirmation').close();}});await load();draw();
