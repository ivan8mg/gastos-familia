import { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxt2GkXr4v2-xujmgVvhzd-F3vfGMYJo4jRqqwjp-HB1sinC77AuLQX0Tqgy03nDVea/exec";

const METHODS = [
  { id: "debito",   emoji: "💳", label: "Débito"   },
  { id: "credito",  emoji: "🏦", label: "Crédito"  },
  { id: "efectivo", emoji: "💵", label: "Efectivo" },
];
const QUIEN = ["Yo", "Esposa", "Los dos"];
const CAT_COLORS = ["#f59e0b","#3b82f6","#10b981","#ef4444","#8b5cf6","#ec4899","#14b8a6","#f97316"];
const fmt = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n || 0);
const todayStr = () => new Date().toISOString().slice(0, 10);

async function classifyWithAI(motivo, monto) {
  const cats = "Alimentación,Transporte,Restaurantes,Entretenimiento,Salud,Hogar,Ropa,Servicios,Educación,Otros";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514", max_tokens: 60,
        messages: [{ role: "user", content: `Clasifica este gasto en UNA categoría. Gasto: "${motivo}" $${monto}. Categorías: ${cats}. Responde SOLO el nombre de la categoría, sin más texto.` }]
      })
    });
    const data = await res.json();
    return data.content?.[0]?.text?.trim() || "Otros";
  } catch { return "Otros"; }
}

async function getAdvice(gastos) {
  const total = gastos.reduce((s, g) => s + g.monto, 0);
  const porCat = gastos.reduce((acc, g) => { acc[g.categoria || "Otros"] = (acc[g.categoria || "Otros"] || 0) + g.monto; return acc; }, {});
  const resumen = Object.entries(porCat).sort((a,b)=>b[1]-a[1]).map(([c,v])=>`${c}: ${fmt(v)}`).join(", ");
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514", max_tokens: 500,
        messages: [{ role: "user", content: `Somos una pareja con estos gastos: Total ${fmt(total)}. Por categoría: ${resumen}. Dame 3 consejos concretos y cortos para gastar menos. Sé directo y amigable. Formato: lista numerada.` }]
      })
    });
    const data = await res.json();
    return data.content?.[0]?.text?.trim() || "";
  } catch { return ""; }
}

function jsonp(params) {
  return new Promise((resolve, reject) => {
    const cb = "cb_" + Date.now();
    const script = document.createElement("script");
    const query = Object.entries({ ...params, callback: cb })
      .map(([k, v]) => `${k}=${encodeURIComponent(typeof v === "object" ? JSON.stringify(v) : v)}`)
      .join("&");
    script.src = `${SCRIPT_URL}?${query}`;
    script.onerror = () => reject(new Error("Error de red"));
    window[cb] = (data) => { delete window[cb]; document.body.removeChild(script); resolve(data); };
    document.body.appendChild(script);
  });
}

async function cargarDeSheet() {
  const data = await jsonp({ action: "leer" });
  if (!data.gastos) return [];
  return data.gastos.map((row, i) => ({
    id: i + 1, fecha: row[0], monto: parseFloat(row[1]) || 0,
    motivo: row[2], metodo: row[3], categoria: row[4], quien: row[5],
  }));
}

async function guardarEnSheet(gasto) {
  return jsonp({ action: "agregar", fila: [gasto.fecha, gasto.monto, gasto.motivo, gasto.metodo, gasto.categoria, gasto.quien] });
}

async function eliminarDeSheet(index) {
  return jsonp({ action: "eliminar", index });
}
export default function App() {
  const [gastos, setGastos] = useState([]);
  const [monto, setMonto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [metodo, setMetodo] = useState("debito");
  const [quien, setQuien] = useState("Yo");
  const [saving, setSaving] = useState(false);
  const [vista, setVista] = useState("add");
  const [advice, setAdvice] = useState("");
  const [loadingAdvice, setLoadingAdvice] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  const total = gastos.reduce((s, g) => s + g.monto, 0);
  const catData = Object.entries(
    gastos.reduce((acc, g) => { const c = g.categoria || "Sin clasificar"; acc[c] = (acc[c]||0)+g.monto; return acc; }, {})
  ).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value);

  useEffect(() => {
    setSyncing(true);
    setSyncMsg("Cargando gastos…");
    cargarDeSheet()
      .then(data => { setGastos(data); setSyncMsg(""); })
      .catch(() => setSyncMsg("⚠️ Error al conectar con Google Sheets"))
      .finally(() => setSyncing(false));
  }, []);

  const guardar = async () => {
    const n = parseFloat(monto.replace(",", "."));
    if (!n || n <= 0 || !motivo.trim()) return;
    setSaving(true);
    const categoria = await classifyWithAI(motivo.trim(), n);
    const nuevo = { id: Date.now(), fecha: todayStr(), monto: n, motivo: motivo.trim(), metodo, quien, categoria };
    try {
      await guardarEnSheet(nuevo);
      setSyncMsg("✓ Guardado en Google Sheets");
    } catch {
      setSyncMsg("⚠️ Solo guardado localmente");
    }
    setTimeout(() => setSyncMsg(""), 2500);
    setGastos(prev => [nuevo, ...prev]);
    setMonto(""); setMotivo("");
    setSaving(false);
  };

  const sincronizar = async () => {
    setSyncing(true); setSyncMsg("Sincronizando…");
    try { const data = await cargarDeSheet(); setGastos(data); setSyncMsg("✓ Datos actualizados"); }
    catch { setSyncMsg("⚠️ Error al sincronizar"); }
    setTimeout(() => setSyncMsg(""), 2500);
    setSyncing(false);
  };

  const eliminar = async (gasto, idx) => {
    setGastos(prev => prev.filter(g => g.id !== gasto.id));
    try { await eliminarDeSheet(gastos.length - idx); } catch {}
  };

  const exportar = () => {
    const ws = XLSX.utils.json_to_sheet(gastos.map(g => ({
      Fecha: g.fecha, Motivo: g.motivo, Monto: g.monto,
      Método: METHODS.find(m => m.id === g.metodo)?.label || g.metodo,
      Categoría: g.categoria, Quién: g.quien,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Gastos");
    XLSX.writeFile(wb, `gastos_${todayStr()}.xlsx`);
  };

  const pedirConsejos = async () => {
    if (!gastos.length) return;
    setLoadingAdvice(true);
    setAdvice(await getAdvice(gastos));
    setLoadingAdvice(false);
  };

  const inp = { width: "100%", boxSizing: "border-box", background: "#fff", border: "2px solid #e8e8e8", borderRadius: 14, outline: "none", color: "#1a1a1a" };
  const lbl = { fontSize: 11, fontWeight: 700, color: "#aaa", letterSpacing: 1, textTransform: "uppercase", marginBottom: 8, display: "block" };

  return (
    <div style={{ minHeight: "100vh", background: "#fafaf8", fontFamily: "'DM Sans','Segoe UI',sans-serif", maxWidth: 420, margin: "0 auto", paddingBottom: 80 }}>
      <div style={{ padding: "28px 20px 16px", borderBottom: "1px solid #ebebeb" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 11, color: "#bbb", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>Gastos familiares</div>
            <div style={{ fontSize: 36, fontWeight: 800, color: "#1a1a1a", lineHeight: 1.1 }}>{fmt(total)}</div>
            <div style={{ fontSize: 13, color: "#aaa", marginTop: 2 }}>{gastos.length} gasto{gastos.length !== 1 ? "s" : ""}</div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button onClick={sincronizar} disabled={syncing} style={{ background: "#f0f0ee", border: "none", borderRadius: 10, padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#555" }}>
              {syncing ? "⏳" : "↻ Sync"}
            </button>
            {gastos.length > 0 && (
              <button onClick={exportar} style={{ background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 10, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>↓ Excel</button>
            )}
          </div>
        </div>
        {syncMsg && (
          <div style={{ marginTop: 10, background: syncMsg.startsWith("✓") ? "#f0fdf4" : "#fff8e1", border: `1px solid ${syncMsg.startsWith("✓") ? "#86efac" : "#fcd34d"}`, borderRadius: 10, padding: "8px 14px", fontSize: 13, color: syncMsg.startsWith("✓") ? "#166534" : "#92400e" }}>
            {syncMsg}
          </div>
        )}
      </div>

      <div style={{ display: "flex", background: "#f0f0ee", margin: "14px 20px", borderRadius: 12, padding: 4, gap: 2 }}>
        {[["add","✚ Agregar"],["list","Lista"],["stats","Análisis"]].map(([id, label]) => (
          <button key={id} onClick={() => setVista(id)} style={{ flex: 1, padding: "9px 0", border: "none", cursor: "pointer", borderRadius: 9, fontSize: 13, fontWeight: 700, transition: "all .15s", background: vista === id ? "#fff" : "transparent", color: vista === id ? "#1a1a1a" : "#888", boxShadow: vista === id ? "0 1px 4px #0001" : "none" }}>{label}</button>
        ))}
      </div>

      <div style={{ padding: "0 20px" }}>
        {vista === "add" && (
          <div>
            <div style={{ marginBottom: 14 }}>
              <span style={lbl}>¿Cuánto?</span>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", fontSize: 22, color: "#ccc", fontWeight: 700 }}>$</span>
                <input type="number" inputMode="decimal" placeholder="0" value={monto} onChange={e => setMonto(e.target.value)} onKeyDown={e => e.key === "Enter" && document.getElementById("inp-motivo").focus()} style={{ ...inp, fontSize: 32, fontWeight: 800, padding: "16px 16px 16px 44px" }} />
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <span style={lbl}>¿En qué?</span>
              <input id="inp-motivo" type="text" placeholder="ej. Súper, gasolina, cena…" value={motivo} onChange={e => setMotivo(e.target.value)} onKeyDown={e => e.key === "Enter" && guardar()} style={{ ...inp, fontSize: 17, padding: "14px 16px" }} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <span style={lbl}>¿Cómo pagaste?</span>
              <div style={{ display: "flex", gap: 8 }}>
                {METHODS.map(m => (
                  <button key={m.id} onClick={() => setMetodo(m.id)} style={{ flex: 1, padding: "12px 0", border: "2px solid", borderRadius: 12, cursor: "pointer", transition: "all .15s", fontSize: 13, fontWeight: 700, borderColor: metodo === m.id ? "#1a1a1a" : "#e8e8e8", background: metodo === m.id ? "#1a1a1a" : "#fff", color: metodo === m.id ? "#fff" : "#666" }}>
                    <div style={{ fontSize: 20 }}>{m.emoji}</div>
                    <div>{m.label}</div>
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 24 }}>
              <span style={lbl}>¿Quién?</span>
              <div style={{ display: "flex", gap: 8 }}>
                {QUIEN.map(q => (
                  <button key={q} onClick={() => setQuien(q)} style={{ flex: 1, padding: "11px 0", border: "2px solid", borderRadius: 12, cursor: "pointer", transition: "all .15s", fontSize: 13, fontWeight: 700, borderColor: quien === q ? "#f59e0b" : "#e8e8e8", background: quien === q ? "#fef3c7" : "#fff", color: quien === q ? "#92400e" : "#888" }}>{q}</button>
                ))}
              </div>
            </div>
            <button onClick={guardar} disabled={saving || !monto || !motivo} style={{ width: "100%", padding: 18, border: "none", borderRadius: 16, fontSize: 17, fontWeight: 800, transition: "all .2s", cursor: (saving || !monto || !motivo) ? "not-allowed" : "pointer", background: (!monto || !motivo) ? "#e8e8e8" : "#1a1a1a", color: (!monto || !motivo) ? "#bbb" : "#fff" }}>
              {saving ? "✨ Guardando…" : "Guardar gasto"}
            </button>
            {gastos.length > 0 && (
              <div style={{ marginTop: 20, padding: "14px 16px", background: "#f5f5f3", borderRadius: 14 }}>
                <div style={{ fontSize: 11, color: "#aaa", fontWeight: 700, marginBottom: 6 }}>ÚLTIMO GASTO</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{gastos[0].motivo}</div>
                    <div style={{ fontSize: 12, color: "#999", marginTop: 2 }}>{gastos[0].categoria} · {gastos[0].quien}</div>
                  </div>
                  <div style={{ fontWeight: 800, fontSize: 18 }}>{fmt(gastos[0].monto)}</div>
                </div>
              </div>
            )}
          </div>
        )}

        {vista === "list" && (
          <div>
            {gastos.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 0", color: "#bbb", fontSize: 15 }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🛒</div>Aún no hay gastos
              </div>
            ) : gastos.map((g, i) => {
              const m = METHODS.find(x => x.id === g.metodo);
              return (
                <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0", borderBottom: "1px solid #f0f0ee" }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: "#f5f5f3", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{m?.emoji}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.motivo}</div>
                    <div style={{ fontSize: 12, color: "#aaa", marginTop: 2 }}>{g.categoria} · {g.quien} · {g.fecha}</div>
                  </div>
                  <div style={{ fontWeight: 800, fontSize: 16, flexShrink: 0 }}>{fmt(g.monto)}</div>
                  <button onClick={() => eliminar(g, i)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#ccc", padding: 0, flexShrink: 0 }}>✕</button>
                </div>
              );
            })}
          </div>
        )}

        {vista === "stats" && (
          <div>
            {gastos.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 0", color: "#bbb", fontSize: 15 }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>Agrega gastos para ver el análisis
              </div>
            ) : (
              <>
                {catData.length > 0 && (
                  <div style={{ background: "#fff", borderRadius: 16, padding: "20px 0 10px", marginBottom: 16, border: "1px solid #f0f0ee" }}>
                    <div style={{ fontWeight: 700, fontSize: 15, paddingLeft: 20, marginBottom: 4 }}>Por categoría</div>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={catData} dataKey="value" cx="50%" cy="50%" outerRadius={80} innerRadius={40}>
                          {catData.map((_, i) => <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={v => fmt(v)} contentStyle={{ borderRadius: 10, fontSize: 13 }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ padding: "0 20px 10px" }}>
                      {catData.map((c, i) => (
                        <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                          <div style={{ width: 10, height: 10, borderRadius: 3, background: CAT_COLORS[i % CAT_COLORS.length], flexShrink: 0 }} />
                          <div style={{ flex: 1, fontSize: 14 }}>{c.name}</div>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{fmt(c.value)}</div>
                          <div style={{ fontSize: 12, color: "#aaa", width: 36, textAlign: "right" }}>{((c.value / total) * 100).toFixed(0)}%</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ background: "#fff", borderRadius: 16, padding: 20, marginBottom: 16, border: "1px solid #f0f0ee" }}>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>Por método de pago</div>
                  {METHODS.map(m => {
                    const sub = gastos.filter(g => g.metodo === m.id).reduce((s, g) => s + g.monto, 0);
                    if (!sub) return null;
                    return (
                      <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                        <div style={{ fontSize: 22 }}>{m.emoji}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <span style={{ fontSize: 13, fontWeight: 600 }}>{m.label}</span>
                            <span style={{ fontSize: 13, fontWeight: 700 }}>{fmt(sub)}</span>
                          </div>
                          <div style={{ height: 5, background: "#f0f0ee", borderRadius: 10 }}>
                            <div style={{ height: "100%", borderRadius: 10, background: "#1a1a1a", width: `${(sub / total) * 100}%` }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button onClick={pedirConsejos} disabled={loadingAdvice} style={{ width: "100%", padding: 16, border: "2px solid #1a1a1a", borderRadius: 14, fontSize: 15, fontWeight: 700, cursor: "pointer", background: "#fff", color: "#1a1a1a", marginBottom: 16 }}>
                  {loadingAdvice ? "⏳ Analizando…" : "🤖 ¿En qué podemos ahorrar?"}
                </button>
                {advice && (
                  <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 16, padding: 20, marginBottom: 16 }}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: "#92400e", marginBottom: 10 }}>💡 Consejos personalizados</div>
                    <div style={{ fontSize: 14, lineHeight: 1.7, color: "#78350f", whiteSpace: "pre-line" }}>{advice}</div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
