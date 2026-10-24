import { db, tx } from './db.js';

// Inventory is isolated from attendance/payroll; quantities use the item's base unit.
db.exec(`
CREATE TABLE IF NOT EXISTS inventory_suppliers (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL, contact TEXT NOT NULL DEFAULT '',
 lead_days INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS inventory_items (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, location TEXT NOT NULL,
 unit TEXT NOT NULL, supplier_id INTEGER REFERENCES inventory_suppliers(id),
 pack_size REAL NOT NULL DEFAULT 1, pack_cost REAL NOT NULL DEFAULT 0,
 par REAL NOT NULL DEFAULT 0, emergency REAL NOT NULL DEFAULT 0, event_extra REAL NOT NULL DEFAULT 0,
 on_hand REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
 revision INTEGER NOT NULL DEFAULT 0, counted_at INTEGER, notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS inventory_orders (
 id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'draft', created_by INTEGER NOT NULL REFERENCES users(id),
 approved_by INTEGER REFERENCES users(id), created_at INTEGER NOT NULL, approved_at INTEGER,
 ordered_at INTEGER, note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS inventory_order_lines (
 id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES inventory_orders(id) ON DELETE CASCADE,
 item_id INTEGER NOT NULL REFERENCES inventory_items(id), item_name TEXT NOT NULL,
 supplier_name TEXT NOT NULL, supplier_id INTEGER, unit TEXT NOT NULL,
 pack_size REAL NOT NULL, pack_cost REAL NOT NULL, packs INTEGER NOT NULL,
 received REAL NOT NULL DEFAULT 0, UNIQUE(order_id,item_id)
);
CREATE TABLE IF NOT EXISTS inventory_history (
 id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES inventory_items(id),
 kind TEXT NOT NULL, before_qty REAL NOT NULL, after_qty REAL NOT NULL,
 user_id INTEGER NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL,
 order_id INTEGER REFERENCES inventory_orders(id), note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS inventory_history_item ON inventory_history(item_id,created_at);
CREATE INDEX IF NOT EXISTS inventory_lines_order ON inventory_order_lines(order_id);
CREATE TABLE IF NOT EXISTS inventory_receipts (
 request_key TEXT PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES inventory_orders(id)
);
`);

const fail = message => { const e = new Error(message); e.status = 400; throw e; };
const text = (value, max = 100) => String(value ?? '').trim().slice(0,max);
const qty = n => Math.round((n + Number.EPSILON) * 1000) / 1000;
function number(value, label, { positive = false, integer = false } = {}) {
  const n = Number(value);
  if (value === '' || value == null || !Number.isFinite(n) || n < 0 || n > 1000000 || (positive && n === 0) || (integer && !Number.isInteger(n))) fail(`Enter a valid ${label}.`);
  if(positive && qty(n)===0) fail(`${label} must be at least 0.001.`);
  return qty(n);
}
const itemById = id => db.prepare('SELECT * FROM inventory_items WHERE id=?').get(id) || fail('Item not found.');
const orderById = id => db.prepare('SELECT * FROM inventory_orders WHERE id=?').get(id) || fail('Order not found.');
const linesFor = id => db.prepare('SELECT * FROM inventory_order_lines WHERE order_id=? ORDER BY supplier_name,item_name').all(id);
function history(item, after, kind, userId, note, orderId = null) {
  db.prepare('INSERT INTO inventory_history(item_id,kind,before_qty,after_qty,user_id,created_at,order_id,note) VALUES (?,?,?,?,?,?,?,?)')
    .run(item.id,kind,item.on_hand,after,userId,Date.now(),orderId,text(note,500));
}
export function suggestion(item, incoming = 0) {
  const target = qty(item.par + item.emergency + item.event_extra);
  const needed = Math.max(0,qty(target-item.on_hand-incoming));
  const packs = Math.ceil(Math.max(0,needed / item.pack_size - 1e-9));
  return { target, incoming: qty(incoming), needed, suggested_packs: packs, suggested_units: qty(packs*item.pack_size), estimated_cost: Math.round(packs*item.pack_cost*100)/100 };
}
function stockList() {
  const incoming = new Map(db.prepare(`SELECT l.item_id,SUM(l.packs*l.pack_size-l.received) AS quantity
    FROM inventory_order_lines l JOIN inventory_orders o ON o.id=l.order_id
    WHERE o.status IN ('approved','ordered') GROUP BY l.item_id`).all().map(row=>[row.item_id,row.quantity]));
  return db.prepare('SELECT i.*,s.name AS supplier_name FROM inventory_items i LEFT JOIN inventory_suppliers s ON s.id=i.supplier_id ORDER BY i.category,i.location,i.name').all()
    .map(item=>({...item,...suggestion(item,incoming.get(item.id)||0)}));
}
export function mountInventory(app, managerOnly) {
  const route = fn => (req,res,next) => { try { res.json(fn(req)); } catch(e) { if(e.status===400) res.status(400).json({error:e.message}); else next(e); } };
  app.get('/api/inventory',route(req=>({
    items:stockList(),
    suppliers:db.prepare('SELECT * FROM inventory_suppliers ORDER BY name').all().map(s=> req.isManager ? s : {id:s.id,name:s.name}),
    orders:req.isManager ? db.prepare('SELECT o.*,u.name AS created_name,a.name AS approved_name FROM inventory_orders o JOIN users u ON u.id=o.created_by LEFT JOIN users a ON a.id=o.approved_by ORDER BY o.id DESC LIMIT 100').all().map(o=>({...o,lines:linesFor(o.id)})) : [],
  })));
  app.post('/api/inventory/suppliers',managerOnly,route(req=>saveSupplier(req.body)));
  app.put('/api/inventory/suppliers/:id',managerOnly,route(req=>saveSupplier(req.body,req.params.id)));
  app.post('/api/inventory/items',managerOnly,route(req=>saveItem(req.body,req.user.id)));
  app.put('/api/inventory/items/:id',managerOnly,route(req=>saveItem(req.body,req.user.id,req.params.id)));
  app.post('/api/inventory/counts',route(req=>recordCounts(req.body,req.user.id)));
  app.get('/api/inventory/history',route(req=>{
    const id=req.query.item ? Number(req.query.item) : null;
    return db.prepare(`SELECT h.*,i.name AS item_name,i.unit,u.name AS user_name FROM inventory_history h
      JOIN inventory_items i ON i.id=h.item_id JOIN users u ON u.id=h.user_id
      ${id ? 'WHERE h.item_id=?' : ''} ORDER BY h.id DESC LIMIT 250`).all(...(id?[id]:[]));
  }));
  app.post('/api/inventory/orders',managerOnly,route(req=>createOrder(req.body,req.user.id)));
  app.post('/api/inventory/orders/:id/action',managerOnly,route(req=>orderAction(req.params.id,req.body,req.user.id)));
  app.post('/api/inventory/orders/:id/receive',managerOnly,route(req=>receiveOrder(req.params.id,req.body,req.user.id)));
}
export function saveSupplier(b,id) {
  const name=text(b.name); if(!name) fail('Supplier name is required.');
  const values=[name,text(b.contact,200),number(b.lead_days??0,'lead time',{integer:true}),text(b.notes,500)];
  if(id) { if(!db.prepare('UPDATE inventory_suppliers SET name=?,contact=?,lead_days=?,notes=? WHERE id=?').run(...values,id).changes) fail('Supplier not found.'); }
  else id=Number(db.prepare('INSERT INTO inventory_suppliers(name,contact,lead_days,notes) VALUES (?,?,?,?)').run(...values).lastInsertRowid);
  return {id};
}
export function saveItem(b,userId,id) {
  return tx(()=>{
    const existing=id?itemById(id):null;
    if(existing && Number(b.revision)!==existing.revision) fail('This item changed. Refresh before saving.');
    const name=text(b.name),category=text(b.category),location=text(b.location),unit=text(b.unit,30);
    if(!name||!category||!location||!unit) fail('Name, category, location and unit are required.');
    const supplier=b.supplier_id?Number(b.supplier_id):null;
    if(supplier&&!db.prepare('SELECT id FROM inventory_suppliers WHERE id=?').get(supplier)) fail('Supplier not found.');
    const values=[name,category,location,unit,supplier,number(b.pack_size,'pack size',{positive:true}),number(b.pack_cost,'pack cost'),number(b.par,'par'),number(b.emergency,'emergency stock'),number(b.event_extra,'event extras'),text(b.notes,500),b.active===false?0:1];
    if(existing) {
      // Unit changes would make earlier counts/receipts ambiguous.
      if(unit!==existing.unit && (existing.on_hand!==0 || db.prepare('SELECT 1 FROM inventory_order_lines WHERE item_id=?').get(id) || db.prepare('SELECT 1 FROM inventory_history WHERE item_id=?').get(id))) fail('Keep the original unit for an item with history. Archive it and create a new item to change units.');
      db.prepare('UPDATE inventory_items SET name=?,category=?,location=?,unit=?,supplier_id=?,pack_size=?,pack_cost=?,par=?,emergency=?,event_extra=?,notes=?,active=?,revision=revision+1 WHERE id=?').run(...values,id);
    } else {
      id=Number(db.prepare('INSERT INTO inventory_items(name,category,location,unit,supplier_id,pack_size,pack_cost,par,emergency,event_extra,notes,active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(...values).lastInsertRowid);
      const initial=number(b.on_hand??0,'initial stock');
      if(initial) { const item=itemById(id); history(item,initial,'initial',userId,'Opening stock'); db.prepare('UPDATE inventory_items SET on_hand=?,counted_at=? WHERE id=?').run(initial,Date.now(),id); }
    }
    return {id};
  });
}
export function recordCounts(b,userId) {
  if(!Array.isArray(b.counts)||!b.counts.length||b.counts.length>500) fail('Enter at least one stock count (up to 500 at once).');
  return tx(()=>{
    const seen=new Set();
    for(const count of b.counts) {
      const item=itemById(count.item_id);
      if(!item.active||seen.has(item.id)) fail('Count each active item only once.'); seen.add(item.id);
      if(Number(count.revision)!==item.revision) fail(`${item.name} changed since this screen loaded. Refresh and count again.`);
      const after=number(count.quantity,'stock quantity');
      history(item,after,'count',userId,b.note);
      db.prepare('UPDATE inventory_items SET on_hand=?,counted_at=?,revision=revision+1 WHERE id=?').run(after,Date.now(),item.id);
    }
    return {saved:seen.size};
  });
}
export function createOrder(b,userId) {
  if(!Array.isArray(b.lines)||!b.lines.length||b.lines.length>500) fail('Select between 1 and 500 items to order.');
  return tx(()=>{
    const id=Number(db.prepare('INSERT INTO inventory_orders(created_by,created_at,note) VALUES (?,?,?)').run(userId,Date.now(),text(b.note,500)).lastInsertRowid);
    const seen=new Set();
    for(const line of b.lines) {
      const item=itemById(line.item_id),packs=number(line.packs,'number of packs',{integer:true,positive:true});
      if(!item.active||seen.has(item.id)||!item.supplier_id) fail('Each order item must be active, unique and have a supplier.');seen.add(item.id);
      const supplier=db.prepare('SELECT name FROM inventory_suppliers WHERE id=?').get(item.supplier_id);
      db.prepare('INSERT INTO inventory_order_lines(order_id,item_id,item_name,supplier_name,supplier_id,unit,pack_size,pack_cost,packs) VALUES (?,?,?,?,?,?,?,?,?)').run(id,item.id,item.name,supplier.name,item.supplier_id,item.unit,item.pack_size,item.pack_cost,packs);
    }
    return {id};
  });
}
export function orderAction(id,b,userId) {
  return tx(()=>{
    const order=orderById(id);
    if(b.action==='approve'&&order.status==='draft') {
      for(const line of linesFor(id)) if(!itemById(line.item_id).active) fail('This order contains an archived item. Cancel and create a new draft.');
      db.prepare("UPDATE inventory_orders SET status='approved',approved_by=?,approved_at=? WHERE id=?").run(userId,Date.now(),id);
    } else if(b.action==='ordered'&&order.status==='approved') db.prepare("UPDATE inventory_orders SET status='ordered',ordered_at=? WHERE id=?").run(Date.now(),id);
    else if(b.action==='cancel'&&['draft','approved','ordered'].includes(order.status)) db.prepare("UPDATE inventory_orders SET status='cancelled' WHERE id=?").run(id);
    else fail('This action is not available for the current order status.');
    return {ok:true};
  });
}
export function receiveOrder(id,b,userId) {
  if(!Array.isArray(b.lines)||!b.lines.length||b.lines.length>500) fail('Enter delivered quantities.');
  const key=text(b.receipt_key,100);
  if(!/^[a-zA-Z0-9-]{16,100}$/.test(key)) fail('Missing delivery reference. Reopen the delivery form.');
  return tx(()=>{
    const previous=db.prepare('SELECT order_id FROM inventory_receipts WHERE request_key=?').get(key);
    if(previous) { if(previous.order_id!==Number(id))fail('Delivery reference belongs to another order.');return {ok:true}; }
    if(orderById(id).status!=='ordered') fail('Mark the approved order as ordered before receiving it.');
    const lines=linesFor(id),seen=new Set(); let total=0;
    for(const entry of b.lines) {
      const line=lines.find(l=>l.id===Number(entry.line_id));
      if(!line||seen.has(line.id)) fail('Invalid or repeated delivery line.'); seen.add(line.id);
      const quantity=number(entry.quantity,'received quantity');
      if(quantity===0)continue;
      const remaining=qty(line.packs*line.pack_size-line.received);
      if(quantity>remaining)fail(`Delivery for ${line.item_name} exceeds the remaining order quantity.`);
      const item=itemById(line.item_id),after=qty(item.on_hand+quantity);
      history(item,after,'receipt',userId,b.note,id);
      db.prepare('UPDATE inventory_items SET on_hand=?,revision=revision+1 WHERE id=?').run(after,item.id);
      db.prepare('UPDATE inventory_order_lines SET received=received+? WHERE id=?').run(quantity,line.id); total+=quantity;
    }
    if(total===0)fail('Enter at least one delivered quantity greater than zero.');
    db.prepare('INSERT INTO inventory_receipts(request_key,order_id) VALUES (?,?)').run(key,id);
    if(linesFor(id).every(l=>qty(l.packs*l.pack_size-l.received)<=0)) db.prepare("UPDATE inventory_orders SET status='received' WHERE id=?").run(id);
    return {ok:true};
  });
}
