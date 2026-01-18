// ================== CONFIG ==================
// Existing exec – still used for cart save / leads etc.
const EXEC_URL =
'https://script.google.com/macros/s/AKfycbyuKVdjwz25nESKmFt3Wgbf_rWT6UCeVgUvSKVBziQYgiItNcwq2m1LWsQQWt0Xu-JfSA/exec';

// Inventory exec – this is the web app with the new Code.gs (inventoryProducts action)
const INVENTORY_EXEC =
'https://script.google.com/macros/s/AKfycbxE2EhcpxgdWBeF9t5VuNJZ4GAqbBLxUDOhn6KWRB8fUfeSx3e_Y3P_8r5OHeYhGzptcA/exec';

// Backend endpoints (same-origin on Cloud Run)
const CHECKOUT_ENDPOINT = '/api/checkout/start';
const CART_SAVE_ENDPOINT = '/api/cart/save';

// Local storage keys for 24-hour cart
const LS_KEY_OWNER = 'ec_cart_owner';
const LS_KEY_CART_ID = 'ec_cart_id';
const LS_KEY_NEXT  = 'ec_cart_prompt_next_at';

// Currency mapping:
// If you're charging in JMD through Fiserv, the numeric code is typically 388.
// If you are charging in USD, use 840.
const PAYMENT_CURRENCY_CODE = '388';

// Category labels for filter chips
const CATEGORY_LABELS = [
  'All Décor',
  'Lamps & Lighting',
  'Mirrors & Wall Art',
  'Vases & Florals',
  'Tabletop & Accents',
  'Furniture & Large Pieces',
  'Other'
];

// Strip colors per category
const CATEGORY_STRIPS = {
  'Lamps & Lighting':'#0F6ABF',
  'Mirrors & Wall Art':'#6E3AA6',
  'Vases & Florals':'#B98A2F',
  'Tabletop & Accents':'#8C4A2F',
  'Furniture & Large Pieces':'#007E62',
  'Other':'#4B4A46',
  'All Décor':'#0C2C7A'
};

const $  = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const PR = new Intl.NumberFormat('en-JM',{style:'currency',currency:'JMD',maximumFractionDigits:0});

// Fallback mock products (with example images) in case API fails
const FALLBACK_DATA = [
  {
    sku:'EC-001',
    name:'Sculptural Gold Lamp',
    price:18950,
    img:'https://images.pexels.com/photos/1571470/pexels-photo-1571470.jpeg',
    desc:'Warm metallic glow that elevates any room. Built to last.',
    cat:'Lamps & Lighting',
    badges:['Bestseller'],
    tiers:[{min:3,pct:5},{min:5,pct:10}]
  },
  {
    sku:'EC-002',
    name:'Beveled Brass Mirror',
    price:32950,
    img:'https://images.pexels.com/photos/1457841/pexels-photo-1457841.jpeg',
    desc:'Crisp beveled edge with a soft brass finish. Durable for everyday use.',
    cat:'Mirrors & Wall Art',
    badges:['Featured'],
    tiers:[{min:3,pct:5},{min:5,pct:10}]
  },
  {
    sku:'EC-003',
    name:'Textured Stone Vase',
    price:9950,
    img:'https://images.pexels.com/photos/1080696/pexels-photo-1080696.jpeg',
    desc:'Soft, textured finish that adds depth without clutter.',
    cat:'Vases & Florals',
    badges:[],
    tiers:[{min:3,pct:5}]
  },
  {
    sku:'EC-004',
    name:'Ambient Wall Sconce',
    price:25950,
    img:'https://images.pexels.com/photos/1571460/pexels-photo-1571460.jpeg',
    desc:'Ambient glow for cozy evenings—sleek, modern shape.',
    cat:'Lamps & Lighting',
    badges:['Limited Stock'],
    tiers:[{min:3,pct:5},{min:5,pct:10}]
  }
];

let DATA = [];                 // all products
let CURRENT_CATEGORY = 'All Décor';
let CURRENT_QUERY = '';

const grid = $('#grid');
const searchInput = $('#searchInput');

// ======== PAYMENT HELPERS (NEW) ========
function getCartSubtotal(){
  return CART.items.reduce((s,i)=>s + (Number(i.price)||0) * (Number(i.qty)||0), 0);
}

function getOwner(){
  try{
    return JSON.parse(localStorage.getItem(LS_KEY_OWNER) || 'null');
  }catch(_){
    return null;
  }
}

function getCartId(){
  const existing = localStorage.getItem(LS_KEY_CART_ID);
  if(existing) return existing;
  const rand = Math.random().toString(36).slice(2, 8);
  const id = `cart_${Date.now()}_${rand}`;
  localStorage.setItem(LS_KEY_CART_ID, id);
  return id;
}

async function startCheckout(payload){
  const res = await fetch(CHECKOUT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if(!res.ok){
    const msg = await res.text();
    throw new Error(msg || 'Checkout failed');
  }

  const html = await res.text();
  document.open();
  document.write(html);
  document.close();
}

// ======== HELPERS ========

function deriveCategory(name){
  const n = (name || '').toUpperCase();
  if(n.includes('LAMP') || n.includes('LIGHT') || n.includes('SCONCE')) return 'Lamps & Lighting';
  if(n.includes('MIRROR') || n.includes('FRAME') || n.includes('ART')) return 'Mirrors & Wall Art';
  if(n.includes('VASE') || n.includes('FLORAL') || n.includes('FLOWER')) return 'Vases & Florals';
  if(n.includes('TABLETOP') || n.includes('FIGURE') || n.includes('FIGURINE') || n.includes('DECOR')) return 'Tabletop & Accents';
  if(n.includes('CHAIR') || n.includes('SOFA') || n.includes('TABLE ') || n.includes('STOOL')) return 'Furniture & Large Pieces';
  return 'Other';
}

/**
 * Convert whatever we get from the backend into a real image URL.
 * Supports:
 *  - bare Drive file IDs
 *  - Drive share links (/file/d/ID/, ?id=ID)
 *  - already-clean URLs (left as-is)
 */
function buildImageUrl(rawImg){
  if(!rawImg) return '';
  let v = String(rawImg).trim();
  if(!v) return '';

  // If it's already some kind of URL
  if(v.startsWith('http')){
    // Try to extract a Google Drive file ID if present
    const m1 = v.match(/\/d\/([a-zA-Z0-9_-]+)/);
    const m2 = v.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    const id = (m1 && m1[1]) || (m2 && m2[1]);

    // If we found a Drive ID, return a clean "uc" link; otherwise use the URL as-is
    return id ? `https://drive.google.com/uc?export=view&id=${id}` : v;
  }

  // If it's not a URL, treat it as a bare file ID
  return `https://drive.google.com/uc?export=view&id=${v}`;
}

function normalizeProduct(raw){
  const name = raw.name || raw.item_name || '';
  const cat  = raw.category || raw.category_name || raw.webCategory || deriveCategory(name);

  // Accept multiple possible fields from Apps Script
  const rawImg =
    raw.image ||
    raw.image_url ||
    raw.item_image ||
    raw.imageUrl ||
    raw.image_file_id ||
    raw.imageFileId ||
    '';

  const img = buildImageUrl(rawImg);

  return {
    sku   : raw.sku || raw.SKU || raw.item_id || raw.id || '',
    name  : name || 'Untitled Item',
    price : Number(raw.price || raw.sellingPrice || raw.rate || raw.unit_price || 0),
    img   : img,
    desc  : raw.description || '',
    cat   : cat || 'Other',
    badges: raw.badges || [],
    tiers : raw.tiers || []
  };
}

// ======== FETCH PRODUCTS FROM APPS SCRIPT ========
async function loadProducts(){
  grid.innerHTML = '<div class="grid-empty">Loading your décor selection…</div>';

  try{
    const url = INVENTORY_EXEC + '?action=inventoryProducts';
    const res = await fetch(url, { method:'GET' });
    if(!res.ok) throw new Error('Network error: '+res.status);
    const json = await res.json();
    const rawList = Array.isArray(json) ? json : (json.products || []);
    if(!rawList.length) throw new Error('No products from API');
    DATA = rawList.map(normalizeProduct);
  }catch(err){
    console.error('Inventory API failed, using fallback products:', err);
    DATA = FALLBACK_DATA;
  }

  buildFilters();
  applyFilters();
  renderCart();
  sendHeight();
}

// ======== FILTERS, SEARCH, GRID ========

function buildFilters(){
  const fbar = $('#filters');
  fbar.innerHTML = '';

  if(!DATA.length) return;

  CATEGORY_LABELS.forEach(label => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = label;
    b.dataset.filter = label;
    b.setAttribute('aria-pressed', label === CURRENT_CATEGORY ? 'true' : 'false');
    b.onclick = () => {
      CURRENT_CATEGORY = label;
      $$('#filters .chip').forEach(c => c.setAttribute('aria-pressed','false'));
      b.setAttribute('aria-pressed','true');
      applyFilters();
    };
    fbar.appendChild(b);
  });
}

function applyFilters(){
  let list = DATA.slice();

  if(CURRENT_CATEGORY && CURRENT_CATEGORY !== 'All Décor'){
    list = list.filter(p => p.cat === CURRENT_CATEGORY);
  }

  if(CURRENT_QUERY){
    const q = CURRENT_QUERY;
    list = list.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q)
    );
  }

  renderGrid(list);
}

searchInput.addEventListener('input', () => {
  CURRENT_QUERY = searchInput.value.toLowerCase().trim();
  applyFilters();
});

function renderGrid(list){
  grid.innerHTML = '';
  if(!list.length){
    grid.innerHTML = '<div class="grid-empty">No items match this search yet. Try another term or category.</div>';
    return;
  }

  list.forEach(p => {
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.sku = p.sku;

    const hasImg = !!p.img;

    card.innerHTML = `
      <div class="thumb${hasImg ? '' : ' placeholder'}">
        <div class="strip" style="background:${CATEGORY_STRIPS[p.cat]||'#0C2C7A'}"></div>
        ${hasImg
          ? `<img src="${p.img}" alt="${p.name}" loading="lazy">`
          : `<span>Image coming soon</span>`}
      </div>
      <div class="body">
        <div class="name">${p.name}</div>
        <div class="price">${PR.format(p.price)}</div>
        <div class="cta-row">
          <button class="btn view">Quick View</button>
        </div>
      </div>`;

    grid.appendChild(card);
    card.querySelector('.view').onclick = e => { e.stopPropagation(); openPDP(p,card); };
    card.addEventListener('click', e => {
      if(!(e.target.classList.contains('view'))) openPDP(p,card);
    });
  });
}

// ======== PDP LOGIC ========
let ACTIVE = null, QTY = 1, PROD = null;
let PDP_STATE = {
  closing: false,
  openTimer: null,
  closeTimer: null
};
const backdrop = $('#backdrop'), pdp = $('#pdp'), strip = $('#pdpStrip');
const img = $('#pdpImg'), title = $('#pdptitle'), sub = $('#pdpsub'),
      priceEl = $('#pdpprice'), badgesEl = $('#pdpbadges'), tiersEl = $('#pdptiers');

$('#plus').onclick  = () => { QTY++; $('#qty').textContent = QTY; };
$('#minus').onclick = () => { QTY = Math.max(1,QTY-1); $('#qty').textContent = QTY; };
$('#add').onclick   = () => { if(PROD) emit('pdp:addToCart',{ sku:PROD.sku, qty:QTY }); closePDP(); };
$('#buy').onclick   = () => { if(PROD) emit('pdp:buyNow',{ sku:PROD.sku, qty:QTY }); };
$('#close').onclick = closePDP;
backdrop.onclick    = closePDP;
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closePDP(); });

function hardCleanupPDP(){
  if(PDP_STATE.openTimer){
    clearTimeout(PDP_STATE.openTimer);
    PDP_STATE.openTimer = null;
  }
  if(PDP_STATE.closeTimer){
    clearTimeout(PDP_STATE.closeTimer);
    PDP_STATE.closeTimer = null;
  }
  PDP_STATE.closing = false;

  document.querySelectorAll('.ghost').forEach(g => g.remove());

  backdrop.classList.remove('show');
  pdp.classList.remove('show');

  pdp.style.transition = '';
  pdp.style.transform = '';
  pdp.style.transformOrigin = '';
  pdp.style.opacity = '';
}

function openPDP(p,card){
  hardCleanupPDP();

  PROD = p;
  ACTIVE = card;
  QTY = 1;
  $('#qty').textContent = QTY;

  if(p.img){
    img.src = p.img;
  }else{
    img.removeAttribute('src');
  }
  title.textContent = p.name;
  sub.textContent = p.desc || '';
  priceEl.textContent = PR.format(p.price);
  badgesEl.innerHTML = (p.badges||[]).map(b=>`<span class="badge">${b}</span>`).join('');
  tiersEl.innerHTML  = (p.tiers||[]).map(t=>`<span class="tier">${t.min}+ save ${t.pct}%</span>`).join('');
  strip.style.background = CATEGORY_STRIPS[p.cat] || '#0C2C7A';

  const r = card.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.className = 'ghost';
  ghost.style.left   = r.left + 'px';
  ghost.style.top    = r.top + 'px';
  ghost.style.width  = r.width + 'px';
  ghost.style.height = r.height + 'px';
  ghost.style.pointerEvents = 'none';
  document.body.appendChild(ghost);

  requestAnimationFrame(()=>{
    backdrop.classList.add('show');
    pdp.classList.add('show');
    const rr = pdp.getBoundingClientRect();
    const sx = r.width/rr.width, sy = r.height/rr.height;
    const dx = r.left-rr.left,   dy = r.top-rr.top;
    pdp.style.opacity = 0;
    pdp.style.transformOrigin = 'top left';
    pdp.style.transform = `translate(${dx}px,${dy}px) scale(${sx},${sy})`;
    requestAnimationFrame(()=>{
      pdp.style.transition = `transform .36s cubic-bezier(.18,.9,.2,1), opacity .2s ease`;
      pdp.style.opacity = 1;
      pdp.style.transform = 'translate(0,0) scale(1,1)';
      ghost.style.opacity = 0;
      ghost.style.transition = 'opacity .2s ease';
      PDP_STATE.openTimer = setTimeout(()=>{
        ghost.remove();
        pdp.style.transition = '';
        pdp.style.transform = '';
        PDP_STATE.openTimer = null;
      }, 450);
    });
  });
}

function closePDP(){
  if(PDP_STATE.closing) return;
  PDP_STATE.closing = true;

  document.querySelectorAll('.ghost').forEach(g => g.remove());

  if(!pdp.classList.contains('show')){
    hardCleanupPDP();
    ACTIVE = null;
    PROD = null;
    return;
  }

  const origin = ACTIVE || document.querySelector(`[data-sku="${PROD?.sku}"]`);
  const rr = pdp.getBoundingClientRect();

  backdrop.classList.remove('show');

  if(origin){
    const r  = origin.getBoundingClientRect();
    const sx = r.width/rr.width, sy = r.height/rr.height;
    const dx = r.left-rr.left,   dy = r.top-rr.top;
    pdp.style.transition = `transform .3s cubic-bezier(.18,.9,.2,1), opacity .2s ease`;
    pdp.style.transformOrigin = 'top left';
    pdp.style.transform = `translate(${dx}px,${dy}px) scale(${sx},${sy})`;
    pdp.style.opacity = 0;
    PDP_STATE.closeTimer = setTimeout(()=>{
      hardCleanupPDP();
      ACTIVE = null;
      PROD = null;
      PDP_STATE.closeTimer = null;
    }, 340);
  }else{
    hardCleanupPDP();
    ACTIVE = null;
    PROD = null;
  }
}

// ======== POSTMESSAGE / HEIGHT ========
function emit(type,payload){
  try{ parent.postMessage({type,payload},'*'); }catch(_){}
}

function sendHeight(){
  try{
    parent.postMessage({type:'ui:height', payload:{ px: document.documentElement.scrollHeight }}, '*');
  }catch(_){}
}
new ResizeObserver(sendHeight).observe(document.documentElement);
window.addEventListener('load', sendHeight);

// ======== CART WIDGET ========
let CART = { items: [] };
const cartFab      = $('#cartFab'),
      cartDrawer   = $('#cartDrawer'),
      cartBody     = $('#cartBody'),
      cartCount    = $('#cartCount'),
      cartMeta     = $('#cartMeta'),
      cartSubtotal = $('#cartSubtotal');
const cartClose = $('#cartClose'),
      keepShopping = $('#keepShopping'),
      checkoutBtn  = $('#checkout');

cartFab.onclick      = ()=>{
  if(hasOwner()){
    const open = !cartDrawer.classList.contains('open');
    setCartOpen(open);
    return;
  }
  openOwnerModal({ reason: 'cta' });
};
cartClose.onclick    = ()=>setCartOpen(false);
keepShopping.onclick = ()=>setCartOpen(false);

function setCartOpen(open){
  cartDrawer.classList.toggle('open',open);
  cartFab.setAttribute('aria-expanded', String(open));
}

function updateLeadCta(){
  const ownerExists = hasOwner();
  cartFab.classList.toggle('has-owner', ownerExists);
  cartFab.classList.toggle('lead', !ownerExists);
  cartFab.setAttribute('aria-label', ownerExists ? 'Open cart' : 'Create my 24-hour cart');
  cartMeta.textContent = ownerExists
    ? (CART.items.length ? 'View Cart' : 'Your Cart')
    : 'Create my 24hr cart';
}

function addToCart(item, qty){
  const i = CART.items.findIndex(x=>x.sku===item.sku);
  if(i>=0) CART.items[i].qty += qty;
  else CART.items.push({ sku:item.sku, name:item.name, price:item.price, image:item.img, qty });
  renderCart();
  emit('pdp:addToCart',{ sku:item.sku, qty });
}
function removeFromCart(sku){
  CART.items = CART.items.filter(x=>x.sku!==sku);
  renderCart();
  emit('cart:remove',{ sku });
}
function setQty(sku, qty){
  const it = CART.items.find(x=>x.sku===sku);
  if(!it) return;
  it.qty = Math.max(1,qty);
  renderCart();
  emit('cart:updateQty',{ sku, qty:it.qty });
}

function renderCart(){
  const subtotal = getCartSubtotal();
  cartCount.textContent   = String(CART.items.reduce((s,i)=>s+i.qty,0));
  cartMeta.textContent    = hasOwner()
    ? (CART.items.length ? 'View Cart' : 'Your Cart')
    : 'Create my 24hr cart';
  cartSubtotal.textContent= `Subtotal — ${PR.format(subtotal)}`;
  cartBody.innerHTML = '';

  CART.items.forEach(i=>{
    const row = document.createElement('div');
    row.className = 'line';
    const hasImg = !!i.image;
    row.innerHTML = `
      ${hasImg ? `<img src="${i.image}" alt="${i.name}">` : `<div style="width:64px;height:64px;border-radius:10px;background:radial-gradient(circle at 0 0, rgba(230,182,82,.3), rgba(12,44,122,.08));display:grid;place-items:center;font-size:10px;color:#555;">No image</div>`}
      <div>
        <div class="name">${i.name}</div>
        <div class="pr">${PR.format(i.price)}</div>
      </div>
      <div class="qty">
        <button class="pill" aria-label="Decrease" data-act="-">−</button>
        <div>${i.qty}</div>
        <button class="pill" aria-label="Increase" data-act="+">+</button>
        <button class="pill trash" aria-label="Remove">🗑</button>
      </div>`;
    cartBody.appendChild(row);

    const [dec, , inc, del] = row.querySelectorAll('.pill');
    dec.onclick = ()=>setQty(i.sku, i.qty-1);
    inc.onclick = ()=>setQty(i.sku, i.qty+1);
    del.onclick = ()=>removeFromCart(i.sku);
  });

  const have = new Set(CART.items.map(i=>i.sku));
  const picks = (DATA||[]).filter(p=>!have.has(p.sku)).slice(0,3);
  const ups = $('#upsGrid');
  ups.innerHTML = '';
  picks.forEach(p=>{
    const c = document.createElement('div');
    c.className = 'ups-card';
    const hasImg = !!p.img;
    c.innerHTML = `
      ${hasImg ? `<img src="${p.img}" alt="${p.name}">` : `<div style="width:100%;height:110px;border-radius:10px;background:radial-gradient(circle at 0 0, rgba(230,182,82,.3), rgba(12,44,122,.08));display:grid;place-items:center;font-size:10px;color:#555;">No image</div>`}
      <div class="nm">${p.name}</div>
      <div class="pr">${PR.format(p.price)}</div>
      <button class="btn" style="margin-top:6px">Add</button>`;
    ups.appendChild(c);
    c.querySelector('.btn').onclick = ()=>addToCart(p,1);
  });

  updateLeadCta();
}

// Ensure PDP addToCart also hits our local cart
const _emit = emit;
emit = (type,payload)=>{
  try{ _emit(type,payload); }catch(_){}
  if(type==='pdp:addToCart'){
    const p = DATA.find(x=>x.sku===payload.sku);
    if(p && payload.qty>0){
      addToCart(p,payload.qty);
      setCartOpen(true);
    }
  }
  if(type==='pdp:buyNow'){
    setCartOpen(true);
  }
};

function onMessageCart(e){
  const {type,payload} = e.data || {};
  if(type==='state:cart'){
    CART.items = (payload.items||[]).map(i=>({
      sku:i.sku, name:i.name, price:i.price, qty:i.qty, image:i.image
    }));
    renderCart();
  }
}
window.addEventListener('message', onMessageCart);

// ✅ Checkout: keep existing emit, PLUS start payment handoff with exact subtotal (NEW)
checkoutBtn.onclick = ()=>{
  const subtotal = getCartSubtotal();

  // If cart is empty, don’t proceed
  if(!CART.items.length || subtotal <= 0){
    alert('Your cart is empty. Add an item first.');
    return;
  }

  if(!hasOwner()){
    openOwnerModal({ reason: 'checkout' });
    return;
  }

  const owner = getOwner();
  const cartId = owner?.cartId || getCartId();

  // Always emit (keeps your existing parent integration intact)
  emit('cart:checkout', {
    items: CART.items,
    subtotal,
    currency: 'JMD',
    currencyCode: PAYMENT_CURRENCY_CODE,
    cartId,
    owner: owner ? { name: owner.name || '', email: owner.email || '', phone: owner.phone || '' } : null
  });

  startCheckout({
    items: CART.items.map(item => ({
      sku: item.sku,
      name: item.name,
      price: item.price,
      qty: item.qty
    })),
    currency: PAYMENT_CURRENCY_CODE,
    customer: owner ? { name: owner.name || '', email: owner.email || '', phone: owner.phone || '' } : null,
    cartId
  }).catch((err)=>{
    console.error('Checkout failed:', err);
    alert('Checkout is not available right now. Please try again.');
  });
};

renderCart();

// ======== 24-HOUR CART PROMPT (same behaviour as before) ========
const INITIAL_DELAY = 45 * 1000;
const REPEAT_DELAY = 45 * 60 * 1000;

const promptBackdrop = $('#promptBackdrop');
const promptModal    = $('#promptModal');
const promptClose    = $('#promptClose');
const promptGate     = $('#promptGate');

let promptTimer = null;

function hasOwner(){
  try{
    const o = JSON.parse(localStorage.getItem(LS_KEY_OWNER) || 'null');
    return !!(o && o.name && o.email && o.phone);
  }catch(_){
    return false;
  }
}
function setOwner(owner){
  const cartId = owner?.cartId || getCartId();
  const payload = {
    name: owner?.name || '',
    email: owner?.email || '',
    phone: owner?.phone || '',
    cartId,
    createdAt: owner?.createdAt || Date.now()
  };
  localStorage.setItem(LS_KEY_OWNER, JSON.stringify(payload));
  updateLeadCta();
  return payload;
}
function scheduleNext(ms){
  localStorage.setItem(LS_KEY_NEXT, String(Date.now()+ms));
}
function nextDue(){
  const v = Number(localStorage.getItem(LS_KEY_NEXT) || 0);
  return Date.now() >= v;
}
function openOwnerModal({ reason } = {}){
  if(hasOwner()) return;
  if(promptGate){
    promptGate.hidden = reason !== 'checkout';
  }
  promptBackdrop.classList.add('show');
  promptModal.classList.add('show');
}
function closeOwnerModal(){
  promptBackdrop.classList.remove('show');
  promptModal.classList.remove('show');
}

function schedulePrompt(){
  if(hasOwner()) return;
  if(promptTimer){
    clearTimeout(promptTimer);
  }

  const now = Date.now();
  let nextAt = Number(localStorage.getItem(LS_KEY_NEXT) || 0);
  if(!nextAt){
    nextAt = now + INITIAL_DELAY;
    scheduleNext(INITIAL_DELAY);
  }
  const delay = Math.max(0, nextAt - now);
  promptTimer = setTimeout(()=>{
    if(hasOwner()) return;
    if(nextDue()){
      openOwnerModal({ reason: 'auto' });
    }
  }, delay);
}

promptBackdrop.addEventListener('click', ()=>{
  closeOwnerModal();
  scheduleNext(REPEAT_DELAY);
  schedulePrompt();
});
document.addEventListener('keydown',(e)=>{
  if(e.key === 'Escape' && promptModal.classList.contains('show')){
    closeOwnerModal();
    scheduleNext(REPEAT_DELAY);
    schedulePrompt();
  }
});
promptClose.addEventListener('click', ()=>{
  closeOwnerModal();
  scheduleNext(REPEAT_DELAY);
  schedulePrompt();
});

function onMessagePrompt(e){
  const {type,payload} = e.data || {};
  if(type==='state:cart'){
    if(payload && (payload.name || payload.email)){
      setOwner({
        name: payload.name || '',
        email: payload.email || '',
        phone: payload.phone || '',
        cartId: payload.cartId || getCartId()
      });
    }
  }
}
window.addEventListener('message', onMessagePrompt);

$('#promptLater').onclick = ()=>{
  closeOwnerModal();
  scheduleNext(REPEAT_DELAY);
  schedulePrompt();
};

const promptForm = $('#promptForm');
promptForm.addEventListener('submit', (e)=>{
  e.preventDefault();
  const name  = $('#pName').value.trim();
  const email = $('#pEmail').value.trim();
  const phone = $('#pPhone').value.trim();
  if(!name || !email || !phone) return;

  const cartId = getCartId();
  setOwner({ name, email, phone, cartId });

  emit('cart:saveOwner', { cartId, name, email, phone });

  fetch(CART_SAVE_ENDPOINT,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({
      event:'cartSaved',
      site:'exclusivecomfortdecor',
      cartId,
      name,
      email,
      phone,
      items: CART.items || [],
      currency: PAYMENT_CURRENCY_CODE,
      source: 'storefront',
      ts: Date.now()
    })
  }).catch(()=>{});

  closeOwnerModal();
});

// ======== INIT ========
window.addEventListener('load', ()=>{
  loadProducts();
  updateLeadCta();
  schedulePrompt();
});
