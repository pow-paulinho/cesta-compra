export const CHECKOUT_HTML = `<div style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px">
<div class="row"><label for="max">Supermercados como máximo</label><select id="max"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="7" selected>sin límite</option></select></div>
<div class="row" style="margin-top:8px"><label for="src">Precios</label><select id="src"><option value="demo" selected>demo</option><option value="open_prices">Open Prices (reales)</option></select></div>
<button id="go" class="primary" style="width:100%;margin-top:12px">Ver dónde comprar</button><div id="plan" aria-live="polite"></div></div>`;

export const CHECKOUT_JS = `
$('#go').onclick=async()=>{const p=$('#plan');if(!cart.length){p.innerHTML='<p class="empty">Añade algo a la cesta primero.</p>';return;}
p.innerHTML='<p class="empty">Calculando…</p>';
const res=await fetch('/api/checkout',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({items:cart.map(i=>({ean:i.ean,qty:i.qty})),maxStores:Number($('#max').value),source:$('#src').value})});
if(!res.ok){p.innerHTML='<p class="empty">No se pudo calcular. Revisa la cesta e inténtalo otra vez.</p>';return;}
const j=await res.json();const name=e=>(cart.find(i=>i.ean===e)||{name:e}).name;
let h=j.best.stops.map(s=>'<div class="stop"><div class="row"><b>'+esc(s.chain)+'</b><span class="total">'+eur(s.totalCents)+'</span></div>'+s.items.map(i=>'<div class="row pmeta"><span>'+i.qty+' × '+esc(name(i.ean))+'</span><span>'+eur(i.totalCents)+'</span></div>').join('')+'</div>').join('');
h+='<div class="row" style="margin-top:10px"><span>Total</span><span class="total">'+eur(j.best.totalCents)+'</span></div>';
if(j.best.missing.length)h+='<p class="note">Sin precio '+(j.source==='demo'?'demo':'en Open Prices')+': '+j.best.missing.map(e=>esc(name(e))).join(', ')+'.</p>';
if(j.bestSingle)h+=j.savingsCents>0?'<div class="savings">Ahorras '+eur(j.savingsCents)+' frente a comprarlo todo en '+esc(j.bestSingle.chain)+' ('+eur(j.bestSingle.totalCents)+').</div>':'<p class="note">Comprarlo todo en '+esc(j.bestSingle.chain)+' ya es lo más barato.</p>';
else if(!j.best.missing.length)h+='<p class="note">Ningún supermercado tiene toda la cesta: hay que repartirla.</p>';
h+='<p class="note">'+(j.source==='demo'?'Precios demo: inventados para probar, no son ofertas reales.':'Precios de Open Prices: reales pero pueden ser antiguos; mira la fecha de cada uno en la búsqueda.')+'</p>';
p.innerHTML=h;};`;
