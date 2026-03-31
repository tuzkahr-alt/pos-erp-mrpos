// app.js - Lógica ERP Premium Unificada
document.addEventListener('DOMContentLoaded', () => {
    // Inicializar módulo de Letras
    if(typeof extenderDBConLetras === 'function') extenderDBConLetras(db);

    // ===== SYSTEM CLOCK =====
    const updateClock = () => {
        const now = new Date();
        document.getElementById('clock').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };
    setInterval(updateClock, 1000);
    updateClock();

    const currentCashierName = db.activeCashierInfo ? JSON.parse(db.activeCashierInfo).name : 'Admin';
    document.querySelector('.avatar img').src = `https://ui-avatars.com/api/?name=${currentCashierName.replace(' ', '+')}&background=2563eb&color=fff`;

    // ===== ROUTING =====
    const navItems = document.querySelectorAll('.nav-item');
    const views = document.querySelectorAll('.view');
    const pageTitle = document.getElementById('current-page-title');
    const pageSubTitle = document.getElementById('current-page-subtitle');

    const viewTitles = {
        'dashboard': { t: 'Dashboard', s: 'Resumen gerencial' },
        'pos': { t: 'Punto de Venta', s: 'Ventas y Emisión' },
        'credits': { t: 'Cobranzas y Créditos', s: 'Gestión de Letras y Abonos' },
        'inventory': { t: 'Inventario', s: 'Maestro de Artículos' },
        'reports': { t: 'Informes y Estadísticas', s: 'Análisis de datos' },
        'workers': { t: 'Personal', s: 'Gestión de Cajeros' }
    };

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const target = item.dataset.target;
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            views.forEach(v => v.classList.remove('active'));
            document.getElementById(target).classList.add('active');
            if (viewTitles[target]) {
                pageTitle.textContent = viewTitles[target].t;
                pageSubTitle.textContent = viewTitles[target].s;
            }
            if (target === 'dashboard') loadDashboard();
            if (target === 'pos') renderPOSProducts();
            if (target === 'credits') loadCredits();
            if (target === 'inventory') loadInventory();
            if (target === 'reports') loadReportsCharts();
            if (target === 'workers') loadWorkers();
        });
    });

    const formatMoney = (amount) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
    const getLetter = (num) => String.fromCharCode(64 + num);

    // ===== 1. DASHBOARD =====
    let dashboardChart = null;
    const loadDashboard = () => {
        const today = new Date().toISOString().split('T')[0];
        const todaySales = db.data.sales.filter(s => s.date.startsWith(today)).reduce((sum, s) => sum + s.total, 0);
        document.getElementById('kpi-sales').textContent = formatMoney(todaySales);
        document.getElementById('kpi-credits').textContent = formatMoney(db.data.clients.reduce((s,p)=>s+p.debt, 0));
        document.getElementById('kpi-stock').textContent = db.data.products.filter(p => p.stock < 5).length;

        const ctx = document.getElementById('chartSales').getContext('2d');
        if(dashboardChart) dashboardChart.destroy();
        dashboardChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['L','M','X','J','V','S','D'],
                datasets: [{ label: 'Ventas $', data: [75000, 89000, 120000, 150000, 240000, 310000, 180000], backgroundColor:'#1a73e8' }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    };

    // ===== 2. POS SEARCH & GRID =====
    const renderPOSProducts = (customList = null) => {
        const grid = document.getElementById('pos-product-grid');
        grid.innerHTML = '';
        let products = customList || db.getProducts();
        const displayList = customList ? products : products.slice(0, 8);
        displayList.forEach(p => {
            const div = document.createElement('div');
            div.className = 'product-card';
            div.innerHTML = `
                <div class="img-placeholder"><i class="fas fa-box"></i></div>
                <h4 title="${p.name}">${p.name}</h4>
                <div class="price">${formatMoney(p.price)} ${p.talla ? `<small>(${p.talla})</small>`:''}</div>
                <div class="stock ${p.stock <= 5 ? 'text-red' : ''}">Stock: ${p.stock}</div>
            `;
            div.onclick = () => { db.addToCart(p); renderCart(); };
            grid.appendChild(div);
        });
    };

    document.getElementById('pos-search').addEventListener('input', (e) => {
        const q = e.target.value.trim();
        if(q.length > 0) renderPOSProducts(db.getProducts(q));
        else renderPOSProducts();
    });

    const globalSearch = document.getElementById('global-search');
    const globalResults = document.getElementById('global-search-results');
    globalSearch.addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        if(q.length < 1) return globalResults.classList.add('hidden');
        globalResults.innerHTML = '';
        const matchingSales = db.data.sales.filter(s => s.id.toLowerCase().includes(q));
        matchingSales.slice(0, 5).forEach(s => {
            const div = document.createElement('div');
            div.className = 'autocomplete-item';
            div.innerHTML = `<span><strong>Folio: ${s.id}</strong></span> <span>${formatMoney(s.total)}</span>`;
            div.onclick = () => { alert(`Venta Folio ${s.id}`); globalResults.classList.add('hidden'); };
            globalResults.appendChild(div);
        });
        if(matchingSales.length > 0) globalResults.classList.remove('hidden');
        else globalResults.classList.add('hidden');
    });

    // ===== 3. CLIENTES: BUSQUEDA Y NUEVO =====
    const updateClientUI = () => {
        const div = document.getElementById('selected-client');
        if(db.data.currentClient) div.innerHTML = `<i class="fas fa-user-check"></i> ${db.data.currentClient.name}`;
        else div.innerHTML = `<i class="fas fa-user-circle"></i> Mostrar Cliente General`;
    };

    const renderClientResults = (q = '') => {
        const results = document.getElementById('client-search-results');
        results.innerHTML = '';
        const clients = db.getClients(q);
        clients.forEach(c => {
            const li = document.createElement('li');
            li.innerHTML = `<strong>${c.name}</strong> - ${c.rut}`;
            li.onclick = () => {
                db.data.currentClient = c;
                updateClientUI();
                closeModal('modal-client');
            };
            results.appendChild(li);
        });
    };

    document.getElementById('btn-add-client').addEventListener('click', () => {
        switchTab('modal-client', 'new');
        openModal('modal-client');
    });

    document.getElementById('btn-search-client').addEventListener('click', () => {
        switchTab('modal-client', 'search');
        renderClientResults();
        openModal('modal-client');
    });

    document.getElementById('search-client-input').addEventListener('input', (e) => {
        renderClientResults(e.target.value);
    });

    document.getElementById('btn-save-client').addEventListener('click', () => {
        const rut = document.getElementById('new-client-rut').value;
        const name = document.getElementById('new-client-name').value;
        const giro = document.getElementById('new-client-giro').value;
        const limit = parseInt(document.getElementById('new-client-limit').value);
        
        if(!rut || !name) return alert('Por favor ingrese RUT y Nombre');
        
        const newC = db.addClient({ rut, name, giro, limit_credit: limit });
        db.data.currentClient = newC;
        updateClientUI();
        closeModal('modal-client');
        alert("Cliente guardado y seleccionado.");
        
        // Limpiar
        document.getElementById('new-client-rut').value = '';
        document.getElementById('new-client-name').value = '';
    });

    // ===== 4. COBRANZAS (LETRAS) =====
    const loadCredits = () => {
        const body = document.getElementById('credits-body');
        body.innerHTML = '';
        db.data.quotas.forEach(q => {
            const tr = document.createElement('tr');
            const letra = getLetter(q.num_quota);
            tr.innerHTML = `<td>${q.clientName}</td><td>${q.saleId}</td><td class="text-blue fw-bold">Letra ${letra}</td><td>${q.dueDate}</td><td>${formatMoney(q.amount)}</td><td>$0</td><td><span class="badge ${q.status==='pagado'?'badge-green':'badge-orange'}">${q.status.toUpperCase()}</span></td><td><button class="btn-primary" onclick="payLetter('${q.id}')">Pagar</button></td>`;
            body.appendChild(tr);
        });
    };

    window.payLetter = (id) => {
        const q = db.data.quotas.find(x => x.id === id);
        if(q && q.status !== 'pagado') {
            q.status = 'pagado';
            const client = db.data.clients.find(c => c.id === q.clientId);
            if(client) client.debt -= q.amount;
            db.save();
            loadCredits();
        }
    };

    // ===== 5. REPORTS =====
    let chartD = null, chartW = null;
    const loadReportsCharts = () => {
        const ctxD = document.getElementById('chartDaily').getContext('2d');
        const ctxW = document.getElementById('chartWeekly').getContext('2d');
        if(chartD) chartD.destroy();
        if(chartW) chartW.destroy();
        chartD = new Chart(ctxD, { type: 'doughnut', data: { labels: ['Ventas','Créditos'], datasets: [{ data: [350000, 120000], backgroundColor: ['#2563eb', '#38c172'] }] }, options: { responsive: true, maintainAspectRatio: false } });
        chartW = new Chart(ctxW, { type: 'line', data: { labels: ['Lun','Mar','Mie','Jue','Vie','Sab','Dom'], datasets: [{ label: 'Ventas Semanales', data:[12, 19, 3, 5, 2, 3, 7], borderColor:'#1a73e8' }] }, options: { responsive: true, maintainAspectRatio: false } });
    };

    // ===== 6. INVENTARIO =====
    const loadInventory = () => {
        const body = document.getElementById('inventory-body');
        body.innerHTML = '';
        db.data.products.forEach(p => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${p.sku}</td><td>${p.name}</td><td>${p.talla || 'U'} / ${p.genero || 'U'}</td><td>${formatMoney(p.price)}</td><td>${p.stock}</td><td><button class="btn-icon text-red" onclick="deleteProd('${p.id}')"><i class="fas fa-trash"></i></button></td>`;
            body.appendChild(tr);
        });
    };

    window.deleteProd = (id) => {
        if(confirm('¿Eliminar producto?')) {
            db.data.products = db.data.products.filter(p => p.id !== id);
            db.save();
            loadInventory();
        }
    };

    document.getElementById('btn-open-new-product').addEventListener('click', () => {
        const provSel = document.getElementById('new-prod-prov');
        provSel.innerHTML = db.data.providers.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
        openModal('modal-product');
    });

    document.getElementById('btn-save-product').addEventListener('click', () => {
        const p = { name: document.getElementById('new-prod-name').value, sku: document.getElementById('new-prod-sku').value, talla: document.getElementById('new-prod-talla').value, genero: document.getElementById('new-prod-genero').value, price: parseInt(document.getElementById('new-prod-price').value), stock: parseInt(document.getElementById('new-prod-stock').value), brand: document.getElementById('new-prod-brand').value, provider: document.getElementById('new-prod-prov').value };
        db.addProduct(p);
        closeModal('modal-product');
        loadInventory();
    });

    // ===== 7. CARRITO & PAGOS =====
    const renderCart = () => {
        const items = document.getElementById('cart-items');
        items.innerHTML = '';
        db.data.cart.forEach(it => {
            const div = document.createElement('div');
            div.className = 'cart-item';
            div.innerHTML = `<div><h4>${it.name}</h4><p>${it.qty} x ${formatMoney(it.price)}</p></div>`;
            items.appendChild(div);
        });
        document.getElementById('cart-total').textContent = formatMoney(db.data.cart.reduce((s,i)=>s+(i.price*i.qty), 0));
    };

    document.getElementById('btn-confirm-payment').addEventListener('click', () => {
        const method = document.querySelector('.method-card.active').dataset.method;
        if(method === 'letras') {
             if(!db.data.currentClient) return alert("Debe seleccionar cliente");
             const n = parseInt(document.getElementById('letras-n-cuotas').value);
             db.registrarVentaConLetras(n);
        } else {
             db.registerSale(method, false);
        }
        closeModal('modal-payment');
        renderCart();
        renderPOSProducts();
        updateClientUI();
    });

    document.querySelectorAll('.method-card').forEach(c => {
        c.onclick = () => {
            document.querySelectorAll('.method-card').forEach(x => x.classList.remove('active'));
            c.classList.add('active');
            if(c.dataset.method === 'letras') document.getElementById('letras-options').classList.remove('hidden');
            else document.getElementById('letras-options').classList.add('hidden');
        };
    });

    // Modal & Tab Helpers
    const openModal = (id) => document.getElementById(id).classList.add('active');
    const closeModal = (id) => document.getElementById(id).classList.remove('active');
    const switchTab = (modalId, tabName) => {
        const modal = document.getElementById(modalId);
        modal.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        modal.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
        modal.querySelector(`.tab[data-tab="${tabName}"]`).classList.add('active');
        modal.querySelector(`#tab-${tabName}`).classList.remove('hidden');
    };
    document.querySelectorAll('.tab').forEach(tab => {
        tab.onclick = () => switchTab(tab.closest('.modal-overlay').id, tab.dataset.tab);
    });
    document.querySelectorAll('.btn-close-modal').forEach(b => b.onclick = () => b.closest('.modal-overlay').classList.remove('active'));

    // Init
    renderPOSProducts();
    updateClientUI();
});
