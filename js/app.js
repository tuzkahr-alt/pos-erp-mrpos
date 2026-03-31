// app.js - ERP Maestro: Versión 4.0 (Scoping Fix & Full Sync)
// Esta versión garantiza que las funciones de refresco sean accesibles y estables.

document.addEventListener('DOMContentLoaded', () => {
    // 0. INTEGRACIÓN: Letras de Cambio
    if(typeof extenderDBConLetras === 'function') extenderDBConLetras(db);

    // ===== RELOJ Y INFO CAJERO =====
    const updateClock = () => {
        const now = new Date();
        const clockEl = document.getElementById('clock');
        if(clockEl) clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };
    setInterval(updateClock, 1000); updateClock();

    const currentCashierObj = db.activeCashierInfo ? JSON.parse(db.activeCashierInfo) : { name: 'Admin' };
    const avatarImg = document.querySelector('.avatar img');
    if(avatarImg) avatarImg.src = `https://ui-avatars.com/api/?name=${currentCashierObj.name.replace(' ', '+')}&background=2563eb&color=fff`;

    // ===== NAVEGACIÓN ENTRE MÓDULOS =====
    const navItems = document.querySelectorAll('.nav-item');
    const views = document.querySelectorAll('.view');
    const pageTitle = document.getElementById('current-page-title');
    const pageSubTitle = document.getElementById('current-page-subtitle');

    const viewTitles = {
        'dashboard': { t: 'Dashboard', s: 'Vista gerencial del negocio' },
        'pos': { t: 'Punto de Venta', s: 'Ventas y Registro de Documentos' },
        'credits': { t: 'Créditos y Cobranzas', s: 'Gestión de Letras A, B, C...' },
        'inventory': { t: 'Bodega e Inventario', s: 'Maestro de Productos ERP' },
        'reports': { t: 'Informes Operativos', s: 'Análisis detallado de transacciones' },
        'workers': { t: 'Cajeros', s: 'Gestión de Terminales' }
    };

    const navigateTo = (target) => {
        navItems.forEach(n => n.classList.toggle('active', n.dataset.target === target));
        views.forEach(v => v.classList.toggle('active', v.id === target));
        if (viewTitles[target]) {
            pageTitle.textContent = viewTitles[target].t;
            pageSubTitle.textContent = viewTitles[target].s;
        }
        if (target === 'dashboard') loadDashboard();
        if (target === 'pos') renderPOSGrid();
        if (target === 'credits') loadCredits();
        if (target === 'inventory') loadInventory();
        if (target === 'reports') loadReportsCharts();
    };

    navItems.forEach(item => {
        item.addEventListener('click', () => navigateTo(item.dataset.target));
    });

    const formatMoney = (amount) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
    const getLetter = (num) => String.fromCharCode(64 + (num || 1));

    // ===== 1. DASHBOARD =====
    let salesChart = null;
    const loadDashboard = () => {
        const today = new Date().toISOString().split('T')[0];
        const salesToday = db.data.sales.filter(s => s.date.startsWith(today)).reduce((sum, s) => sum + s.total, 0);
        const kpiSales = document.getElementById('kpi-sales');
        if(kpiSales) kpiSales.textContent = formatMoney(salesToday);
        const kpiCredits = document.getElementById('kpi-credits');
        if(kpiCredits) kpiCredits.textContent = formatMoney(db.data.clients.reduce((s,c)=>s+c.debt, 0));
        const kpiStock = document.getElementById('kpi-stock');
        if(kpiStock) kpiStock.textContent = db.data.products.filter(p => p.stock < 5).length;

        const chartCanvas = document.getElementById('chartSales');
        if(chartCanvas) {
            const ctx = chartCanvas.getContext('2d');
            if(salesChart) salesChart.destroy();
            salesChart = new Chart(ctx, { type: 'bar', data: { labels: ['Lun','Mar','Mie','Jue','Vie','Sab','Dom'], datasets: [{ label: 'Ventas Semanales $', data:[120000, 190000, 30000, 50000, 20000, 300000, 450000], backgroundColor: '#2563eb' }] }, options: { responsive:true, maintainAspectRatio:false }});
        }
    };

    // ===== 2. POS: PRODUCTOS Y CARRITO =====
    window.renderPOSGrid = (customList = null) => {
        const grid = document.getElementById('pos-product-grid');
        if(!grid) return;
        grid.innerHTML = '';
        const list = customList || db.getProducts();
        const displayList = (customList || list.length <= 8) ? list : list.slice(0, 8);
        
        displayList.forEach(p => {
            const card = document.createElement('div');
            card.className = 'product-card';
            card.innerHTML = `
                <div class="img-placeholder"><i class="fas fa-box"></i></div>
                <h4 title="${p.name}">${p.name}</h4>
                <div class="price">${formatMoney(p.price)} <small>${p.talla || 'U'}</small> ${p.genero ? `<small>(${p.genero[0]})</small>`:''}</div>
                <div class="stock ${p.stock < 10 ? 'text-red':''}">Stock: ${p.stock}</div>
            `;
            card.onclick = () => { db.addToCart(p); renderCart(); };
            grid.appendChild(card);
        });
    }

    const posSearch = document.getElementById('pos-search');
    if(posSearch) {
        posSearch.addEventListener('input', (e) => {
            const q = e.target.value.trim();
            if(q.length > 0) renderPOSGrid(db.getProducts(q));
            else renderPOSGrid();
        });
    }

    window.renderCart = () => {
        const cartItems = document.getElementById('cart-items');
        if(!cartItems) return;
        cartItems.innerHTML = '';
        let total = 0;
        db.data.cart.forEach(item => {
            total += (item.price * item.qty);
            const div = document.createElement('div');
            div.className = 'cart-item';
            div.innerHTML = `<div><h4>${item.name}</h4><p>${item.qty} x ${formatMoney(item.price)}</p></div>`;
            cartItems.appendChild(div);
        });
        document.getElementById('cart-total').textContent = formatMoney(total);
        document.getElementById('cart-subtotal').textContent = formatMoney(total);
    };

    // ===== 3. CLIENTES: BUSCAR / NUEVO =====
    const updateClientUI = () => {
        const div = document.getElementById('selected-client');
        if(div) div.innerHTML = db.data.currentClient ? `<i class="fas fa-user-check"></i> ${db.data.currentClient.name}` : `<i class="fas fa-user-circle"></i> Mostrar Cliente General`;
    };

    const btnAddClient = document.getElementById('btn-add-client');
    if(btnAddClient) btnAddClient.onclick = () => { switchTab('modal-client','new'); openModal('modal-client'); };
    
    const btnSearchClient = document.getElementById('btn-search-client');
    if(btnSearchClient) btnSearchClient.onclick = () => { switchTab('modal-client','search'); renderClientSearchResults(''); openModal('modal-client'); };

    const renderClientSearchResults = (q) => {
        const list = document.getElementById('client-search-results'); 
        if(!list) return;
        list.innerHTML = '';
        db.getClients(q).forEach(c => {
            const li = document.createElement('li'); li.innerHTML = `<strong>${c.name}</strong> - ${c.rut}`;
            li.onclick = () => { db.data.currentClient = c; updateClientUI(); closeModal('modal-client'); };
            list.appendChild(li);
        });
    }
    const searchClientInput = document.getElementById('search-client-input');
    if(searchClientInput) searchClientInput.oninput = (e) => renderClientSearchResults(e.target.value);

    document.getElementById('btn-save-client').onclick = () => {
        const rut = document.getElementById('new-client-rut').value;
        const name = document.getElementById('new-client-name').value;
        const limit = parseInt(document.getElementById('new-client-limit').value || 100000);
        if(!rut || !name) return alert("Ingrese datos básicos");
        const nc = db.addClient({ rut, name, giro: document.getElementById('new-client-giro').value, limit_credit: limit });
        db.data.currentClient = nc; updateClientUI(); closeModal('modal-client'); alert("Cliente Registrado");
    };

    // ===== 4. PAGOS Y MODULOS =====
    let currentPaymentMethod = 'cash';
    document.querySelectorAll('.method-card').forEach(card => {
        card.onclick = () => {
            document.querySelectorAll('.method-card').forEach(x => x.classList.remove('active'));
            card.classList.add('active'); 
            currentPaymentMethod = card.dataset.method;
            const letrasOpt = document.getElementById('letras-options');
            if(letrasOpt) letrasOpt.classList.toggle('hidden', currentPaymentMethod !== 'letras');
        };
    });

    document.getElementById('btn-pay').onclick = () => {
        const total = db.data.cart.reduce((s,i)=>s+(i.price*i.qty), 0);
        if(total === 0) return alert("CARRITO VACÍO");
        document.getElementById('payment-total-display').textContent = formatMoney(total);
        openModal('modal-payment');
    };

    document.getElementById('btn-confirm-payment').onclick = () => {
        if(currentPaymentMethod === 'letras') {
            if(!db.data.currentClient) return alert("Debe seleccionar cliente para pagar con letras");
            const n = parseInt(document.getElementById('letras-n-cuotas').value);
            const res = db.registrarVentaConLetras(n);
            if(!res.success) return alert(res.error);
        } else {
            db.registerSale(currentPaymentMethod, false);
        }
        closeModal('modal-payment'); 
        db.data.currentClient = null; updateClientUI(); 
        renderCart(); renderPOSGrid();
        alert("¡VENTA FINALIZADA EXITOSAMENTE!");
    };

    // Configuración
    document.getElementById('btn-settings').onclick = () => {
        const pList = document.getElementById('providers-list'); 
        if(pList) {
            pList.innerHTML = '';
            db.data.providers.forEach(p => pList.innerHTML += `<li>${p.name}</li>`);
        }
        const adjSel = document.getElementById('adj-product');
        if(adjSel) adjSel.innerHTML = db.data.products.map(p => `<option value="${p.id}">${p.name} (SKU: ${p.sku})</option>`).join('');
        switchTab('modal-settings', 'providers');
        openModal('modal-settings');
    };

    document.getElementById('btn-save-product').onclick = () => {
        const name = document.getElementById('new-prod-name').value;
        const sku = document.getElementById('new-prod-sku').value;
        const price = parseInt(document.getElementById('new-prod-price').value || 0);
        if(!name || !sku || price <= 0) return alert("Nombre, SKU y Precio son obligatorios");

        const p = { 
            name: name, sku: sku,
            talla: document.getElementById('new-prod-talla').value || 'U',
            genero: document.getElementById('new-prod-genero').value || 'Unisex',
            price: price,
            stock: parseInt(document.getElementById('new-prod-stock').value || 0),
            brand: document.getElementById('new-prod-brand').value || '',
            provider: document.getElementById('new-prod-prov').value || 'General'
        };
        db.addProduct(p);
        closeModal('modal-product'); loadInventory(); renderPOSGrid();
        alert("Producto agregado exitosamente.");
    };

    document.getElementById('btn-save-provider').onclick = () => {
        const nInput = document.getElementById('new-provider-name');
        if(nInput && nInput.value) { 
            db.addProvider({name: nInput.value}); 
            document.getElementById('btn-settings').click(); 
        }
    };

    document.getElementById('btn-save-stock-adj').onclick = () => {
        const pid = document.getElementById('adj-product').value;
        const qtyValue = document.getElementById('adj-stock-qty').value;
        const qty = parseInt(qtyValue || 0);
        const prod = db.data.products.find(x => x.id === pid);
        if(prod) { 
            prod.stock = qty; db.save(); 
            alert("Stock ajustado manual."); 
            renderPOSGrid(); loadInventory(); 
        }
    };

    // ===== 5. REPORTES =====
    document.getElementById('btn-generate-report').onclick = () => {
        const type = document.getElementById('report-type').value;
        const thead = document.getElementById('report-head');
        const tbody = document.getElementById('report-body');
        document.getElementById('report-title').textContent = document.getElementById('report-type').options[document.getElementById('report-type').selectedIndex].text;
        thead.innerHTML = ''; tbody.innerHTML = '';
        const sales = db.data.sales || [];

        if (type === 'sales_day') {
            thead.innerHTML = '<tr><th>Fecha</th><th>Total Ventas</th></tr>';
            const days = {}; sales.forEach(s => { const d = s.date.split('T')[0]; days[d] = (days[d]||0) + s.total; });
            Object.keys(days).forEach(d => tbody.innerHTML += `<tr><td>${d}</td><td>${formatMoney(days[d])}</td></tr>`);
        } else if (type === 'sales_product') {
            thead.innerHTML = '<tr><th>Artículo</th><th>Cantidad</th><th>Monto</th></tr>';
            const items = {}; sales.forEach(s => s.items.forEach(i => { items[i.name] = (items[i.name]||{q:0, t:0}); items[i.name].q += i.qty; items[i.name].t += (i.qty*i.price); }));
            Object.keys(items).forEach(k => tbody.innerHTML += `<tr><td>${k}</td><td>${items[k].q}</td><td>${formatMoney(items[k].t)}</td></tr>`);
        } else {
             thead.innerHTML = '<tr><th>Concepto</th><th>Monto General</th></tr>';
             tbody.innerHTML = '<tr><td>Resumen Seleccionado</td><td>...generando datos...</td></tr>';
        }
    };

    let chartDaily = null, chartWeekly = null;
    const loadReportsCharts = () => {
        const c1El = document.getElementById('chartDaily');
        const c2El = document.getElementById('chartWeekly');
        if(!c1El || !c2El) return;
        const c1 = c1El.getContext('2d');
        const c2 = c2El.getContext('2d');
        if(chartDaily) chartDaily.destroy(); if(chartWeekly) chartWeekly.destroy();
        chartDaily = new Chart(c1, { type: 'doughnut', data:{ labels:['Efectivo','Otros'], datasets:[{ data:[70,30], backgroundColor:['#2563eb','#38c172'] }] }, options:{maintainAspectRatio:false} });
        chartWeekly = new Chart(c2, { type: 'bar', data:{ labels:['Lun','Mar','Mie','Jue','Vie'], datasets:[{label:'Ventas', data:[12, 19, 3, 5, 2], backgroundColor:'#38c172' }] }, options:{maintainAspectRatio:false} });
    };

    // ===== 6. REFRESHABLE GLOBAL FUNCTIONS =====
    window.loadCredits = () => {
        const body = document.getElementById('credits-body'); 
        if(!body) return;
        body.innerHTML = '';
        db.data.quotas.forEach(q => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${q.clientName}</td><td>${q.saleId}</td><td class="text-blue fw-bold">Letra ${getLetter(q.num_quota)}</td>
                <td>${q.dueDate}</td><td>${formatMoney(q.amount)}</td><td>$0</td>
                <td><span class="badge ${q.status==='pagado'?'badge-green':'badge-orange'}">${q.status.toUpperCase()}</span></td>
                <td><button class="btn-primary" onclick="window.payQuotaAtCredit('${q.id}')">Pagar</button></td>`;
            body.appendChild(tr);
        });
    };

    window.payQuotaAtCredit = (id) => {
        if(db.pagarLetra(id)) { alert("Pago registrado exitosamente"); window.loadCredits(); }
    };

    window.loadInventory = () => {
        const body = document.getElementById('inventory-body'); 
        if(!body) return;
        body.innerHTML = '';
        db.data.products.forEach(p => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${p.sku}</td><td>${p.name}</td><td>${p.talla || 'U'} / ${p.genero || 'U'}</td><td>${formatMoney(p.price)}</td><td>${p.stock}</td><td><button class="btn-icon text-red" onclick="window.deleteProductAtInventory('${p.id}')"><i class="fas fa-trash"></i></button></td>`;
            body.appendChild(tr);
        });
    };

    window.deleteProductAtInventory = (id) => {
        if(confirm('¿Seguro de eliminar este artículo?')) {
            db.data.products = db.data.products.filter(x => x.id !== id);
            db.save(); window.loadInventory(); window.renderPOSGrid();
        }
    };

    // MODAL HELPERS
    window.openModal = (id) => { const el = document.getElementById(id); if(el) el.classList.add('active'); };
    window.closeModal = (id) => { const el = document.getElementById(id); if(el) el.classList.remove('active'); };
    window.switchTab = (m, t) => { 
        const mod = document.getElementById(m); 
        if(!mod) return;
        mod.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === t));
        mod.querySelectorAll('.tab-content').forEach(x => x.classList.toggle('hidden', x.id !== 'tab-' + t));
    };
    document.querySelectorAll('.btn-close-modal').forEach(b => b.onclick = () => b.closest('.modal-overlay').classList.remove('active'));

    // Init Logic
    navigateTo('pos');
});
