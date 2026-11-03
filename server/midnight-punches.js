import { db, tx } from './db.js';

const zone='America/Toronto';
const format=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function parts(ms) { return Object.fromEntries(format.formatToParts(ms).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)])); }
export function nextRestaurantMidnight(ms) {
  const p=parts(ms);
  const target=Date.UTC(p.year,p.month-1,p.day+1);
  let guess=target;
  for(let i=0;i<4;i++) {
    const q=parts(guess);
    const delta=target-Date.UTC(q.year,q.month-1,q.day,q.hour,q.minute,q.second);
    guess+=delta;
    if(!delta)break;
  }
  return guess;
}
export function closeForgottenPunches(now=Date.now()) {
  const candidates=db.prepare('SELECT * FROM punches WHERE clock_out IS NULL AND clock_in < ?').all(now);
  let closed=0;
  tx(()=>{
    for(const punch of candidates) {
      const end=nextRestaurantMidnight(punch.clock_in);
      if(end>now)continue;
      const extra=punch.break_start?Math.max(0,end-Math.max(punch.clock_in,punch.break_start))/60000:0;
      const note=[punch.note,'Automatically punched out at midnight (America/Toronto). Manager review required.'].filter(Boolean).join('\n');
      closed+=db.prepare('UPDATE punches SET clock_out=?,break_min=break_min+?,break_start=NULL,approved=0,note=? WHERE id=? AND clock_out IS NULL').run(end,extra,note,punch.id).changes;
    }
  });
  return closed;
}
