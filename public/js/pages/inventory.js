import { api, esc, money, modal, options, toast, confirmDialog, emptyState, downloadCsv } from '../ui.js';

const state={tab:'stock',search:'',category:'',location:'',archived:false};
const n=value=>Number(value).toLocaleString('en-CA',{maximumFractionDigits:3});
const timestamp=value=>value?new Date(value).toLocaleString('en-CA'):'Never';
const statusLabel={draft:'Draft — needs approval',approved:'Approved',ordered:'Ordered',received:'Received',cancelled:'Cancelled'};
const field=(label,name,value='',type='text',extra='')=>`<label class="field"><span>${label}</span><input type="${type}" name="${name}" value="${esc(value)}" ${extra}></label>`;
const numeric=(label,name,value=0,extra='')=>field(label,name,value,'number',`min="0" max="1000000" step="${extra.includes('step="1"')?'1':'0.001'}" required`);

export async function render(root,ctx) {
  const data=await api('/inventory');
  const M=ctx.isManager;
  const reload=()=>render(root,ctx);
  if(!M&&state.tab==='orders')state.tab='stock';
  const active=data.items.filter(i=>i.active);
  const visible=data.items.filter(i=>(state.archived||i.active)&&(!state.category||i.category===state.category)&&(!state.location||i.location===state.location)&&`${i.name} ${i.supplier_name||''}`.toLowerCase().includes(state.search.toLowerCase()));
  root.innerHTML=`<div class="page inventory-page">
    <div class="page-head"><div><h1>Inventory</h1><div class="sub">Count stock, review par levels, and plan supplier orders.</div></div><div class="toolbar">${M?'<button class="btn" data-suppliers>Suppliers</button><button class="btn btn-primary" data-add>+ Add item</button>':''}</div></div>
    <div class="grid grid-4" style="margin-bottom:16px">
      <div class="card stat"><div class="label">Active items</div><div class="value">${active.length}</div></div>
      <div class="card stat"><div class="label">Items to order</div><div class="value">${active.filter(i=>i.suggested_packs>0).length}</div></div>
      <div class="card stat"><div class="label">Estimated stock value</div><div class="value">${money(active.reduce((sum,i)=>sum+i.on_hand/i.pack_size*i.pack_cost,0))}</div><div class="foot">At current pack prices</div></div>
      <div class="card stat"><div class="label">Suggested purchase cost</div><div class="value">${money(active.reduce((sum,i)=>sum+i.estimated_cost,0))}</div><div class="foot">Before tax and delivery</div></div>
    </div>
    <div class="toolbar" style="margin-bottom:16px"><div class="seg">${[['stock','Stock & counts'],...(M?[['orders','Orders']]:[]),['history','Count history']].map(([key,label])=>`<button type="button" data-tab="${key}" class="${state.tab===key?'on':''}">${label}</button>`).join('')}</div></div>
    <div data-inventory-body></div>
  </div>`;
  root.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;reload();});
  root.querySelector('[data-add]')?.addEventListener('click',()=>itemModal(null,data,reload));
  root.querySelector('[data-suppliers]')?.addEventListener('click',()=>supplierList(data,reload));
  const body=root.querySelector('[data-inventory-body]');
  if(state.tab==='stock') {
    body.innerHTML=`<div class="card"><div class="card-body"><div class="toolbar">
      <label class="field"><span>Search item or supplier</span><input type="search" data-search value="${esc(state.search)}" placeholder="Search inventory"></label>
      <label class="field"><span>Category</span><select data-category>${options([...new Set(data.items.map(i=>i.category))].sort().map(v=>[v,v]),state.category,{blank:'All categories'})}</select></label>
      <label class="field"><span>Storage location</span><select data-location>${options([...new Set(data.items.map(i=>i.location))].sort().map(v=>[v,v]),state.location,{blank:'All locations'})}</select></label>
      ${M?`<label class="check"><input type="checkbox" data-archived ${state.archived?'checked':''}> Show archived</label>`:''}
    </div><p class="small muted">Order suggestion = par + emergency stock + event extras − on hand − approved/ordered deliveries still outstanding. Rounded up to whole supplier packs. All quantities use the listed stock unit.</p>
    <form data-count-form><div class="table-wrap"><table class="table inventory-table"><thead><tr><th>Item / location</th><th>On hand</th><th>Count now</th><th>Par + extras</th><th>Incoming</th><th>Supplier pack</th><th>Order suggestion</th>${M?'<th>Order packs</th><th></th>':''}</tr></thead><tbody>${stockRows(visible,M)}</tbody></table></div>
    <div class="toolbar" style="margin-top:16px"><button class="btn btn-primary" type="submit" ${!active.length?'disabled':''}>Save entered counts</button>${M?'<button type="button" class="btn btn-teal" data-draft>Create draft from entered packs</button>':''}<button type="button" class="btn" data-export>Export stock CSV</button></div><p class="small muted">Leave unchanged count fields blank. Saving counts replaces on-hand quantities and records who counted them. Draft orders are not sent to suppliers and do not reserve stock.</p></form></div></div>`;
    body.querySelector('[data-search]').onchange=e=>{state.search=e.target.value;reload();};
    body.querySelector('[data-category]').onchange=e=>{state.category=e.target.value;reload();};
    body.querySelector('[data-location]').onchange=e=>{state.location=e.target.value;reload();};
    body.querySelector('[data-archived]')?.addEventListener('change',e=>{state.archived=e.target.checked;reload();});
    body.querySelectorAll('[data-edit-item]').forEach(b=>b.onclick=()=>itemModal(data.items.find(i=>i.id===Number(b.dataset.editItem)),data,reload));
    body.querySelectorAll('[data-item-history]').forEach(b=>b.onclick=()=>historyModal(data.items.find(i=>i.id===Number(b.dataset.itemHistory))));
    body.querySelector('[data-count-form]').onsubmit=async e=>{
      e.preventDefault();const counts=[...body.querySelectorAll('[data-count]')].filter(input=>input.value!=='').map(input=>({item_id:Number(input.dataset.count),revision:Number(input.dataset.revision),quantity:Number(input.value)}));
      if(!counts.length)return toast('Enter at least one stock count.','error');
      if(!await confirmDialog(`Save counts for ${counts.length} item(s)? This replaces their current on-hand quantities.`,{confirmLabel:'Save counts'}))return;
      const button=e.submitter;button.disabled=true;
      try{await api('/inventory/counts',{method:'POST',body:{counts}});toast('Stock counts saved');await reload();}catch(error){toast(error.message,'error');button.disabled=false;}
    };
    body.querySelector('[data-draft]')?.addEventListener('click',()=>{
      const unsaved=[...body.querySelectorAll('[data-count]')].some(input=>input.value!=='');
      if(unsaved)return toast('Save your stock counts before creating the order.','error');
      const lines=[...body.querySelectorAll('[data-packs]')].filter(input=>Number(input.value)>0).map(input=>({item_id:Number(input.dataset.packs),packs:Number(input.value)}));
      if(!lines.length)return toast('Enter packs for at least one item.','error');
      draftModal(lines,data,()=>{state.tab='orders';reload();});
    });
    body.querySelector('[data-export]').onclick=()=>downloadCsv('bepshift-inventory.csv',[
      ['Item','Category','Location','Unit','On hand','Par','Emergency','Event extras','Incoming','Suggested packs','Pack size','Pack cost','Supplier','Last counted'],
      ...visible.map(i=>[i.name,i.category,i.location,i.unit,i.on_hand,i.par,i.emergency,i.event_extra,i.incoming,i.suggested_packs,i.pack_size,i.pack_cost,i.supplier_name||'',timestamp(i.counted_at)])]);
  } else if(state.tab==='orders') {
    body.innerHTML=`<div class="card"><div class="card-head"><h2>Orders</h2></div><div class="card-body"><p class="small muted">Draft → manager approval → mark ordered → receive delivery. Send the reviewed order to your supplier yourself; BepShift does not place purchases automatically.</p></div><div class="table-wrap"><table class="table"><thead><tr><th>Order</th><th>Created</th><th>Suppliers</th><th>Status</th><th>Estimated cost</th><th></th></tr></thead><tbody>${data.orders.map(o=>`<tr><td>#${o.id}</td><td>${esc(timestamp(o.created_at))}<div class="small muted">${esc(o.created_name)}</div></td><td>${esc([...new Set(o.lines.map(l=>l.supplier_name))].join(', '))}</td><td>${esc(statusLabel[o.status])}</td><td>${money(orderCost(o))}</td><td><button class="btn btn-sm" data-order="${o.id}">Review</button></td></tr>`).join('')||'<tr><td colspan="6">No orders yet. Enter pack quantities in Stock & counts to create a draft.</td></tr>'}</tbody></table></div></div>`;
    body.querySelectorAll('[data-order]').forEach(b=>b.onclick=()=>orderModal(data.orders.find(o=>o.id===Number(b.dataset.order)),reload));
  } else {
    body.innerHTML='<div class="card card-body">Loading count history…</div>';
    try{const rows=await api('/inventory/history');if(!root.contains(body))return;body.innerHTML=`<div class="card"><div class="card-head"><h2>Count & delivery history</h2><span class="small muted">Latest 250 entries</span></div>${historyTable(rows)}</div>`;}catch(error){body.textContent=error.message;}
  }
}

function stockRows(items,M) {
  let category=null;
  return items.map(i=>{
    const heading=category!==i.category?`<tr class="inventory-category"><th colspan="${M?9:7}">${esc(i.category)}</th></tr>`:'';category=i.category;
    return heading+`<tr><td><strong>${esc(i.name)}</strong>${!i.active?' <span class="pill pill-muted">Archived</span>':''}<div class="small muted">${esc(i.location)} · ${esc(i.unit)}</div><button type="button" class="btn btn-sm btn-ghost" data-item-history="${i.id}">History · ${i.counted_at?esc(timestamp(i.counted_at)):'Not counted'}</button></td>
    <td class="num">${n(i.on_hand)}</td><td>${i.active?`<input class="inventory-quantity" aria-label="Count ${esc(i.name)} in ${esc(i.unit)}" type="number" min="0" max="1000000" step="0.001" placeholder="New count" data-count="${i.id}" data-revision="${i.revision}">`:'—'}</td>
    <td>${n(i.par)} + ${n(i.emergency)} + ${n(i.event_extra)}<div class="small muted">Target ${n(i.target)}</div></td><td>${n(i.incoming)}</td>
    <td>${esc(i.supplier_name||'No supplier')}<div class="small muted">${n(i.pack_size)} ${esc(i.unit)} / pack · ${money(i.pack_cost)}</div></td>
    <td>${i.suggested_packs?`<span class="pill pill-warn">${n(i.suggested_packs)} packs</span>`:'<span class="pill pill-good">Stock covered</span>'}<div class="small muted">${n(i.suggested_units)} ${esc(i.unit)} · ${money(i.estimated_cost)}</div></td>
    ${M?`<td>${i.active?`<input class="inventory-quantity" aria-label="Order packs of ${esc(i.name)}" type="number" min="0" max="1000000" step="1" value="${i.supplier_id?i.suggested_packs:0}" data-packs="${i.id}" ${!i.supplier_id?'disabled':''}>`:''}</td><td><button type="button" class="btn btn-sm" data-edit-item="${i.id}">Edit</button></td>`:''}</tr>`;
  }).join('')||`<tr><td colspan="${M?9:7}">${emptyState('No inventory items',M?'Add your suppliers and first item to get started.':'Ask a manager to add items before counting stock.')}</td></tr>`;
}
function itemModal(item,data,done) {
  const i=item||{name:'',category:'Produce',location:'Kitchen',unit:'kg',pack_size:1,pack_cost:0,par:0,emergency:0,event_extra:0,on_hand:0,active:1};
  modal({title:item?`Edit ${item.name}`:'Add inventory item',wide:true,body:`
    <div class="row">${field('Item name','name',i.name,'text','required maxlength="100"')}${field('Category','category',i.category,'text','required maxlength="100"')}${field('Storage location','location',i.location,'text','required maxlength="100"')}</div>
    <div class="row">${field('Stock unit (kg, L, each…)','unit',i.unit,'text','required maxlength="30"')}<label class="field"><span>Supplier</span><select name="supplier_id">${options(data.suppliers.map(s=>[s.id,s.name]),i.supplier_id,{blank:'No supplier yet'})}</select></label>${numeric('Units per supplier pack','pack_size',i.pack_size)}</div>
    <div class="row">${numeric('Cost per pack ($, before tax)','pack_cost',i.pack_cost)}${numeric('Par level','par',i.par)}${numeric('Emergency stock','emergency',i.emergency)}${numeric('Event extras','event_extra',i.event_extra)}</div>
    <p class="small muted">Enter stock, par and extras in the same unit. Example: stock unit kg, supplier case 5 kg → pack size 5. Emergency and event quantities are added to par until you change them.</p>
    ${!item?numeric('Opening stock','on_hand',0):'<p class="small muted">Use Stock & counts to change on-hand stock. Existing history is preserved.</p>'}
    ${field('Notes','notes',i.notes||'','text','maxlength="500"')}
    ${item?`<label class="check"><input type="checkbox" name="active" ${i.active?'checked':''}> Active (uncheck to archive)</label>`:''}`,
    onSubmit:async v=>{v.active=item?!!v.active:true;v.revision=i.revision;await api('/inventory/items'+(item?'/'+item.id:''),{method:item?'PUT':'POST',body:v});toast('Inventory item saved');await done();}});
}
function supplierList(data,done) {
  const m=modal({title:'Suppliers',body:`<button type="button" class="btn btn-primary" data-new>+ Add supplier</button><ul class="list">${data.suppliers.map(s=>`<li><button type="button" class="employee-hours-link" data-supplier="${s.id}"><span><strong>${esc(s.name)}</strong><br>${esc(s.contact)}<br><span class="small muted">Lead time ${s.lead_days} days</span></span><span>Edit</span></button></li>`).join('')||'<li>No suppliers yet.</li>'}</ul>`});
  const open=supplier=>{m.close();supplierModal(supplier,done);};m.form.querySelector('[data-new]').onclick=()=>open(null);m.form.querySelectorAll('[data-supplier]').forEach(b=>b.onclick=()=>open(data.suppliers.find(s=>s.id===Number(b.dataset.supplier))));
}
function supplierModal(s,done) {
  modal({title:s?'Edit supplier':'Add supplier',body:`${field('Supplier name','name',s?.name||'','text','required maxlength="100"')}${field('Contact (email or phone)','contact',s?.contact||'','text','maxlength="200"')}${numeric('Delivery lead time (days)','lead_days',s?.lead_days||0,'step="1"')}${field('Delivery / ordering notes','notes',s?.notes||'','text','maxlength="500"')}`,onSubmit:async v=>{await api('/inventory/suppliers'+(s?'/'+s.id:''),{method:s?'PUT':'POST',body:v});toast('Supplier saved');await done();}});
}
function draftModal(lines,data,done) {
  modal({title:'Review draft order',wide:true,submitLabel:'Save draft',body:`<p>Review the items below. A manager must approve the saved draft before you mark it as ordered.</p><div class="table-wrap"><table class="table"><thead><tr><th>Item</th><th>Supplier</th><th>Packs</th><th>Stock units</th><th>Estimated cost</th></tr></thead><tbody>${lines.map(line=>{const i=data.items.find(i=>i.id===line.item_id);return `<tr><td>${esc(i.name)}</td><td>${esc(i.supplier_name||'No supplier')}</td><td>${n(line.packs)}</td><td>${n(line.packs*i.pack_size)} ${esc(i.unit)}</td><td>${money(line.packs*i.pack_cost)}</td></tr>`;}).join('')}</tbody></table></div>${field('Order notes','note','','text','maxlength="500"')}`,onSubmit:async v=>{await api('/inventory/orders',{method:'POST',body:{lines,note:v.note}});toast('Draft order created — not sent');await done();}});
}
const orderCost=o=>o.lines.reduce((sum,l)=>sum+l.packs*l.pack_cost,0);
function orderModal(o,done) {
  const actions=[];
  if(o.status==='draft')actions.push(['approve','Approve order']);
  if(o.status==='approved')actions.push(['ordered','Mark as ordered']);
  if(o.status==='ordered')actions.push(['receive','Receive delivery']);
  if(['draft','approved','ordered'].includes(o.status))actions.push(['cancel','Cancel remaining order']);
  const m=modal({title:`Order #${o.id} · ${statusLabel[o.status]}`,wide:true,body:`<p>Created by ${esc(o.created_name)} · ${esc(timestamp(o.created_at))}${o.approved_name?`<br>Approved by ${esc(o.approved_name)}`:''}</p><p>${esc(o.note)}</p><div class="table-wrap"><table class="table"><thead><tr><th>Supplier / item</th><th>Packs</th><th>Ordered units</th><th>Received units</th><th>Cost</th></tr></thead><tbody>${o.lines.map(l=>`<tr><td>${esc(l.supplier_name)}<br><strong>${esc(l.item_name)}</strong></td><td>${l.packs} × ${n(l.pack_size)}</td><td>${n(l.packs*l.pack_size)} ${esc(l.unit)}</td><td>${n(l.received)} ${esc(l.unit)}</td><td>${money(l.packs*l.pack_cost)}</td></tr>`).join('')}</tbody></table></div><p><strong>Estimated total ${money(orderCost(o))}</strong> before tax and delivery.</p><button type="button" class="btn" data-order-csv>Export supplier order CSV</button><p class="small muted">Exporting does not send an order. Contact the supplier separately. Partial receipts remain open; cancelling releases only quantities not yet received.</p>`,extra:actions.map(([action,label])=>({label,className:action==='cancel'?'btn-danger':'',onClick:async()=>{
    if(action==='receive'){m.close();receiveModal(o,done);return;}
    if(!await confirmDialog(action==='approve'?'Approve this order? Its outstanding quantities will count as incoming stock.':action==='ordered'?'Have you placed this order with the supplier?': 'Cancel the remaining order? Stock already received is kept.',{confirmLabel:label,danger:action==='cancel'}))return false;
    await api(`/inventory/orders/${o.id}/action`,{method:'POST',body:{action}});toast('Order updated');await done();
  }}))});
  m.form.querySelector('[data-order-csv]').onclick=()=>downloadCsv(`bepshift-order-${o.id}.csv`,[['Supplier','Item','Packs','Units per pack','Unit','Pack cost','Line total'],...o.lines.map(l=>[l.supplier_name,l.item_name,l.packs,l.pack_size,l.unit,l.pack_cost,l.packs*l.pack_cost])]);
}
function receiveModal(o,done) {
  const receiptKey=crypto.randomUUID();
  modal({title:`Receive order #${o.id}`,wide:true,submitLabel:'Record delivery',body:`<p>Enter quantities delivered now in each item's stock unit. Leave undelivered items at zero. Partial deliveries are supported.</p>${o.lines.filter(l=>l.packs*l.pack_size-l.received>0.0001).map(l=>numeric(`${esc(l.item_name)} — ${n(l.packs*l.pack_size-l.received)} ${esc(l.unit)} remaining`,'line_'+l.id,0)).join('')}${field('Delivery notes','note','','text','maxlength="500"')}`,onSubmit:async v=>{const lines=o.lines.filter(l=>Number(v['line_'+l.id])>0).map(l=>({line_id:l.id,quantity:Number(v['line_'+l.id])}));await api(`/inventory/orders/${o.id}/receive`,{method:'POST',body:{lines,note:v.note,receipt_key:receiptKey}});toast('Delivery added to stock');await done();}});
}
function historyTable(rows) {
  return `<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Item</th><th>Action</th><th>Before → after</th><th>By</th><th>Notes</th></tr></thead><tbody>${rows.map(h=>`<tr><td>${esc(timestamp(h.created_at))}</td><td>${esc(h.item_name)}</td><td>${esc(h.kind)}${h.order_id?' #'+h.order_id:''}</td><td>${n(h.before_qty)} → ${n(h.after_qty)} ${esc(h.unit)}</td><td>${esc(h.user_name)}</td><td>${esc(h.note)}</td></tr>`).join('')||'<tr><td colspan="6">No counts or deliveries recorded yet.</td></tr>'}</tbody></table></div>`;
}
async function historyModal(item) {
  const m=modal({title:`${item.name} · Stock history`,wide:true,body:'<div data-history>Loading…</div>'});
  try{const rows=await api('/inventory/history?item='+item.id);if(m.dlg.isConnected)m.form.querySelector('[data-history]').innerHTML=historyTable(rows);}catch(e){if(m.dlg.isConnected)m.form.querySelector('[data-history]').textContent=e.message;}
}
