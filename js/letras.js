// ============================================================
// letras.js — Módulo de Crédito por Letras de Cambio
// MrPOS · tuzkahr-alt.github.io/pos-erp-mrpos
// Arquitectura: Integración con clase Database (db.js)
// ============================================================

// ─────────────────────────────────────────────
// ENTIDAD: LetraCambio
// Equivalente a un Model de ORM.
// ─────────────────────────────────────────────
class LetraCambio {
    /**
     * @param {Object} params
     * @param {string} params.id_venta        - FK a la venta principal
     * @param {string} params.rut_cliente     - RUT del cliente deudor
     * @param {string} params.nombre_cliente  - Nombre completo del cliente
     * @param {string} params.id_cliente      - ID interno del cliente
     * @param {number} params.monto_cuota     - Monto de esta letra en CLP
     * @param {string} params.fecha_vencimiento - ISO date 'YYYY-MM-DD'
     * @param {number} params.numero_cuota    - Número de cuota (1-based)
     * @param {number} params.total_cuotas    - Total de cuotas pactadas
     * @param {boolean|string} params.estado_pago - false=pendiente, true=pagado, 'mora'
     * @param {number} params.interes         - Interés acumulado (default 0)
     */
    constructor({ id_venta, rut_cliente, nombre_cliente, id_cliente,
                  monto_cuota, fecha_vencimiento, numero_cuota,
                  total_cuotas, estado_pago = false, interes = 0 }) {

        // Identificador único generado por el Motor
        this.id = LetraCambio._generarId();

        // Relación con la venta (Integridad referencial)
        this.id_venta = id_venta;

        // Datos del librado (cliente/deudor)
        this.rut_cliente     = rut_cliente;
        this.nombre_cliente  = nombre_cliente;
        this.id_cliente      = id_cliente;

        // Datos financieros de la letra
        this.monto_cuota      = monto_cuota;
        this.fecha_vencimiento = fecha_vencimiento;
        this.numero_cuota     = numero_cuota;
        this.total_cuotas     = total_cuotas;

        // estado_pago: false = pendiente, true = pagado, 'mora' = vencida sin pago
        this.estado_pago = estado_pago;
        this.interes     = interes;

        // Metadatos de auditoría
        this.fecha_emision = new Date().toISOString().split('T')[0];
        this.tipo = 'letra'; // Índice de tipo para filtros rápidos
    }

    /** Genera un ID único compatible con el motor de db.js */
    static _generarId() {
        return 'LTR-' + Math.random().toString(36).substr(2, 9).toUpperCase();
    }

    /** Verifica si la letra está vencida (sin importar el estado_pago) */
    estaVencida() {
        if (this.estado_pago === true || this.estado_pago === 'pagado') return false;
        const hoy   = new Date();
        const vence = new Date(this.fecha_vencimiento);
        return hoy > vence;
    }

    /** Días de mora (0 si no está vencida) */
    diasMora() {
        if (!this.estaVencida()) return 0;
        const hoy   = new Date();
        const vence = new Date(this.fecha_vencimiento);
        return Math.floor((hoy - vence) / (1000 * 60 * 60 * 24));
    }

    /** Serializa a un objeto plano para guardarlo en localStorage */
    toPlainObject() {
        return { ...this };
    }
}


// ─────────────────────────────────────────────
// LÓGICA DE FRAGMENTACIÓN
// Recibe monto_total y n_cuotas.
// Devuelve lista de LetraCambio con
// vencimientos calculados cada 30 días.
// ─────────────────────────────────────────────

/**
 * Fragmenta una venta en N letras de cambio con vencimientos a 30 días.
 *
 * @param {number} monto_total   - Monto total de la venta en CLP
 * @param {number} n_cuotas      - Número de cuotas a generar
 * @param {Object} clienteInfo   - { id, rut, nombre } del cliente deudor
 * @param {string} id_venta      - ID de la venta asociada (para FK)
 * @returns {LetraCambio[]}      - Array de N objetos LetraCambio
 */
function fragmentarEnLetras(monto_total, n_cuotas, clienteInfo, id_venta) {
    if (n_cuotas < 1 || monto_total <= 0) {
        throw new Error('[Letras] n_cuotas debe ser >= 1 y monto_total > 0');
    }

    const letras = [];
    const monto_base = Math.floor(monto_total / n_cuotas);
    // El residuo por redondeo se agrega a la última cuota
    const residuo = monto_total - (monto_base * n_cuotas);

    for (let i = 1; i <= n_cuotas; i++) {
        // Vencimiento: cada 30 días exactos desde hoy
        const fecha_venc = new Date();
        fecha_venc.setDate(fecha_venc.getDate() + (30 * i));
        const fecha_iso  = fecha_venc.toISOString().split('T')[0];

        // La última cuota absorbe el residuo del redondeo
        const monto_cuota = (i === n_cuotas)
            ? monto_base + residuo
            : monto_base;

        const letra = new LetraCambio({
            id_venta,
            rut_cliente:      clienteInfo.rut,
            nombre_cliente:   clienteInfo.nombre,
            id_cliente:       clienteInfo.id,
            monto_cuota,
            fecha_vencimiento: fecha_iso,
            numero_cuota:     i,
            total_cuotas:     n_cuotas,
            estado_pago:      false,
            interes:          0
        });

        letras.push(letra);
    }

    return letras;
}


// ─────────────────────────────────────────────
// INTEGRACIÓN CON EL POS — COMMIT ATÓMICO
// Registra venta + letras en una sola operación.
// Si falla la generación de alguna letra,
// se hace rollback completo (no se guarda nada).
// ─────────────────────────────────────────────

/**
 * Extiende la clase Database con los métodos de Letras.
 * Se llama una vez después de que db.js crea el objeto `db`.
 */
function extenderDBConLetras(dbInstance) {

    // Inicializar la colección de letras si no existe aún
    if (!dbInstance.data.letras) {
        dbInstance.data.letras = [];
        dbInstance.save();
    }

    /**
     * COMMIT ATÓMICO: Registra una venta con método 'letras'.
     * Garantiza integridad referencial: si falla la creación de
     * cualquier letra, se revierte la venta completa (rollback).
     *
     * @param {number} n_cuotas - Número de letras a emitir
     * @returns {{ success: boolean, folio?: string, error?: string }}
     */
    dbInstance.registrarVentaConLetras = function(n_cuotas) {
        // Validaciones previas (antes del commit)
        if (this.data.cart.length === 0) {
            return { success: false, error: 'El carrito está vacío.' };
        }
        if (!this.data.currentClient) {
            return { success: false, error: 'Debe seleccionar un cliente para emitir letras.' };
        }

        const total = this.data.cart.reduce((sum, item) => sum + (item.price * item.qty), 0);

        // Validación de crédito existente
        const validacion = this.validateCredit(this.data.currentClient.id, total);
        if (!validacion.valid) {
            return { success: false, error: validacion.reason };
        }

        // ── INICIO TRANSACCIÓN ──────────────────────────
        // Guardamos snapshot para poder hacer rollback
        const snapshotClientes  = JSON.stringify(this.data.clients);
        const snapshotLetras    = JSON.stringify(this.data.letras);
        const snapshotVentas    = JSON.stringify(this.data.sales);
        const snapshotProductos = JSON.stringify(this.data.products);

        try {
            // 1. Construir objeto venta
            const folio = 'V-LTR-' + (this.data.sales.length + 1).toString().padStart(4, '0');
            const venta = {
                id:      folio,
                date:    new Date().toISOString(),
                clientId: this.data.currentClient.id,
                cashier:  this.activeCashierInfo ? JSON.parse(this.activeCashierInfo).name : 'Admin',
                total,
                method:  'letras',
                n_cuotas,
                status:  'finalizada',
                items:   [...this.data.cart]
            };

            // 2. Generar las N letras de cambio
            const clienteInfo = {
                id:     this.data.currentClient.id,
                rut:    this.data.currentClient.rut,
                nombre: this.data.currentClient.name
            };

            const letrasGeneradas = fragmentarEnLetras(total, n_cuotas, clienteInfo, folio);

            // Verificación de integridad: exactamente N letras generadas
            if (letrasGeneradas.length !== n_cuotas) {
                throw new Error(`Se esperaban ${n_cuotas} letras pero se generaron ${letrasGeneradas.length}`);
            }

            // 3. Descontar stock
            this.data.cart.forEach(cartItem => {
                const prod = this.data.products.find(p => p.id === cartItem.id);
                if (prod) prod.stock -= cartItem.qty;
            });

            // 4. Actualizar deuda del cliente
            const cliente = this.data.clients.find(c => c.id === this.data.currentClient.id);
            cliente.debt += total;

            // 5. Persistir todo de forma atómica
            this.data.sales.push(venta);
            letrasGeneradas.forEach(l => this.data.letras.push(l.toPlainObject()));

            // También sincronizar con data.quotas para compatibilidad
            // con el módulo de créditos existente
            letrasGeneradas.forEach(l => {
                this.data.quotas.push({
                    id:           l.id,
                    clientId:     l.id_cliente,
                    clientName:   l.nombre_cliente,
                    clientRut:    l.rut_cliente,
                    saleId:       l.id_venta,
                    num_quota:    l.numero_cuota,
                    total_quotas: l.total_cuotas,
                    amount:       l.monto_cuota,
                    dueDate:      l.fecha_vencimiento,
                    status:       'pendiente',
                    interest:     0,
                    tipo:         'letra'
                });
            });

            // 6. Limpiar carrito
            this.data.cart = [];
            this.data.currentClient = null;

            // COMMIT: persiste en localStorage
            this.save();

            return { success: true, folio, letras: letrasGeneradas };

        } catch (err) {
            // ── ROLLBACK ────────────────────────────────
            // Restauramos el snapshot anterior en caso de cualquier error
            this.data.clients  = JSON.parse(snapshotClientes);
            this.data.letras   = JSON.parse(snapshotLetras);
            this.data.sales    = JSON.parse(snapshotVentas);
            this.data.products = JSON.parse(snapshotProductos);
            // NO llamamos this.save() → el estado original permanece intacto
            console.error('[Letras] ROLLBACK ejecutado:', err.message);
            return { success: false, error: 'Error al emitir letras: ' + err.message };
        }
        // ── FIN TRANSACCIÓN ─────────────────────────────
    };


    // ─────────────────────────────────────────────
    // MÓDULO DE CONSULTA — BÚSQUEDA RÁPIDA INDEXADA
    // Filtra letras vencidas por RUT del cliente.
    // Optimizado para cobranza en el POS.
    // ─────────────────────────────────────────────

    /**
     * Devuelve todas las letras vencidas de un cliente por RUT.
     * Uso principal: cobranza en mostrador.
     *
     * @param {string} rut - RUT del cliente (ej: '11.111.111-1')
     * @returns {Array}    - Letras vencidas, ordenadas por fecha_vencimiento ASC
     */
    dbInstance.buscarLetrasVencidasPorRut = function(rut) {
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);

        return this.data.quotas
            .filter(q => {
                if (q.tipo !== 'letra') return false;
                if (q.status === 'pagado')  return false;
                if (q.clientRut !== rut)    return false;
                const vence = new Date(q.dueDate);
                return vence < hoy; // Solo letras VENCIDAS
            })
            .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    };

    /**
     * Devuelve TODAS las letras de un cliente por RUT
     * (vencidas, pendientes y pagadas).
     *
     * @param {string} rut
     * @returns {Array}
     */
    dbInstance.buscarLetrasPorRut = function(rut) {
        return this.data.quotas
            .filter(q => q.tipo === 'letra' && q.clientRut === rut)
            .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    };

    /**
     * Devuelve el resumen de cobranza de un cliente:
     * - Total adeudado en letras
     * - Cantidad de letras vencidas
     * - Días de mora máximo
     *
     * @param {string} rut
     * @returns {{ total_adeudado: number, letras_vencidas: number, max_mora_dias: number }}
     */
    dbInstance.resumenCobranzaRut = function(rut) {
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);

        const letrasCliente = this.data.quotas.filter(
            q => q.tipo === 'letra' && q.clientRut === rut && q.status !== 'pagado'
        );

        let total_adeudado  = 0;
        let letras_vencidas = 0;
        let max_mora_dias   = 0;

        letrasCliente.forEach(q => {
            total_adeudado += q.amount;
            const vence = new Date(q.dueDate);
            if (vence < hoy) {
                letras_vencidas++;
                const mora = Math.floor((hoy - vence) / (1000 * 60 * 60 * 24));
                if (mora > max_mora_dias) max_mora_dias = mora;
            }
        });

        return { total_adeudado, letras_vencidas, max_mora_dias };
    };

    /**
     * Paga una letra por ID y actualiza el estado de cuenta del cliente.
     *
     * @param {string} id - ID de la letra (LTR-XXXXXXXXX)
     * @returns {boolean}
     */
    dbInstance.pagarLetra = function(id) {
        const quota = this.data.quotas.find(q => q.id === id && q.tipo === 'letra');
        if (!quota) return false;

        quota.status = 'pagado';

        // Actualizar la deuda del cliente
        const cliente = this.data.clients.find(c => c.id === quota.clientId);
        if (cliente) {
            cliente.debt = Math.max(0, cliente.debt - quota.amount);
        }

        // Sincronizar también en data.letras
        const letra = this.data.letras?.find(l => l.id === id);
        if (letra) letra.estado_pago = true;

        this.save();
        return true;
    };

    console.log('[Letras] Módulo de Crédito por Letras cargado correctamente ✓');
}
