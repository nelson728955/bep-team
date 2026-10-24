import assert from 'node:assert/strict';
import { test } from 'node:test';

// Exercise the hosted driver's SQL compatibility without a live cloud account.
process.env.TURSO_DATABASE_URL='file::memory:';
process.env.TURSO_AUTH_TOKEN='';
process.env.NODE_ENV='test';
// Node's test subprocess may inject flags that Worker does not accept.
process.execArgv = process.execArgv.filter(arg=>arg==='--no-warnings');
const { db } = await import('../server/db.js');
const { suggestion, saveSupplier, saveItem, recordCounts, createOrder, orderAction, receiveOrder, mountInventory } = await import('../server/inventory.js');

test('inventory lifecycle and safeguards',()=>{
  try {
    const manager=Number(db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES ('Manager','inventory-manager@example.test','unused','manager')").run().lastInsertRowid);
    const employee=Number(db.prepare("INSERT INTO users(name,email,password_hash) VALUES ('Cook','inventory-cook@example.test','unused')").run().lastInsertRowid);
    const supplier=saveSupplier({name:'Produce Co',contact:'test@example.test',lead_days:2}).id;
    const input={name:'Rice',category:'Grains',location:'Dry storage',unit:'kg',supplier_id:supplier,pack_size:5,pack_cost:20,par:20,emergency:2,event_extra:3,on_hand:6};
    const id=saveItem(input,manager).id;
    const getItem=()=>db.prepare('SELECT * FROM inventory_items WHERE id=?').get(id);
    assert.deepEqual(suggestion(getItem()),{target:25,incoming:0,needed:19,suggested_packs:4,suggested_units:20,estimated_cost:80});
    assert.equal(suggestion({...getItem(),on_hand:30}).suggested_packs,0);
    assert.equal(suggestion({...getItem(),par:0.3,emergency:0,event_extra:0,on_hand:0,pack_size:0.1}).suggested_packs,3);
    const revision=getItem().revision;
    recordCounts({counts:[{item_id:id,revision,quantity:8}],note:'Kitchen count'},employee);
    assert.equal(getItem().on_hand,8);
    assert.throws(()=>recordCounts({counts:[{item_id:id,revision,quantity:100}]},employee),/changed/);
    const nextRevision=getItem().revision;
    assert.throws(()=>recordCounts({counts:[{item_id:id,revision:nextRevision,quantity:10},{item_id:9999,revision:0,quantity:0}]},employee),/not found/);
    assert.equal(getItem().on_hand,8,'failed batch count rolls back all changes');
    assert.throws(()=>createOrder({lines:[{item_id:id,packs:1.5}]},manager),/valid/);
    assert.equal(db.prepare('SELECT count(*) AS n FROM inventory_orders').get().n,0,'invalid draft is rolled back');
    const order=createOrder({lines:[{item_id:id,packs:4}],note:'Weekly order'},manager).id;
    let line=db.prepare('SELECT * FROM inventory_order_lines WHERE order_id=?').get(order);
    assert.throws(()=>receiveOrder(order,{receipt_key:'test-'+crypto.randomUUID(),lines:[{line_id:line.id,quantity:5}]},manager),/ordered/);
    orderAction(order,{action:'approve'},manager);
    assert.throws(()=>orderAction(order,{action:'approve'},manager),/status/);
    // Capture API handlers to check incoming calculations and manager protection.
    const routes=new Map();
    const managerOnly=()=>{};
    const app={get:(p,...h)=>routes.set('GET '+p,h),post:(p,...h)=>routes.set('POST '+p,h),put:(p,...h)=>routes.set('PUT '+p,h)};
    mountInventory(app,managerOnly);
    for(const endpoint of ['POST /api/inventory/items','PUT /api/inventory/items/:id','POST /api/inventory/orders','POST /api/inventory/orders/:id/action','POST /api/inventory/orders/:id/receive','POST /api/inventory/suppliers'])assert.equal(routes.get(endpoint)[0],managerOnly);
    assert.notEqual(routes.get('POST /api/inventory/counts')[0],managerOnly);
    let overview;
    const read=()=>{routes.get('GET /api/inventory')[0]({isManager:true},{json:v=>overview=v},e=>{throw e;});return overview.items.find(i=>i.id===id);};
    assert.equal(read().incoming,20);assert.equal(read().suggested_packs,0);
    orderAction(order,{action:'ordered'},manager);
    receiveOrder(order,{receipt_key:'test-'+crypto.randomUUID(),lines:[{line_id:line.id,quantity:5}],note:'First delivery'},manager);
    assert.equal(getItem().on_hand,13);assert.equal(read().incoming,15);
    const deliveredKey=db.prepare('SELECT request_key FROM inventory_receipts WHERE order_id=?').get(order).request_key;
    receiveOrder(order,{receipt_key:deliveredKey,lines:[{line_id:line.id,quantity:5}]},manager);
    assert.equal(getItem().on_hand,13,'retrying a partial delivery cannot double-count stock');
    assert.throws(()=>receiveOrder(order,{receipt_key:'test-'+crypto.randomUUID(),lines:[{line_id:line.id,quantity:16}]},manager),/exceeds/);
    assert.equal(getItem().on_hand,13);
    receiveOrder(order,{receipt_key:'test-'+crypto.randomUUID(),lines:[{line_id:line.id,quantity:15}]},manager);
    assert.equal(getItem().on_hand,28);assert.equal(read().incoming,0);
    assert.equal(db.prepare('SELECT status FROM inventory_orders WHERE id=?').get(order).status,'received');
    assert.throws(()=>receiveOrder(order,{receipt_key:'test-'+crypto.randomUUID(),lines:[{line_id:line.id,quantity:1}]},manager),/ordered/,'completed delivery cannot be repeated');
    const cancelled=createOrder({lines:[{item_id:id,packs:2}]},manager).id;
    orderAction(cancelled,{action:'approve'},manager);assert.equal(read().incoming,10);
    orderAction(cancelled,{action:'cancel'},manager);assert.equal(read().incoming,0);assert.equal(getItem().on_hand,28);
    const current=getItem();
    saveItem({...input,on_hand:999,revision:current.revision,pack_cost:25},manager,id);
    assert.equal(getItem().on_hand,28,'editing metadata does not overwrite stock');
    assert.equal(line.pack_cost,20,'order retains the quoted pack price');
    assert.throws(()=>saveItem({...input,revision:getItem().revision,unit:'case'},manager,id),/original unit/);
    assert.ok(db.prepare("SELECT 1 FROM inventory_history WHERE item_id=? AND kind='count' AND user_id=?").get(id,employee));
    assert.equal(db.prepare("SELECT count(*) AS n FROM inventory_history WHERE item_id=? AND kind='receipt'").get(id).n,2);
    assert.throws(()=>saveItem({...input,pack_size:0},manager),/pack size/);
  } finally { db.close(); }
});
