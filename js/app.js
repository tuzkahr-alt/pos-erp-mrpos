// app.js - MrPOS ERP (ESTRUCTURA RESTAURADA + MEJORAS)
document.addEventListener('DOMContentLoaded', () => {

    // 0. PWA & SERVICE WORKER
    let deferredPrompt;
    const btnPwa = document.getElementById('btn-pwa-install');
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault(); deferredPrompt = e;
        if(btnPwa) btnPwa.classList.remove('hidden');
    });
    if(btnPwa) btnPwa.onclick = () => {
        if(!deferredPrompt) return;
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choice) => {
            if(choice.outcome === 'accepted') btnPwa.classList.add('hidden');
            deferredPrompt = null;
        });
    };
    if('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(err => console.log('SW Error:', err));
    }

    // 1. INITIALIZATION & CLOCK
    if(typeof extenderDBConLetras === 'function') extenderDBConLetras(db);

    const updateClock = () => {
        const now = new Date();
        const clockEl = document.getElementById('clock');
        if(clockEl) clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };
    setInterval(updateClock, 1000); updateClock();

    const currentCashierObj = db.activeCashierInfo ? JSON.parse(db.activeCashierInfo) : { name: 'Admin' };
    const avatarImg = document.querySelector('.avatar img');
    if(avatarImg) avatarImg.src = `https://ui-avatars.com/api/?name=${currentCashierObj.name.replace(' ', '+')}&background=2563eb&color=fff`;

    // ===== 2. MODULAR AUTOCOMPLETE (AL ESCRIBIR 1 LETRA) =====
    const setupAutocomplete = (inputId, dropdownId, searchFn, selectFn, displayFn) => {
        const input = document.getElementById(inputId);
        const dropdown = document.getElementById(dropdownId);
        if(!input || !dropdown) return;

        input.addEventListener('input', (e) => {
            const q = e.target.value.trim().toLowerCase();
            if(q.length < 1) return dropdown.classList.add('hidden');
            dropdown.innerHTML = '';
            const results = searchFn(q);
            if(results.length === 0) return dropdown.classList.add('hidden');
            results.slice(0, 5).forEach(r => {
                const div = document.createElement('div');
                div.className = 'autocomplete-item';
                div.innerHTML = displayFn(r);
                div.onclick = () => { selectFn(r); dropdown.classList.add('hidden'); };
                dropdown.appendChild(div);
            });
            dropdown.classList.remove('hidden');
        });
        input.onfocus = () => { if(input.value.length > 0) input.dispatchEvent(new Event('input')); };
    };

    // Global Search (Folios/Client)
    setupAutocomplete('global-search', 'global-search-results', 
        (q) => db.data.sales.filter(s => s.id.toLowerCase().includes(q) || (s.clientId && s.clientId.toLowerCase().includes(q))),
        (s) => alert(`Venta: ${s.id}\nTotal: ${s.total}`),
        (s) => `<strong>${s.id}</strong> - ${s.total}`
    );

    // POS Search (Products)
    setupAutocomplete('pos-search', 'pos-search-results',
        (q) => db.getProducts(q),
        (p) => { db.addToCart(p); window.renderCart(); },
        (p) => `<strong>${p.name}</strong> (${p.sku})`
    );

    // Client modal logic
    setupAutocomplete('search-client-input', 'client-search-results', 
       (q) => db.getClients(q),
       (c) => { db.data.currentClient = c; updateClientUI(); closeModal('modal-client'); },
       (c) => `<strong>${c.name}</strong> (${c.rut})`
    );

    // ===== 3. NAVEGACIÓN Y VISTAS =====
    const navItems = document.querySelectorAll('.nav-item');
    const views = document.querySelectorAll('.view');
    const pageTitle = document.getElementById('current-page-title');
    const pageSubTitle = document.getElementById('current-page-subtitle');

    const navigateTo = (target) => {
        navItems.forEach(n => n.classList.toggle('active', n.dataset.target === target));
        views.forEach(v => v.classList.toggle('active', v.id === target));
        if (target === 'dashboard') loadDashboard();
        if (target === 'pos') renderPOSGrid();
        if (target === 'credits') loadCredits();
        if (target === 'inventory') loadInventory();
        if (target === 'reports') loadReportsCharts();
        if (target === 'workers') loadWorkers();
    };

    navItems.forEach(item => {
        item.addEventListener('click', () => navigateTo(item.dataset.target));
    });

    const formatMoney = (amount) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
    const getLetter = (num) => String.fromCharCode(64 + (num || 1));

    // Dashboard
    const loadDashboard = () => {
        const today = new Date().toISOString().split('T')[0];
        const salesToday = db.data.sales.filter(s => s.date.startsWith(today)).reduce((sum, s) => sum + s.total, 0);
        document.getElementById('kpi-sales').textContent = formatMoney(salesToday);
        document.getElementById('kpi-credits').textContent = formatMoney(db.data.clients.reduce((s,c)=>s+c.debt, 0));
        document.getElementById('kpi-stock').textContent = db.data.products.filter(p => p.stock < 5).length;
    };

    // POS Grid: Limitar a 6
    window.renderPOSGrid = (customList = null) => {
        const grid = document.getElementById('pos-product-grid');
        if(!grid) return; grid.innerHTML = '';
        const list = customList || db.getProducts();
        const displayList = customList ? list : list.slice(0, 6); // 6 Favoritos
        displayList.forEach(p => {
            const card = document.createElement('div');
            card.className = 'product-card';
            card.innerHTML = `<div class="img-placeholder"><i class="fas fa-box"></i></div><h4>${p.name}</h4><div class="price">$${p.price}</div><div class="stock ${p.stock < 10?'text-red':''}">S: ${p.stock}</div>`;
            card.onclick = () => { db.addToCart(p); renderCart(); };
            grid.appendChild(card);
        });
    }

    window.renderCart = () => {
        const items = document.getElementById('cart-items'); if(!items) return; items.innerHTML = '';
        db.data.cart.forEach(it => {
            const div = document.createElement('div'); div.className = 'cart-item';
            div.innerHTML = `<div><h4>${it.name}</h4><p>${it.qty} x ${formatMoney(it.price)}</p></div>`;
            items.appendChild(div);
        });
        document.getElementById('cart-total').textContent = formatMoney(db.data.cart.reduce((s,i)=>s+(i.price*i.qty), 0));
    };

    // ===== 4. MODULOS (MAESTRO, CAJEROS, CREDITOS) =====
    const updateClientUI = () => {
        const d = document.getElementById('selected-client');
        if(d) d.innerHTML = db.data.currentClient ? `<i class="fas fa-user-check"></i> ${db.data.currentClient.name}` : '<i class="fas fa-user-circle"></i> Cliente General';
    };

    // Maestro de Productos (Nuevo Diseño)
    document.getElementById('btn-save-product').onclick = () => {
        const p = {
            sku: document.getElementById('m-codigo').value, name: document.getElementById('m-desc').value,
            price: parseInt(document.getElementById('m-pventa').value) || 0,
            stock: parseInt(document.getElementById('m-sact').value) || 0,
            tax: document.getElementById('m-impto').value,
            active: document.getElementById('m-activo').checked
        };
        if(!p.sku || !p.name) return alert("Complete Código y Descripción.");
        db.addProduct(p); closeModal('modal-product'); loadInventory(); renderPOSGrid();
        alert("Producto agregado al Maestro.");
    };

    // Cajeros
    document.getElementById('btn-new-worker').onclick = () => openModal('modal-worker');
    document.getElementById('btn-create-worker').onclick = () => {
        const n = document.getElementById('new-worker-name').value;
        const p = document.getElementById('new-worker-pin').value;
        if(n && p) { db.addWorker({name: n, pin: p}); closeModal('modal-worker'); loadWorkers(); alert("Cajero agregado."); }
    };

    // Configuración & Stock Adj
    document.getElementById('btn-settings').onclick = () => {
        const l = document.getElementById('providers-list'); l.innerHTML = '';
        db.data.providers.forEach(p => l.innerHTML += `<li>${p.name}</li>`);
        const adj = document.getElementById('adj-product');
        adj.innerHTML = db.data.products.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
        switchTab('modal-settings', 'providers'); openModal('modal-settings');
    };
    document.getElementById('btn-save-provider').onclick = () => {
        const v = document.getElementById('new-provider-name').value;
        if(v) { db.addProvider({name: v}); document.getElementById('btn-settings').click(); }
    };
    document.getElementById('btn-save-stock-adj').onclick = () => {
        const id = document.getElementById('adj-product').value;
        const q = parseInt(document.getElementById('adj-stock-qty').value || 0);
        const p = db.data.products.find(x => x.id === id);
        if(p) { p.stock = q; db.save(); alert("Stock rectificado."); loadInventory(); renderPOSGrid(); }
    };

    // Payments
    let currentPaymentMethod = 'cash';
    document.querySelectorAll('.method-card').forEach(card => {
        card.onclick = () => {
            document.querySelectorAll('.method-card').forEach(x => x.classList.remove('active'));
            card.classList.add('active'); currentPaymentMethod = card.dataset.method;
            if(document.getElementById('letras-options')) document.getElementById('letras-options').classList.toggle('hidden', currentPaymentMethod !== 'letras');
        };
    });
    document.getElementById('btn-pay').onclick = () => {
        const t = db.data.cart.reduce((s,i)=>s+(i.price*i.qty),0);
        if(t > 0) { document.getElementById('payment-total-display').textContent = formatMoney(t); openModal('modal-payment'); }
    };
    document.getElementById('btn-confirm-payment').onclick = () => {
        if(currentPaymentMethod === 'letras') {
            if(!db.data.currentClient) return alert("Seleccione un cliente.");
             db.registrarVentaConLetras(parseInt(document.getElementById('letras-n-cuotas').value));
        } else {
            db.registerSale(currentPaymentMethod, false);
        }
        closeModal('modal-payment'); renderCart(); renderPOSGrid(); updateClientUI(); alert("VENTA FINALIZADA.");
    };

    // Loaders
    window.loadInventory = () => {
        const b = document.getElementById('inventory-body'); if(!b) return; b.innerHTML = '';
        db.data.products.forEach(p => b.innerHTML += `<tr><td>${p.sku}</td><td>${p.name}</td><td>${formatMoney(p.price)}</td><td>${p.stock}</td><td><button onclick="window.deleteProd('${p.id}')"><i class="fas fa-trash"></i></button></td></tr>`);
    };
    window.deleteProd = (id) => { db.data.products=db.data.products.filter(x=>x.id!==id); db.save(); loadInventory(); renderPOSGrid(); };
    window.loadWorkers = () => {
        const b = document.getElementById('workers-body'); if(!b) return; b.innerHTML = '';
        db.data.workers.forEach(w => b.innerHTML += `<tr><td>${w.id}</td><td>${w.name}</td><td>${w.pin}</td><td>${w.status}</td></tr>`);
    };
    window.loadCredits = () => {
        const b = document.getElementById('credits-body'); if(!b) return; b.innerHTML = '';
        db.data.quotas.forEach(q => b.innerHTML += `<tr><td>${q.clientName}</td><td>${q.saleId}</td><td>Letra ${getLetter(q.num_quota)}</td><td>${formatMoney(q.amount)}</td><td>${q.status}</td><td><button onclick="window.payCredit('${q.id}')">Pagar</button></td></tr>`);
    };
    window.payCredit = (id) => { const q = db.data.quotas.find(x=>x.id===id); if(q){q.status='PAGADO';db.save();loadCredits();} };

    // Reports
    let chartDaily = null, chartWeekly = null;
    const loadReportsCharts = () => {
        const c1El = document.getElementById('chartDaily'); const c2El = document.getElementById('chartWeekly');
        if(!c1El || !c2El) return;
        if(chartDaily) chartDaily.destroy(); if(chartWeekly) chartWeekly.destroy();
        chartDaily = new Chart(c1El.getContext('2d'), { type:'doughnut', data:{labels:['Ef','Tar'], datasets:[{data:[60,40],backgroundColor:['#2563eb','#38c172']}]} });
        chartWeekly = new Chart(c2El.getContext('2d'), { type:'bar', data:{labels:['S1','S2'], datasets:[{label:'Ventas',data:[100,150],backgroundColor:'#38c172'}]} });
    };

    // Helpers
    window.openModal = (id) => document.getElementById(id).classList.add('active');
    window.closeModal = (id) => document.getElementById(id).classList.remove('active');
    window.switchTab = (m, t) => { 
        const mod = document.getElementById(m); if(!mod) return;
        mod.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active', x.dataset.tab===t));
        mod.querySelectorAll('.tab-content').forEach(x=>x.classList.toggle('hidden', x.id!=='tab-'+t));
    };
    document.querySelectorAll('.btn-close-modal').forEach(b => b.onclick = () => b.closest('.modal-overlay').classList.remove('active'));
    
    // Init
    navigateTo('pos'); updateClientUI();
});
