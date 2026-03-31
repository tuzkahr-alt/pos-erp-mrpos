// db.js - Motor de Persistencia y Datos ERP
const generateId = () => Math.random().toString(36).substr(2, 9).toUpperCase();

// Generador de datos iniciales para Retail
const generateGroceries = () => {
    const brands = ['Soprole', 'Colun', 'Nestlé', 'Lucchetti', 'Carozzi', 'Tucapel', 'Chef', 'Belmont', 'Coca-Cola', 'CCU', 'Cachantun', 'Báltica', 'Cristal', 'Escudo', 'Costa', 'McKay', 'Savory', 'Maggi', 'Hellmanns', 'Lipton', 'Ideal', 'Castaño'];
    const items = [
        { n: 'Arroz G1', p: 1500 }, { n: 'Fideos Espagueti 400g', p: 900 }, { n: 'Aceite Maravilla 1L', p: 2500 },
        { n: 'Salsa de Tomates 200g', p: 500 }, { n: 'Leche Entera 1L', p: 1100 }, { n: 'Bebida 2L', p: 2200 },
        { n: 'Cerveza Lata 473ml', p: 1000 }, { n: 'Galletas Vino', p: 700 }, { n: 'Galletas Tritón', p: 900 },
        { n: 'Mayonesa 400g', p: 1800 }, { n: 'Ketchup 400g', p: 1500 }, { n: 'Mostaza 250g', p: 900 },
        { n: 'Té Ceylán 100 bolsitas', p: 2500 }
    ];
    let prods = [];
    items.forEach((it, i) => {
        const brand = brands[Math.floor(Math.random() * brands.length)];
        prods.push({
            id: generateId(), sku: 'CHI-' + (1000 + i), name: `${it.n} ${brand}`,
            price: it.p, brand: brand, stock: Math.floor(Math.random() * 50) + 10,
            talla: 'U', genero: 'Unisex', provider: 'Distribuidora Central'
        });
    });
    return prods;
};

const INITIAL_DATA = {
    products: generateGroceries(),
    clients: [
        { id: generateId(), rut: '11.111.111-1', name: 'Juan Ignacio Pérez', giro: 'Particular', limit_credit: 150000, debt: 45000 },
        { id: generateId(), rut: '09.876.543-2', name: 'Constructora Eloísa Ltda.', giro: 'Construcción', limit_credit: 1500000, debt: 250000 }
    ],
    sales: [],
    quotas: [],
    cart: [],
    currentClient: null,
    workers: [
        { id: 'admin', name: 'Administrador ERP', pin: '1234' }
    ],
    providers: [
        { id: generateId(), name: 'Distribuidora Central' },
        { id: generateId(), name: 'Proveedor General' },
        { id: generateId(), name: 'Textiles Chile' }
    ]
};

class Database {
    constructor() {
        this.activeCashierInfo = localStorage.getItem('mrpos_active_cashier_info');
        this.activeCashier = this.activeCashierInfo ? JSON.parse(this.activeCashierInfo).id : 'admin';
        this.storageKey = 'erp_data_' + this.activeCashier;
        this.load();
    }

    load() {
        const data = localStorage.getItem(this.storageKey);
        if (data) {
            this.data = JSON.parse(data);
            // Migración: asegurar que existan nuevas colecciones
            if(!this.data.providers) this.data.providers = INITIAL_DATA.providers;
            if(!this.data.products[0].talla) {
                 this.data.products.forEach(p => { p.talla = 'U'; p.genero = 'Unisex'; p.provider = 'S/P'; });
            }
        } else {
            this.data = JSON.parse(JSON.stringify(INITIAL_DATA));
            this.save();
        }
    }

    save() {
        localStorage.setItem(this.storageKey, JSON.stringify(this.data));
    }

    switchCashier(workerParams) {
        localStorage.setItem('mrpos_active_cashier_info', JSON.stringify(workerParams));
        location.reload();
    }

    // Products
    getProducts(query = '') {
        if (!query) return this.data.products;
        query = query.toLowerCase();
        return this.data.products.filter(p => p.name.toLowerCase().includes(query) || p.sku.toLowerCase().includes(query));
    }

    addProduct(prod) {
        const newProd = { id: generateId(), ...prod };
        this.data.products.push(newProd);
        this.save();
        return newProd;
    }

    // Providers & Workers
    addWorker(worker) {
        this.data.workers.push({ id: generateId(), ...worker });
        this.save();
    }
    
    addProvider(prov) {
        this.data.providers.push({ id: generateId(), ...prov });
        this.save();
    }

    // Clients
    getClients(query = '') {
        if (!query) return this.data.clients;
        query = query.toLowerCase();
        return this.data.clients.filter(c => c.name.toLowerCase().includes(query) || c.rut.includes(query));
    }

    addClient(client) {
        const newClient = { id: generateId(), debt: 0, ...client };
        this.data.clients.push(newClient);
        this.save();
        return newClient;
    }

    validateCredit(clientId, amount) {
        const client = this.data.clients.find(c => c.id === clientId);
        if (!client) return { valid: false, reason: 'Cliente no seleccionado' };
        if ((client.debt + amount) > client.limit_credit) {
            return { valid: false, reason: `Excede límite ($${client.limit_credit.toLocaleString()})` };
        }
        return { valid: true };
    }

    // Cart
    addToCart(product) {
        const existing = this.data.cart.find(item => item.id === product.id);
        if (existing) existing.qty += 1;
        else this.data.cart.push({ ...product, qty: 1 });
        this.save();
    }

    removeFromCart(productId) {
        this.data.cart = this.data.cart.filter(item => item.id !== productId);
        this.save();
    }

    updateCartQty(productId, qty) {
        const item = this.data.cart.find(item => item.id === productId);
        if (item) {
            item.qty = qty;
            if (item.qty <= 0) this.removeFromCart(productId);
        }
        this.save();
    }

    clearCart() {
        this.data.cart = [];
        this.save();
    }

    // Sales
    registerSale(paymentMethod, isPresale) {
        if (this.data.cart.length === 0) return false;
        const total = this.data.cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
        const sale = {
            id: 'V-00' + (this.data.sales.length + 100),
            date: new Date().toISOString(),
            clientId: this.data.currentClient ? this.data.currentClient.id : 'General',
            cashier: this.activeCashierInfo ? JSON.parse(this.activeCashierInfo).name : 'Admin',
            total: total,
            method: paymentMethod,
            status: isPresale ? 'preventa' : 'finalizada',
            items: [...this.data.cart]
        };

        this.data.cart.forEach(cartItem => {
            const prod = this.data.products.find(p => p.id === cartItem.id);
            if(prod) prod.stock -= cartItem.qty;
        });

        this.data.sales.push(sale);
        this.clearCart();
        this.save();
        return true;
    }
}

const db = new Database();
