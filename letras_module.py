# =============================================================
# letras_module.py — Módulo de Crédito por Letras de Cambio
# MrPOS Backend · tuzkahr-alt.github.io/pos-erp-mrpos
# Compatible con SQLite (pos_system.db) y exportación CSV/PDF
# Autor: Arquitecto MrPOS
# =============================================================

from __future__ import annotations
import sqlite3
import json
from datetime import date, timedelta
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Optional, List


# ─────────────────────────────────────────────
# ENUM: Estado de una Letra de Cambio
# ─────────────────────────────────────────────
class EstadoPago(str, Enum):
    PENDIENTE = "pendiente"
    PAGADO    = "pagado"
    MORA      = "mora"


# ─────────────────────────────────────────────
# ENTIDAD: LetraCambio (Model)
# Equivalente a un ORM Model de Antigravity.
# Usa dataclass para serialización limpia.
# ─────────────────────────────────────────────
@dataclass
class LetraCambio:
    """
    Representa una letra de cambio individual dentro de
    un plan de crédito por cuotas en el sistema MrPOS.

    Relaciones:
        id_venta → sales.id  (integridad referencial)
        rut_cliente          (índice primario de cobranza)
    """
    # FK a la tabla de ventas
    id_venta: str

    # Datos del librado (cliente deudor)
    rut_cliente:    str
    nombre_cliente: str
    id_cliente:     str

    # Datos financieros de la letra
    monto_cuota:       int      # CLP sin decimales
    fecha_vencimiento: str      # 'YYYY-MM-DD'
    numero_cuota:      int      # 1-based
    total_cuotas:      int

    # Estado de pago (Enum o bool)
    estado_pago: EstadoPago = EstadoPago.PENDIENTE
    interes:     int        = 0

    # Metadatos (generados automáticamente)
    id:            str  = field(default_factory=lambda: LetraCambio._generar_id())
    fecha_emision: str  = field(default_factory=lambda: date.today().isoformat())
    tipo:          str  = "letra"

    # ── Generador de ID ──────────────────────
    @staticmethod
    def _generar_id() -> str:
        import random, string
        suffix = ''.join(random.choices(string.ascii_uppercase + string.digits, k=9))
        return f"LTR-{suffix}"

    # ── Propiedades calculadas ───────────────
    @property
    def esta_vencida(self) -> bool:
        """True si la letra está vencida y sin pagar."""
        if self.estado_pago in (EstadoPago.PAGADO, "pagado"):
            return False
        return date.today() > date.fromisoformat(self.fecha_vencimiento)

    @property
    def dias_mora(self) -> int:
        """Días de mora (0 si no vencida o ya pagada)."""
        if not self.esta_vencida:
            return 0
        delta = date.today() - date.fromisoformat(self.fecha_vencimiento)
        return delta.days

    def to_dict(self) -> dict:
        """Serializa a dict para JSON / localStorage bridge."""
        d = asdict(self)
        d['estado_pago'] = self.estado_pago.value if isinstance(self.estado_pago, EstadoPago) else self.estado_pago
        return d


# ─────────────────────────────────────────────
# LÓGICA DE FRAGMENTACIÓN
# Recibe monto_total y n_cuotas → genera letras
# con vencimientos cada 30 días.
# ─────────────────────────────────────────────
def fragmentar_en_letras(
    monto_total: int,
    n_cuotas:    int,
    id_venta:    str,
    rut_cliente:    str,
    nombre_cliente: str,
    id_cliente:     str,
) -> List[LetraCambio]:
    """
    Fragmenta una venta en N letras de cambio.
    Vencimientos calculados cada 30 días exactos desde hoy.

    Args:
        monto_total:    Monto total de la venta en CLP.
        n_cuotas:       Número de cuotas (letras) a emitir.
        id_venta:       ID de la venta (FK, integridad referencial).
        rut_cliente:    RUT del cliente deudor.
        nombre_cliente: Nombre completo del cliente.
        id_cliente:     ID interno del cliente.

    Returns:
        List[LetraCambio]: Lista de N letras ordenadas por número de cuota.

    Raises:
        ValueError: Si n_cuotas < 1 o monto_total <= 0.
    """
    if n_cuotas < 1:
        raise ValueError(f"n_cuotas debe ser >= 1, recibido: {n_cuotas}")
    if monto_total <= 0:
        raise ValueError(f"monto_total debe ser > 0, recibido: {monto_total}")

    monto_base = monto_total // n_cuotas
    residuo    = monto_total - (monto_base * n_cuotas)

    letras: List[LetraCambio] = []

    for i in range(1, n_cuotas + 1):
        # Vencimiento: 30 días × i desde hoy
        fecha_venc = date.today() + timedelta(days=30 * i)

        # La última cuota absorbe el residuo de redondeo
        monto_cuota = monto_base + (residuo if i == n_cuotas else 0)

        letra = LetraCambio(
            id_venta        = id_venta,
            rut_cliente     = rut_cliente,
            nombre_cliente  = nombre_cliente,
            id_cliente      = id_cliente,
            monto_cuota     = monto_cuota,
            fecha_vencimiento = fecha_venc.isoformat(),
            numero_cuota    = i,
            total_cuotas    = n_cuotas,
            estado_pago     = EstadoPago.PENDIENTE,
            interes         = 0,
        )
        letras.append(letra)

    return letras


# ─────────────────────────────────────────────
# REPOSITORIO: LetrasRepository
# Encapsula el acceso a SQLite con commit
# atómico y rollback explícito.
# ─────────────────────────────────────────────
class LetrasRepository:
    """
    Capa de persistencia para LetraCambio sobre SQLite.
    Garantiza integridad referencial mediante transacciones
    atómicas: si falla la inserción de cualquier letra,
    se hace rollback completo de la venta.
    """

    CREATE_TABLE_SQL = """
    CREATE TABLE IF NOT EXISTS letras_cambio (
        id                TEXT PRIMARY KEY,
        id_venta          TEXT NOT NULL REFERENCES sales(id),
        rut_cliente       TEXT NOT NULL,
        nombre_cliente    TEXT NOT NULL,
        id_cliente        TEXT NOT NULL,
        monto_cuota       INTEGER NOT NULL,
        fecha_vencimiento TEXT NOT NULL,
        numero_cuota      INTEGER NOT NULL,
        total_cuotas      INTEGER NOT NULL,
        estado_pago       TEXT NOT NULL DEFAULT 'pendiente',
        interes           INTEGER NOT NULL DEFAULT 0,
        fecha_emision     TEXT NOT NULL,
        tipo              TEXT NOT NULL DEFAULT 'letra'
    );
    CREATE INDEX IF NOT EXISTS idx_letras_rut    ON letras_cambio(rut_cliente);
    CREATE INDEX IF NOT EXISTS idx_letras_venta  ON letras_cambio(id_venta);
    CREATE INDEX IF NOT EXISTS idx_letras_estado ON letras_cambio(estado_pago);
    """

    def __init__(self, db_path: str = "pos_system.db"):
        self.db_path = db_path
        self._inicializar_tabla()

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _inicializar_tabla(self):
        with self._get_conn() as conn:
            for stmt in self.CREATE_TABLE_SQL.strip().split(';'):
                if stmt.strip():
                    conn.execute(stmt)

    # ── COMMIT ATÓMICO ───────────────────────────────────────────
    def registrar_venta_con_letras(
        self,
        venta_data: dict,
        letras:     List[LetraCambio]
    ) -> dict:
        """
        Registra la venta y todas sus letras en una sola transacción.
        Si falla la inserción de CUALQUIER letra → ROLLBACK completo.

        Args:
            venta_data: Dict con los datos de la venta (debe incluir 'id').
            letras:     Lista de LetraCambio generadas por fragmentar_en_letras().

        Returns:
            dict: { "success": bool, "folio": str|None, "error": str|None }
        """
        conn = self._get_conn()
        try:
            # INICIO TRANSACCIÓN ATÓMICA
            conn.execute("BEGIN")

            # 1. Insertar la venta en la tabla principal
            conn.execute("""
                INSERT INTO sales (id, date, client_id, cashier, total, method, status)
                VALUES (:id, :date, :client_id, :cashier, :total, :method, :status)
            """, venta_data)

            # 2. Insertar cada letra (si alguna falla → rollback automático)
            for letra in letras:
                conn.execute("""
                    INSERT INTO letras_cambio
                        (id, id_venta, rut_cliente, nombre_cliente, id_cliente,
                         monto_cuota, fecha_vencimiento, numero_cuota, total_cuotas,
                         estado_pago, interes, fecha_emision, tipo)
                    VALUES
                        (:id, :id_venta, :rut_cliente, :nombre_cliente, :id_cliente,
                         :monto_cuota, :fecha_vencimiento, :numero_cuota, :total_cuotas,
                         :estado_pago, :interes, :fecha_emision, :tipo)
                """, {**letra.to_dict(), 'estado_pago': letra.estado_pago.value})

            # COMMIT: todo OK
            conn.commit()
            return {"success": True, "folio": venta_data["id"], "error": None}

        except Exception as e:
            # ROLLBACK: venta + letras revertidas
            conn.rollback()
            print(f"[Letras] ROLLBACK ejecutado: {e}")
            return {"success": False, "folio": None, "error": str(e)}

        finally:
            conn.close()

    # ── MÓDULO DE CONSULTA RÁPIDA (INDEXADA) ────────────────────

    def buscar_letras_vencidas_por_rut(self, rut_cliente: str) -> List[dict]:
        """
        Búsqueda rápida usando el índice idx_letras_rut.
        Devuelve todas las letras VENCIDAS de un cliente, ordenadas
        por fecha de vencimiento ASC (para cobranza en mostrador).

        Args:
            rut_cliente: RUT del cliente a consultar.

        Returns:
            List[dict]: Letras vencidas ordenadas por antigüedad.
        """
        hoy = date.today().isoformat()
        with self._get_conn() as conn:
            rows = conn.execute("""
                SELECT *
                FROM letras_cambio
                WHERE rut_cliente  = ?
                  AND estado_pago != 'pagado'
                  AND fecha_vencimiento < ?
                ORDER BY fecha_vencimiento ASC
            """, (rut_cliente, hoy)).fetchall()
        return [dict(r) for r in rows]

    def buscar_letras_por_rut(self, rut_cliente: str) -> List[dict]:
        """
        Devuelve todas las letras de un cliente (cualquier estado).

        Args:
            rut_cliente: RUT del cliente.

        Returns:
            List[dict]: Todas las letras del cliente.
        """
        with self._get_conn() as conn:
            rows = conn.execute("""
                SELECT *
                FROM letras_cambio
                WHERE rut_cliente = ?
                ORDER BY fecha_vencimiento ASC
            """, (rut_cliente,)).fetchall()
        return [dict(r) for r in rows]

    def resumen_cobranza_rut(self, rut_cliente: str) -> dict:
        """
        Resumen de cobranza para el mostrador:
        total_adeudado, letras_vencidas, max_mora_dias.

        Args:
            rut_cliente: RUT del cliente.

        Returns:
            dict con métricas de cobranza.
        """
        hoy = date.today().isoformat()
        with self._get_conn() as conn:
            row = conn.execute("""
                SELECT
                    SUM(monto_cuota)                                    AS total_adeudado,
                    COUNT(CASE WHEN fecha_vencimiento < ? THEN 1 END)   AS letras_vencidas,
                    MAX(CASE WHEN fecha_vencimiento < ?
                        THEN CAST(julianday(?) - julianday(fecha_vencimiento) AS INTEGER)
                        ELSE 0 END)                                     AS max_mora_dias
                FROM letras_cambio
                WHERE rut_cliente  = ?
                  AND estado_pago != 'pagado'
            """, (hoy, hoy, hoy, rut_cliente)).fetchone()

        return {
            "total_adeudado":  row["total_adeudado"]  or 0,
            "letras_vencidas": row["letras_vencidas"] or 0,
            "max_mora_dias":   row["max_mora_dias"]   or 0,
        }

    def pagar_letra(self, id_letra: str) -> bool:
        """
        Marca una letra como pagada y actualiza la deuda del cliente.

        Args:
            id_letra: ID de la letra (LTR-XXXXXXXXX).

        Returns:
            bool: True si se actualizó correctamente.
        """
        with self._get_conn() as conn:
            cur = conn.execute("""
                UPDATE letras_cambio
                SET estado_pago = 'pagado'
                WHERE id = ? AND estado_pago != 'pagado'
            """, (id_letra,))
            conn.commit()
            return cur.rowcount > 0


# ─────────────────────────────────────────────
# EJEMPLO DE USO / TEST MANUAL
# ─────────────────────────────────────────────
if __name__ == "__main__":
    print("=== MrPOS · Módulo de Letras de Cambio ===\n")

    # 1. Fragmentar venta en letras
    letras = fragmentar_en_letras(
        monto_total    = 150_000,
        n_cuotas       = 3,
        id_venta       = "V-LTR-0001",
        rut_cliente    = "11.111.111-1",
        nombre_cliente = "Juan Ignacio Pérez",
        id_cliente     = "client_abc123",
    )

    print(f"Letras generadas ({len(letras)}):")
    for l in letras:
        print(f"  Cuota {l.numero_cuota}/{l.total_cuotas} → "
              f"${l.monto_cuota:,} | Vence: {l.fecha_vencimiento} | "
              f"ID: {l.id}")

    # 2. Persistir en SQLite (commit atómico)
    repo = LetrasRepository("pos_system.db")

    venta_data = {
        "id":        "V-LTR-0001",
        "date":      date.today().isoformat(),
        "client_id": "client_abc123",
        "cashier":   "Admin",
        "total":     150_000,
        "method":    "letras",
        "status":    "finalizada",
    }

    resultado = repo.registrar_venta_con_letras(venta_data, letras)
    print(f"\nRegistro atómico: {resultado}")

    # 3. Consulta de letras vencidas por RUT
    vencidas = repo.buscar_letras_vencidas_por_rut("11.111.111-1")
    print(f"\nLetras vencidas de 11.111.111-1: {len(vencidas)}")

    # 4. Resumen de cobranza
    resumen = repo.resumen_cobranza_rut("11.111.111-1")
    print(f"Resumen cobranza: {json.dumps(resumen, indent=2, ensure_ascii=False)}")
