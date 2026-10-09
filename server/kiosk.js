import { createHash } from 'node:crypto';
import { db, tx, getSettings } from './db.js';
import { newToken, today, msAt } from './util.js';

db.exec(`CREATE TABLE IF NOT EXISTS kiosk_devices (token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS work_ids (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, code TEXT NOT NULL);`);
const digest = value => createHash('sha256').update(value).digest('hex');
export const workId = user => db.prepare('SELECT code FROM work_ids WHERE user_id=?').get(user.id)?.code || (String(user.phone || '').replace(/\D/g,'').length >= 4 ? String(user.phone).replace(/\D/g,'').slice(-4) : '');
export function mountKioskPublic(app) {
  const limits = new Map();
  app.use('/api/kiosk', (req,res,next) => {
    const token = (req.headers.cookie || '').match(/(?:^|;\s*)kiosk=([^;]+)/)?.[1];
    if (!token || !db.prepare('SELECT 1 FROM kiosk_devices WHERE token=? AND expires>?').get(digest(token),Date.now())) return res.status(401).json({error:'A manager must set up this tablet first.'});
    next();
  });
  app.get('/api/kiosk/status', (req,res) => res.json({name:getSettings().restaurant_name,now:Date.now()}));
  app.post('/api/kiosk/punch', (req,res,next) => {
    try {
      const now=Date.now();
      for(const [key,value] of limits) if(value.until<now) limits.delete(key);
      const limit=limits.get(req.ip) || {count:0,until:now+60000}; limits.set(req.ip,limit);
      if(++limit.count>20) return res.status(429).json({error:'Too many attempts. Wait one minute.'});
      const code=String(req.body.code || '');
      const users=db.prepare('SELECT * FROM users WHERE active=1').all().filter(u=>workId(u)===code);
      if(!/^\d{4}$/.test(code) || users.length!==1) return res.status(400).json({error:'Work ID not found or shared by multiple employees. Ask your manager.'});
      const user=users[0];
      const action=tx(()=>{
        const open=db.prepare('SELECT * FROM punches WHERE user_id=? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1').get(user.id);
        if(open){db.prepare('UPDATE punches SET clock_out=?,break_min=break_min+?,break_start=NULL WHERE id=?').run(now,open.break_start?(now-open.break_start)/60000:0,open.id);return 'out';}
        const shifts=db.prepare('SELECT * FROM shifts WHERE user_id=? AND date=? AND published=1 ORDER BY start').all(user.id,today());
        const shift=shifts.sort((a,b)=>Math.abs(msAt(a.date,a.start)-now)-Math.abs(msAt(b.date,b.start)-now))[0];
        if(shift) db.prepare('DELETE FROM punches WHERE shift_id=? AND estimated=1 AND approved=0').run(shift.id);
        db.prepare('INSERT INTO punches(user_id,shift_id,clock_in) VALUES (?,?,?)').run(user.id,shift?.id ?? null,now);
        return 'in';
      });
      res.json({name:user.name,action,now});
    }catch(error){next(error);}
  });
}
export function mountKioskManager(app, managerOnly, route) {
  app.post('/api/kiosk-setup',managerOnly,route((req,res)=>{
    const token=newToken();
    db.prepare('INSERT INTO kiosk_devices(token,expires) VALUES (?,?)').run(digest(token),Date.now()+365*86400000);
    res.setHeader('Set-Cookie',`kiosk=${token}; HttpOnly; SameSite=Strict; Path=/api/kiosk; Max-Age=31536000${process.env.NODE_ENV==='production'?'; Secure':''}`);
    return {ok:true};
  }));
  app.put('/api/users/:id/work-id',managerOnly,route(req=>{
    const user=db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if(!user) throw new Error('Employee not found');
    const code=String(req.body.code || '');
    if(!/^\d{4}$/.test(code)) return void (()=>{throw new Error('Work ID must contain four digits');})();
    if(db.prepare('SELECT * FROM users WHERE active=1 AND id!=?').all(user.id).some(u=>workId(u)===code)) throw new Error('This work ID is already used. Choose another.');
    db.prepare('INSERT INTO work_ids(user_id,code) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET code=excluded.code').run(user.id,code);
    return {ok:true};
  }));
}
