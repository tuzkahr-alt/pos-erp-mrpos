// app.js - Lógica ERP Premium con Gráficos y Búsqueda Avanzada (Restaurado y Mejorado)
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

    // ===== SYSTEM CLOCK =====
    const updateClock = () => {
        const now = new Date();
        const clockEl = document.getElementById('clock');
        if(clockEl) clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };
    setInterval(updateClock, 1000);
    updateClock();

    const currentCashierName = db.activeCashierInfo ? JSON.parse(db.activeCashierInfo).name : 'Admin';
    const avatarImg = document.querySelector('.avatar img');
    if(avatarImg) avatarImg.src = `https://ui-avatars.com/api/?name=${currentCashierName.replace(' ', '+')}&background=2563eb&color=fff`;

    // ===== ROUTING (Views) =====
    const navItems = document.querySelectorAll('.nav-item');
    const views = document.querySelectorAll('.view');
    const pageTitle = document.getElementById('current-page-title');
    const pageSubTitle = document.getElementById('current-page-subtitle');

    const viewTitles = {
        'dashboard': { t: 'Dashboard', s: 'Resumen genérico del negocio' },
        'pos': { t: 'Punto de Venta', s: 'Ventas y Emisión de Documentos' },
        'inventory': { t: 'Bodega e Inventario', s: 'Maestro de Productos y Ajustes' },
        'people': { t: 'Maestro de Personas', s: 'Gestión de Clientes, Proveedores y Personal' },
        'credits': { t: 'Gestión de Crédito', s: 'Ctas. Ctes. y Cobranza de Cuotas' },
        'workers': { t: 'Cajeros', s: 'Instancias de Terminal Activas' },
        'reports': { t: 'Reportes ERP', s: 'Informes de Gestión y Exportación' }
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
            if (target === 'inventory') loadInventory();
            if (target === 'people') loadPeople();
            if (target === 'credits') loadCredits();
            if (target === 'workers') loadWorkers();
            if (target === 'reports') {
                const btnGen = document.getElementById('btn-generate-report');
                if(btnGen) btnGen.click();
                loadReportsCharts();
            }
        });
    });

    const formatMoney = (amount) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
    const getLetter = (num) => String.fromCharCode(64 + num);

    // ===== 1. DASHBOARD & KPIs =====
    let dashboardChart = null;
    const loadDashboard = () => {
        const today = new Date().toISOString().split('T')[0];
        const todaySales = db.data.sales.filter(s => s.date.startsWith(today)).reduce((sum, s) => sum + s.total, 0);
        document.getElementById('kpi-sales').textContent = formatMoney(todaySales);
        document.getElementById('kpi-credits').textContent = formatMoney(db.data.people.reduce((s,p)=>s+p.debt, 0));
        document.getElementById('kpi-stock').textContent = db.data.products.filter(p => p.stock <= p.stockCrit).length;

        const ctx = document.getElementById('chartSales').getContext('2d');
        if(dashboardChart) dashboardChart.destroy();
        dashboardChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['L','M','X','J','V','S','D'],
                datasets: [{ label: 'Ventas Semanales', data: [120, 190, 300, 500, 200, 300, 450], borderColor:'#1a73e8', tension: 0.4 }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    };

    // ===== 2. POS (VENTAS & PRODUCTOS) - LIMITE 6 =====
    const renderPOSProducts = (products = [], isSearch = false) => {
        const grid = document.getElementById('pos-product-grid');
        if(!grid) return;
        grid.innerHTML = '';
        
        // Regla: 6 productos por defecto (Favoritos), o todos si busca
        const list = isSearch ? products : (products.length > 0 ? products.slice(0, 6) : db.getProducts().slice(0, 6));

        list.forEach(p => {
            const card = document.createElement('div');
            card.className = 'product-card';
            card.innerHTML = `
                <div class="img-placeholder"><i class="fas fa-box"></i></div>
                <h4 title="${p.name}">${p.name}</h4>
                <div class="price">${formatMoney(p.price)}</div>
                <div class="stock ${p.stock <= p.stockCrit ? 'text-red' : ''}">Uds: ${p.stock}</div>
            `;
            card.addEventListener('click', () => {
                db.addToCart(p);
                renderCart();
            });
            grid.appendChild(card);
        });
    };

    document.getElementById('pos-search').addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (query.length > 0) {
            const filtered = db.getProducts(query);
            renderPOSProducts(filtered, true);
        } else {
            renderPOSProducts();
        }
    });

    const renderCart = () => {
        const items = document.getElementById('cart-items');
        if(!items) return;
        items.innerHTML = '';
        if (db.data.cart.length === 0) {
            items.innerHTML = '<div class="empty-cart-msg">No hay productos en la orden.</div>';
            document.getElementById('cart-total').textContent = '$0';
            document.getElementById('cart-subtotal').textContent = '$0';
            return;
        }

        let total = 0;
        db.data.cart.forEach(item => {
            total += item.price * item.qty;
            const div = document.createElement('div');
            div.className = 'cart-item';
            div.innerHTML = `
                <div class="cart-item-info"><h4>${item.name}</h4><p>${formatMoney(item.price)} x ${item.qty}</p></div>
                <div class="cart-item-controls">
                    <button class="qty-btn" onclick="updateQty('${item.id}', -1)">-</button>
                    <span>${item.qty}</span>
                    <button class="qty-btn" onclick="updateQty('${item.id}', 1)">+</button>
                </div>
            `;
            items.appendChild(div);
        });
        document.getElementById('cart-subtotal').textContent = formatMoney(total);
        document.getElementById('cart-total').textContent = formatMoney(total);
    };

    window.updateQty = (id, n) => {
        const item = db.data.cart.find(i => i.id === id);
        if(item) {
            db.updateCartQty(id, item.qty + n);
            renderCart();
        }
    }

    document.getElementById('btn-pay').addEventListener('click', () => {
        if(db.data.cart.length === 0) return alert("Carrito Vacío");
        const total = db.data.cart.reduce((s, i) => s + (i.price * i.qty), 0);
        document.getElementById('payment-total-display').textContent = formatMoney(total);
        openModal('modal-payment');
    });

    document.getElementById('btn-confirm-payment').addEventListener('click', () => {
        const method = document.querySelector('.method-card.active').dataset.method;
        const creditParams = method === 'credit' ? { installments: parseInt(document.getElementById('credit-installments').value) } : null;
        if(db.registerSale(method, false, creditParams)) {
            closeModal('modal-payment');
            renderCart();
            renderPOSProducts();
            db.data.currentClient = null;
            updateClientUI();
            alert("Venta Finalizada Exitosamente");
        }
    });

    // ===== 3. AUTOTEXTO & FOLIOS (Búsqueda Global - 1 Letra) =====
    const globalSearch = document.getElementById('global-search');
    const globalDropdown = document.getElementById('global-search-results');

    globalSearch.addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        if(q.length < 1) return globalDropdown.classList.add('hidden');
        
        globalDropdown.innerHTML = '';
        const matchingSales = db.data.sales.filter(s => s.id.toLowerCase().includes(q) || (s.personId && s.personId.toLowerCase().includes(q)));
        matchingSales.slice(0, 5).forEach(s => {
            const div = document.createElement('div');
            div.className = 'autocomplete-item';
            div.innerHTML = `<i class="fas fa-file-invoice"></i> Folio: ${s.id} | ${formatMoney(s.total)}`;
            div.onclick = () => { alert(`Venta Folio ${s.id}\nTotal: ${s.total}\nMétodo: ${s.method}`); globalDropdown.classList.add('hidden'); };
            globalDropdown.appendChild(div);
        });
        if(matchingSales.length > 0) globalDropdown.classList.remove('hidden');
        else globalDropdown.classList.add('hidden');
    });

    // ===== 4. CLIENT GENERAL ICON =====
    document.getElementById('btn-add-client').addEventListener('click', () => {
        openModal('modal-person');
    });

    const updateClientUI = () => {
        const div = document.getElementById('selected-client');
        if(!div) return;
        if(db.data.currentClient) div.innerHTML = `<i class="fas fa-user-check"></i> ${db.data.currentClient.name}`;
        else div.innerHTML = `<i class="fas fa-user-circle"></i> Mostrar Cliente General`;
    };

    document.getElementById('btn-search-client').addEventListener('click', () => openModal('modal-client'));
    document.getElementById('search-client-input').addEventListener('input', (e) => {
        const q = e.target.value.trim();
        const results = document.getElementById('client-search-results');
        results.innerHTML = '';
        db.getPeople(q, 'client').forEach(c => {
            const li = document.createElement('li');
            li.innerHTML = `<strong>${c.name}</strong> - ${c.rut}`;
            li.onclick = () => { db.data.currentClient = c; updateClientUI(); closeModal('modal-client'); };
            results.appendChild(li);
        });
    });

    // MAESTRO PRODUCTOS SAVE
    document.getElementById('btn-save-product').onclick = () => {
        const p = {
            sku: document.getElementById('m-codigo').value, 
            name: document.getElementById('m-desc').value,
            price: parseInt(document.getElementById('m-pventa').value) || 0,
            stock: parseInt(document.getElementById('m-sact').value) || 0,
            stockCrit: parseInt(document.getElementById('m-scrit').value) || 5,
            active: document.getElementById('m-activo').checked
        };
        if(!p.sku || !p.name) return alert("Código y Descripción son obligatorios.");
        db.addProduct(p);
        closeModal('modal-product');
        loadInventory();
        renderPOSProducts();
        alert("Producto guardado en Maestro.");
    };

    // CONFIG STOCK ADJUST
    document.getElementById('btn-save-stock-adj').onclick = () => {
        const id = document.getElementById('set-adj-prod').value;
        const q = parseInt(document.getElementById('set-adj-qty').value || 0);
        const prod = db.data.products.find(x => x.id === id);
        if(prod) { prod.stock = q; db.save(); alert("Stock ajustado."); loadInventory(); renderPOSProducts(); }
    };

    // ===== 5. CREDITOS & LETRAS (A, B, C) =====
    const loadCredits = () => {
        const body = document.getElementById('credits-body');
        if(!body) return;
        body.innerHTML = '';
        db.data.quotas.forEach(q => {
            const tr = document.createElement('tr');
            const quotaLabel = `Letra ${getLetter(q.num_quota)}`;
            tr.innerHTML = `
                <td>${q.personName}</td>
                <td>${q.saleId}</td>
                <td class="fw-bold text-blue">${quotaLabel}</td>
                <td>${q.dueDate}</td>
                <td>${formatMoney(q.amount)}</td>
                <td>$0</td>
                <td><span class="badge ${q.status === 'pagado' ? 'badge-green' : 'badge-orange'}">${q.status.toUpperCase()}</span></td>
                <td><button class="btn-primary" onclick="payLetter('${q.id}')">Pagar</button></td>
            `;
            body.appendChild(tr);
        });
    };

    window.payLetter = (id) => {
        const q = db.data.quotas.find(x => x.id === id);
        if(q && q.status !== 'pagado') {
            q.status = 'pagado';
            const person = db.data.people.find(p => p.id === q.personId);
            if(person) person.debt -= q.amount;
            db.save();
            loadCredits();
        }
    };

    // ===== 6. REPORTS & CHARTS (DIARIO/SEMANAL) =====
    let chartDaily = null, chartWeekly = null;
    const loadReportsCharts = () => {
        const ctxD_el = document.getElementById('chartDaily');
        const ctxW_el = document.getElementById('chartWeekly');
        if(!ctxD_el || !ctxW_el) return;
        const ctxD = ctxD_el.getContext('2d');
        const ctxW = ctxW_el.getContext('2d');
        
        if(chartDaily) chartDaily.destroy();
        if(chartWeekly) chartWeekly.destroy();

        chartDaily = new Chart(ctxD, {
            type: 'doughnut',
            data: {
                labels: ['Efectivo', 'Tarjeta', 'Transferencia', 'Crédito'],
                datasets: [{ data: [300000, 150000, 50000, 120000], backgroundColor: ['#2563eb', '#38c172', '#ffed4a', '#e3342f'] }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });

        chartWeekly = new Chart(ctxW, {
            type: 'bar',
            data: {
                labels: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'],
                datasets: [{ label: 'Ventas por Día', data: [75000, 89000, 120000, 150000, 240000, 310000, 180000], backgroundColor: '#2563eb' }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    };

    // ===== OTHER CORE LOGIC (Personas, Inventory, Workers) =====
    window.loadInventory = () => {
        const body = document.getElementById('inventory-body');
        if(!body) return;
        body.innerHTML = '';
        db.getProducts().forEach(p => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${p.sku}</td><td>${p.name}</td><td>Maestro</td>
                <td>${formatMoney(p.price)}</td><td>${p.stock}</td>
                <td><span class="badge ${p.active ? 'badge-green':'badge-red'}">${p.active?'Act':'Inac'}</span></td>
                <td><button class="btn-icon text-red" onclick="deleteProd('${p.id}')"><i class="fas fa-trash"></i></button></td>
            `;
            body.appendChild(tr);
        });
        const adjSel = document.getElementById('set-adj-prod');
        if(adjSel) adjSel.innerHTML = db.data.products.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    };

    window.deleteProd = (id) => {
        if(confirm("¿Eliminar artículo?")) {
            db.data.products = db.data.products.filter(x => x.id !== id); db.save(); loadInventory(); renderPOSProducts();
        }
    };

    const loadPeople = () => {
        const body = document.getElementById('people-body');
        if(!body) return;
        body.innerHTML = '';
        db.data.people.forEach(p => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${p.rut}</td><td><strong>${p.name}</strong></td><td>${p.giro}</td><td>${p.phone}</td><td>${p.isClient?'CL':''} ${p.isProvider?'PR':''}</td><td><span class="badge badge-green">HABIL</span></td><td>#</td>`;
            body.appendChild(tr);
        });
    }

    window.loadWorkers = () => {
        const body = document.getElementById('workers-body');
        if(!body) return;
        body.innerHTML = '';
        db.data.workers.forEach(w => {
            body.innerHTML += `<tr><td>${w.id}</td><td>${w.name}</td><td>LOCAL_LOCALSTORAGE</td><td>-</td></tr>`;
        });
    };

    // Modal Helpers
    window.openModal = (id) => { const el = document.getElementById(id); if(el) el.classList.add('active'); };
    window.closeModal = (id) => { const el = document.getElementById(id); if(el) el.classList.remove('active'); };
    document.querySelectorAll('.btn-close-modal').forEach(b => b.addEventListener('click', (e) => e.target.closest('.modal-overlay').classList.remove('active')));
    
    window.switchTab = (m, t) => { 
        const mod = document.getElementById(m); if(!mod) return;
        mod.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active', x.dataset.tab===t));
        mod.querySelectorAll('.tab-content').forEach(x=>x.classList.toggle('hidden', x.id!=='tab-'+t));
    };

    document.getElementById('btn-open-new-product').onclick = () => openModal('modal-product');
    document.getElementById('btn-settings').onclick = () => {
        const provs = document.getElementById('providers-list');
        if(provs) provs.innerHTML = db.data.people.filter(p=>p.isProvider).map(p=>`<li>${p.name}</li>`).join('');
        openModal('modal-settings');
    };

    // Methods
    document.querySelectorAll('.method-card').forEach(m => m.onclick = () => {
        document.querySelectorAll('.method-card').forEach(x=>x.classList.remove('active'));
        m.classList.add('active');
        document.getElementById('credit-options').classList.toggle('hidden', m.dataset.method !== 'credit');
    });

    // Initial State
    const posNav = document.querySelector('.nav-item[data-target="pos"]');
    if(posNav) posNav.click();
    renderPOSProducts();
    updateClientUI();
});
