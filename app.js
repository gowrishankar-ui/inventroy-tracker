/* ================= Configuration ================= */
const SB = supabase.createClient('https://fbxxyputyvoxczphltlx.supabase.co', 'sb_publishable_hxvllS0csDBvxYqMkafVIw_jwcxs4ZB');
const FN_URL = 'https://fbxxyputyvoxczphltlx.supabase.co/functions/v1/admin-users';
const PUB_KEY = 'sb_publishable_hxvllS0csDBvxYqMkafVIw_jwcxs4ZB';
const STUDENT_DOMAIN = '@protosem.tech';
const ROLE = {student:'Student', engineer:'Engineer', spalead:'SPA Lead', admin:'Engineers-Admin', viewer:'Viewer (inventory only)'};
const CATS = {asset:'Asset', reusable:'Reusable', consumable:'Consumables'};
const APPROVERS = ['engineer','spalead','admin'];
const ST = {pending:['Pending','b-warn'], approved:['Approved','b-info'], collected:['Collected','b-ok'], returned:['Returned','b-info'], rejected:['Rejected','b-bad']};
const TEMPLATE = 'Component Name,Specifications,Overall Qty,Working Qty,Damaged Qty,Current Qty,Location,BoQ Type,Inventory\nArduino Uno R3,ATmega328P board,20,18,2,18,Shelf A1,Reusable,Protosem\nBME280 Sensor,I2C temp and humidity,10,10,0,10,Lab C1,Consumable,SPA\nRaspberry Pi 4,4GB,6,6,0,6,Shelf B2,Asset,Protosem\n3D Printer Nozzle,0.4 mm brass,30,30,0,30,Fab Lab D1,Consumable,Protosem\n';
const ASSET_TEMPLATE = 'Asset Name,Specifications,Overall Qty,Working Qty,Damaged Qty,Current Qty,Location\n3D Printer (Ender 3),Build volume 220x220x250,2,2,0,2,Fab Lab D1\nMeta Quest 3,128GB headset,5,5,0,5,Lab E2\n';

/* ================= State ================= */
let ME = null, P = null, CH = null;
let S = {components:[], requests:[], logs:[], imports:[], profiles:[], notes:[], approvals:[], compReq:[], recReq:[], impReq:[], assets:[], assetReq:[], settings:[]};
let ASSET_PICK = null, U_TYPE_DEFAULT = 'component';
let POLL = null, TICK = 0, DIRTY = false, LAST_SIG = '', LAST_EXTRA = '', AUTH_READY = false;
const PAGE = (document.body && document.body.dataset.page) || 'inv';
const HREF = {inv:'index.html', assets:'assets.html', req:'new-request.html', my:'requests.html', appr:'approvals.html', spa:'spa-history.html', dash:'dashboard.html', imp:'csv-import.html', log:'activity.html', acc:'accounts.html'};
let U = {tab:PAGE, q:'', ask:null, askAcc:null, preview:null, fileName:''};
// Move to another page (the other screens are separate pages now)
function goTab(k){ U.tab = k; if (HREF[k] && k !== PAGE) location.href = HREF[k]; }

/* ================= Helpers ================= */
const v = id => document.getElementById(id).value.trim();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = t => new Date(t).toLocaleString();
const badge = (t, c) => `<span class="badge ${c}">${t}</span>`;
const tbl = (h, rows) => `<div class="scroll"><table><thead><tr>${h.map(x=>`<th scope="col">${x}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
function toast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('show'),3000)}
const scopeBadge = s => s === 'spa' ? badge('SPA','b-info') : badge('Team','b-ok');
const compName = id => S.components.find(c=>c.id===id)?.name || '(removed)';
const findByName = (n, inv) => S.components.find(c=>c.name.toLowerCase()===n.toLowerCase() && c.inventory===inv);
const invTag = c => c.inventory === 'spa' ? 'SPA' : 'Protosem';
const profName = id => S.profiles.find(p=>p.id===id)?.name || 'System';
// Mirrors can_approve() in the database
const SPA_ROLES = ['engineer','spalead','admin'];
function coboardOf(loc){ return String(loc || '').replace(/[0-9].*$/, '').trim(); }
function coboardApprover(loc){
  const key = coboardOf(loc).toLowerCase();
  const cb = (S.coboards || []).find(c => c.name.toLowerCase() === key);
  return cb ? cb.approver_id : null;
}
function canDecide(r){
  if (r.status !== 'pending') return false;
  if (r.route === 'spa4'){
    const eligible = r.approver_id === ME.id || P.role === 'spalead' || P.role === 'admin';
    return r.requester_id !== ME.id && eligible
      && !(S.approvals || []).some(a => a.request_id === r.id && a.approver_id === ME.id);
  }
  if (r.approver_id) return r.approver_id === ME.id;
  return P.role === 'admin';
}
function ownerOpts(sel){ return S.profiles.filter(p => ['engineer','spalead','admin'].includes(p.role))
  .map(p => `<option value="${p.id}" ${sel === p.id ? 'selected' : ''}>${esc(p.name)} (${ROLE[p.role]})</option>`).join(''); }
function normInv(t){
  t = (t||'').toLowerCase().trim();
  if (t.startsWith('spa')) return 'spa';
  return 'protosem';
}
function normBoq(t){
  t = (t||'').toLowerCase().trim();
  if (t.startsWith('asset')) return 'asset';
  if (t.startsWith('reus') || t.startsWith('resu')) return 'reusable';
  if (t.startsWith('consum')) return 'consumable';
  return null;
}
async function logMsg(message){
  if (ME) await SB.from('activity_logs').insert({actor_id: ME.id, message});
}

/* ================= Data ================= */
function apOpts(key, roles){
  roles = roles || ['engineer','spalead'];
  return S.profiles.filter(p => p.id !== ME.id && roles.includes(p.role))
    .map(p => `<option value="${p.id}" ${U[key] === p.id ? 'selected' : ''}>${esc(p.name)} (${ROLE[p.role]})</option>`).join('');
}
// Do not redraw while someone is typing in a form; redraw as soon as they leave the field
// Take focus off the current field before an action, so the screen is redrawn with the result
function blurNow(){ const el = document.activeElement; if (el && el.blur) el.blur(); }
function isTyping(){ return ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName); }
function paint(){ if (isTyping()){ DIRTY = true; return; } DIRTY = false; render(); }
document.addEventListener('focusout', () => { if (DIRTY) setTimeout(paint, 150); });
function startPolling(){
  if (POLL) return;
  POLL = setInterval(() => { TICK++; loadData(); }, 4000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadData(true); });
}
async function run(promise, okMsg, logText){
  blurNow();
  const {error} = await promise;
  if (error) return toast(error.message);
  if (logText) await logMsg(logText);
  if (okMsg) toast(okMsg);
  await loadData(true);
}
async function loadProfile(){
  const {data} = await SB.from('profiles').select('*').eq('id', ME.id).maybeSingle();
  P = data;
  if (P?.role){
    await loadData();
    if (!CH) CH = SB.channel('live').on('postgres_changes', {event:'*', schema:'public'}, () => loadData()).subscribe();
    startPolling();
  }
  render();
}

/* ================= Sign in / up ================= */
async function signIn(){
  const {error} = await SB.auth.signInWithPassword({email: v('le').toLowerCase(), password: v('lp')});
  if (error) toast(error.message);
}
const SIGNUP_DOMAINS = ['@protosem.tech', '@forge-ic.co', '@forge-iv.co'];
async function signUp(){
  const email = v('le').toLowerCase();
  if (!SIGNUP_DOMAINS.some(d => email.endsWith(d))) return toast('Only ' + SIGNUP_DOMAINS.join(' and ') + ' email addresses can create an account.');
  const {error} = await SB.auth.signUp({email, password: v('lp'), options:{data:{name: v('ln') || email.split('@')[0]}}});
  toast(error ? error.message : 'Account created. Confirm your email, then sign in.');
}
async function signOut(){
  if (CH){ SB.removeChannel(CH); CH = null; }
  if (POLL){ clearInterval(POLL); POLL = null; }
  await SB.auth.signOut();
}
SB.auth.onAuthStateChange((_e, s) => {
  AUTH_READY = true;
  const user = s?.user || null;
  if (user && P && user.id === ME?.id){ ME = user; return; }   // same person: nothing to reload
  ME = user; P = null; LAST_SIG = ''; LAST_EXTRA = '';
  if (ME) loadProfile(); else render();
});

/* ================= Inventory and requests ================= */
function addComp(){
  const name = v('nn');
  if (!name) return toast('Name is required');
  if (!v('ninv')) return toast('Choose SPA or Protosem inventory');
  if (!coboardApprover(v('nl'))) return toast('No person is assigned to coboard "' + coboardOf(v('nl')) + '". Assign one on the Dashboard first.');
  const row = {name, specifications: v('nsp'), overall_qty: +v('no')||0, working_qty: +v('nw')||0,
    damaged_qty: +v('nd')||0, current_qty: +v('nq')||0, min_qty: +v('nm')||0, location: v('nl'), boq_type: v('nc'),
    inventory: v('ninv'), proposed_by: ME.id, proposed_by_name: P.name,
    is_high_value: !!document.getElementById('nhv')?.checked};
  run(SB.from('component_requests').insert(row), 'Sent to the coboard person for approval', `${P.name} proposed new component "${name}" for approval`);
}
function receive(){
  const id = v('rcomp'), n = +v('rn');
  if (!id || !(n > 0)) return toast('Choose a component and a quantity');
  const c = S.components.find(x=>x.id===id);
  run(SB.from('components').update({
    overall_qty: c.overall_qty + n, working_qty: c.working_qty + n, current_qty: c.current_qty + n
  }).eq('id', id), `Received ${n} unit(s)`, `Received ${n} × ${c.name}, new qty ${c.current_qty + n}`);
}
async function removeComp(id){
  U.ask = null;
  const c = S.components.find(x=>x.id===id);
  const {error} = await SB.from('components').delete().eq('id', id);
  if (error) return toast(error.code === '23503'
    ? 'This item is used in requests or the red bin, so it cannot be removed. Set its quantity to 0 instead.' : error.message);
  await logMsg(`Removed component "${c?.name}"`);
  toast('Component removed');
  await loadData();
}
async function submitReq(){
  const d = U.draft;
  const used = USED.find(([k]) => k === d.used) || USED[1];
  const lines = d.lines.filter(l => l.cid && l.qty > 0);
  if (!lines.length) return toast('Choose at least one component and a quantity');
  for (const l of lines){
    const c = S.components.find(x => x.id === l.cid);
    if (c && l.qty > c.current_qty) return toast('Only ' + c.current_qty + ' available for ' + c.name);
  }
  if (!d.title.trim()) return toast('Enter the project title');
  if (!d.purpose.trim()) return toast('Describe the purpose');
  blurNow();
  const rows = lines.map(l => ({component_id: l.cid, qty: +l.qty, purpose: d.purpose.trim(),
    scope: used[1], project_title: d.title.trim(), used_for: used[0]}));
  const {error} = await SB.from('requests').insert(rows);
  if (error) return toast(error.message);
  for (const l of lines){
    const c = S.components.find(x => x.id === l.cid);
    await logMsg(`${P.name} requested ${l.qty} x ${c?.name} (${used[0]}) for "${d.title.trim()}"`);
  }
  U.draft = blankDraft();
  goTab('my');
  toast('Request sent for approval');
  await loadData(true);
}
async function decide(id, dec){
  blurNow();
  const reason = dec === 'rejected' ? (v('rr'+id) || null) : null;
  const r = S.requests.find(x => x.id === id);
  if (r && r.scope !== 'spa') r.status = dec;                 // single-approver request: show at once
  if (r && r.scope === 'spa') S.approvals.push({request_id: id, approver_role: P.role, decision: dec});
  if (r) render();
  const {error} = await SB.rpc('decide_request', {req_id: id, decision: dec, reason});
  if (error){ toast(error.message); return loadData(true); }
  toast(dec === 'approved' ? 'Approved' : 'Rejected');
  loadData(true);
}
function collect(id){ run(SB.rpc('collect_request', {req_id: id}), 'Collected, stock updated'); }

/* ================= CSV and PDF import ================= */
function parseCSV(text){
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++){
    const ch = text[i];
    if (q){ if (ch === '"'){ if (text[i+1] === '"'){ cur += '"'; i++; } else q = false; } else cur += ch; }
    else {
      if (ch === '"') q = true;
      else if (ch === ','){ row.push(cur); cur = ''; }
      else if (ch === '\n'){ row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (ch !== '\r') cur += ch;
    }
  }
  if (cur || row.length){ row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
function buildPreview(rows){
  const h = rows[0].map(x => x.toLowerCase().replace(/[^a-z]/g, ''));
  const idx = (...ks) => { for (const k of ks){ const i = h.indexOf(k); if (i >= 0) return i; } return -1; };
  const col = {name:idx('componentname','name','assetname'), spec:idx('specifications','specification','specs'),
    overall:idx('overallqty','overall'), working:idx('workingqty','working'), damaged:idx('damagedqty','damaged'),
    current:idx('currentqty','current','qty'), location:idx('location'), category:idx('boqtype','boq','category'), min:idx('minlevel','min'), inv:idx('inventory','inventoryname')};
  if (col.name < 0) return toast('Header must include "Component Name"');
  if (col.current < 0 && col.working < 0 && col.overall < 0) return toast('Header must include a quantity column, e.g. "Current Qty"');
  U.preview = rows.slice(1).map((r, i) => {
    const g = k => col[k] >= 0 ? (r[col[k]] || '').trim() : '';
    const n = k => { const x = parseInt(g(k), 10); return isNaN(x) ? 0 : x; };
    const name = g('name');
    const working = col.working >= 0 ? n('working') : n('current');
    const current = col.current >= 0 ? n('current') : working;
    const overall = col.overall >= 0 ? n('overall') : working + n('damaged');
    const damaged = n('damaged');
    const category = U.itype === 'asset' ? 'asset' : normBoq(g('category'));
    let err = '';
    if (!name) err = 'Missing component name';
    else if (!category) err = 'Unknown BoQ type';
    else if (current < 0 || working < 0 || damaged < 0 || overall < 0) err = 'Negative quantity';
    else if (!(current > 0 || working > 0 || overall > 0 || damaged > 0)) err = 'No quantity given';
    return {line: i+2, name, spec: g('spec'), category, inv: normInv(g('inventory')), overall, working, damaged, current, min: n('min'), location: g('location'), err};
  });
  render();
}
function onCSV(input){
  const f = input.files[0]; if (!f) return;
  U.fileName = f.name;
  const isPDF = /\.pdf$/i.test(f.name);
  const reader = new FileReader();
  reader.onload = async () => {
    let text = reader.result;
    if (isPDF){ try { text = await pdfToCSV(text); } catch(e){ return toast('Could not read PDF: ' + e.message); } }
    const rows = parseCSV(text);
    if (rows.length < 2) return toast('File needs a header row and at least one item');
    buildPreview(rows);
  };
  if (isPDF) reader.readAsArrayBuffer(f); else reader.readAsText(f);
}
let PDFJS = null;
function loadPdfJs(){
  if (PDFJS) return Promise.resolve(PDFJS);
  const base = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = base + 'pdf.min.js';
    s.onload = () => { PDFJS = window.pdfjsLib; PDFJS.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js'; res(PDFJS); };
    s.onerror = () => rej(new Error('PDF reader could not be loaded'));
    document.head.appendChild(s);
  });
}
// Reads every table in the PDF and returns CSV text in the platform's column order
async function pdfToCSV(buf){
  const lib = await loadPdfJs();
  const pdf = await lib.getDocument({data: buf}).promise;
  const HEAD = ['Component Name','Specifications','Overall Qty','Working Qty','Damaged Qty','Current Qty','Location','BoQ Type'];
  const KEYS = ['componentname','specifications','overallqty','workingqty','damagedqty','currentqty','location','boqtype'];
  const out = [HEAD]; let map = null;
  for (let p = 1; p <= pdf.numPages; p++){
    const tc = await (await pdf.getPage(p)).getTextContent();
    const items = tc.items.filter(i => i.str.trim()).map(i => ({s: i.str.trim(), x: i.transform[4], y: Math.round(i.transform[5]), w: i.width || 0}));
    const lines = [];
    items.forEach(it => { const L = lines.find(l => Math.abs(l.y - it.y) <= 2); if (L) L.items.push(it); else lines.push({y: it.y, items: [it]}); });
    lines.sort((a, b) => b.y - a.y);
    for (const L of lines){
      L.items.sort((a, b) => a.x - b.x);
      const cells = []; let prevEnd = null;
      L.items.forEach(it => { const gap = prevEnd === null ? Infinity : it.x - prevEnd; if (gap < 8 && cells.length) cells[cells.length-1] += ' ' + it.s; else cells.push(it.s); prevEnd = it.x + it.w; });
      const norm = cells.map(c => c.toLowerCase().replace(/[^a-z]/g, ''));
      if (norm.includes('componentname')){ map = KEYS.map(k => norm.indexOf(k)); continue; }
      if (!map || cells.length < 2) continue;
      const row = map.map(i => i >= 0 ? (cells[i] || '') : '');
      if (!row.some(x => x)) continue;
      out.push(row);
    }
  }
  if (!map) throw new Error('no table with a "Component Name" header row was found');
  const esc2 = x => /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x;
  return out.map(r => r.map(esc2).join(',')).join('\n');
}
async function commitImport(){
  if (U.itype === 'asset') return commitAssetImport();
  const valid = U.preview.filter(p => !p.err);
  const replace = !!document.getElementById('rep')?.checked;
  const groups = new Map();
  valid.forEach(p => {
    const k = p.name.toLowerCase() + '|' + p.inv, g = groups.get(k);
    if (!g) groups.set(k, {...p});
    else { g.overall += p.overall; g.working += p.working; g.damaged += p.damaged; g.current += p.current;
      g.location = g.location || p.location; g.spec = g.spec || p.spec; g.min = g.min || p.min; }
  });
  const rows = [...groups.values()].map(p => ({name: p.name, inv: p.inv, spec: p.spec, category: p.category,
    overall: p.overall, working: p.working, damaged: p.damaged, current: p.current, min: p.min, location: p.location}));
  const byCob = new Map();
  rows.forEach(r => { const k = coboardOf(r.location); if (!byCob.has(k)) byCob.set(k, []); byCob.get(k).push(r); });
  const batches = [];
  for (const [cob, list] of byCob){
    const approver = coboardApprover(list[0].location);
    if (!approver) return toast('No person is assigned to coboard "' + (cob || '(no coboard)') + '". Assign one on the Dashboard first.');
    batches.push({cob, approver, rows: list});
  }
  if (replace && batches.length > 1) return toast('Replace current stock works with one coboard at a time.');
  blurNow();
  const skipped = U.preview.length - valid.length;
  for (const [i, b] of batches.entries()){
    const {error} = await SB.from('import_requests').insert({file_name: U.fileName + (b.cob ? ' (' + b.cob + ')' : ''),
      rows: b.rows, replace_stock: replace, skipped: i === 0 ? skipped : 0, proposed_by: ME.id, proposed_by_name: P.name,
      approver_id: b.approver});
    if (error) return toast(error.message);
  }
  U.preview = null;
  goTab('appr');
  toast('Sent ' + batches.length + ' batch(es) to the coboard people for approval');
  await loadData(true);
}

/* ================= Accounts (admin only, through the Edge Function) ================= */
async function acctCall(body){
  blurNow();
  const {data:{session}} = await SB.auth.getSession();
  const res = await fetch(FN_URL, {method:'POST',
    headers:{Authorization:'Bearer ' + session.access_token, apikey: PUB_KEY, 'Content-Type':'application/json'},
    body: JSON.stringify(body)});
  const out = await res.json().catch(() => ({error:'No response from server'}));
  if (!res.ok || out.error){ toast(out.error || 'Request failed'); return null; }
  return out;
}
async function createAccount(){
  const email = v('ae').toLowerCase(), pw = v('ap'), name = v('an'), role = v('ar');
  if (!email || pw.length < 8) return toast('Email and a password of 8+ characters are required');
  if (await acctCall({action:'create', email, password: pw, name, role})){ toast('Account created'); await loadData(); }
}
async function setRole(id, role){
  blurNow();
  const {data, error} = await SB.rpc('set_user_role', {target: id, new_role: role === 'none' ? null : role});
  if (error) return toast(error.message);
  const saved = data === 'none' ? null : data;       // the role the database stored
  const p = S.profiles.find(x => x.id === id);
  if (p) p.role = saved;
  toast('Saved: ' + (p?.email || 'account') + ' is now ' + (saved ? ROLE[saved] : 'No access'));
  render();
  loadData(true);
}
async function removeAccount(id){
  U.askAcc = null;
  if (await acctCall({action:'remove', id})){ toast('Account removed'); await loadData(); }
}

/* ================= Views ================= */
function invBody(){
  const q = (U.q || '').toLowerCase(), adm = P.role === 'admin';
  const list = S.components.filter(c => (c.name + ' ' + (c.location||'') + ' ' + (c.specifications || '')).toLowerCase().includes(q)
    && (!U.invf || (c.inventory || 'protosem') === U.invf));
  if (!list.length) return '<p class="empty">No components match.</p>';
  // One row per component, with the stock split by inventory
  const groups = new Map();
  list.forEach(c => { const k = c.name.toLowerCase(); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); });
  const rows = [...groups.values()].map(rs => {
    const sum = f => rs.reduce((a, c) => a + (c[f] || 0), 0);
    const first = rs[0];
    const split = rs.map(c => badge(invTag(c) + ' - ' + c.current_qty, c.inventory === 'spa' ? 'b-warn' : 'b-ok')).join(' ');
    const ids = '[' + rs.map(c => "'" + c.id + "'").join(',') + ']';
    const act = adm ? `<button class="btn ghost sm" onclick="receiveFocus('${first.id}')">+ Receive</button>
      <button class="btn ghost sm" onclick="askLocation(${ids})">Location</button>
      <button class="btn bad sm" onclick="ask('Remove this component from every inventory?', () => removeGroup(${ids}))">Remove</button>` : '';
    return [esc(first.name) + (first.is_high_value ? ' ' + badge('High value', 'b-warn') : ''), esc(first.specifications || '-'), sum('overall_qty'), sum('working_qty'), sum('damaged_qty'),
      `<b>${sum('current_qty')}</b>`, split, esc(rs.map(c => c.location).filter(Boolean).join(', ') || '-'),
      badge(CATS[first.boq_type], 'b-info'), act];
  });
  return tbl(['Component','Specifications','Overall','Working','Damaged','Total current','Stock by inventory','Location','BoQ Type', adm ? 'Admin' : ''], rows);
}
function vInv(){
  const adm = P.role === 'admin';
  const form = !adm ? '' : `
    <div class="card" style="margin-bottom:16px"><h2>Add component</h2><div class="form">
      <div><label for="nn">Component Name</label><input id="nn"></div>
      <div><label for="nsp">Specifications</label><input id="nsp"></div>
      <div><label for="no">Overall Qty</label><input id="no" type="number" min="0" value="0"></div>
      <div><label for="nw">Working Qty</label><input id="nw" type="number" min="0" value="0"></div>
      <div><label for="nd">Damaged Qty</label><input id="nd" type="number" min="0" value="0"></div>
      <div><label for="nq">Current Qty</label><input id="nq" type="number" min="0" value="0"></div>
      <div><label for="nm">Min level</label><input id="nm" type="number" min="0" value="0"></div>
      <div><label for="nl">Location</label><input id="nl"></div>
      <div><label for="nc">BoQ Type</label><select id="nc">${Object.entries(CATS).map(([k,x])=>`<option value="${k}">${x}</option>`).join('')}</select></div>
      <div><label for="ninv">Inventory</label><select id="ninv"><option value="">Select SPA or Protosem</option><option value="spa">SPA</option><option value="protosem">Protosem</option></select></div>
      <p class="muted" style="margin:0">The approver is the person assigned to the coboard in this location.</p>
            <div><label><input type="checkbox" id="nhv" style="width:auto"> High-value component</label></div>
      <div><button class="btn" onclick="ask('Add this component to the inventory?', () => addComp())">Add</button></div>
    </div></div>
    <div class="card" style="margin-bottom:16px"><h2>Receive stock</h2><p class="muted" style="margin:0 0 12px">Each receipt goes to the person assigned to the component's coboard.</p><div id="rlines">${recvHtml()}</div><div class="row"><button class="btn ghost sm" onclick="U.recv.push({cid:'',n:1,inv:'protosem'});recvRedraw()">+ Add another component</button> <button class="btn" onclick="ask('Send these units for approval?', () => receiveAll())">Send for approval</button></div></div>`;
  return `<div class="card" style="margin-bottom:16px"><h2>Inventory upload template</h2>
    <p class="muted" style="margin:0 0 10px">One row per component. Upload the filled file on the CSV import tab.</p>
    <a class="btn" href="data:text/csv;charset=utf-8,${encodeURIComponent(U.itype === 'asset' ? ASSET_TEMPLATE : TEMPLATE)}" download="upload-template.csv" style="text-decoration:none">Download template</a></div>${form}<div class="card">
    <div class="row" style="justify-content:space-between;margin-bottom:12px">
      <h2 style="margin:0">Inventory</h2>
      <input placeholder="Search" value="${esc(U.q)}" style="max-width:260px"
        oninput="U.q=this.value;document.getElementById('invbody').innerHTML=invBody()">
    </div>
    <div style="margin-bottom:12px"><select style="max-width:220px" onchange="U.invf=this.value;document.getElementById('invbody').innerHTML=invBody()"><option value="">All inventories</option><option value="spa" ${U.invf==='spa'?'selected':''}>SPA only</option><option value="protosem" ${U.invf==='protosem'?'selected':''}>Protosem only</option></select></div>
    <div id="invbody">${invBody()}</div></div>`;
}
const USED = [['SPA','spa'],['Protosem PoC','team'],['Protosem Activity','team'],['Self learning','team']];
const blankDraft = () => ({title:'', purpose:'', used:'Protosem PoC', search:'', lines:[{cid:'', qty:1}]});
function setLineQty(i, val){
  const l = U.draft.lines[i];
  const c = S.components.find(x => x.id === l.cid);
  let q = Math.floor(+val) || 1;
  if (c && q > c.current_qty){ toast('Only ' + c.current_qty + ' available for ' + c.name); q = c.current_qty; }
  if (q < 1) q = 1;
  l.qty = q;
  linesRedraw();
}
function linesHtml(){
  const d = U.draft;
  return d.lines.map((l, i) => {
    const c = S.components.find(x => x.id === l.cid);
    return `<div class="row" style="margin-bottom:8px">
      <div class="cb" id="cb${i}">
        <input id="cbin${i}" autocomplete="off" placeholder="Type to search components" value="${esc(c ? c.name + ' [' + invTag(c) + '] (' + c.current_qty + ' available)' : '')}"
          oninput="cbFilter(${i}, this.value)" onfocus="cbFilter(${i}, '')"
          onblur="setTimeout(() => cbClose(${i}), 150)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();cbEnter(${i})}">
        <div class="cb-panel" id="cbp${i}">${cbPanel(i, '')}</div>
      </div>
      <input type="number" min="1" max="${c ? c.current_qty : 0}" value="${l.qty}" style="flex:1" title="${c ? 'Available: ' + c.current_qty : 'Choose a component first'}" onchange="setLineQty(${i}, this.value)">
      ${d.lines.length > 1 ? `<button class="btn ghost sm" onclick="U.draft.lines.splice(${i},1);linesRedraw()">Remove</button>` : ''}
    </div>`;
  }).join('');
}
function cbMatches(q){
  q = (q || '').trim().toLowerCase();
  return S.components.filter(c => (P.role !== 'student' || c.inventory !== 'spa') && (!q || (c.name + ' ' + (c.specifications || '')).toLowerCase().includes(q)));
}
function cbPanel(i, q){
  const list = cbMatches(q);
  return list.length
    ? list.map(c => `<div class="cb-opt" onmousedown="event.preventDefault();cbPick(${i}, '${c.id}')">${esc(c.name)} <span class="muted">· ${invTag(c)} · ${c.current_qty} available</span></div>`).join('')
    : '<div class="cb-empty">No component matches</div>';
}
function cbFilter(i, q){
  const p = document.getElementById('cbp' + i);
  if (p) p.innerHTML = cbPanel(i, q);
  document.getElementById('cb' + i)?.classList.add('open');
}
function cbPick(i, id){
  const c = S.components.find(x => x.id === id);
  U.draft.lines[i].cid = id;
  const input = document.getElementById('cbin' + i);
  if (input) input.value = c ? c.name + ' [' + invTag(c) + '] (' + c.current_qty + ' available)' : '';
  document.getElementById('cb' + i)?.classList.remove('open');
}
function cbEnter(i){
  const first = cbMatches(document.getElementById('cbin' + i).value)[0];
  if (first) cbPick(i, first.id);
}
function cbClose(i){
  const l = U.draft.lines[i];
  const c = l && S.components.find(x => x.id === l.cid);
  const input = document.getElementById('cbin' + i);
  if (input) input.value = c ? c.name + ' [' + invTag(c) + '] (' + c.current_qty + ' available)' : '';
  document.getElementById('cb' + i)?.classList.remove('open');
}
function setLineComp(i, name){
  const c = S.components.find(x => x.name.toLowerCase() === name.trim().toLowerCase());
  if (!c){ toast('Pick a component from the suggestions'); return linesRedraw(); }
  U.draft.lines[i].cid = c.id;
  linesRedraw();
}
function linesRedraw(){ const el = document.getElementById('lines'); if (el) el.innerHTML = linesHtml(); }
function vReq(){
  U.draft = U.draft || blankDraft();
  const d = U.draft;
  const hint = P.role === 'student'
    ? 'Your requests go to the person assigned to the component\'s coboard. Students cannot request SPA items.'
    : 'Requests go to the person assigned to the component\'s coboard. SPA team requests need the coboard person, the SPA Lead and the Engineers-Admin.';
  return `<div class="card" style="max-width:720px"><h2>Request a component</h2>
    <p class="muted" style="margin-top:-8px">${hint}</p>
    <div class="grid">
      <div><label>Used for</label><select onchange="U.draft.used=this.value">${USED.map(([k]) => `<option ${d.used===k?'selected':''}>${k}</option>`).join('')}</select></div>
      <div><label>Project title</label><input value="${esc(d.title)}" onchange="U.draft.title=this.value"></div>
      <div><label>Components and quantity</label><div id="lines">${linesHtml()}</div>
        <button class="btn ghost sm" onclick="U.draft.lines.push({cid:'',qty:1});linesRedraw()">+ Add another component</button></div>
      <div><label>Purpose</label><textarea rows="3" onchange="U.draft.purpose=this.value">${esc(d.purpose)}</textarea></div>
      <div><button class="btn" onclick="submitReq()">Submit request</button></div>
    </div></div>`;
}
function actionCell(r, adm){
  const own = r.requester_id === ME.id;
  if (r.status === 'approved' && (adm || own))
    return `<button class="btn ok sm" onclick="ask('Mark this item as collected?', () => collect('${r.id}'))">Mark collected</button>`;
  if (r.status === 'collected'){
    let out = '';
    if (own || adm) out += `<button class="btn sm" onclick="askReturn('${r.id}', ${r.qty})">Return to inventory</button> `;
    if (adm) out += `<button class="btn ghost sm" onclick="ask('Send a return reminder to this person?', () => remind('${r.id}'))">Send return reminder</button>`;
    if (r.reminded_at) out += ` <span class="muted">Reminded ${fmt(r.reminded_at)}</span>`;
    return out;
  }
  if (r.status === 'returned') return `<span class="muted">Returned ${r.returned_at ? fmt(r.returned_at) : ''}</span>`;
  return '';
}
function vMy(){
  const adm = P.role === 'admin';
  const list = S.requests.filter(r => adm || r.requester_id === ME.id);
  if (!list.length) return '<div class="card"><p class="empty">No requests yet.</p></div>';
  return `<div class="card"><h2>${adm ? 'All requests' : 'My requests'}</h2>${tbl(
    ['Item','Qty','Purpose','Used for','Requested by','Submitted','Status','Action'],
    list.map(r => [esc(compName(r.component_id)), r.qty, (r.project_title ? '<b>' + esc(r.project_title) + '</b> · ' : '') + (r.used_for ? esc(r.used_for) + ' · ' : '') + esc(r.purpose), scopeBadge(r.scope),
      esc(r.requester_name), fmt(r.created_at), badge(ST[r.status][0], ST[r.status][1])
        + (r.scope === 'spa' && r.status === 'pending' ? '<br><span class="muted" style="font-size:12px">' + spaProgress(r).replace(/<br>/g, ' · ') + '</span>' : ''),
      actionCell(r, adm)]))}</div>`;
}
function vApprBase(){
  const list = S.requests.filter(canDecide);
  if (!list.length) return '<div class="card"><p class="empty">No requests waiting for your approval.</p></div>';
  return `<div class="card"><h2>Pending approvals</h2>${tbl(
    ['Requester','Role','Item','Qty','Purpose','Used for','Submitted','Decision'],
    list.map(r => [esc(r.requester_name), ROLE[r.requester_role] || '', esc(compName(r.component_id))
        + (r.scope === 'spa' ? '<br><span class="muted" style="font-size:12px">' + spaProgress(r).replace(/<br>/g, ' · ') + '</span>' : ''), r.qty,
      (r.project_title ? '<b>' + esc(r.project_title) + '</b> · ' : '') + (r.used_for ? esc(r.used_for) + ' · ' : '') + esc(r.purpose), scopeBadge(r.scope), fmt(r.created_at),
      `<button class="btn ok sm" onclick="ask('Approve this request?', () => decide('${r.id}','approved'))">Approve</button>
       <input id="rr${r.id}" placeholder="Reason (optional)" style="max-width:160px;display:inline-block;padding:4px 8px">
       <button class="btn bad sm" onclick="ask('Reject this request?', () => decide('${r.id}','rejected'))">Reject</button>`])
  )}</div>`;
}
function histCard(){
  const h = S.history || [];
  if (!h.length) return '';
  return `<div class="card" style="margin-top:16px"><h2>Approval history</h2>${tbl(
    ['Date and time','Item','Qty','Requested by','Decided by','Role','Decision','Reason'],
    h.slice(0, 200).map(x => [fmt(x.decided_at), esc(x.item), x.qty, esc(x.requester_name), esc(x.approver_name),
      ROLE[x.approver_role] || '-', badge(x.decision === 'approved' ? 'Approved' : 'Rejected', x.decision === 'approved' ? 'b-ok' : 'b-bad'),
      esc(x.reason || '-')]))}</div>`;
}
function hvCard(){
  const cut = Date.now() - 3 * 24 * 3600 * 1000;
  const late = S.requests.filter(r => r.status === 'collected' && (S.components.find(c => c.id === r.component_id) || {}).is_high_value
    && new Date(r.collected_at).getTime() < cut);
  return `<div class="card" style="margin-top:16px"><h2>High-value items in use for 3+ days</h2>${late.length
    ? tbl(['Component','Qty','Taken by','Taken on'], late.map(r => {
        const c = S.components.find(x => x.id === r.component_id) || {};
        return [esc(c.name || '-'), r.qty, esc(r.requester_name), fmt(r.collected_at)];
      }))
    : '<p class="empty">None right now.</p>'}</div>`;
}
function assetsOwner(){ const x = (S.settings || []).find(z => z.key === 'assets_owner'); return x ? x.value : null; }
function assetOwnerCard(){
  const cur = assetsOwner();
  return `<div class="card" style="margin-bottom:16px"><h2>Assets owner</h2>
    <p class="muted" style="margin:0 0 10px">Every asset request and asset upload is approved by this person.</p>
    <div class="row"><select id="aown" aria-label="Assets owner" style="max-width:340px"><option value="">Select owner</option>${ownerOpts(cur)}</select>
      <button class="btn" onclick="setAssetsOwner()">Save</button></div></div>`;
}
async function setAssetsOwner(){
  const id = v('aown');
  if (!id) return toast('Choose the owner');
  blurNow();
  const {error} = await SB.from('settings').upsert({key: 'assets_owner', value: id});
  if (error) return toast(error.message);
  await logMsg(`${P.name} set ${profName(id)} as the Assets owner`);
  toast('Saved');
  await loadData(true);
}
function vAssets(){
  const isAdm = P.role === 'admin';
  const ownerId = assetsOwner();
  const rows = (S.assets || []).slice().sort((a, b) => a.name.localeCompare(b.name)).map(a => {
    const inUse = (S.assetReq || []).filter(r => r.asset_id === a.id && r.status === 'collected').reduce((x, r) => x + r.qty, 0);
    const action = a.current_qty > 0 ? `<button class="btn sm" onclick="askAssetReq('${a.id}')">Request</button>` : '<span class="muted">none free</span>';
    return [esc(a.name), esc(a.specifications || '-'), a.overall_qty, a.working_qty, a.damaged_qty, `<b>${a.current_qty}</b>`,
      esc(a.location || '-'), inUse, action];
  });
  const mine = (S.assetReq || []).filter(r => isAdm || r.requester_id === ME.id);
  const reqRows = mine.map(r => {
    const a = (S.assets || []).find(x => x.id === r.asset_id) || {};
    const own = r.requester_id === ME.id;
    let act = '';
    if (r.status === 'approved' && (own || isAdm)) act = `<button class="btn ok sm" onclick="ask('Mark this asset as collected?', () => collectAsset('${r.id}'))">Mark collected</button>`;
    if (r.status === 'collected' && (own || isAdm)) act = `<button class="btn sm" onclick="ask('Return this asset to stock?', () => returnAsset('${r.id}'))">Return</button>`;
    return [esc(a.name || '-'), r.qty, esc(r.purpose), esc(r.project_title || '-'), esc(r.requester_name), ST[r.status] ? badge(ST[r.status][0], ST[r.status][1]) : r.status, act || '-'];
  });
  return (P.role === 'admin' ? assetOwnerCard() : '') + `<div class="card" style="margin-bottom:16px">
      <div class="row" style="justify-content:space-between"><h2 style="margin:0">Assets</h2>
        <a class="btn ghost sm" href="data:text/csv;charset=utf-8,${encodeURIComponent(ASSET_TEMPLATE)}" download="asset-template.csv" style="text-decoration:none">Download asset template</a></div>
      <p class="muted" style="margin:8px 0 12px">Owner: ${ownerId ? esc(profName(ownerId)) : 'not set yet'}. Uploads and requests are approved by the owner.</p>
      ${rows.length ? tbl(['Asset','Specifications','Overall','Working','Damaged','Current','Location','In use','Request'], rows)
        : '<p class="empty">No assets yet. Upload them on the CSV import tab with Type = Assets.</p>'}
    </div>
    <div class="card"><h2>${isAdm ? 'All asset requests' : 'My asset requests'}</h2>${reqRows.length
      ? tbl(['Asset','Qty','Purpose','Project','Requested by','Status','Action'], reqRows)
      : '<p class="empty">No asset requests yet.</p>'}</div>`;
}
function askAssetReq(id){
  ASSET_PICK = id;
  const a = (S.assets || []).find(x => x.id === id) || {};
  openDialog(`<h2>Request ${esc(a.name || 'asset')}</h2>
    <p class="muted" style="margin:0 0 12px">Available now: ${a.current_qty}</p>
    <div style="margin-bottom:10px"><label for="art">Project title</label><input id="art"></div>
    <div style="margin-bottom:10px"><label for="arq">Quantity</label><input id="arq" type="number" min="1" max="${a.current_qty}" value="1"></div>
    <div style="margin-bottom:12px"><label for="arp">Purpose</label><textarea id="arp" rows="2"></textarea></div>
    <div class="row" style="justify-content:flex-end">
      <button class="btn ghost" onclick="closeConfirm()">Cancel</button>
      <button class="btn" onclick="submitAssetReq()">Send for approval</button>
    </div>`);
}
async function submitAssetReq(){
  const id = ASSET_PICK, a = (S.assets || []).find(x => x.id === id) || {};
  const q = parseInt(v('arq'), 10), purpose = v('arp'), title = v('art');
  if (!(q > 0)) return toast('Quantity must be at least 1');
  if (q > a.current_qty) return toast('Only ' + a.current_qty + ' available');
  if (!purpose) return toast('Describe the purpose');
  closeConfirm();
  blurNow();
  const {error} = await SB.from('asset_requests').insert({asset_id: id, qty: q, purpose, project_title: title});
  if (error) return toast(error.message);
  await logMsg(`${P.name} requested ${q} x ${a.name} (asset)`);
  toast('Sent to the Assets owner for approval');
  await loadData(true);
}
function collectAsset(id){ run(SB.rpc('collect_asset', {req: id}), 'Collected'); }
function returnAsset(id){ run(SB.rpc('return_asset', {req: id}), 'Returned to stock'); }
function decideAsset(id, dec){
  const why = dec === 'rejected' ? (v('arr' + id) || null) : null;
  blurNow();
  run(SB.rpc('decide_asset_request', {req: id, decision: dec, why}), dec === 'approved' ? 'Approved' : 'Rejected');
}
function assetCard(){
  const mine = (S.assetReq || []).filter(r => r.approver_id === ME.id && r.status === 'pending');
  if (!mine.length) return '';
  return `<div class="card" style="margin-bottom:16px"><h2>Asset requests waiting for your approval</h2>${tbl(
    ['Asset','Qty','Purpose','Project','Requested by','Submitted','Decision'],
    mine.map(r => {
      const a = (S.assets || []).find(x => x.id === r.asset_id) || {};
      return [esc(a.name || '-'), r.qty, esc(r.purpose), esc(r.project_title || '-'), esc(r.requester_name), fmt(r.created_at),
        `<button class="btn ok sm" onclick="decideAsset('${r.id}','approved')">Approve</button>
         <input id="arr${r.id}" placeholder="Reason (optional)" style="max-width:150px;display:inline-block;padding:4px 8px">
         <button class="btn bad sm" onclick="decideAsset('${r.id}','rejected')">Reject</button>`];
    }))}</div>`;
}
async function commitAssetImport(){
  const valid = U.preview.filter(p => !p.err);
  if (!valid.length) return toast('No valid rows to send');
  const ownerId = assetsOwner();
  if (!ownerId) return toast('Set the Assets owner on the Assets page first');
  const merged = new Map();
  valid.forEach(p => {
    const k = p.name.toLowerCase(), g = merged.get(k);
    if (!g) merged.set(k, {...p});
    else { g.overall += p.overall; g.working += p.working; g.damaged += p.damaged; g.current += p.current;
      g.location = g.location || p.location; g.spec = g.spec || p.spec; }
  });
  const rows = [...merged.values()].map(p => ({name: p.name, spec: p.spec, overall: p.overall, working: p.working,
    damaged: p.damaged, current: p.current, location: p.location}));
  blurNow();
  const {error} = await SB.from('import_requests').insert({file_name: U.fileName, rows, replace_stock: false,
    skipped: U.preview.length - valid.length, kind: 'asset', proposed_by: ME.id, proposed_by_name: P.name, approver_id: ownerId});
  if (error) return toast(error.message);
  U.preview = null;
  goTab('appr');
  toast('Asset list sent to the Assets owner for approval');
  await loadData(true);
}
function coboardCard(){
  const names = [...new Set([...(S.components || []).map(c => coboardOf(c.location)), ...(S.coboards || []).map(c => c.name)])]
    .filter(Boolean).sort();
  const staff = S.profiles.filter(p => ['engineer','spalead','admin'].includes(p.role));
  const opts = (sel) => `<option value="">Not assigned</option>` + staff.map(p => `<option value="${p.id}" ${sel === p.id ? 'selected' : ''}>${esc(p.name)} (${ROLE[p.role]})</option>`).join('');
  const rows = names.map(n => {
    const cur = (S.coboards || []).find(c => c.name === n);
    return [esc(n), `<select aria-label="Assigned person for ${esc(n)}">${opts(cur ? cur.approver_id : null)}</select> <button class="btn sm" data-name="${esc(n)}" onclick="saveCoboard(this)">Save</button>`];
  });
  return `<div class="card" style="margin-bottom:16px"><h2>Coboard approvers</h2>
    <p class="muted" style="margin:0 0 10px">Requests, new components, stock receipts and imports for a location go to the person assigned to its coboard. The coboard is the name before the first number in the location (for example, "A1#1" belongs to coboard A, "G1#3" to coboard G).</p>
    ${rows.length ? tbl(['Coboard','Assigned person'], rows) : '<p class="empty">No coboards yet. Add a location to a component first.</p>'}
    <div class="row" style="margin-top:12px"><input id="newcob" aria-label="New coboard name" placeholder="New coboard name, e.g. Coboard D" style="max-width:240px">
      <select id="newcobsel" aria-label="Assigned person for the new coboard" style="max-width:300px">${opts(null)}</select>
      <button class="btn" onclick="addCoboard()">Save coboard</button></div></div>`;
}
async function saveCoboard(btn){
  const name = btn.dataset.name, sel = btn.parentElement.querySelector('select').value;
  blurNow();
  const {error} = await SB.from('coboards').upsert({name, approver_id: sel || null});
  if (error) return toast(error.message);
  await logMsg(`${P.name} assigned ${sel ? profName(sel) : 'nobody'} to ${name}`);
  toast('Saved');
  await loadData(true);
}
async function addCoboard(){
  const name = (document.getElementById('newcob')?.value || '').trim();
  if (!name) return toast('Enter the coboard name');
  const sel = document.getElementById('newcobsel')?.value || null;
  blurNow();
  const {error} = await SB.from('coboards').upsert({name, approver_id: sel});
  if (error) return toast(error.message);
  await logMsg(`${P.name} saved coboard ${name}`);
  toast('Saved');
  await loadData(true);
}
function vDashBase(){
  const done = S.requests.filter(r => r.status === 'collected');
  const grp = f => { const g = done.filter(f); return [g.length, g.reduce((a,r)=>a+r.qty,0)]; };
  const util = [
    ['Students', ...grp(r => r.scope !== 'spa' && r.requester_role === 'student')],
    ['Team',     ...grp(r => r.scope !== 'spa' && r.requester_role !== 'student')],
    ['SPA',      ...grp(r => r.scope === 'spa')]
  ];
  const low = S.components.filter(c => c.current_qty <= c.min_qty);
  const units = S.components.reduce((a,c) => a + c.current_qty, 0);
  const pending = S.requests.filter(r => r.status === 'pending').length;
  return `<div class="grid stats" style="margin-bottom:16px">
      <div class="card stat"><span>Components</span><b>${S.components.length}</b></div>
      <div class="card stat"><span>Units in stock</span><b>${units}</b></div>
      <div class="card stat"><span>Low stock</span><b>${low.length}</b></div>
      <div class="card stat"><span>Pending approvals</span><b>${pending}</b></div>
    </div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">
      <div class="card"><h2>Low stock alerts</h2>${low.length
        ? tbl(['Item','Current','Min'], low.map(c => [esc(c.name), badge(c.current_qty, 'b-bad'), c.min_qty]))
        : '<p class="empty">All items are above minimum.</p>'}</div>
      <div class="card"><h2>Recent CSV imports</h2>${S.imports.length
        ? tbl(['When','By','New','Restocked'], S.imports.slice(0,6).map(i => [fmt(i.created_at), esc(profName(i.imported_by)), i.added, i.restocked]))
        : '<p class="empty">No imports yet.</p>'}</div>
      <div class="card"><h2>Utilisation (collected)</h2>${tbl(['Group','Requests collected','Units collected'], util)}</div>
    </div>`;
}
function vImp(){
  const p = U.preview; let preview = '';
  if (p){
    const valid = p.filter(x => !x.err).length;
    preview = `<div style="margin-top:18px"><h2>Preview (${p.length} rows)</h2>${tbl(
      ['Line','Item','Specifications','BoQ Type','Overall','Working','Damaged','Current','Action','Issue'],
      p.map(x => [x.line, esc(x.name), esc(x.spec), x.category ? badge(CATS[x.category], 'b-info') : '-',
        x.overall, x.working, x.damaged, x.current,
        x.err ? badge('Error', 'b-bad') : (findByName(x.name, x.inv) ? badge('Restock +' + x.current, 'b-warn') : badge('New item', 'b-ok')),
        esc(x.err)]))}
      <label style="display:flex;gap:8px;align-items:center;margin-top:12px;font-weight:600;color:var(--ink)">
        <input type="checkbox" id="rep" style="width:auto" onchange="U.irep=this.checked" ${U.irep ? 'checked' : ''}> Replace current stock with this file (first full load of your sheet)</label>
      <p class="muted" style="margin:12px 0 0">Each coboard's rows go to the person assigned to that coboard.</p>
      <div class="row" style="margin-top:14px">
        <button class="btn" ${valid ? '' : 'disabled'} onclick="ask('Send this import for approval?', () => commitImport())">Send ${valid} row${valid===1?'':'s'} for approval</button>
        <button class="btn ghost" onclick="U.preview=null;render()">Cancel</button>
      </div></div>`;
  }
  return `<div class="card" style="max-width:900px"><h2>Import purchased components (CSV or PDF)</h2>
    <p class="muted">Columns: <b>Component Name, Specifications, Overall Qty, Working Qty, Damaged Qty, Current Qty, Location, BoQ Type, Inventory</b>. BoQ Type is Asset, Reusable or Consumables. Rows matching an existing component name add to its quantities; other rows create new items.</p>
    <p><a href="data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}" download="inventory-template.csv" style="color:var(--brand)">Download template</a></p>
    <div style="margin-bottom:12px"><label for="itype">What are you uploading?</label><select id="itype" onchange="U.itype=this.value;U.preview=null;render()"><option value="component" ${U.itype === 'asset' ? '' : 'selected'}>Components</option><option value="asset" ${U.itype === 'asset' ? 'selected' : ''}>Assets</option></select></div>
    <input type="file" accept=".csv,.pdf,text/csv,application/pdf" onchange="onCSV(this)">${preview}</div>`;
}
function vLog(){
  return `<div class="card"><h2>Activity</h2>${tbl(['Time','By','Event'],
    S.logs.slice(0,300).map(l => [fmt(l.created_at), esc(profName(l.actor_id)), esc(l.message)]))}</div>`;
}
async function resetPassword(){
  const id = v('rpuser'), pw = v('rppw');
  if (!id || pw.length < 8) return toast('Choose an account and a password of 8+ characters');
  if (await acctCall({action:'set_password', id, password: pw})){
    toast('Password set. Give it to the person.');
    document.getElementById('rppw').value = '';
  }
}
function vAcc(){
  const opts = sel => [['none','No access'], ...Object.entries(ROLE)]
    .map(([k,l]) => `<option value="${k}" ${(sel || 'none') === k ? 'selected' : ''}>${l}</option>`).join('');
  const rows = S.profiles.map(p => [
    esc(p.email), esc(p.name),
    p.id === ME.id ? '<span class="muted">you</span>'
      : `<select id="role-${p.id}" aria-label="Role for ${esc(p.email)}">${opts(p.role)}</select> <button class="btn ghost sm" onclick="ask('Change this person access?', () => setRole('${p.id}', document.getElementById('role-${p.id}').value))">Save role</button>`,
    p.id === ME.id ? '' : (U.askAcc === p.id
      ? `<button class="btn bad sm" onclick="ask('Remove this account?', () => removeAccount('${p.id}'))">Confirm remove</button> <button class="btn ghost sm" onclick="U.askAcc=null;render()">Cancel</button>`
      : `<button class="btn ghost sm" onclick="ask('Remove this account?', () => removeAccount('${p.id}'))">Remove</button>`)
  ]);
  return `<div class="card" style="margin-bottom:16px"><h2>Add account</h2>
      <div class="form">
        <div><label for="ae">Email</label><input id="ae" type="email"></div>
        <div><label for="an">Name</label><input id="an"></div>
        <div><label for="ar">Role</label><select id="ar">${opts('student')}</select></div>
        <div><label for="ap">Temporary password (8+ characters)</label><input id="ap" type="password"></div>
        <div><button class="btn" onclick="ask('Create this account?', () => createAccount())">Create account</button></div>
      </div>
      <p class="muted" style="margin:10px 0 0">Give the person their password. Choose "No access" to block someone without deleting their history.</p>
    </div>
    <div class="card" style="margin-bottom:16px"><h2>Reset a password</h2>
      <div class="form">
        <div><label for="rpuser">Account</label><select id="rpuser">${S.profiles.filter(p => p.id !== ME.id).map(p => `<option value="${p.id}">${esc(p.email)}</option>`).join('')}</select></div>
        <div><label for="rppw">New password (8+ characters)</label><input id="rppw" type="password"></div>
        <div><button class="btn" onclick="ask('Set this new password for the account?', () => resetPassword())">Set password</button></div>
      </div>
    </div>
    <div class="card"><h2>Accounts</h2>${tbl(['Email','Name','Role','Remove'], rows)}</div>`;
}
function returnItem(id){ run(SB.rpc('return_request', {req_id: id}), 'Returned to inventory'); }
function remind(id){ run(SB.rpc('remind_return', {req_id: id}), 'Reminder sent'); }
function unreadCount(){ return (S.notes || []).filter(n => !n.is_read).length; }
async function markAllRead(){
  await SB.from('notifications').update({is_read: true}).eq('is_read', false);
  loadData(true);
}
function vNotes(){
  const list = S.notes || [];
  return `<div class="card" style="margin-bottom:16px"><div class="row" style="justify-content:space-between">
      <h2 style="margin:0">Notifications</h2>
      <button class="btn ghost sm" onclick="ask('Mark all notifications as read?', () => markAllRead())">Mark all read</button></div>
    ${list.length ? '<ul style="margin:12px 0 0;padding-left:18px">' + list.map(n =>
      `<li style="margin-bottom:6px;${n.is_read ? 'color:var(--muted)' : 'font-weight:600'}">${esc(n.message)} <span class="muted">· ${fmt(n.created_at)}</span></li>`
    ).join('') + '</ul>' : '<p class="empty">No notifications.</p>'}
  </div>`;
}
function spaProgress(r){
  const list = (S.approvals || []).filter(a => a.request_id === r.id);
  return [['coboard','Coboard person'],['spalead','SPA Lead'],['admin','Engineers-Admin']].map(([k, l]) => {
    const a = list.find(x => x.slot === k);
    if (!a) return `<span class="muted">${l} —</span>`;
    return a.decision === 'approved' ? `${l} ✓` : `${l} ✗`;
  }).join('<br>');
}
function vSpa(){
  const list = S.requests.filter(r => r.scope === 'spa');
  if (!list.length) return '<div class="card"><p class="empty">No SPA requests yet.</p></div>';
  return `<div class="card"><h2>SPA history</h2>${tbl(
    ['Item','Qty','Purpose','Requested by','Submitted','Status','Approvals','Collected','Returned'],
    list.map(r => [esc(compName(r.component_id)), r.qty, esc(r.purpose), esc(r.requester_name), fmt(r.created_at),
      badge(ST[r.status][0], ST[r.status][1]), spaProgress(r),
      r.collected_at ? fmt(r.collected_at) : '-', r.returned_at ? fmt(r.returned_at) : '-']))}</div>`;
}

/* ===== Confirmation pop-up for every button ===== */
let CONF = null;
function ask(msg, fn){ CONF = {msg, fn}; renderConfirm(); }
function renderConfirm(){
  let el = document.getElementById('confirm');
  if (!el){ el = document.createElement('div'); el.id = 'confirm'; document.body.appendChild(el); }
  el.innerHTML = CONF ? `<div role="dialog" aria-modal="true" aria-label="Please confirm" style="position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:50">
    <div class="card" style="max-width:380px;width:90%">
      <h2>Please confirm</h2>
      <p style="margin:0 0 16px">${esc(CONF.msg)}</p>
      <div class="row" style="justify-content:flex-end">
        <button class="btn ghost" onclick="closeConfirm()">Cancel</button>
        <button class="btn" onclick="runConfirm()">Confirm</button>
      </div></div></div>` : '';
}
function closeConfirm(){ CONF = null; renderConfirm(); }
function runConfirm(){ const fn = CONF && CONF.fn; CONF = null; renderConfirm(); if (fn) fn(); }

/* ===== Return with damaged units ===== */
function askReturn(id, qty){
  const el = document.getElementById('confirm') || (() => { const d = document.createElement('div'); d.id = 'confirm'; document.body.appendChild(d); return d; })();
  CONF = null;
  el.innerHTML = `<div style="position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:50">
    <div class="card" style="max-width:400px;width:90%">
      <h2>Return to inventory</h2>
      <p style="margin:0 0 12px">${qty} unit(s) are being returned. How many are damaged? Damaged units go to the red bin.</p>
      <div style="margin-bottom:12px"><label for="dmg">Damaged quantity (0 to ${qty})</label><input id="dmg" type="number" min="0" max="${qty}" value="0"></div>
      <div style="margin-bottom:12px"><label for="dnote">What happened (optional)</label><input id="dnote" placeholder="e.g. burnt during testing"></div>
      <div class="row" style="justify-content:flex-end">
        <button class="btn ghost" onclick="closeConfirm()">Cancel</button>
        <button class="btn" onclick="confirmReturn('${id}', ${qty})">Confirm return</button>
      </div></div></div>`;
}
function confirmReturn(id, qty){
  const d = parseInt(document.getElementById('dmg').value, 10) || 0;
  if (d < 0 || d > qty) return toast('Damaged quantity must be between 0 and ' + qty);
  const note = (document.getElementById('dnote').value || '').trim() || null;
  closeConfirm();
  run(SB.rpc('return_request', {req_id: id, damaged: d, note}),
      d ? `Returned. ${d} damaged unit(s) sent to the red bin` : 'Returned to inventory');
}
/* ===== Red bin (admin dashboard) ===== */
function redBinCard(){
  const list = S.damage || [];
  const total = list.reduce((a, x) => a + x.qty, 0);
  return `<div class="card" style="margin-top:16px"><h2>Red bin: damaged components</h2>
    <p class="muted" style="margin-top:-8px">Total damaged units reported: <b>${total}</b></p>
    ${list.length ? tbl(['Reported','Component','Damaged qty','Damaged by','Project','Purpose','Reported by','Note'],
      list.map(d => [fmt(d.created_at), esc(compName(d.component_id)), d.qty, esc(d.damaged_by_name),
        esc(d.project_title || '-'), esc(d.purpose || '-'), esc(profName(d.reported_by)), esc(d.note || '-')]))
      : '<p class="empty">Nothing in the red bin.</p>'}</div>`;
}

/* ===== Receive stock: several components at once ===== */
function recvHtml(){
  U.recv = U.recv || [{cid:'', n:1, inv:'protosem'}];
  const r = U.recv;
  // Every component name is listed, whichever inventory it is in
  const names = [...new Map(S.components.map(c => [c.name.toLowerCase(), c])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));
  return r.map((l, i) => {
    const cur = S.components.find(x => x.id === l.cid);
    const curKey = cur ? cur.name.toLowerCase() : '';
    return `<div class="row" style="margin-bottom:8px">
      <select style="flex:1" onchange="U.recv[${i}].inv=this.value;recvRedraw()">
        <option value="protosem" ${l.inv==='protosem'?'selected':''}>Protosem</option>
        <option value="spa" ${l.inv==='spa'?'selected':''}>SPA</option>
      </select>
      <select style="flex:2" onchange="U.recv[${i}].cid=this.value">
        <option value="">Select a component</option>
        ${names.map(c => `<option value="${c.id}" ${curKey===c.name.toLowerCase()?'selected':''}>${esc(c.name)}</option>`).join('')}
      </select>
      <input type="number" min="1" value="${l.n}" style="flex:1" onchange="U.recv[${i}].n=+this.value">
      ${r.length > 1 ? `<button class="btn ghost sm" onclick="U.recv.splice(${i},1);recvRedraw()">Remove</button>` : ''}
    </div>`;
  }).join('');
}
function recvRedraw(){ const el = document.getElementById('rlines'); if (el) el.innerHTML = recvHtml(); }
async function receiveAll(){
  const lines = (U.recv || []).filter(l => l.cid && l.n > 0);
  if (!lines.length) return toast('Choose a component and the units received');
  const totals = new Map();
  for (const l of lines){
    const rep = S.components.find(x => x.id === l.cid);
    if (!rep) continue;
    const key = rep.name.toLowerCase() + '|' + l.inv;
    const t = totals.get(key) || {rep, inv: l.inv, n: 0};
    t.n += (+l.n);
    totals.set(key, t);
  }
  blurNow();
  for (const t of totals.values()){
    const row = S.components.find(x => x.name.toLowerCase() === t.rep.name.toLowerCase() && x.inventory === t.inv);
    if (!coboardApprover(t.rep.location)){ toast('No person is assigned to coboard "' + coboardOf(t.rep.location) + '"'); continue; }
    let res;
    if (row){
      res = await SB.from('receive_requests').insert({component_id: row.id, qty: t.n, proposed_by: ME.id, proposed_by_name: P.name});
    } else {
      res = await SB.from('component_requests').insert({name: t.rep.name, specifications: t.rep.specifications || '',
        location: t.rep.location || '', boq_type: t.rep.boq_type, min_qty: t.rep.min_qty || 0, inventory: t.inv,
        overall_qty: t.n, working_qty: t.n, current_qty: t.n, damaged_qty: 0, proposed_by: ME.id, proposed_by_name: P.name,
        is_high_value: !!t.rep.is_high_value});
    }
    if (res.error) toast(res.error.message);
  }
  U.recv = [{cid:'', n:1, inv:'protosem'}];
  toast('Sent to the coboard person for approval');
  await loadData(true);
}
function receiveFocus(id){
  const c = S.components.find(x => x.id === id);
  U.recv = [{cid:id, n:1, inv: c ? c.inventory : 'protosem'}];
  recvRedraw();
  document.getElementById('rlines')?.scrollIntoView({behavior:'smooth', block:'center'});
}
async function removeGroup(ids){
  U.ask = null;
  let failed = 0;
  const names = [];
  for (const id of ids){
    const c = S.components.find(x => x.id === id);
    const {error} = await SB.from('components').delete().eq('id', id);
    if (error) failed++; else if (c) names.push(c.name + ' (' + invTag(c) + ')');
  }
  if (names.length) await logMsg('Removed component ' + names.join(', '));
  toast(failed ? 'Some inventories have requests, so they could not be removed' : 'Component removed');
  await loadData(true);
}

/* ===== Admin password check, clear all inventory, and change location ===== */
let PW_FN = null, LOC_IDS = [];
function focusFirst(el){ setTimeout(() => { const f = el && el.querySelector('input,select,textarea,button'); if (f) f.focus(); }, 60); }
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('confirm')?.innerHTML) closeConfirm(); });
function openDialog(inner){
  const el = document.getElementById('confirm') || (() => { const d = document.createElement('div'); d.id = 'confirm'; document.body.appendChild(d); return d; })();
  CONF = null;
  el.innerHTML = `<div role="dialog" aria-modal="true" style="position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:50">
    <div class="card" style="max-width:420px;width:90%">${inner}</div></div>`;
  focusFirst(el);
  return el;
}
function askPassword(msg, fn){
  PW_FN = fn;
  openDialog(`<h2>Admin password needed</h2>
    <p style="margin:0 0 12px">${esc(msg)}</p>
    <div style="margin-bottom:12px"><label for="pwin">Your admin password</label><input id="pwin" type="password"></div>
    <div class="row" style="justify-content:flex-end">
      <button class="btn ghost" onclick="closeConfirm()">Cancel</button>
      <button class="btn bad" onclick="runPassword()">Confirm</button>
    </div>`);
  setTimeout(() => document.getElementById('pwin')?.focus(), 50);
}
function runPassword(){
  const pw = document.getElementById('pwin')?.value || '';
  const fn = PW_FN;
  closeConfirm();
  if (!pw) return toast('Enter your admin password');
  if (fn) fn(pw);
}
async function clearAll(pw){
  const {error: authErr} = await SB.auth.signInWithPassword({email: P.email, password: pw});
  if (authErr) return toast('Wrong admin password. Nothing was cleared.');
  const {error} = await SB.from('components').update({overall_qty: 0, working_qty: 0, damaged_qty: 0, current_qty: 0}).gte('overall_qty', 0);
  if (error) return toast(error.message);
  await logMsg(`${P.name} cleared all inventory (stock set to 0)`);
  toast('All inventory cleared');
  await loadData(true);
}
function askLocation(ids){
  LOC_IDS = ids;
  const cur = (S.components.find(c => c.id === ids[0]) || {}).location || '';
  openDialog(`<h2>Change location</h2>
    <p class="muted" style="margin:0 0 12px">The new location is applied to this component in every inventory.</p>
    <div style="margin-bottom:12px"><label for="locin">Location</label><input id="locin" value="${esc(cur)}"></div>
    <div class="row" style="justify-content:flex-end">
      <button class="btn ghost" onclick="closeConfirm()">Cancel</button>
      <button class="btn" onclick="saveLocation()">Save location</button>
    </div>`);
  setTimeout(() => document.getElementById('locin')?.focus(), 50);
}
async function saveLocation(){
  const loc = (document.getElementById('locin')?.value || '').trim();
  const ids = LOC_IDS || [];
  closeConfirm();
  if (!ids.length) return;
  const name = (S.components.find(c => c.id === ids[0]) || {}).name || 'component';
  const {error} = await SB.from('components').update({location: loc}).in('id', ids);
  if (error) return toast(error.message);
  await logMsg(`Location of ${name} changed to ${loc || '(none)'}`);
  toast('Location updated');
  await loadData(true);
}
function dangerCard(){
  return `<div class="card" style="margin-bottom:16px;border-top:3px solid var(--bad)"><h2>Clear all inventory</h2>
    <p class="muted" style="margin-top:-8px">Sets the stock of every component to 0. Components, requests and history are kept. You will be asked for your admin password.</p>
    <button class="btn bad" onclick="askPassword('Clear ALL inventory? Every stock quantity will be set to 0.', clearAll)">Clear all inventory</button></div>`;
}
async function loadData(full){
  const adminOn = ['admin','engineer','spalead'].includes(P.role) && ['log','acc','dash','imp'].includes(U.tab);
  const adminExtra = adminOn && (full || TICK % 4 === 0);
  const q = [
    SB.from('components').select('*').order('name'),
    SB.from('requests').select('*').order('created_at', {ascending:true}),
    SB.from('notifications').select('*').order('created_at', {ascending:false}).limit(50),
    SB.from('approvals').select('*'),
    SB.from('component_requests').select('*').order('created_at', {ascending:true}),
    SB.from('receive_requests').select('*').order('created_at', {ascending:true}),
    SB.from('import_requests').select('*').order('created_at', {ascending:true}),
    SB.from('approval_history').select('*').order('decided_at', {ascending:false}).limit(300),
    SB.from('assets').select('*').order('name'),
    SB.from('asset_requests').select('*').order('created_at', {ascending:true}),
    SB.from('settings').select('*'),
    SB.from('coboards').select('*')
  ];
  if (adminExtra) q.push(
    SB.from('profiles').select('*').order('email'),
    SB.from('activity_logs').select('*').order('created_at', {ascending:false}).limit(200),
    SB.from('imports').select('*').order('created_at', {ascending:false}).limit(50),
    SB.from('damage_reports').select('*').order('created_at', {ascending:false}).limit(200)
  );
  const res = await Promise.all(q);
  const err = res.find(x => x.error);
  if (err) return toast('Could not load data: ' + err.error.message);
  // Redraw only when the data really changed
  if (adminExtra) LAST_EXTRA = JSON.stringify(res.slice(12).map(x => x.data));
  const sig = JSON.stringify(res.slice(0, 12).map(x => x.data)) + '|' + LAST_EXTRA;
  if (sig === LAST_SIG) return;
  LAST_SIG = sig;
  S.components = res[0].data; S.requests = res[1].data; S.notes = res[2].data; S.approvals = res[3].data;
  S.compReq = res[4].data; S.recReq = res[5].data; S.impReq = res[6].data;
  S.history = res[7].data; S.assets = res[8].data; S.assetReq = res[9].data; S.settings = res[10].data; S.coboards = res[11].data;
  if (adminExtra){ S.profiles = res[12].data; S.logs = res[13].data; S.imports = res[14].data; S.damage = res[15].data; }
  paint();
}
function go(k){ U.tab = k; render(); if (['admin','engineer','spalead'].includes(P?.role) && ['log','acc','dash','imp'].includes(k)) loadData(true); }
function spaCard(){
  const spa = S.components.filter(c => c.inventory === 'spa');
  const prot = S.components.filter(c => (c.inventory || 'protosem') !== 'spa');
  const units = a => a.reduce((x, c) => x + c.current_qty, 0);
  const rows = spa.slice().sort((a, b) => a.name.localeCompare(b.name));
  return `<div class="card" style="margin-top:16px"><h2>SPA components</h2>
    <p class="muted" style="margin-top:-8px">SPA: ${spa.length} items, ${units(spa)} units in stock &middot; Protosem: ${prot.length} items, ${units(prot)} units in stock</p>
    ${rows.length ? tbl(['Component','Overall','Working','Damaged','Current (SPA)','Location','BoQ Type'],
      rows.map(c => [esc(c.name), c.overall_qty, c.working_qty, c.damaged_qty, `<b>${c.current_qty}</b>`, esc(c.location || '-'), badge(CATS[c.boq_type], 'b-info')]))
      : '<p class="empty">No SPA components yet.</p>'}</div>`;
}
function vDash(){ return (P.role === 'admin' ? dangerCard() + coboardCard() : '') + vDashBase() + spaCard() + hvCard() + redBinCard(); }
function compCard(){
  const cr = S.compReq || [], rr = S.recReq || [];
  const inv = r => r.inventory === 'spa' ? 'SPA' : 'Protosem';
  const mine = cr.filter(r => r.approver_id === ME.id && r.status === 'pending');
  const mineRec = rr.filter(r => r.approver_id === ME.id && r.status === 'pending');
  const waiting = cr.filter(r => r.proposed_by === ME.id && r.status === 'pending');
  const waitingRec = rr.filter(r => r.proposed_by === ME.id && r.status === 'pending');
  const recent = cr.filter(r => r.proposed_by === ME.id && r.status !== 'pending').slice(-5).reverse();
  let html = '';
  if (mine.length) html += `<div class="card" style="margin-bottom:16px"><h2>New components waiting for your approval</h2>${tbl(
    ['Component','Specifications','Inventory','Current qty','Proposed by','Submitted','Decision'],
    mine.map(r => [esc(r.name), esc(r.specifications || '-'), inv(r), r.current_qty, esc(r.proposed_by_name || '-'), fmt(r.created_at),
      `<button class="btn ok sm" onclick="ask('Approve adding this component?', () => approveComp('${r.id}'))">Approve</button>
       <input id="crr${r.id}" placeholder="Reason (optional)" style="max-width:150px;display:inline-block;padding:4px 8px">
       <button class="btn bad sm" onclick="ask('Reject this component?', () => rejectComp('${r.id}'))">Reject</button>`]))}</div>`;
  if (mineRec.length) html += `<div class="card" style="margin-bottom:16px"><h2>Stock waiting for your approval</h2>${tbl(
    ['Component','Units to add','Proposed by','Submitted','Decision'],
    mineRec.map(r => [esc(compName(r.component_id)), r.qty, esc(r.proposed_by_name || '-'), fmt(r.created_at),
      `<button class="btn ok sm" onclick="ask('Approve adding these units to stock?', () => approveRec('${r.id}'))">Approve</button>
       <input id="rrr${r.id}" placeholder="Reason (optional)" style="max-width:150px;display:inline-block;padding:4px 8px">
       <button class="btn bad sm" onclick="ask('Reject these units?', () => rejectRec('${r.id}'))">Reject</button>`]))}</div>`;
  if (waiting.length) html += `<div class="card" style="margin-bottom:16px"><h2>Your new components, waiting for approval</h2>${tbl(
    ['Component','Inventory','Approver','Submitted'],
    waiting.map(r => [esc(r.name), inv(r), esc(profName(r.approver_id)), fmt(r.created_at)]))}</div>`;
  if (waitingRec.length) html += `<div class="card" style="margin-bottom:16px"><h2>Your stock, waiting for approval</h2>${tbl(
    ['Component','Units','Approver','Submitted'],
    waitingRec.map(r => [esc(compName(r.component_id)), r.qty, esc(profName(r.approver_id)), fmt(r.created_at)]))}</div>`;
  if (recent.length) html += `<div class="card" style="margin-bottom:16px"><h2>Recent decisions on your components</h2>${tbl(
    ['Component','Inventory','Result','Reason'],
    recent.map(r => [esc(r.name), inv(r), badge(r.status === 'approved' ? 'Approved' : 'Rejected', r.status === 'approved' ? 'b-ok' : 'b-bad'), esc(r.reason || '-')]))}</div>`;
  return html;
}
function vAppr(){
  const toggle = `<div style="margin-bottom:12px"><button class="btn ghost" onclick="toggleAllComps()">${U.showAll ? 'Hide all components' : 'Show all components'}</button></div>`;
  return toggle + (U.showAll ? allCompsCard() : '') + assetCard() + impCard() + compCard() + vApprBase() + histCard();
}
async function approveComp(id){
  blurNow();
  const {error} = await SB.rpc('approve_component', {req: id});
  if (error) return toast(error.message);
  toast('Approved and added to inventory');
  loadData(true);
}
async function rejectComp(id){
  const reason = (document.getElementById('crr' + id)?.value || '').trim() || null;
  blurNow();
  const {error} = await SB.rpc('reject_component', {req: id, rej_reason: reason});
  if (error) return toast(error.message);
  toast('Rejected');
  loadData(true);
}
async function approveRec(id){
  blurNow();
  const {error} = await SB.rpc('approve_receive', {req: id});
  if (error) return toast(error.message);
  toast('Approved and added to stock');
  loadData(true);
}
async function rejectRec(id){
  const reason = (document.getElementById('rrr' + id)?.value || '').trim() || null;
  blurNow();
  const {error} = await SB.rpc('reject_receive', {req: id, rej_reason: reason});
  if (error) return toast(error.message);
  toast('Rejected');
  loadData(true);
}
async function approveImp(id){
  blurNow();
  const batch = (S.impReq || []).find(x => x.id === id);
  const rpc = batch && batch.kind === 'asset' ? 'approve_asset_import' : 'approve_import';
  const {error} = await SB.rpc(rpc, {req: id});
  if (error) return toast(error.message);
  toast('Approved. The import has been applied.');
  loadData(true);
}
async function rejectImp(id){
  const reason = (document.getElementById('iir' + id)?.value || '').trim() || null;
  blurNow();
  const {error} = await SB.rpc('reject_import', {req: id, rej_reason: reason});
  if (error) return toast(error.message);
  toast('Import rejected');
  loadData(true);
}
function impCard(){
  const ir = S.impReq || [];
  const mine = ir.filter(r => r.approver_id === ME.id && r.status === 'pending');
  const waiting = ir.filter(r => r.proposed_by === ME.id && r.status === 'pending');
  let html = '';
  if (mine.length) html += `<div class="card" style="margin-bottom:16px"><h2>CSV imports waiting for your approval</h2>${tbl(
    ['File','Rows','Replace current stock','Proposed by','Submitted','Decision'],
    mine.map(r => [esc(r.file_name), r.rows.length, r.replace_stock ? 'Yes' : 'No', esc(r.proposed_by_name || '-'), fmt(r.created_at),
      `<button class="btn ghost sm" onclick="toggleImpView('${r.id}')">${U.impView === r.id ? 'Hide items' : 'View items'}</button>
       <button class="btn ok sm" onclick="ask('Approve this import and apply all rows?', () => approveImp('${r.id}'))">Approve</button>
       <input id="iir${r.id}" placeholder="Reason (optional)" style="max-width:150px;display:inline-block;padding:4px 8px">
       <button class="btn bad sm" onclick="ask('Reject this import?', () => rejectImp('${r.id}'))">Reject</button>`]))}</div>`;
  const open = mine.find(r => r.id === U.impView);
  if (open) html += `<div class="card" style="margin-bottom:16px"><h2>Items in "${esc(open.file_name)}"</h2>${impDetail(open)}</div>`;
  if (waiting.length) html += `<div class="card" style="margin-bottom:16px"><h2>Your CSV imports, waiting for approval</h2>${tbl(
    ['File','Rows','Approver','Submitted'],
    waiting.map(r => [esc(r.file_name), r.rows.length, esc(profName(r.approver_id)), fmt(r.created_at)]))}</div>`;
  return html;
}
function impDetail(r){
  return tbl(['#','Component','Inventory','In stock now','Adding','Result'],
    r.rows.map((x, i) => {
      const c = S.components.find(y => y.name.toLowerCase() === x.name.toLowerCase() && (y.inventory || 'protosem') === x.inv);
      const result = !c ? badge('New item', 'b-ok')
        : (r.replace_stock ? badge('Set to ' + x.current, 'b-warn') : badge('Restock +' + x.current, 'b-warn'));
      return [i + 1, esc(x.name), x.inv === 'spa' ? 'SPA' : 'Protosem', c ? c.current_qty : '-', x.current, result];
    }));
}
function toggleImpView(id){ U.impView = U.impView === id ? null : id; render(); }
function toggleAllComps(){ U.showAll = !U.showAll; render(); }
function allCompsCard(){
  const list = S.components.slice().sort((a, b) => a.name.localeCompare(b.name));
  return `<div class="card" style="margin-bottom:16px"><h2>All components (${list.length})</h2>${list.length
    ? tbl(['Component','Inventory','Overall','Working','Damaged','Current','Location','BoQ Type'],
        list.map(c => [esc(c.name), invTag(c), c.overall_qty, c.working_qty, c.damaged_qty, `<b>${c.current_qty}</b>`,
          esc(c.location || '-'), badge(CATS[c.boq_type], 'b-info')]))
    : '<p class="empty">No components yet.</p>'}</div>`;
}
const VIEWS = {assets:vAssets, inv:vInv, req:vReq, my:vMy, appr:vAppr, spa:vSpa, dash:vDash, imp:vImp, log:vLog, acc:vAcc};

function checkingView(msg){
  return `<div class="login"><div class="brand" style="justify-content:center;margin-bottom:18px"><i aria-hidden="true"></i>Component Inventory</div>
    <div class="card"><p class="muted" style="margin:0">${msg || 'Checking your session…'}</p></div></div>`;
}
const LOGIN_NOTICE = 'Please sign in with your original mail id (@protosem.tech or @forge-ic.co).';
let LOGIN_NOTE = '';
(function(){
  const h = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  const q = new URLSearchParams(location.search || '');
  if (h.get('error') || q.get('error') || h.get('error_description') || q.get('error_description')) LOGIN_NOTE = LOGIN_NOTICE;
})();
async function googleLogin(){
  const {error} = await SB.auth.signInWithOAuth({provider: 'google', options: {redirectTo: location.origin + location.pathname}});
  if (error) toast(error.message);
}
function loginView(){
  return `<div class="login"><div class="brand" style="justify-content:center;margin-bottom:18px"><i aria-hidden="true"></i>Component Inventory</div>
    <div class="card">
      <h2 style="margin:0">Sign in</h2>
      <div><label for="le">Email</label><input id="le" type="email" autocomplete="email"></div>
      <div><label for="lp">Password</label><input id="lp" type="password" autocomplete="current-password"></div>
      <div><label for="ln">Name (for new accounts)</label><input id="ln" autocomplete="name"></div>
      <div class="row"><button class="btn" onclick="ask('Sign in now?', () => signIn())">Sign in</button><button class="btn ghost" onclick="ask('Create this account?', () => signUp())">Create account</button></div>
      <button class="btn ghost" onclick="googleLogin()">Sign in with Google</button>
      ${LOGIN_NOTE ? `<p style="margin:0;color:var(--bad);font-weight:600">${LOGIN_NOTE}</p>` : ''}
      <p class="muted" style="margin:0">Sign in with Google using your @protosem.tech or @forge-ic.co mail. Viewers see the inventory until the admin gives a role. Other mail ids cannot sign in.</p>
    </div></div>`;
}
function render(){
  const app = document.getElementById('app');
  if (!AUTH_READY){ app.innerHTML = checkingView(); return; }
  if (!ME){ app.innerHTML = loginView(); return; }
  if (!P){ app.innerHTML = checkingView('Loading your workspace…'); return; }
  if (!P.role){
    app.innerHTML = `<div class="login"><div class="card"><h2>Access not granted</h2>
      <p class="muted">${esc(P.email)} has no role yet. Ask the Engineers-Admin to set it.</p>
      <button class="btn ghost" onclick="ask('Sign out of the platform?', () => signOut())">Sign out</button></div></div>`;
    return;
  }
  const tabs = P.role === 'viewer' ? [['inv','Inventory']] : [['inv','Inventory'], ['assets','Assets'], ['req','New request'], ['my','Requests'],
    ...(APPROVERS.includes(P.role) ? [['appr','Approvals']] : []),
    ...(['spalead','admin'].includes(P.role) ? [['spa','SPA history']] : []),
    ...(['engineer','spalead','admin'].includes(P.role) ? [['dash','Dashboard']] : []),
    ...(P.role === 'admin' ? [['imp','CSV import'], ['log','Activity'], ['acc','Accounts']] : [])];
  if (!tabs.some(t => t[0] === U.tab)) { location.replace(HREF[tabs[0][0]]); return; }   // not allowed here: go to the first page you can use
  app.innerHTML = `<header>
      <div class="brand"><i aria-hidden="true"></i>Component Inventory</div>
      <nav aria-label="Main">${tabs.map(([k,l]) => `<a class="${U.tab===k?'on':''}" href="${HREF[k]}"${U.tab===k?' aria-current="page"':''}>${l}</a>`).join('')}</nav>
      <div class="row"><button class="btn ghost sm" onclick="U.showN=!U.showN;render()">Notifications (${unreadCount()})</button><span class="badge b-info">${ROLE[P.role]}</span><span class="muted">${esc(P.name)}</span>
        <button class="btn ghost sm" onclick="ask('Sign out of the platform?', () => signOut())">Sign out</button></div>
    </header><main><h1 class="sr-only">${(tabs.find(t => t[0] === U.tab) || [])[1] || 'Component Inventory'}</h1>${U.showN ? vNotes() : ''}${VIEWS[U.tab]()}</main>`;
}
render();
