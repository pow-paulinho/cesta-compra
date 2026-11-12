/** The whole web app: one page, no build step. Cart lives in localStorage. */
export const PAGE = /* html */ `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cesta: dónde comprar más barato</title>
<style>
:root{--bg:#f7f7f5;--card:#fff;--ink:#1c1c1a;--muted:#6b6b66;--line:#e4e3de;--accent:#2f6b4f;--accent-ink:#fff;--warn:#9a5b00;--warn-bg:#fff4e0;--demo:#5a4fb0;--demo-bg:#eeecfb;--r:10px}
*{box-sizing:border-box}body{margin:0;font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
header{padding:16px 20px;border-bottom:1px solid var(--line);background:var(--card)}h1{font-size:20px;margin:0}header p{margin:4px 0 0;color:var(--muted);font-size:13px}
main{display:grid;grid-template-columns:1fr 360px;gap:20px;padding:20px;max-width:1180px;margin:0 auto}
@media (max-width:860px){main{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:16px}
input[type=search]{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:8px;font:inherit}
button{font:inherit;border:1px solid var(--line);background:var(--card);border-radius:8px;padding:7px 12px;cursor:pointer}
button.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.product{border-top:1px solid var(--line);padding:12px 0}.product:first-child{border-top:0}.pname{font-weight:600}.pmeta{color:var(--muted);font-size:13px}
.prices{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.price{border:1px solid var(--line);border-radius:6px;padding:4px 8px;font-size:13px}
.tag{display:inline-block;font-size:11px;font-weight:600;border-radius:4px;padding:1px 5px;margin-left:4px}.tag.demo{background:var(--demo-bg);color:var(--demo)}.tag.real{background:#e6f2ec;color:var(--accent)}.tag.stale{background:var(--warn-bg);color:var(--warn)}
.row{display:flex;justify-content:space-between;gap:8px;align-items:center}.cart-item{padding:8px 0;border-top:1px solid var(--line)}.cart-item:first-child{border-top:0}
.qty{display:flex;gap:4px;align-items:center}.qty button{padding:2px 9px}.empty{color:var(--muted)}
.stop{border:1px solid var(--line);border-radius:8px;padding:10px;margin-top:10px}.total{font-weight:700}.savings{background:#e6f2ec;color:var(--accent);border-radius:8px;padding:10px;margin-top:10px;font-weight:600}
.note{color:var(--muted);font-size:12px;margin-top:10px}select{font:inherit;padding:6px;border-radius:8px;border:1px solid var(--line)}
</style></head><body>
<header><h1>Cesta</h1><p>Busca productos, monta tu cesta y mira en qué supermercado comprar cada parte. Precios de <a href="https://prices.openfoodfacts.org">Open Prices</a> (reales, con fecha) y precios <b>demo</b> (inventados para probar).</p></header>
<main>
<section class="card" aria-labelledby="h-search"><h2 id="h-search" style="font-size:16px;margin:0 0 10px">Buscar</h2>
<input id="q" type="search" placeholder="Nutella, pesto, Barilla…" aria-label="Buscar productos" autocomplete="off">
<div id="results" aria-live="polite" style="margin-top:12px"><p class="empty">Escribe al menos 2 letras.</p></div></section>
<aside class="card" aria-labelledby="h-cart"><h2 id="h-cart" style="font-size:16px;margin:0 0 10px">Tu cesta</h2>
<div id="cart"></div>
<!--CHECKOUT-->
</aside></main>
<script>
const KEY='cesta.v1';const $=s=>document.querySelector(s);
const eur=c=>(c/100).toLocaleString('es-ES',{style:'currency',currency:'EUR'});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let cart=JSON.parse(localStorage.getItem(KEY)||'[]');
const save=()=>{localStorage.setItem(KEY,JSON.stringify(cart));renderCart();};
function add(p){const i=cart.find(x=>x.ean===p.ean);if(i)i.qty++;else cart.push({ean:p.ean,name:p.name,brand:p.brand,size:p.size,qty:1});save();}
function setQty(ean,d){const i=cart.find(x=>x.ean===ean);if(!i)return;i.qty+=d;if(i.qty<1)cart=cart.filter(x=>x.ean!==ean);save();}
function renderCart(){const el=$('#cart');if(!cart.length){el.innerHTML='<p class="empty">Todavía no hay nada. Añade productos desde la búsqueda.</p>';return;}
el.innerHTML=cart.map(i=>'<div class="cart-item row"><div><div class="pname">'+esc(i.name)+'</div><div class="pmeta">'+esc([i.brand,i.size].filter(Boolean).join(' · '))+'</div></div><div class="qty"><button aria-label="Quitar uno de '+esc(i.name)+'" data-d="-1" data-e="'+i.ean+'">−</button><span aria-label="cantidad">'+i.qty+'</span><button aria-label="Añadir uno de '+esc(i.name)+'" data-d="1" data-e="'+i.ean+'">+</button></div></div>').join('');
el.querySelectorAll('button[data-e]').forEach(b=>b.onclick=()=>setQty(b.dataset.e,Number(b.dataset.d)));}
let timer;$('#q').addEventListener('input',e=>{clearTimeout(timer);timer=setTimeout(()=>search(e.target.value),250);});
async function search(q){const r=$('#results');if(q.trim().length<2){r.innerHTML='<p class="empty">Escribe al menos 2 letras.</p>';return;}
const j=await (await fetch('/api/products?q='+encodeURIComponent(q))).json();
if(!j.products.length){r.innerHTML='<p class="empty">Nada encontrado para «'+esc(q)+'».</p>';return;}
r.innerHTML=j.products.map((p,n)=>'<div class="product"><div class="row"><div><div class="pname">'+esc(p.name)+'</div><div class="pmeta">'+esc([p.brand,p.size,'EAN '+p.ean].filter(Boolean).join(' · '))+'</div></div><button class="primary" data-n="'+n+'">Añadir</button></div><div class="prices">'+
p.prices.map(x=>'<span class="price"><b>'+esc(x.chain)+'</b> '+eur(x.cents)+(x.source==='demo'?'<span class="tag demo">demo</span>':'<span class="tag real">Open Prices · '+esc(x.date)+'</span>')+(x.source!=='demo'&&x.stale?'<span class="tag stale">antiguo</span>':'')+'</span>').join('')+'</div></div>').join('');
r.querySelectorAll('button[data-n]').forEach(b=>b.onclick=()=>add(j.products[Number(b.dataset.n)]));}
renderCart();
/*CHECKOUT_JS*/
</script></body></html>`;
