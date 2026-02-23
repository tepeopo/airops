import { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

/* ════════════════════════════════════════
   SUPABASE CLIENT
════════════════════════════════════════ */
const supabase = createClient(
  "https://ahdcmxvsznnpmqmxxudo.supabase.co",
  "sb_publishable_RlYExWFK8KNB-CEKOozqeQ_Vdse1R0E"
);

/* ════════════════════════════════════════
   THEME
════════════════════════════════════════ */
const C = {
  bg: "#f1f5f9",
  surface: "#ffffff",
  card: "#ffffff",
  panel: "#f8fafc",
  border: "#e2e8f0",
  borderHi: "#94a3b8",
  amber: "#d97706",
  amberDim: "#fef3c7",
  blue: "#2563eb",
  blueDim: "#dbeafe",
  green: "#059669",
  greenDim: "#d1fae5",
  red: "#dc2626",
  redDim: "#fee2e2",
  purple: "#7c3aed",
  purpleDim: "#ede9fe",
  cyan: "#0891b2",
  cyanDim: "#cffafe",
  orange: "#ea580c",
  text: "#0f172a",
  dim: "#475569",
  faint: "#94a3b8",
  overlay: "rgba(15,23,42,0.6)",
};

const FONT = "'IBM Plex Mono', monospace";

/* ════════════════════════════════════════
   CONSTANTS
════════════════════════════════════════ */
const DAYS = ["mon","tue","wed","thu","fri","sat","sun"];
const DAY_LABELS = { mon:"Monday", tue:"Tuesday", wed:"Wednesday", thu:"Thursday", fri:"Friday", sat:"Saturday", sun:"Sunday" };

function dateToDay(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return DAYS[d.getDay() === 0 ? 6 : d.getDay() - 1];
}

/* ════════════════════════════════════════
   SUPABASE DATA HELPERS
   Each function maps to one Supabase table.
   All errors are caught and logged silently
   so the UI never hard-crashes on a DB error.
════════════════════════════════════════ */

// ── Generic single-row key/value tables (airports, aircraft, routes, charters)
async function dbGetAll(table) {
  try {
    const { data, error } = await supabase.from(table).select("*");
    if (error) throw error;
    return data || [];
  } catch (e) { console.error("dbGetAll", table, e); return []; }
}

async function dbUpsert(table, row) {
  try {
    const { error } = await supabase.from(table).upsert(row);
    if (error) throw error;
  } catch (e) { console.error("dbUpsert", table, e); }
}

async function dbDelete(table, id) {
  try {
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) throw error;
  } catch (e) { console.error("dbDelete", table, e); }
}

// ── ac_config: one row per aircraft id
async function dbGetAcConfig() {
  try {
    const { data, error } = await supabase.from("ac_config").select("*");
    if (error) throw error;
    const map = {};
    (data||[]).forEach(r => { map[r.ac_id] = { routeFlightTimes: r.route_flight_times||{}, defaultCapacity: r.default_capacity }; });
    return map;
  } catch (e) { console.error("dbGetAcConfig", e); return {}; }
}

async function dbSaveAcConfig(acId, cfg) {
  try {
    const { error } = await supabase.from("ac_config").upsert({
      ac_id: acId,
      route_flight_times: cfg.routeFlightTimes || {},
      default_capacity: cfg.defaultCapacity || null,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  } catch (e) { console.error("dbSaveAcConfig", e); }
}

// ── boards: one row per date
async function dbGetBoards() {
  try {
    const { data, error } = await supabase.from("boards").select("*");
    if (error) throw error;
    const map = {};
    (data||[]).forEach(r => { map[r.date] = { pool: r.pool||{}, assignments: r.assignments||[] }; });
    return map;
  } catch (e) { console.error("dbGetBoards", e); return {}; }
}

async function dbSaveBoard(date, board) {
  try {
    const { error } = await supabase.from("boards").upsert({
      date,
      pool: board.pool || {},
      assignments: board.assignments || [],
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    // Always write to history_log for AI training data
    await supabase.from("history_log").insert({
      date,
      pool: board.pool || {},
      assignments: board.assignments || [],
    });
  } catch (e) { console.error("dbSaveBoard", e); }
}

// ── weekly: one row per day key
async function dbGetWeekly() {
  try {
    const { data, error } = await supabase.from("weekly").select("*");
    if (error) throw error;
    const map = {};
    (data||[]).forEach(r => { map[r.day] = r.slots||[]; });
    return map;
  } catch (e) { console.error("dbGetWeekly", e); return {}; }
}

async function dbSaveWeeklyDay(day, slots) {
  try {
    const { error } = await supabase.from("weekly").upsert({
      day,
      slots,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  } catch (e) { console.error("dbSaveWeeklyDay", e); }
}

/* ════════════════════════════════════════
   UTILS
════════════════════════════════════════ */
const uid  = () => Math.random().toString(36).slice(2, 9);
const pad  = (n) => String(n).padStart(2, "0");
const todayStr = () => new Date().toISOString().slice(0, 10);

function addMinutes(timeStr, mins) {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":").map(Number);
  const total = h * 60 + m + mins;
  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
}

function minutesBetween(t1, t2) {
  if (!t1 || !t2) return 0;
  const toM = t => { const [h,m]=t.split(":").map(Number); return h*60+m; };
  return toM(t2) - toM(t1);
}

// Returns how many pax a leg pulls from a given route pool entry
function legPaxFromPool(leg) {
  return leg.type === "route" ? (Number(leg.pax) || 0) : 0;
}

/* ════════════════════════════════════════
   PRIMITIVES
════════════════════════════════════════ */
const s = {
  btn: (v="primary", sm=false) => ({
    padding: sm ? "4px 10px" : "7px 16px",
    border: "none", borderRadius: 4, cursor: "pointer",
    fontFamily: FONT, fontWeight: 700,
    fontSize: sm ? 9 : 10, letterSpacing: "0.1em", textTransform: "uppercase",
    background:
      v==="primary" ? C.amber :
      v==="danger"  ? C.red   :
      v==="blue"    ? C.blue  :
      v==="green"   ? C.green :
      v==="ghost"   ? "transparent" : C.faint,
    color: ["primary","blue","green"].includes(v) ? "#000" : C.text,
    border: v==="ghost" ? `1px solid ${C.border}` : "none",
    transition: "opacity 0.12s",
    whiteSpace: "nowrap",
  }),
  inp: {
    background: C.surface, border: `1px solid ${C.border}`,
    borderRadius: 4, padding: "7px 10px", color: C.text,
    fontSize: 12, fontFamily: FONT, width: "100%",
    boxSizing: "border-box", outline: "none",
  },
  label: {
    fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase",
    color: C.faint, fontWeight: 700, display: "block", marginBottom: 4,
  },
  tag: (col) => ({
    display: "inline-block", padding: "2px 7px", borderRadius: 3,
    fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
    background: col+"22", color: col, border: `1px solid ${col}44`,
  }),
};

function Lbl({ c }) { return <span style={s.label}>{c}</span>; }
function F({ label, children, style }) {
  return <div style={{ marginBottom: 12, ...style }}><Lbl c={label} />{children}</div>;
}
function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{ position:"fixed", inset:0, background:C.overlay, zIndex:400,
      display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div style={{ background:C.card, border:`1px solid ${C.borderHi}`,
        borderRadius:10, padding:24, width:"100%", maxWidth: wide?820:500,
        maxHeight:"90vh", overflowY:"auto" }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:18 }}>
          <span style={{ fontSize:10, letterSpacing:"0.2em", textTransform:"uppercase", color:C.amber, fontWeight:700 }}>{title}</span>
          <button onClick={onClose} style={{ background:"none", border:"none", color:C.dim, cursor:"pointer", fontSize:18, lineHeight:1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
function G2({children,gap=12}){ return <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap}}>{children}</div>; }
function G3({children,gap=12}){ return <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap}}>{children}</div>; }

/* ════════════════════════════════════════
   PAX POOL HEADER
   Shows each route with remaining pax
════════════════════════════════════════ */
function PaxPoolHeader({ routes, pool, assignments }) {
  // For each route, compute how many pax have been assigned
  const consumed = {};
  assignments.forEach(ac => {
    (ac.legs || []).forEach(leg => {
      if (leg.type === "route" && leg.routeId) {
        consumed[leg.routeId] = (consumed[leg.routeId] || 0) + legPaxFromPool(leg);
      }
    });
  });

  return (
    <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:24 }}>
      {routes.map(r => {
        const total = pool[r.id] || 0;
        const used  = consumed[r.id] || 0;
        const remaining = Math.max(0, total - used);
        const pct = total ? Math.round((used/total)*100) : 0;
        const col = remaining === 0 ? C.green : remaining < total*0.2 ? C.amber : C.blue;
        return (
          <div key={r.id} style={{ background:C.card, border:`1px solid ${col}44`,
            borderRadius:8, padding:"12px 18px", minWidth:160, borderTop:`3px solid ${col}` }}>
            <div style={{ fontSize:9, letterSpacing:"0.15em", color:C.dim, marginBottom:4, textTransform:"uppercase" }}>{r.name}</div>
            <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
              <span style={{ fontSize:28, fontWeight:700, color:col, lineHeight:1 }}>{remaining}</span>
              <span style={{ fontSize:11, color:C.faint }}>/ {total}</span>
            </div>
            <div style={{ marginTop:8, height:4, background:C.surface, borderRadius:2 }}>
              <div style={{ width:`${pct}%`, height:"100%", background:col, borderRadius:2, transition:"width 0.3s" }} />
            </div>
            <div style={{ fontSize:9, color:C.faint, marginTop:4 }}>{used} assigned · {pct}%</div>
          </div>
        );
      })}
      {routes.length === 0 && (
        <div style={{ color:C.faint, fontSize:12, padding:"12px 0" }}>No routes defined. Go to Routes tab first.</div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════
   AIRCRAFT TIMELINE CARD
════════════════════════════════════════ */
const LEG_COLORS = {
  route:   C.blue,
  charter: C.purple,
  ground:  C.faint,
  ferry:   C.orange,
};

function TimelineBar({ legs, capacity }) {
  // Simple visual bar 06:00 → 22:00 = 960 min
  const START = 6 * 60, END = 22 * 60, TOTAL = END - START;
  const toX = (t) => {
    if (!t) return 0;
    const [h,m] = t.split(":").map(Number);
    return Math.max(0, Math.min(100, ((h*60+m - START) / TOTAL) * 100));
  };

  return (
    <div style={{ position:"relative", height:20, background:C.surface,
      borderRadius:3, overflow:"hidden", margin:"8px 0", border:`1px solid ${C.border}` }}>
      {/* Hour markers */}
      {[8,10,12,14,16,18,20].map(h => (
        <div key={h} style={{ position:"absolute", left:`${toX(`${h}:00`)}%`,
          top:0, bottom:0, width:1, background:C.border+"88", pointerEvents:"none" }}>
          <span style={{ position:"absolute", top:1, left:2, fontSize:7, color:C.faint }}>{h}</span>
        </div>
      ))}
      {legs.filter(l => l.depTime && l.arrTime).map((leg, i) => {
        const x1 = toX(leg.depTime), x2 = toX(leg.arrTime);
        const col = LEG_COLORS[leg.type] || C.blue;
        return (
          <div key={i} style={{ position:"absolute", left:`${x1}%`, width:`${Math.max(0.5,x2-x1)}%`,
            top:2, bottom:2, background:col+"cc", borderRadius:2 }}
            title={`${leg.depTime}→${leg.arrTime} ${leg.label||""}`} />
        );
      })}
    </div>
  );
}

function AircraftCard({
  ac, legs, onAddLeg, onRemoveLeg, onEditLeg,
  routes, charters, acConfig, pool, allAssignments, date
}) {
  const cfg = acConfig[ac.id] || {};
  const cap = cfg.defaultCapacity || ac.defaultCapacity;

  // Compute pax on board across legs (simple: board = pax on route legs departing)
  let onBoard = 0;

  // Charter blocks for this ac on this date
  const acCharters = charters.filter(c =>
    c.acId === ac.id && c.date === date && c.status !== "cancelled"
  );

  const lastLeg = legs.length > 0 ? legs[legs.length-1] : null;
  const currentBase = lastLeg ? lastLeg.arr : (ac.base || "?");
  const isNightstop = lastLeg && ac.base && lastLeg.arr !== ac.base;

  // Consumed per route by ALL aircraft
  const consumed = {};
  allAssignments.forEach(a => {
    (a.legs||[]).forEach(leg => {
      if (leg.type==="route" && leg.routeId)
        consumed[leg.routeId] = (consumed[leg.routeId]||0) + legPaxFromPool(leg);
      const cnx = Number(leg.connectingPax)||0;
      const cnxRoute = leg.throughPaxRouteId;
      if (cnx > 0 && cnxRoute) {
        consumed[cnxRoute] = (consumed[cnxRoute]||0) + cnx;
      }
    });
  });

  const getRemaining = (routeId) => Math.max(0, (pool[routeId]||0) - (consumed[routeId]||0));

  return (
    <div style={{ background:C.card,
      border:`1px solid ${isNightstop ? C.purple : C.border}`,
      borderRadius:8, marginBottom:14, overflow:"hidden",
      boxShadow: isNightstop ? `0 0 0 1px ${C.purple}44` : "none" }}>

      {/* AC Header */}
      <div style={{ background: isNightstop ? C.purpleDim : C.panel,
        borderBottom:`1px solid ${C.border}`,
        padding:"10px 16px", display:"flex", alignItems:"center", gap:14 }}>
        <span style={{ fontWeight:700, fontSize:15, color:C.amber }}>{ac.reg}</span>
        <span style={{ fontSize:10, color:C.dim }}>{ac.type}</span>
        <span style={s.tag(C.blue)}>{cap} seats</span>
        {ac.base && <span style={{ fontSize:10, color:C.faint }}>Base: {ac.base}</span>}
        <span style={{ fontSize:10, color: isNightstop ? C.purple : C.cyan, marginLeft:"auto", fontWeight: isNightstop ? 700 : 400 }}>
          {isNightstop ? "🌙 NIGHTSTOP:" : "Now at:"} <strong>{currentBase}</strong>
        </span>
        {isNightstop && (
          <span style={s.tag(C.purple)}>Away from base</span>
        )}
        {acCharters.length > 0 && (
          <span style={s.tag(C.purple)}>⚑ {acCharters.length} charter{acCharters.length>1?"s":""}</span>
        )}
      </div>

      {/* Timeline bar */}
      <div style={{ padding:"4px 16px 0" }}>
        <TimelineBar legs={[
          ...legs,
          ...acCharters.map(c => ({ type:"charter", depTime:c.depTime, arrTime:c.arrTime, label:c.client }))
        ]} capacity={cap} />
      </div>

      {/* Legs list */}
      <div style={{ padding:"8px 16px 12px" }}>
        {legs.length === 0 && acCharters.length === 0 && (
          <div style={{ color:C.faint, fontSize:11, padding:"4px 0 8px" }}>No assignments yet.</div>
        )}

        {/* Charter blocks shown inline */}
        {acCharters.map(c => (
          <div key={c.id} style={{ display:"flex", alignItems:"center", gap:10,
            background:C.purpleDim+"44", border:`1px solid ${C.purple}33`,
            borderRadius:5, padding:"6px 12px", marginBottom:6, fontSize:11 }}>
            <span style={s.tag(C.purple)}>CHARTER</span>
            <span style={{ color:C.purple, fontWeight:700 }}>{c.client}</span>
            <span style={{ color:C.dim }}>{c.from}→{c.to}</span>
            <span style={{ color:C.faint }}>{c.depTime}–{c.arrTime}</span>
            <span style={{ color:C.faint, marginLeft:"auto" }}>{c.pax||"?"} pax</span>
          </div>
        ))}

        {/* Route/ferry legs */}
        {legs.map((leg, i) => {
          const col = LEG_COLORS[leg.type] || C.blue;
          const r = routes.find(x => x.id === leg.routeId);
          const rem = leg.routeId ? getRemaining(leg.routeId) + legPaxFromPool(leg) : 0; // rem before this leg
          const afterThis = leg.routeId ? getRemaining(leg.routeId) : 0; // rem after
          return (
            <div key={leg.id} style={{ display:"flex", alignItems:"center", gap:8,
              background:C.surface+"88", border:`1px solid ${col}22`,
              borderRadius:5, padding:"6px 10px", marginBottom:5, fontSize:11 }}>
              <span style={{ color:C.faint, fontSize:9, minWidth:18 }}>#{i+1}</span>
              <span style={s.tag(col)}>{leg.type.toUpperCase()}</span>
              <span style={{ color:col, fontWeight:700 }}>{leg.dep}→{leg.arr}</span>
              {r && <span style={{ color:C.dim, fontSize:10 }}>({r.name})</span>}
              {leg.type==="route" && (() => {
                const cfg2 = acConfig[ac.id] || {};
                const acCap = cfg2.defaultCapacity || ac.defaultCapacity;
                const connecting = Number(leg.connectingPax)||0;
                const routePax = Number(leg.pax)||0;
                const totalOnBoard = routePax + connecting;
                const spare = acCap - totalOnBoard;
                return (
                  <span style={{ display:"flex", alignItems:"center", gap:5, flexWrap:"wrap" }}>
                    <span style={{ color:C.amber, fontWeight:700 }}>{routePax} pax</span>
                    {connecting > 0 && (
                      <span style={{ background:C.purpleDim, color:C.purple,
                        padding:"1px 6px", borderRadius:3, fontSize:9, fontWeight:700,
                        border:`1px solid ${C.purple}44` }}>
                        +{connecting} cnx
                      </span>
                    )}
                    {spare > 0 && (
                      <span style={{ background:C.greenDim, color:C.green,
                        padding:"1px 6px", borderRadius:3, fontSize:9, fontWeight:700,
                        border:`1px solid ${C.green}44` }}>
                        +{spare} spare
                      </span>
                    )}
                    {spare === 0 && (
                      <span style={{ background:C.amberDim, color:C.amber,
                        padding:"1px 6px", borderRadius:3, fontSize:9, fontWeight:700,
                        border:`1px solid ${C.amber}44` }}>
                        FULL
                      </span>
                    )}
                    {spare < 0 && (
                      <span style={{ background:C.redDim, color:C.red,
                        padding:"1px 6px", borderRadius:3, fontSize:9, fontWeight:700,
                        border:`1px solid ${C.red}44` }}>
                        OVER {Math.abs(spare)}
                      </span>
                    )}
                  </span>
                );
              })()}
              {leg.type==="charter" && (
                <span style={s.tag(C.purple)}>{leg.charterClient}</span>
              )}
              <span style={{ color:C.green, fontSize:10 }}>{leg.depTime}</span>
              <span style={{ color:C.faint }}>→</span>
              <span style={{ color:C.green, fontSize:10 }}>{leg.arrTime}</span>
              <span style={{ flex:1 }} />
              <button onClick={() => onEditLeg(i)} style={s.btn("ghost",true)}>Edit</button>
              <button onClick={() => onRemoveLeg(i)} style={s.btn("danger",true)}>✕</button>
            </div>
          );
        })}

        <button onClick={onAddLeg}
          style={{ ...s.btn("ghost",true), marginTop:4, width:"100%", textAlign:"center" }}>
          + Add Assignment
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   LEG EDITOR MODAL
════════════════════════════════════════ */
function LegModal({ leg, onSave, onClose, routes, aircraft, pool, consumed, ac, acConfig, allLegs }) {
  const cfg = acConfig[ac?.id] || {};
  const cap = cfg.defaultCapacity || ac?.defaultCapacity || 0;

  // Guess from = last leg's arr
  const guessFrom = allLegs.length > 0 ? allLegs[allLegs.length-1].arr : (ac?.base || "");

  const [form, setForm] = useState(leg || {
    type: "route", routeId: "", dep: guessFrom, arr: "",
    pax: "", connectingPax: "", throughPaxRouteId: "", depTime: "", arrTime: "",
    charterClient: "", charterRef: "",
  });

  const selRoute = routes.find(r => r.id === form.routeId);

  // Auto-fill arr from route
  useEffect(() => {
    if (form.type === "route" && form.routeId && selRoute) {
      const legs = selRoute.operationalRouting || [];
      if (legs.length > 0) {
        // find leg matching dep
        const match = legs.find(l => l.from === form.dep);
        if (match) setForm(f => ({ ...f, arr: match.to }));
        else setForm(f => ({ ...f, dep: legs[0].from, arr: legs[legs.length-1].to }));
      }
    }
  }, [form.routeId, form.dep]);

  // Auto-calc arrTime from depTime + aircraft-specific flight time for this route
  useEffect(() => {
    if (form.depTime && form.routeId) {
      const acFlightTime = (acConfig[ac?.id]||{}).routeFlightTimes?.[form.routeId];
      if (acFlightTime) {
        setForm(f => ({ ...f, arrTime: addMinutes(f.depTime, acFlightTime) }));
      }
    }
  }, [form.depTime, form.routeId]);

  // Remaining pax for selected route
  const remaining = form.routeId
    ? Math.max(0, (pool[form.routeId]||0) - (consumed[form.routeId]||0))
    : 0;

  // Auto suggest pax = min(cap, remaining)
  useEffect(() => {
    if (form.type === "route" && form.routeId && !leg) {
      setForm(f => ({ ...f, pax: String(Math.min(cap, remaining)) }));
    }
  }, [form.routeId]);

  const valid =
    form.type === "route"   ? (form.routeId && form.dep && form.arr && form.depTime && form.arrTime && form.pax) :
    form.type === "ferry"   ? (form.dep && form.arr && form.depTime && form.arrTime) :
    true;

  return (
    <Modal title={leg ? "Edit Assignment" : "New Assignment"} onClose={onClose}>
      <F label="Type">
        <div style={{ display:"flex", gap:8 }}>
          {["route","ferry"].map(t => (
            <button key={t} onClick={() => setForm(f=>({...f,type:t}))}
              style={{ ...s.btn(form.type===t?"primary":"ghost"), flex:1 }}>
              {t === "route" ? "✈ Route" : "🔄 Ferry"}
            </button>
          ))}
        </div>
      </F>

      {form.type === "route" && (
        <>
          <F label="Route *">
            <select style={s.inp} value={form.routeId} onChange={e => setForm(f=>({...f,routeId:e.target.value,pax:""}))}>
              <option value="">Select route…</option>
              {routes.map(r => {
                const rem = Math.max(0,(pool[r.id]||0)-(consumed[r.id]||0));
                return <option key={r.id} value={r.id}>{r.name} — {rem} pax remaining</option>;
              })}
            </select>
          </F>
          {selRoute && (
            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:4,
              padding:"8px 12px", marginBottom:12, fontSize:11 }}>
              <span style={{ color:C.cyan }}>
                {(selRoute.operationalRouting||[]).map((l,i)=>i===0?`${l.from}-${l.to}`:l.to).join("-")}
              </span>
              {(() => {
                const ft = (acConfig[ac?.id]||{}).routeFlightTimes?.[form.routeId];
                return ft
                  ? <span style={{ color:C.green, marginLeft:12 }}>⏱ {ft} min ({ac?.reg})</span>
                  : <span style={{ color:C.amber, marginLeft:12 }}>⚠ No block time set for {ac?.reg} on this route</span>;
              })()}
            </div>
          )}
          <G2>
            <F label="From">
              <input style={s.inp} value={form.dep} onChange={e => setForm(f=>({...f,dep:e.target.value.toUpperCase()}))} placeholder="FBM" />
            </F>
            <F label="To">
              <input style={s.inp} value={form.arr} onChange={e => setForm(f=>({...f,arr:e.target.value.toUpperCase()}))} placeholder="KWZ" />
            </F>
          </G2>
          <F label={`Pax (${remaining} remaining on route, ${cap} seats)`}>
            <input style={{ ...s.inp, borderColor: Number(form.pax)>cap ? C.red : Number(form.pax)>remaining ? C.amber : C.border }}
              type="number" min="0" max={cap} value={form.pax}
              onChange={e => setForm(f=>({...f,pax:e.target.value}))} />
            {Number(form.pax) > cap && <div style={{ color:C.red, fontSize:10, marginTop:3 }}>⚠ Exceeds aircraft capacity ({cap})</div>}
            {Number(form.pax) > remaining && Number(form.pax) <= cap &&
              <div style={{ color:C.amber, fontSize:10, marginTop:3 }}>⚠ More than remaining pool ({remaining})</div>}
            {(() => {
              const paxNum = Number(form.pax);
              const spare = cap - paxNum;
              const overPool = paxNum > remaining;
              if (paxNum > 0 && spare > 0 && paxNum <= cap) {
                return (
                  <div style={{ marginTop:6, background:C.greenDim, border:`1px solid ${C.green}44`,
                    borderRadius:4, padding:"6px 10px", display:"flex", alignItems:"center", gap:10 }}>
                    <span style={{ fontSize:11, color:C.green, fontWeight:700 }}>
                      +{spare} spare seat{spare!==1?"s":""}
                    </span>
                    <span style={{ fontSize:10, color:C.dim }}>
                      ({paxNum} pax · {cap} capacity)
                    </span>
                    {overPool && <span style={{ fontSize:10, color:C.amber }}>· pool has {remaining}</span>}
                  </div>
                );
              }
              if (paxNum > 0 && spare === 0 && paxNum <= cap) {
                return (
                  <div style={{ marginTop:6, background:C.amberDim, border:`1px solid ${C.amber}44`,
                    borderRadius:4, padding:"6px 10px" }}>
                    <span style={{ fontSize:11, color:C.amber, fontWeight:700 }}>Full load — no spare seats</span>
                  </div>
                );
              }
              return null;
            })()}
          </F>
          <F label="Through Pax (boarding here, riding further)">
            <div style={{ display:"flex", gap:8, alignItems:"flex-start" }}>
              <div style={{ flex:1 }}>
                <input style={{ ...s.inp, borderColor: (() => {
                  const total = (Number(form.pax)||0) + (Number(form.connectingPax)||0);
                  return total > cap ? C.red : Number(form.connectingPax)>0 ? C.cyan : C.border;
                })() }}
                  type="number" min="0" value={form.connectingPax}
                  onChange={e => setForm(f=>({...f,connectingPax:e.target.value}))}
                  placeholder="0 pax" />
              </div>
              <div style={{ flex:2 }}>
                <select style={{ ...s.inp, borderColor: form.throughPaxRouteId ? C.cyan : C.border }}
                  value={form.throughPaxRouteId}
                  onChange={e => setForm(f=>({...f,throughPaxRouteId:e.target.value}))}>
                  <option value="">← select their route</option>
                  {routes.filter(r => r.id !== form.routeId).map(r => {
                    const rem = Math.max(0,(pool[r.id]||0)-(consumed[r.id]||0));
                    return <option key={r.id} value={r.id}>{r.name} ({rem} avail)</option>;
                  })}
                </select>
              </div>
            </div>
            {(() => {
              const cnx = Number(form.connectingPax)||0;
              const local = Number(form.pax)||0;
              const total = local + cnx;
              const spare = cap - total;
              if (cnx > 0) return (
                <div style={{ marginTop:5, background: spare<0?C.redDim:C.cyanDim,
                  border:`1px solid ${spare<0?C.red:C.cyan}44`,
                  borderRadius:4, padding:"5px 10px", fontSize:10 }}>
                  <span style={{ color:spare<0?C.red:C.cyan, fontWeight:700 }}>
                    {local} local + {cnx} through = {total} on board
                  </span>
                  {spare >= 0
                    ? <span style={{ color:C.green, marginLeft:8 }}>· {spare} seat{spare!==1?"s":""} free</span>
                    : <span style={{ color:C.red, marginLeft:8 }}>· OVERLOADED by {Math.abs(spare)}</span>}
                  {!form.throughPaxRouteId && cnx > 0 && (
                    <span style={{ color:C.amber, marginLeft:8 }}>⚠ Select route to track pool correctly</span>
                  )}
                </div>
              );
              return null;
            })()}
          </F>
        </>
      )}

      {form.type === "ferry" && (
        <G2>
          <F label="From">
            <input style={s.inp} value={form.dep} onChange={e => setForm(f=>({...f,dep:e.target.value.toUpperCase()}))} />
          </F>
          <F label="To">
            <input style={s.inp} value={form.arr} onChange={e => setForm(f=>({...f,arr:e.target.value.toUpperCase()}))} />
          </F>
        </G2>
      )}



      <G2>
        <F label="Departure Time *">
          <input style={s.inp} type="time" value={form.depTime} onChange={e => setForm(f=>({...f,depTime:e.target.value}))} />
        </F>
        <F label="Arrival Time *">
          <input style={s.inp} type="time" value={form.arrTime} onChange={e => setForm(f=>({...f,arrTime:e.target.value}))} />
        </F>
      </G2>

      {form.depTime && form.arrTime && minutesBetween(form.depTime,form.arrTime) > 0 && (
        <div style={{ fontSize:10, color:C.cyan, marginBottom:12 }}>
          ⏱ Block time: {minutesBetween(form.depTime,form.arrTime)} min
        </div>
      )}

      <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:4 }}>
        <button style={s.btn("ghost")} onClick={onClose}>Cancel</button>
        <button style={s.btn(valid?"primary":"ghost")} onClick={() => valid && onSave({...form, id: form.id||uid()})}>
          Save
        </button>
      </div>
    </Modal>
  );
}

/* ════════════════════════════════════════
   EXPORT MODAL COMPONENT
════════════════════════════════════════ */
function ExportModal({ onClose, exportSession, setExportSession, generatePrintHTML,
  aircraft, workingBoard, charters, acConfig, routes, date }) {

  const openPrint = () => {
    const html = generatePrintHTML();
    const w = window.open("", "_blank");
    if (!w) { alert("Pop-up blocked. Please allow pop-ups for this site."); return; }
    w.document.write(html);
    w.document.close();
  };

  const activeAc = aircraft.filter(a => a.status === "active");

  return (
    <Modal title="Export Program" onClose={onClose} wide>
      {/* Session toggle */}
      <div style={{ marginBottom:16 }}>
        <div style={s.label}>Session</div>
        <div style={{ display:"flex", gap:8 }}>
          {[["afternoon","☀️ Afternoon Program"],["morning","🌅 Morning Program"]].map(([val,label]) => (
            <button key={val} onClick={() => setExportSession(val)}
              style={{ ...s.btn(exportSession===val?"primary":"ghost"), flex:1 }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Preview */}
      <div style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:6,
        padding:16, marginBottom:16, maxHeight:420, overflowY:"auto" }}>
        <div style={{ fontSize:11, color:C.dim, marginBottom:12 }}>
          <strong style={{ color:C.text }}>
            {exportSession === "afternoon" ? "☀️ Afternoon Program" : "🌅 Morning Program"}
          </strong>
          {" — "}{new Date(date + "T12:00:00").toLocaleDateString("en-GB",
            { weekday:"long", day:"numeric", month:"long", year:"numeric" })}
        </div>

        {activeAc.map(ac => {
          const asgn = workingBoard.assignments.find(a => a.acId === ac.id) || { legs:[] };
          const legs = asgn.legs || [];
          const acCharters = charters.filter(c =>
            c.acId === ac.id && c.date === date && c.status !== "cancelled");
          if (legs.length === 0 && acCharters.length === 0) return null;

          const lastLeg = legs.length > 0 ? legs[legs.length-1] : null;
          const finalPos = lastLeg ? lastLeg.arr : (ac.base || "?");
          const nightstop = lastLeg && ac.base && lastLeg.arr !== ac.base;
          const cfg = acConfig[ac.id] || {};
          const cap = cfg.defaultCapacity || ac.defaultCapacity;

          const allLegs = [
            ...legs.map(l => ({...l, _t:"leg"})),
            ...acCharters.map(c => ({_t:"charter", depTime:c.depTime, arrTime:c.arrTime,
              dep:c.from, arr:c.to, client:c.client, pax:c.pax}))
          ].sort((a,b) => (a.depTime||"").localeCompare(b.depTime||""));

          return (
            <div key={ac.id} style={{ marginBottom:10, background:C.surface,
              border:`1px solid ${nightstop?C.purple:C.border}`, borderRadius:6, overflow:"hidden" }}>
              <div style={{ background:nightstop?C.purpleDim:C.panel, padding:"8px 12px",
                display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span>
                  <strong style={{ color:C.amber, fontSize:13 }}>{ac.reg}</strong>
                  <span style={{ color:C.dim, fontSize:10, marginLeft:8 }}>{ac.type}</span>
                  <span style={{ background:C.blueDim, color:C.blue, padding:"1px 6px",
                    borderRadius:3, fontSize:9, fontWeight:700, marginLeft:8 }}>{cap} seats</span>
                </span>
                <span style={{ fontSize:10, color:nightstop?C.purple:C.cyan, fontWeight:nightstop?700:400 }}>
                  {nightstop ? `🌙 Nightstop: ${finalPos}` : `Returns: ${finalPos}`}
                </span>
              </div>
              <div style={{ padding:"4px 12px 8px" }}>
                {allLegs.map((l, i) => {
                  const connecting = Number(l.connectingPax)||0;
                  const totalOnBoard = (Number(l.pax)||0) + connecting;
                  const spare = cap - totalOnBoard;
                  const throughRoute = l.throughPaxRouteId ? routes.find(x => x.id === l.throughPaxRouteId) : null;
                  return (
                    <div key={i} style={{ display:"flex", gap:10, fontSize:11,
                      padding:"4px 0", borderBottom:`1px solid ${C.border}22`, alignItems:"center" }}>
                      <span style={{ color:l._t==="charter"?C.purple:C.blue,
                        fontWeight:700, minWidth:55, fontSize:9 }}>
                        {l._t==="charter"?"CHARTER":(l.type||"ROUTE").toUpperCase()}
                      </span>
                      <span style={{ fontWeight:700, minWidth:80 }}>{l.dep}→{l.arr}</span>
                      <span style={{ color:C.green, minWidth:95 }}>{l.depTime}→{l.arrTime}</span>
                      {l._t==="charter"
                        ? <span style={{ color:C.purple }}>{l.client} · {l.pax||"?"} pax</span>
                        : <span style={{ color:C.amber }}>
                            {l.pax} pax
                            {connecting > 0 && (
                              <span style={{ color:C.cyan }}> +{connecting} thru{throughRoute?" ("+throughRoute.name+")":""}</span>
                            )}
                            {connecting > 0 && <span style={{ color:C.dim }}> ={totalOnBoard}</span>}
                            {spare > 0
                              ? <span style={{ color:C.green, fontSize:9 }}> (+{spare} spare)</span>
                              : spare === 0
                                ? <span style={{ color:C.amber, fontSize:9 }}> FULL</span>
                                : <span style={{ color:C.red, fontSize:9, fontWeight:700 }}> OVERLOAD</span>}
                          </span>
                      }
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {activeAc.every(ac => {
          const asgn = workingBoard.assignments.find(a => a.acId === ac.id) || { legs:[] };
          return (asgn.legs||[]).length === 0 &&
            charters.filter(c => c.acId === ac.id && c.date === date).length === 0;
        }) && (
          <div style={{ color:C.faint, fontSize:12 }}>No assignments logged yet for this session.</div>
        )}
      </div>

      <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
        <button style={s.btn("ghost")} onClick={onClose}>Close</button>
        <button style={s.btn("green")} onClick={openPrint}>
          🖨 Open Printable Sheet
        </button>
      </div>
    </Modal>
  );
}

/* ════════════════════════════════════════
   DISPATCH BOARD (main page)
════════════════════════════════════════ */
function DispatchBoard({ aircraft, routes, charters, acConfig, boards, setBoards, weekly }) {
  const [date, setDate] = useState(todayStr());
  const [showTemplate, setShowTemplate] = useState(true);
  const [showExport, setShowExport] = useState(false);
  const [exportSession, setExportSession] = useState("afternoon"); // "afternoon" | "morning"

  // Get today's template slots
  const todayDay = dateToDay(date);
  const todaySlots = (weekly[todayDay] || []);

  // Board for this date: { pool: {routeId: totalPax}, assignments: [{acId, legs:[]}] }
  const board = boards[date] || { pool: {}, assignments: [] };

  const saveBoard = async (updated) => {
    const newBoards = { ...boards, [date]: updated };
    setBoards(newBoards);
    await dbSaveBoard(date, updated);
  };

  const setPool = async (routeId, val) => {
    const updated = { ...board, pool: { ...board.pool, [routeId]: Number(val)||0 } };
    await saveBoard(updated);
  };

  // Ensure every active aircraft has an assignment slot
  const ensureAssignments = (b) => {
    const existing = new Set((b.assignments||[]).map(a => a.acId));
    const added = aircraft.filter(ac=>ac.status==="active" && !existing.has(ac.id))
      .map(ac => ({ acId: ac.id, legs: [] }));
    return added.length > 0 ? { ...b, assignments: [...(b.assignments||[]), ...added] } : b;
  };

  const workingBoard = ensureAssignments(board);

  // Consumed pax per route — local pax + through/connecting pax (debits their own route pool)
  const consumed = {};
  (workingBoard.assignments||[]).forEach(a => {
    (a.legs||[]).forEach(leg => {
      if (leg.type==="route" && leg.routeId)
        consumed[leg.routeId] = (consumed[leg.routeId]||0) + legPaxFromPool(leg);
      // Through pax debit from their route pool, not the leg's route pool
      const cnx = Number(leg.connectingPax)||0;
      const cnxRoute = leg.throughPaxRouteId;
      if (cnx > 0 && cnxRoute) {
        consumed[cnxRoute] = (consumed[cnxRoute]||0) + cnx;
      }
    });
  });

  // Spare seats per route: sum of (ac capacity - pax) for each assigned leg on that route
  const spareSeats = {};
  (workingBoard.assignments||[]).forEach(a => {
    const ac = aircraft.find(x => x.id === a.acId);
    if (!ac) return;
    (a.legs||[]).forEach(leg => {
      if (leg.type==="route" && leg.routeId) {
        const cfg = acConfig[ac.id] || {};
        const cap = cfg.defaultCapacity || ac.defaultCapacity || 0;
        const totalOnBoard = (Number(leg.pax)||0) + (Number(leg.connectingPax)||0);
        const spare = Math.max(0, cap - totalOnBoard);
        spareSeats[leg.routeId] = (spareSeats[leg.routeId]||0) + spare;
      }
    });
  });

  // Leg modal state
  const [legModal, setLegModal] = useState(null);
  // { acId, legIdx (null=new), leg }

  const openAddLeg = (acId) => setLegModal({ acId, legIdx: null, leg: null });
  const openEditLeg = (acId, legIdx) => {
    const a = workingBoard.assignments.find(x=>x.acId===acId);
    setLegModal({ acId, legIdx, leg: a.legs[legIdx] });
  };

  const saveLeg = async (savedLeg) => {
    const newAssignments = workingBoard.assignments.map(a => {
      if (a.acId !== legModal.acId) return a;
      let legs = [...(a.legs||[])];
      if (legModal.legIdx === null) legs = [...legs, savedLeg];
      else legs[legModal.legIdx] = savedLeg;
      return { ...a, legs };
    });
    await saveBoard({ ...workingBoard, assignments: newAssignments });
    setLegModal(null);
  };

  const removeLeg = async (acId, idx) => {
    if (!confirm("Remove this assignment?")) return;
    const newAssignments = workingBoard.assignments.map(a => {
      if (a.acId !== acId) return a;
      return { ...a, legs: a.legs.filter((_,i)=>i!==idx) };
    });
    await saveBoard({ ...workingBoard, assignments: newAssignments });
  };

  const copyYesterday = async () => {
    const d = new Date(date); d.setDate(d.getDate()-1);
    const yd = d.toISOString().slice(0,10);
    const yb = boards[yd];
    if (!yb) return alert("No board found for yesterday ("+yd+")");
    if (!confirm("Copy yesterday's pax pool to today? (assignments won't be copied)")) return;
    await saveBoard({ ...workingBoard, pool: { ...yb.pool } });
  };

  const modalAc = legModal ? aircraft.find(a=>a.id===legModal.acId) : null;
  const modalAssignment = legModal ? workingBoard.assignments.find(a=>a.acId===legModal.acId) : null;

  // Total overview
  const totalRoutes = routes.length;
  const fullyCleared = routes.filter(r => {
    const pool = workingBoard.pool[r.id]||0;
    const used = consumed[r.id]||0;
    return pool > 0 && used >= pool;
  }).length;

  // For "use slot" — open legModal pre-filled from a template slot
  const useTemplateSlot = (slot, acId) => {
    const route = routes.find(r => r.id === slot.routeId);
    const matchAc = acId
      ? aircraft.find(a => a.id === acId)
      : aircraft.find(a => a.status === "active" && (!slot.acType || a.type === slot.acType));
    if (!matchAc) return alert("No matching active aircraft found for type: " + (slot.acType||"any"));
    const assignment = workingBoard.assignments.find(a => a.acId === matchAc.id);
    const guessFrom = (assignment?.legs||[]).length > 0
      ? assignment.legs[assignment.legs.length-1].arr
      : matchAc.base || "";
    const acFt = (acConfig[matchAc.id]||{}).routeFlightTimes?.[slot.routeId];
    const arrTime = acFt && slot.depTime ? addMinutes(slot.depTime, acFt) : "";
    const remaining = Math.max(0, (workingBoard.pool[slot.routeId]||0) - (consumed[slot.routeId]||0));
    const cap = matchAc.defaultCapacity;
    setLegModal({
      acId: matchAc.id,
      legIdx: null,
      leg: {
        type: "route",
        routeId: slot.routeId,
        dep: guessFrom || (route?.operationalRouting?.[0]?.from || ""),
        arr: route?.operationalRouting?.[route.operationalRouting.length-1]?.to || "",
        pax: String(slot.expectedPax ? Math.min(slot.expectedPax, cap, remaining) : Math.min(cap, remaining)),
        depTime: slot.depTime,
        arrTime,
        charterClient: "", charterRef: "",
      }
    });
  };

  // ── Generate print HTML ──────────────────────────────────────────────────
  const generatePrintHTML = () => {
    const sessionLabel = exportSession === "afternoon" ? "Afternoon Program" : "Morning Program";
    const now = new Date();
    const dateLabel = new Date(date + "T12:00:00").toLocaleDateString("en-GB", { weekday:"long", day:"numeric", month:"long", year:"numeric" });
    const generatedAt = now.toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" });
    const acList = aircraft.filter(a => a.status === "active");

    const rows = acList.map(ac => {
      const assignment = workingBoard.assignments.find(a => a.acId === ac.id) || { legs:[] };
      const legs = assignment.legs || [];
      const acCharters = charters.filter(c => c.acId === ac.id && c.date === date && c.status !== "cancelled");
      if (legs.length === 0 && acCharters.length === 0) return "";
      const lastLeg = legs.length > 0 ? legs[legs.length-1] : null;
      const finalPos = lastLeg ? lastLeg.arr : (ac.base || "?");
      const nightstop = lastLeg && ac.base && lastLeg.arr !== ac.base;
      const cfg = acConfig[ac.id] || {};
      const cap = cfg.defaultCapacity || ac.defaultCapacity;

      const allLegs = [
        ...legs.map(l => ({ ...l, _type:"leg" })),
        ...acCharters.map(c => ({ _type:"charter", depTime:c.depTime, arrTime:c.arrTime, dep:c.from, arr:c.to, client:c.client, pax:c.pax }))
      ].sort((a,b) => (a.depTime||"").localeCompare(b.depTime||""));

      const legRows = allLegs.map(l => {
        if (l._type === "charter") {
          return `<tr style="background:#faf5ff">
            <td style="padding:7px 12px;font-weight:700;color:#7c3aed;border-bottom:1px solid #e2e8f0">CHARTER</td>
            <td style="padding:7px 12px;font-weight:700;border-bottom:1px solid #e2e8f0">${l.dep||""}→${l.arr||""}</td>
            <td style="padding:7px 12px;color:#059669;font-weight:700;border-bottom:1px solid #e2e8f0">${l.depTime||""}→${l.arrTime||""}</td>
            <td style="padding:7px 12px;color:#7c3aed;border-bottom:1px solid #e2e8f0">${l.client||""}</td>
            <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0">${l.pax||"?"} pax</td>
          </tr>`;
        }
        const connecting = Number(l.connectingPax)||0;
        const totalOnBoard = (Number(l.pax)||0) + connecting;
        const spare = cap - totalOnBoard;
        const r = routes.find(x => x.id === l.routeId);
        const throughRoute = l.throughPaxRouteId ? routes.find(x => x.id === l.throughPaxRouteId) : null;
        const spareHtml = spare > 0
          ? `<span style="color:#059669;font-size:10px"> (+${spare} spare)</span>`
          : spare === 0 ? `<span style="color:#d97706;font-size:10px"> FULL</span>`
          : `<span style="color:#dc2626;font-size:10px"> OVERLOAD</span>`;
        const cnxLabel = connecting > 0
          ? `<span style="color:#0891b2;font-size:10px"> +${connecting} thru${throughRoute?" ("+throughRoute.name+")":""}</span>`
          : "";
        return `<tr>
          <td style="padding:7px 12px;font-weight:700;color:#2563eb;border-bottom:1px solid #e2e8f0">${(l.type||"ROUTE").toUpperCase()}</td>
          <td style="padding:7px 12px;font-weight:700;border-bottom:1px solid #e2e8f0">${l.dep||""}→${l.arr||""}</td>
          <td style="padding:7px 12px;color:#059669;font-weight:700;border-bottom:1px solid #e2e8f0">${l.depTime||""}→${l.arrTime||""}</td>
          <td style="padding:7px 12px;color:#475569;font-size:11px;border-bottom:1px solid #e2e8f0">${r ? r.name : ""}</td>
          <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0">${l.pax||0}${cnxLabel}${connecting>0?` = ${totalOnBoard} on board`:""}${spareHtml}</td>
        </tr>`;
      }).join("");

      return `<div style="margin-bottom:20px;border:2px solid ${nightstop?"#7c3aed":"#e2e8f0"};border-radius:8px;overflow:hidden;page-break-inside:avoid">
        <div style="background:${nightstop?"#ede9fe":"#f8fafc"};padding:12px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e2e8f0">
          <div style="display:flex;align-items:center;gap:12px">
            <span style="font-weight:700;font-size:17px;color:#d97706">${ac.reg}</span>
            <span style="color:#475569;font-size:12px">${ac.type||""}</span>
            <span style="background:#dbeafe;color:#2563eb;padding:2px 8px;border-radius:3px;font-size:10px;font-weight:700">${cap} seats</span>
          </div>
          <div style="font-size:12px;font-weight:700;color:${nightstop?"#7c3aed":"#0891b2"}">
            ${nightstop ? "🌙 NIGHTSTOP: " + finalPos : "Returns to: " + finalPos}
          </div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;font-family:'IBM Plex Mono',monospace">
          <thead><tr style="background:#f1f5f9">
            <th style="text-align:left;padding:6px 12px;font-size:9px;letter-spacing:0.12em;color:#94a3b8;text-transform:uppercase;border-bottom:1px solid #e2e8f0">Type</th>
            <th style="text-align:left;padding:6px 12px;font-size:9px;letter-spacing:0.12em;color:#94a3b8;text-transform:uppercase;border-bottom:1px solid #e2e8f0">Sector</th>
            <th style="text-align:left;padding:6px 12px;font-size:9px;letter-spacing:0.12em;color:#94a3b8;text-transform:uppercase;border-bottom:1px solid #e2e8f0">Times</th>
            <th style="text-align:left;padding:6px 12px;font-size:9px;letter-spacing:0.12em;color:#94a3b8;text-transform:uppercase;border-bottom:1px solid #e2e8f0">Route</th>
            <th style="text-align:left;padding:6px 12px;font-size:9px;letter-spacing:0.12em;color:#94a3b8;text-transform:uppercase;border-bottom:1px solid #e2e8f0">Pax</th>
          </tr></thead>
          <tbody>${legRows}</tbody>
        </table>
      </div>`;
    }).filter(Boolean).join("");

    const nightstops = acList.filter(ac => {
      const asgn = workingBoard.assignments.find(a => a.acId === ac.id) || { legs:[] };
      const ll = asgn.legs.length > 0 ? asgn.legs[asgn.legs.length-1] : null;
      return ll && ac.base && ll.arr !== ac.base;
    });

    const nightstopBlock = nightstops.length > 0 ? `
      <div style="margin-top:24px;border:2px solid #7c3aed;border-radius:8px;padding:16px 20px;background:#faf5ff;page-break-inside:avoid">
        <div style="font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:#7c3aed;font-weight:700;margin-bottom:12px">🌙 Nightstop Summary</div>
        ${nightstops.map(ac => {
          const asgn = workingBoard.assignments.find(a => a.acId === ac.id) || { legs:[] };
          if (!asgn.legs.length) return "";
          const ll = asgn.legs[asgn.legs.length-1];
          return `<div style="display:flex;gap:20px;font-size:13px;margin-bottom:6px;align-items:center">
            <span style="color:#d97706;font-weight:700;min-width:90px">${ac.reg}</span>
            <span style="color:#7c3aed;font-weight:700">Overnights at ${ll.arr}</span>
            <span style="color:#94a3b8;font-size:11px">(home base: ${ac.base})</span>
          </div>`;
        }).join("")}
      </div>` : "";

    return `<!DOCTYPE html><html><head>
      <meta charset="utf-8"/>
      <title>AirOps — ${sessionLabel} — ${dateLabel}</title>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&display=swap" rel="stylesheet"/>
      <style>
        * { box-sizing:border-box; margin:0; padding:0; }
        body { font-family:'IBM Plex Mono','Courier New',monospace; background:#fff; color:#0f172a; padding:36px; max-width:900px; margin:0 auto; }
        @media print { .no-print { display:none !important; } body { padding:16px; } }
      </style>
    </head><body>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:28px;padding-bottom:16px;border-bottom:3px solid #0f172a">
        <div>
          <div style="font-size:13px;letter-spacing:0.2em;text-transform:uppercase;color:#94a3b8;margin-bottom:4px">✈ AirOps Dispatch</div>
          <div style="font-size:30px;font-weight:700;color:#d97706">${sessionLabel}</div>
          <div style="font-size:15px;color:#475569;margin-top:4px">${dateLabel}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;color:#94a3b8">Generated at ${generatedAt}</div>
          <button class="no-print" onclick="window.print()" style="margin-top:10px;padding:8px 18px;background:#d97706;color:#000;border:none;border-radius:4px;font-weight:700;cursor:pointer;font-family:inherit;font-size:12px">🖨 Print / Save PDF</button>
        </div>
      </div>
      ${rows || "<p style='color:#94a3b8'>No assignments logged for this session.</p>"}
      ${nightstopBlock}
    </body></html>`;
  };

  return (
    <div>
      {/* Board header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <span style={{ fontSize:18, fontWeight:700 }}>Dispatch Board</span>
          <input type="date" style={{ ...s.inp, width:"auto" }} value={date} onChange={e=>setDate(e.target.value)} />
          <button style={s.btn("ghost",true)} onClick={copyYesterday}>Copy yesterday's pool</button>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ fontSize:11, color:C.dim }}>
            {fullyCleared}/{totalRoutes} routes cleared
            {fullyCleared === totalRoutes && totalRoutes > 0 &&
              <span style={{ color:C.green, marginLeft:8 }}>✓ ALL CLEAR</span>}
          </div>
          <button style={s.btn(showTemplate?"primary":"ghost", true)}
            onClick={() => setShowTemplate(v => !v)}>
            {showTemplate ? "Hide Template" : `📋 Template (${todaySlots.length})`}
          </button>
          <button style={s.btn("green", true)} onClick={() => setShowExport(true)}>
            ⬇ Export Program
          </button>
        </div>
      </div>

      {/* PAX POOL — enter totals per route */}
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8,
        padding:"16px 20px", marginBottom:20 }}>
        <div style={{ fontSize:9, letterSpacing:"0.2em", textTransform:"uppercase",
          color:C.amber, fontWeight:700, marginBottom:14 }}>Pax Pool — Enter Today's Totals</div>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"flex-end" }}>
          {routes.map(r => {
            const poolVal = workingBoard.pool[r.id] || "";
            const usedVal = consumed[r.id] || 0;
            const rem = Math.max(0, (Number(poolVal)||0) - usedVal);
            const pct = poolVal ? Math.round(usedVal/(Number(poolVal))*100) : 0;
            const col = rem===0&&poolVal?C.green : pct>80?C.amber : C.blue;
            return (
              <div key={r.id} style={{ background:C.surface, border:`1px solid ${col}44`,
                borderRadius:6, padding:"10px 14px", minWidth:160 }}>
                <div style={{ fontSize:9, color:C.dim, letterSpacing:"0.1em",
                  textTransform:"uppercase", marginBottom:6 }}>{r.name}</div>
                <input type="number" min="0" style={{ ...s.inp, fontSize:20,
                  fontWeight:700, color:col, padding:"4px 8px", marginBottom:6 }}
                  value={poolVal} placeholder="0"
                  onChange={e => setPool(r.id, e.target.value)} />
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, color:C.faint }}>
                  <span>{usedVal} assigned</span>
                  <span style={{ color:col, fontWeight:700 }}>{rem} left</span>
                </div>
                <div style={{ height:3, background:C.bg, borderRadius:2, marginTop:4, marginBottom: spareSeats[r.id]>0 ? 6 : 0 }}>
                  <div style={{ width:`${pct}%`, height:"100%", background:col, borderRadius:2 }} />
                </div>
                {spareSeats[r.id] > 0 && (
                  <div style={{ background:C.greenDim, border:`1px solid ${C.green}33`,
                    borderRadius:3, padding:"3px 7px", fontSize:9, color:C.green, fontWeight:700 }}>
                    +{spareSeats[r.id]} extra seat{spareSeats[r.id]!==1?"s":""}
                  </div>
                )}
              </div>
            );
          })}
          {routes.length === 0 && (
            <div style={{ color:C.faint, fontSize:12 }}>Define routes first in the Routes tab.</div>
          )}
        </div>
      </div>

      {/* MAIN BOARD + TEMPLATE PANEL */}
      <div style={{ display:"flex", gap:16, alignItems:"flex-start" }}>
        {/* Aircraft cards — main board */}
        <div style={{ flex:1, minWidth:0 }}>
          {aircraft.filter(ac=>ac.status==="active").length === 0 && (
            <div style={{ color:C.faint, fontSize:12, padding:"20px 0" }}>
              No active aircraft. Add your fleet in the Fleet tab.
            </div>
          )}
          {aircraft.filter(ac=>ac.status==="active").map(ac => {
            const assignment = workingBoard.assignments.find(a=>a.acId===ac.id) || { legs:[] };
            return (
              <AircraftCard
                key={ac.id}
                ac={ac}
                legs={assignment.legs||[]}
                routes={routes}
                charters={charters}
                acConfig={acConfig}
                pool={workingBoard.pool}
                allAssignments={workingBoard.assignments}
                date={date}
                onAddLeg={() => openAddLeg(ac.id)}
                onRemoveLeg={(i) => removeLeg(ac.id, i)}
                onEditLeg={(i) => openEditLeg(ac.id, i)}
              />
            );
          })}
        </div>

        {/* TEMPLATE SIDE PANEL */}
        {showTemplate && (
          <div style={{ width:280, flexShrink:0, background:C.card,
            border:`1px solid ${C.borderHi}`, borderRadius:8,
            position:"sticky", top:72, maxHeight:"calc(100vh - 100px)", overflowY:"auto" }}>
            <div style={{ padding:"14px 16px", borderBottom:`1px solid ${C.border}` }}>
              <div style={{ fontSize:9, letterSpacing:"0.2em", textTransform:"uppercase",
                color:C.amber, fontWeight:700, marginBottom:2 }}>
                📋 {DAY_LABELS[todayDay]} Template
              </div>
              <div style={{ fontSize:10, color:C.faint }}>
                {todaySlots.length} scheduled slot{todaySlots.length!==1?"s":""}
              </div>
            </div>

            {todaySlots.length === 0 ? (
              <div style={{ padding:16, color:C.faint, fontSize:11 }}>
                No template defined for {DAY_LABELS[todayDay]}.<br/>
                Go to Weekly Schedule to set it up.
              </div>
            ) : (
              <div style={{ padding:12 }}>
                {todaySlots.map((slot, i) => {
                  const route = routes.find(r => r.id === slot.routeId);
                  // Find matching active aircraft for this type
                  const matchingAc = aircraft.filter(a =>
                    a.status === "active" && (!slot.acType || a.type === slot.acType)
                  );
                  return (
                    <div key={slot.id||i} style={{ background:C.surface,
                      border:`1px solid ${C.border}`, borderRadius:6,
                      padding:"10px 12px", marginBottom:8 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                        <span style={{ color:C.green, fontWeight:700, fontSize:13 }}>{slot.depTime}</span>
                        {slot.acType && (
                          <span style={{ background:C.blueDim, color:C.blue, padding:"1px 6px",
                            borderRadius:3, fontSize:9, fontWeight:700 }}>{slot.acType}</span>
                        )}
                      </div>
                      <div style={{ color:C.amber, fontWeight:700, fontSize:11, marginBottom:2 }}>
                        {route?.name || "Unknown route"}
                      </div>
                      {route && (
                        <div style={{ fontSize:9, color:C.faint, marginBottom:6 }}>
                          {(route.operationalRouting||[]).map((l,j)=>j===0?`${l.from}-${l.to}`:l.to).join("-")}
                        </div>
                      )}
                      {slot.expectedPax > 0 && (
                        <div style={{ fontSize:9, color:C.cyan, marginBottom:8 }}>
                          ~{slot.expectedPax} pax expected
                        </div>
                      )}
                      {slot.notes && (
                        <div style={{ fontSize:9, color:C.faint, marginBottom:8, fontStyle:"italic" }}>
                          {slot.notes}
                        </div>
                      )}
                      {/* Assign buttons — one per matching aircraft type */}
                      <div style={{ fontSize:9, color:C.faint, marginBottom:4, textTransform:"uppercase", letterSpacing:"0.1em" }}>
                        Assign to:
                      </div>
                      {matchingAc.length === 0 ? (
                        <div style={{ fontSize:10, color:C.red }}>No active {slot.acType||""} aircraft</div>
                      ) : (
                        <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                          {matchingAc.map(ac => (
                            <button key={ac.id} onClick={() => useTemplateSlot(slot, ac.id)}
                              style={{ ...s.btn("ghost", true), fontSize:9, padding:"3px 8px",
                                borderColor:C.amber+"66", color:C.amber }}>
                              {ac.reg}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* EXPORT MODAL */}
      {showExport && (
        <ExportModal
          onClose={() => setShowExport(false)}
          exportSession={exportSession}
          setExportSession={setExportSession}
          generatePrintHTML={generatePrintHTML}
          aircraft={aircraft}
          workingBoard={workingBoard}
          charters={charters}
          acConfig={acConfig}
          routes={routes}
          date={date}
        />
      )}
      {/* LEG MODAL */}
      {legModal && modalAc && (
        <LegModal
          leg={legModal.leg}
          ac={modalAc}
          routes={routes}
          aircraft={aircraft}
          pool={workingBoard.pool}
          consumed={consumed}
          acConfig={acConfig}
          allLegs={modalAssignment?.legs||[]}
          onSave={saveLeg}
          onClose={() => setLegModal(null)}
        />
      )}
    </div>
  );
}

/* ════════════════════════════════════════
   SETUP PAGES (Airports, Fleet, Routes, Charters)
   — compact versions for the nav
════════════════════════════════════════ */
function SetupAirports({ airports, setAirports }) {
  const [form, setForm] = useState({ code:"", name:"", country:"" });
  const save = async () => {
    if (!form.code) return;
    const e = { ...form, id: uid(), code: form.code.toUpperCase() };
    await dbUpsert("airports", e);
    setAirports([...airports, e]);
    setForm({ code:"", name:"", country:"" });
  };
  const del = async (id) => {
    await dbDelete("airports", id);
    setAirports(airports.filter(a=>a.id!==id));
  };
  return (
    <div>
      <div style={{ fontSize:16, fontWeight:700, marginBottom:18 }}>Airports</div>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:20, marginBottom:16 }}>
        <G3>
          <F label="IATA Code *"><input style={s.inp} value={form.code} onChange={e=>setForm({...form,code:e.target.value.toUpperCase().slice(0,4)})} placeholder="FBM" /></F>
          <F label="Name"><input style={s.inp} value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Lubumbashi Int'l" /></F>
          <F label="Country"><input style={s.inp} value={form.country} onChange={e=>setForm({...form,country:e.target.value})} placeholder="DRC" /></F>
        </G3>
        <button style={s.btn()} onClick={save}>Add Airport</button>
      </div>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:20 }}>
        {airports.length===0 ? <div style={{color:C.faint,fontSize:12}}>No airports yet.</div>
          : <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead><tr>
                {["Code","Name","Country",""].map(h=><th key={h} style={{textAlign:"left",padding:"6px 10px",fontSize:9,letterSpacing:"0.15em",textTransform:"uppercase",color:C.faint,borderBottom:`1px solid ${C.border}`}}>{h}</th>)}
              </tr></thead>
              <tbody>{airports.map(a=>(
                <tr key={a.id}>
                  <td style={{padding:"8px 10px",color:C.amber,fontWeight:700}}>{a.code}</td>
                  <td style={{padding:"8px 10px"}}>{a.name}</td>
                  <td style={{padding:"8px 10px",color:C.dim}}>{a.country}</td>
                  <td style={{padding:"8px 10px"}}><button style={s.btn("danger",true)} onClick={()=>del(a.id)}>✕</button></td>
                </tr>
              ))}</tbody>
            </table>
        }
      </div>
    </div>
  );
}

function SetupFleet({ aircraft, setAircraft, airports, routes, acConfig, setAcConfig }) {
  const [form, setForm] = useState({ reg:"", type:"", defaultCapacity:"", base:"", status:"active" });
  const [editId, setEditId] = useState(null);
  const [show, setShow] = useState(false);
  const [routeTimes, setRouteTimes] = useState({}); // routeId -> minutes

  const openAdd = () => {
    setEditId(null);
    setForm({ reg:"", type:"", defaultCapacity:"", base:"", status:"active" });
    setRouteTimes({});
    setShow(true);
  };

  const openEdit = (ac) => {
    setEditId(ac.id);
    setForm({ ...ac, defaultCapacity:String(ac.defaultCapacity) });
    setRouteTimes((acConfig[ac.id]||{}).routeFlightTimes || {});
    setShow(true);
  };

  const save = async () => {
    if (!form.reg||!form.defaultCapacity) return;
    const e = { ...form, id:editId||uid(), defaultCapacity:Number(form.defaultCapacity) };
    const u = editId ? aircraft.map(a=>a.id===editId?e:a) : [...aircraft,e];
    setAircraft(u);
    await dbUpsert("aircraft", { id:e.id, reg:e.reg, type:e.type||"", default_capacity:e.defaultCapacity, base:e.base||"", status:e.status });
    // Save route flight times into acConfig
    const acId = e.id;
    const newCfg = { ...(acConfig[acId]||{}), routeFlightTimes: routeTimes };
    const updCfg = { ...acConfig, [acId]: newCfg };
    setAcConfig(updCfg);
    await dbSaveAcConfig(acId, newCfg);
    setShow(false); setEditId(null); setForm({ reg:"", type:"", defaultCapacity:"", base:"", status:"active" });
  };

  const del = async (id) => {
    if (!confirm("Remove?")) return;
    await dbDelete("aircraft", id);
    setAircraft(aircraft.filter(a=>a.id!==id));
  };

  const statusCol = { active:C.green, maintenance:C.amber, aog:C.red };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
        <span style={{fontSize:16,fontWeight:700}}>Fleet</span>
        <button style={s.btn()} onClick={openAdd}>+ Add Aircraft</button>
      </div>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:20}}>
        {aircraft.length===0 ? <div style={{color:C.faint,fontSize:12}}>No aircraft.</div>
          : <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead><tr>
                {["Reg","Type","Capacity","Base","Status",""].map(h=><th key={h} style={{textAlign:"left",padding:"6px 10px",fontSize:9,letterSpacing:"0.15em",textTransform:"uppercase",color:C.faint,borderBottom:`1px solid ${C.border}`}}>{h}</th>)}
              </tr></thead>
              <tbody>{aircraft.map(ac=>(
                <tr key={ac.id}>
                  <td style={{padding:"8px 10px",color:C.amber,fontWeight:700,fontSize:14}}>{ac.reg}</td>
                  <td style={{padding:"8px 10px",color:C.dim}}>{ac.type||"—"}</td>
                  <td style={{padding:"8px 10px"}}>{ac.defaultCapacity} pax</td>
                  <td style={{padding:"8px 10px",color:C.cyan}}>{ac.base||"—"}</td>
                  <td style={{padding:"8px 10px"}}><span style={s.tag(statusCol[ac.status]||C.dim)}>{ac.status}</span></td>
                  <td style={{padding:"8px 10px"}}>
                    <div style={{display:"flex",gap:6}}>
                      <button style={s.btn("ghost",true)} onClick={()=>openEdit(ac)}>Edit</button>
                      <button style={s.btn("danger",true)} onClick={()=>del(ac.id)}>✕</button>
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
        }
      </div>
      {show && (
        <Modal title={editId?"Edit Aircraft":"New Aircraft"} onClose={()=>setShow(false)}>
          <G2>
            <F label="Registration *"><input style={s.inp} value={form.reg} onChange={e=>setForm({...form,reg:e.target.value.toUpperCase()})} placeholder="9Q-PKP" /></F>
            <F label="Type"><input style={s.inp} value={form.type} onChange={e=>setForm({...form,type:e.target.value})} placeholder="Cessna 208B" /></F>
          </G2>
          <G2>
            <F label="Capacity *"><input style={s.inp} type="number" value={form.defaultCapacity} onChange={e=>setForm({...form,defaultCapacity:e.target.value})} placeholder="14" /></F>
            <F label="Home Base">
              <select style={s.inp} value={form.base} onChange={e=>setForm({...form,base:e.target.value})}>
                <option value="">Select…</option>
                {airports.map(a=><option key={a.id} value={a.code}>{a.code}</option>)}
              </select>
            </F>
          </G2>
          <F label="Status">
            <select style={s.inp} value={form.status} onChange={e=>setForm({...form,status:e.target.value})}>
              <option value="active">Active</option>
              <option value="maintenance">Maintenance</option>
              <option value="aog">AOG</option>
            </select>
          </F>
          {/* Per-route flight times */}
          {routes.length > 0 && (
            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:6, padding:14, marginBottom:12 }}>
              <div style={{ fontSize:9, letterSpacing:"0.15em", textTransform:"uppercase", color:C.amber, fontWeight:700, marginBottom:10 }}>
                Block Time Per Route (min)
              </div>
              <div style={{ fontSize:10, color:C.faint, marginBottom:10 }}>
                Set how long this aircraft type takes on each route. Used to auto-calculate arrival times on the dispatch board.
              </div>
              {routes.map(r => (
                <div key={r.id} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                  <span style={{ color:C.cyan, fontSize:11, minWidth:120 }}>{r.name}</span>
                  <input
                    type="number" min="0" placeholder="e.g. 60"
                    style={{ ...s.inp, width:90 }}
                    value={routeTimes[r.id] || ""}
                    onChange={e => setRouteTimes(t => ({ ...t, [r.id]: Number(e.target.value)||0 }))}
                  />
                  <span style={{ fontSize:10, color:C.faint }}>min</span>
                  {routeTimes[r.id] > 0 && (
                    <span style={{ fontSize:10, color:C.green }}>
                      → arr +{routeTimes[r.id]}m
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <button style={s.btn("ghost")} onClick={()=>setShow(false)}>Cancel</button>
            <button style={s.btn()} onClick={save}>Save</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SetupRoutes({ routes, setRoutes, airports }) {
  const [show, setShow] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name:"", notes:"" });
  const [legs, setLegs] = useState([]);
  const [nextTo, setNextTo] = useState("");
  const [firstFrom, setFirstFrom] = useState("");
  const [firstTo, setFirstTo] = useState("");
  const [marketed, setMarketed] = useState([]);
  const [mFrom, setMFrom] = useState(""); const [mTo, setMTo] = useState("");

  const openNew = () => { setForm({name:"",notes:""}); setLegs([]); setMarketed([]); setEditId(null); setShow(true); };
  const openEdit = (r) => { setForm({name:r.name,notes:r.notes||""}); setLegs(r.operationalRouting||[]); setMarketed(r.marketedSectors||[]); setEditId(r.id); setShow(true); };

  const routeStr = (ls) => ls.length===0?"" : ls.map((l,i)=>i===0?`${l.from}-${l.to}`:l.to).join("-");

  const addFirstLeg = () => {
    if (!firstFrom||!firstTo||firstFrom===firstTo) return;
    setLegs([{from:firstFrom,to:firstTo}]); setFirstFrom(""); setFirstTo("");
  };
  const addLeg = () => {
    if (!nextTo) return;
    const from = legs[legs.length-1].to;
    setLegs([...legs,{from,to:nextTo}]); setNextTo("");
  };
  const removeLeg = (i) => {
    const u = legs.filter((_,idx)=>idx!==i);
    setLegs(u.map((l,idx)=>idx===0?l:{...l,from:u[idx-1].to}));
  };

  const saveRoute = async () => {
    if (!form.name||legs.length===0) return alert("Name and at least one leg required");
    const e = {...form,id:editId||uid(),operationalRouting:legs,marketedSectors:marketed};
    const u = editId ? routes.map(r=>r.id===editId?e:r) : [...routes,e];
    setRoutes(u);
    await dbUpsert("routes", { id:e.id, name:e.name, operational_routing:e.operationalRouting, marketed_sectors:e.marketedSectors, notes:e.notes||"" });
    setShow(false);
  };

  const del = async (id) => {
    if (!confirm("Delete route?")) return;
    await dbDelete("routes", id);
    setRoutes(routes.filter(r=>r.id!==id));
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
        <span style={{fontSize:16,fontWeight:700}}>Routes</span>
        <button style={s.btn()} onClick={openNew}>+ Build Route</button>
      </div>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:20}}>
        {routes.length===0 ? <div style={{color:C.faint,fontSize:12}}>No routes yet.</div>
          : <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead><tr>
                {["Name","Operational Routing","Marketed","Flight Time",""].map(h=><th key={h} style={{textAlign:"left",padding:"6px 10px",fontSize:9,letterSpacing:"0.15em",textTransform:"uppercase",color:C.faint,borderBottom:`1px solid ${C.border}`}}>{h}</th>)}
              </tr></thead>
              <tbody>{routes.map(r=>(
                <tr key={r.id}>
                  <td style={{padding:"8px 10px",color:C.amber,fontWeight:700}}>{r.name}</td>
                  <td style={{padding:"8px 10px",color:C.cyan,fontSize:11}}>{routeStr(r.operationalRouting||[])}</td>
                  <td style={{padding:"8px 10px"}}>
                    <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                      {(r.marketedSectors||[]).map(m=><span key={m.id} style={s.tag(C.purple)}>{m.from}–{m.to}</span>)}
                      {!(r.marketedSectors||[]).length && <span style={{color:C.faint}}>—</span>}
                    </div>
                  </td>
                  <td style={{padding:"8px 10px",color:C.dim}}>{r.flightTime?`${r.flightTime}m`:"—"}</td>
                  <td style={{padding:"8px 10px"}}>
                    <div style={{display:"flex",gap:6}}>
                      <button style={s.btn("ghost",true)} onClick={()=>openEdit(r)}>Edit</button>
                      <button style={s.btn("danger",true)} onClick={()=>del(r.id)}>✕</button>
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
        }
      </div>

      {show && (
        <Modal title={editId?"Edit Route":"Build Route"} onClose={()=>setShow(false)} wide>
          <F label="Route Name *"><input style={s.inp} value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="FBM-KWZ" /></F>

          {/* Operational routing */}
          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:14,marginBottom:14}}>
            <div style={{fontSize:9,letterSpacing:"0.15em",textTransform:"uppercase",color:C.faint,marginBottom:10}}>Operational Routing</div>
            {legs.length>0 && (
              <div style={{background:C.bg,borderRadius:4,padding:"6px 12px",marginBottom:10,color:C.cyan,fontWeight:700,fontSize:13}}>
                ✈ {routeStr(legs)}
              </div>
            )}
            {legs.map((l,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:5,
                background:C.card,borderRadius:4,padding:"5px 10px",fontSize:11}}>
                <span style={{color:C.amber,fontWeight:700}}>{l.from}→{l.to}</span>
                <span style={{color:C.faint,fontSize:9}}>Leg {i+1}</span>
                <span style={{flex:1}}/>
                <button onClick={()=>removeLeg(i)} style={{background:"none",border:"none",color:C.red,cursor:"pointer"}}>✕</button>
              </div>
            ))}
            {airports.length===0 ? <div style={{color:C.faint,fontSize:11}}>Add airports first.</div>
              : legs.length===0
                ? <div style={{display:"flex",gap:8,alignItems:"flex-end",marginTop:8}}>
                    <F label="From" style={{flex:1,margin:0}}><select style={s.inp} value={firstFrom} onChange={e=>setFirstFrom(e.target.value)}><option value="">Select…</option>{airports.map(a=><option key={a.id} value={a.code}>{a.code}</option>)}</select></F>
                    <F label="To" style={{flex:1,margin:0}}><select style={s.inp} value={firstTo} onChange={e=>setFirstTo(e.target.value)}><option value="">Select…</option>{airports.map(a=><option key={a.id} value={a.code}>{a.code}</option>)}</select></F>
                    <button style={{...s.btn("blue"),marginBottom:1}} onClick={addFirstLeg}>Add</button>
                  </div>
                : <div style={{display:"flex",gap:8,alignItems:"flex-end",marginTop:8}}>
                    <F label={`Next: from ${legs[legs.length-1].to} →`} style={{flex:1,margin:0}}>
                      <select style={s.inp} value={nextTo} onChange={e=>setNextTo(e.target.value)}>
                        <option value="">Select…</option>
                        {airports.map(a=><option key={a.id} value={a.code}>{a.code}</option>)}
                      </select>
                    </F>
                    <button style={{...s.btn("blue"),marginBottom:1}} onClick={addLeg}>+ Leg</button>
                  </div>
            }
          </div>

          {/* Marketed sectors */}
          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:14,marginBottom:14}}>
            <div style={{fontSize:9,letterSpacing:"0.15em",textTransform:"uppercase",color:C.faint,marginBottom:8}}>Marketed Sectors (tickets sold)</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
              {marketed.map(m=>(
                <div key={m.id} style={{display:"flex",alignItems:"center",gap:4,background:C.card,border:`1px solid ${C.purple}44`,borderRadius:4,padding:"3px 8px"}}>
                  <span style={{color:C.purple,fontSize:11,fontWeight:700}}>{m.from}–{m.to}</span>
                  <button onClick={()=>setMarketed(marketed.filter(x=>x.id!==m.id))} style={{background:"none",border:"none",color:C.faint,cursor:"pointer",fontSize:11}}>✕</button>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
              <F label="From" style={{flex:1,margin:0}}><select style={s.inp} value={mFrom} onChange={e=>setMFrom(e.target.value)}><option value="">…</option>{airports.map(a=><option key={a.id} value={a.code}>{a.code}</option>)}</select></F>
              <F label="To" style={{flex:1,margin:0}}><select style={s.inp} value={mTo} onChange={e=>setMTo(e.target.value)}><option value="">…</option>{airports.map(a=><option key={a.id} value={a.code}>{a.code}</option>)}</select></F>
              <button style={{...s.btn("ghost"),marginBottom:1}} onClick={()=>{if(mFrom&&mTo&&mFrom!==mTo){setMarketed([...marketed,{id:uid(),from:mFrom,to:mTo}]);setMFrom("");setMTo("");}}}>+ Add</button>
            </div>
          </div>

          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <button style={s.btn("ghost")} onClick={()=>setShow(false)}>Cancel</button>
            <button style={s.btn()} onClick={saveRoute}>Save Route</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SetupCharters({ charters, setCharters, aircraft, airports }) {
  const [form, setForm] = useState({ client:"", from:"", to:"", date:todayStr(), depTime:"", arrTime:"", pax:"", acId:"", status:"pending", notes:"" });
  const [editId, setEditId] = useState(null);
  const [show, setShow] = useState(false);
  const [filter, setFilter] = useState("upcoming");

  const save = async () => {
    if (!form.client||!form.date) return;
    const e = {...form,id:editId||uid(),pax:Number(form.pax)||0};
    const u = editId ? charters.map(c=>c.id===editId?e:c) : [...charters,e];
    setCharters(u);
    await dbUpsert("charters", { id:e.id, client:e.client, from_airport:e.from||"", to_airport:e.to||"", date:e.date, dep_time:e.depTime||"", arr_time:e.arrTime||"", pax:e.pax, ac_id:e.acId||null, status:e.status, notes:e.notes||"" });
    setShow(false); setEditId(null);
    setForm({client:"",from:"",to:"",date:todayStr(),depTime:"",arrTime:"",pax:"",acId:"",status:"pending",notes:""});
  };

  const del = async (id) => {
    if (!confirm("Delete?")) return;
    await dbDelete("charters", id);
    setCharters(charters.filter(c=>c.id!==id));
  };

  const td = todayStr();
  const list = filter==="upcoming"
    ? charters.filter(c=>c.date>=td&&c.status!=="cancelled")
    : charters.filter(c=>filter==="all"||c.status===filter);
  const sorted = [...list].sort((a,b)=>a.date.localeCompare(b.date));
  const sc = {pending:C.amber,confirmed:C.green,cancelled:C.red,completed:C.faint};

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
        <span style={{fontSize:16,fontWeight:700}}>Charters</span>
        <div style={{display:"flex",gap:8}}>
          {["upcoming","confirmed","pending","all"].map(f=>(
            <button key={f} style={s.btn(filter===f?"primary":"ghost",true)} onClick={()=>setFilter(f)}>
              {f.charAt(0).toUpperCase()+f.slice(1)}
            </button>
          ))}
          <button style={s.btn()} onClick={()=>{setShow(true);setEditId(null);}}>+ Log Charter</button>
        </div>
      </div>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:20}}>
        {sorted.length===0 ? <div style={{color:C.faint,fontSize:12}}>No charters.</div>
          : <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead><tr>
                {["Date","Client","Route","Aircraft","Times","Pax","Status",""].map(h=><th key={h} style={{textAlign:"left",padding:"6px 10px",fontSize:9,letterSpacing:"0.15em",textTransform:"uppercase",color:C.faint,borderBottom:`1px solid ${C.border}`}}>{h}</th>)}
              </tr></thead>
              <tbody>{sorted.map(c=>{
                const ac = aircraft.find(a=>a.id===c.acId);
                return (
                  <tr key={c.id}>
                    <td style={{padding:"8px 10px",color:C.blue}}>{c.date}</td>
                    <td style={{padding:"8px 10px",fontWeight:700}}>{c.client}</td>
                    <td style={{padding:"8px 10px"}}>{c.from&&c.to?`${c.from}→${c.to}`:"—"}</td>
                    <td style={{padding:"8px 10px",color:C.amber}}>{ac?ac.reg:"TBD"}</td>
                    <td style={{padding:"8px 10px",color:C.green,fontSize:11}}>{c.depTime&&c.arrTime?`${c.depTime}–${c.arrTime}`:"—"}</td>
                    <td style={{padding:"8px 10px"}}>{c.pax||"—"}</td>
                    <td style={{padding:"8px 10px"}}><span style={s.tag(sc[c.status]||C.faint)}>{c.status}</span></td>
                    <td style={{padding:"8px 10px"}}>
                      <div style={{display:"flex",gap:6}}>
                        <button style={s.btn("ghost",true)} onClick={()=>{setForm({...c,pax:String(c.pax||"")});setEditId(c.id);setShow(true);}}>Edit</button>
                        <button style={s.btn("danger",true)} onClick={()=>del(c.id)}>✕</button>
                      </div>
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
        }
      </div>

      {show && (
        <Modal title={editId?"Edit Charter":"New Charter"} onClose={()=>setShow(false)}>
          <F label="Client *"><input style={s.inp} value={form.client} onChange={e=>setForm({...form,client:e.target.value})} placeholder="Company / person" /></F>
          <G2>
            <F label="From"><select style={s.inp} value={form.from} onChange={e=>setForm({...form,from:e.target.value})}><option value="">Select…</option>{airports.map(a=><option key={a.id} value={a.code}>{a.code} – {a.name}</option>)}</select></F>
            <F label="To"><select style={s.inp} value={form.to} onChange={e=>setForm({...form,to:e.target.value})}><option value="">Select…</option>{airports.map(a=><option key={a.id} value={a.code}>{a.code} – {a.name}</option>)}</select></F>
          </G2>
          <G2>
            <F label="Date *"><input style={s.inp} type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})} /></F>
            <F label="Pax"><input style={s.inp} type="number" value={form.pax} onChange={e=>setForm({...form,pax:e.target.value})} /></F>
          </G2>
          <G2>
            <F label="Dep Time"><input style={s.inp} type="time" value={form.depTime} onChange={e=>setForm({...form,depTime:e.target.value})} /></F>
            <F label="Arr Time"><input style={s.inp} type="time" value={form.arrTime} onChange={e=>setForm({...form,arrTime:e.target.value})} /></F>
          </G2>
          <F label="Aircraft">
            <select style={s.inp} value={form.acId} onChange={e=>setForm({...form,acId:e.target.value})}>
              <option value="">TBD</option>
              {aircraft.map(a=><option key={a.id} value={a.id}>{a.reg} – {a.type}</option>)}
            </select>
          </F>
          <F label="Status">
            <select style={s.inp} value={form.status} onChange={e=>setForm({...form,status:e.target.value})}>
              {["pending","confirmed","cancelled","completed"].map(x=><option key={x} value={x}>{x.charAt(0).toUpperCase()+x.slice(1)}</option>)}
            </select>
          </F>
          <F label="Notes"><textarea style={{...s.inp,height:52,resize:"vertical"}} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} /></F>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <button style={s.btn("ghost")} onClick={()=>setShow(false)}>Cancel</button>
            <button style={s.btn()} onClick={save}>Save Charter</button>
          </div>
        </Modal>
      )}
    </div>
  );
}


/* ════════════════════════════════════════
   WEEKLY SCHEDULE TEMPLATE
════════════════════════════════════════ */
function WeeklySchedule({ weekly, setWeekly, routes, aircraft }) {
  const [activeDay, setActiveDay] = useState("mon");
  const [showForm, setShowForm] = useState(false);
  const [editIdx, setEditIdx] = useState(null);
  const emptyForm = { routeId:"", acType:"", depTime:"", expectedPax:"", notes:"" };
  const [form, setForm] = useState(emptyForm);

  const daySlots = weekly[activeDay] || [];

  // Collect unique aircraft types from fleet
  const acTypes = [...new Set(aircraft.map(a => a.type).filter(Boolean))].sort();

  const saveSlot = async () => {
    if (!form.routeId || !form.depTime) return alert("Route and departure time required");
    const slot = { ...form, id: uid(), expectedPax: Number(form.expectedPax)||0 };
    const updated = [...daySlots];
    if (editIdx !== null) updated[editIdx] = slot;
    else updated.push(slot);
    updated.sort((a,b) => a.depTime.localeCompare(b.depTime));
    const newWeekly = { ...weekly, [activeDay]: updated };
    setWeekly(newWeekly);
    await dbSaveWeeklyDay(activeDay, updated);
    setShowForm(false); setEditIdx(null); setForm(emptyForm);
  };

  const deleteSlot = async (idx) => {
    const updated = daySlots.filter((_,i) => i !== idx);
    const newWeekly = { ...weekly, [activeDay]: updated };
    setWeekly(newWeekly);
    await dbSaveWeeklyDay(activeDay, updated);
  };

  const openEdit = (slot, idx) => {
    setForm({ ...slot, expectedPax: String(slot.expectedPax||"") });
    setEditIdx(idx); setShowForm(true);
  };

  const copyDayTo = async (targetDay) => {
    if (!confirm(`Copy ${DAY_LABELS[activeDay]} template to ${DAY_LABELS[targetDay]}?`)) return;
    const newWeekly = { ...weekly, [targetDay]: JSON.parse(JSON.stringify(daySlots)) };
    setWeekly(newWeekly);
    await dbSaveWeeklyDay(targetDay, JSON.parse(JSON.stringify(daySlots)));
  };

  const totalSlots = DAYS.reduce((s,d) => s + (weekly[d]||[]).length, 0);

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
        <div>
          <span style={{ fontSize:18, fontWeight:700 }}>Weekly Schedule</span>
          <span style={{ fontSize:11, color:C.dim, marginLeft:12 }}>{totalSlots} total slots defined</span>
        </div>
      </div>

      {/* Day selector */}
      <div style={{ display:"flex", gap:4, marginBottom:20 }}>
        {DAYS.map(d => {
          const count = (weekly[d]||[]).length;
          return (
            <button key={d} onClick={() => setActiveDay(d)} style={{
              flex:1, padding:"10px 4px", border:"none", borderRadius:6, cursor:"pointer",
              fontFamily:FONT, fontWeight:700, fontSize:10, letterSpacing:"0.08em",
              textTransform:"uppercase", transition:"all 0.15s",
              background: activeDay===d ? C.amber : count>0 ? C.surface : C.bg,
              color: activeDay===d ? "#000" : count>0 ? C.text : C.faint,
              borderBottom: activeDay===d ? "none" : `1px solid ${C.border}`,
            }}>
              {d.toUpperCase()}
              {count > 0 && <div style={{ fontSize:9, marginTop:2, color: activeDay===d?"#000":C.dim }}>{count} flight{count!==1?"s":""}</div>}
            </button>
          );
        })}
      </div>

      {/* Day panel */}
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:20 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <span style={{ fontSize:11, letterSpacing:"0.15em", textTransform:"uppercase",
            color:C.amber, fontWeight:700 }}>{DAY_LABELS[activeDay]}</span>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            {/* Copy to another day */}
            <select style={{ ...s.inp, width:"auto", fontSize:10, padding:"4px 8px" }}
              defaultValue="" onChange={e => { if(e.target.value) { copyDayTo(e.target.value); e.target.value=""; } }}>
              <option value="" disabled>Copy to…</option>
              {DAYS.filter(d=>d!==activeDay).map(d => <option key={d} value={d}>{DAY_LABELS[d]}</option>)}
            </select>
            <button style={s.btn()} onClick={() => { setShowForm(true); setEditIdx(null); setForm(emptyForm); }}>
              + Add Slot
            </button>
          </div>
        </div>

        {daySlots.length === 0 ? (
          <div style={{ color:C.faint, fontSize:12, padding:"16px 0" }}>
            No scheduled flights for {DAY_LABELS[activeDay]}. Add your first slot above.
          </div>
        ) : (
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr>
                {["Dep","Route","Aircraft Type","Exp. Pax","Notes",""].map(h => (
                  <th key={h} style={{ textAlign:"left", padding:"6px 10px", fontSize:9,
                    letterSpacing:"0.15em", textTransform:"uppercase", color:C.faint,
                    borderBottom:`1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {daySlots.map((slot, i) => {
                const route = routes.find(r => r.id === slot.routeId);
                return (
                  <tr key={slot.id||i}>
                    <td style={{ padding:"10px 10px", color:C.green, fontWeight:700, fontSize:13 }}>{slot.depTime}</td>
                    <td style={{ padding:"10px 10px" }}>
                      <span style={{ color:C.amber, fontWeight:700 }}>{route?.name || "—"}</span>
                      {route && (
                        <div style={{ fontSize:9, color:C.faint, marginTop:2 }}>
                          {(route.operationalRouting||[]).map((l,i)=>i===0?`${l.from}-${l.to}`:l.to).join("-")}
                        </div>
                      )}
                    </td>
                    <td style={{ padding:"10px 10px" }}>
                      {slot.acType
                        ? <span style={{ background:C.blueDim, color:C.blue, padding:"2px 8px",
                            borderRadius:3, fontSize:10, fontWeight:700 }}>{slot.acType}</span>
                        : <span style={{ color:C.faint, fontSize:11 }}>Any</span>
                      }
                    </td>
                    <td style={{ padding:"10px 10px", color:C.cyan }}>{slot.expectedPax||"—"}</td>
                    <td style={{ padding:"10px 10px", color:C.faint, fontSize:11 }}>{slot.notes||"—"}</td>
                    <td style={{ padding:"10px 10px" }}>
                      <div style={{ display:"flex", gap:6 }}>
                        <button style={s.btn("ghost",true)} onClick={() => openEdit(slot, i)}>Edit</button>
                        <button style={s.btn("danger",true)} onClick={() => deleteSlot(i)}>✕</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Weekly overview grid */}
      {totalSlots > 0 && (
        <div style={{ marginTop:20, background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:20 }}>
          <div style={{ fontSize:9, letterSpacing:"0.2em", textTransform:"uppercase",
            color:C.amber, fontWeight:700, marginBottom:14 }}>Week Overview</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:8 }}>
            {DAYS.map(d => (
              <div key={d} style={{ background:C.surface, borderRadius:6, padding:"10px 8px",
                border:`1px solid ${d===activeDay?C.amber:C.border}` }}>
                <div style={{ fontSize:9, fontWeight:700, letterSpacing:"0.12em",
                  color:d===activeDay?C.amber:C.faint, textTransform:"uppercase", marginBottom:8 }}>
                  {d.toUpperCase()}
                </div>
                {(weekly[d]||[]).length === 0
                  ? <div style={{ fontSize:9, color:C.faint }}>—</div>
                  : (weekly[d]||[]).map((slot,i) => {
                      const route = routes.find(r=>r.id===slot.routeId);
                      return (
                        <div key={i} style={{ marginBottom:5, background:C.card,
                          borderRadius:3, padding:"3px 6px", fontSize:9 }}>
                          <span style={{ color:C.green }}>{slot.depTime} </span>
                          <span style={{ color:C.amber }}>{route?.name||"?"}</span>
                          {slot.acType && <div style={{ color:C.blue, fontSize:8 }}>{slot.acType}</div>}
                        </div>
                      );
                    })
                }
              </div>
            ))}
          </div>
        </div>
      )}

      {showForm && (
        <Modal title={editIdx!==null ? "Edit Slot" : `Add Slot — ${DAY_LABELS[activeDay]}`} onClose={() => { setShowForm(false); setEditIdx(null); }}>
          <G2>
            <F label="Route *">
              <select style={s.inp} value={form.routeId} onChange={e => setForm({...form, routeId:e.target.value})}>
                <option value="">Select route…</option>
                {routes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </F>
            <F label="Departure Time *">
              <input style={s.inp} type="time" value={form.depTime} onChange={e => setForm({...form, depTime:e.target.value})} />
            </F>
          </G2>
          <G2>
            <F label="Aircraft Type">
              <select style={s.inp} value={form.acType} onChange={e => setForm({...form, acType:e.target.value})}>
                <option value="">Any / TBD</option>
                {acTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </F>
            <F label="Expected Pax">
              <input style={s.inp} type="number" min="0" value={form.expectedPax}
                onChange={e => setForm({...form, expectedPax:e.target.value})} placeholder="e.g. 44" />
            </F>
          </G2>
          <F label="Notes">
            <input style={s.inp} value={form.notes} onChange={e => setForm({...form, notes:e.target.value})}
              placeholder="e.g. Morning shuttle, high load expected" />
          </F>
          <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
            <button style={s.btn("ghost")} onClick={() => { setShowForm(false); setEditIdx(null); }}>Cancel</button>
            <button style={s.btn()} onClick={saveSlot}>Save Slot</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ════════════════════════════════════════
   ROOT
════════════════════════════════════════ */
export default function App() {
  const [tab, setTab] = useState("board");
  const [airports, setAirports]   = useState([]);
  const [aircraft, setAircraft]   = useState([]);
  const [acConfig, setAcConfig]   = useState({});
  const [routes, setRoutes]       = useState([]);
  const [boards, setBoards]       = useState({});
  const [charters, setCharters]   = useState([]);
  const [weekly, setWeekly]       = useState({});
  const [ready, setReady]         = useState(false);

  useEffect(() => {
    async function loadAll() {
      try {
        const [ap, ac, cfg, ro, bo, ch, wk] = await Promise.all([
          dbGetAll("airports"),
          dbGetAll("aircraft"),
          dbGetAcConfig(),
          dbGetAll("routes"),
          dbGetBoards(),
          dbGetAll("charters"),
          dbGetWeekly(),
        ]);
        // Normalize aircraft from DB column names
        setAirports(ap);
        setAircraft(ac.map(a => ({
          id: a.id, reg: a.reg, type: a.type||"",
          defaultCapacity: a.default_capacity||0,
          base: a.base||"", status: a.status||"active"
        })));
        setAcConfig(cfg);
        setRoutes(ro.map(r => ({
          id: r.id, name: r.name,
          operationalRouting: r.operational_routing||[],
          marketedSectors: r.marketed_sectors||[],
          notes: r.notes||""
        })));
        setBoards(bo);
        setCharters(ch.map(c => ({
          id: c.id, client: c.client, from: c.from_airport||"",
          to: c.to_airport||"", date: c.date, depTime: c.dep_time||"",
          arrTime: c.arr_time||"", pax: c.pax||0,
          acId: c.ac_id||"", status: c.status||"pending", notes: c.notes||""
        })));
        setWeekly(wk);
      } catch(e) {
        console.error("Load error:", e);
      } finally {
        setReady(true);
      }
    }
    loadAll();
  }, []);

  const TABS = [
    { id:"board",    icon:"⬛", label:"Dispatch"  },
    { id:"weekly",   icon:"📋", label:"Weekly"    },
    { id:"charters", icon:"✈", label:"Charters"  },
    { id:"fleet",    icon:"🛩", label:"Fleet"     },
    { id:"routes",   icon:"🗺", label:"Routes"    },
    { id:"airports", icon:"📍", label:"Airports"  },
  ];

  if (!ready) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex",
      alignItems:"center", justifyContent:"center", fontFamily:FONT }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:36, marginBottom:12 }}>✈</div>
        <div style={{ color:C.amber, fontSize:10, letterSpacing:"0.3em" }}>LOADING AIROPS…</div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:C.bg, fontFamily:FONT, color:C.text, display:"flex", flexDirection:"column" }}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />

      <header style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, boxShadow:'0 1px 4px #0f172a18',
        height:56, display:"flex", alignItems:"center", padding:"0 24px",
        justifyContent:"space-between", position:"sticky", top:0, zIndex:200 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:20 }}>✈</span>
          <span style={{ fontWeight:700, fontSize:11, letterSpacing:"0.2em",
            textTransform:"uppercase", color:C.amber }}>AirOps</span>
          <span style={{ fontSize:9, color:C.faint, letterSpacing:"0.08em" }}>Dispatch System</span>
        </div>
        <nav style={{ display:"flex", gap:2 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding:"5px 14px", border:"none", borderRadius:4, cursor:"pointer",
              fontFamily:FONT, fontSize:9, letterSpacing:"0.12em", textTransform:"uppercase",
              fontWeight:700, transition:"all 0.12s",
              background: tab===t.id ? C.amber : "transparent",
              color: tab===t.id ? "#000" : C.faint,
            }}>{t.icon} {t.label}</button>
          ))}
        </nav>
        <div style={{ fontSize:9, color:C.faint, display:"flex", gap:12 }}>
          <span>{aircraft.filter(a=>a.status==="active").length} active AC</span>
          <span>{routes.length} routes</span>
          <span style={{ color:C.green }}>● LIVE DB</span>
        </div>
      </header>

      <main style={{ flex:1, padding:"24px 28px", maxWidth:1440, width:"100%",
        margin:"0 auto", boxSizing:"border-box" }}>
        {tab==="board"    && <DispatchBoard aircraft={aircraft} routes={routes} charters={charters} acConfig={acConfig} boards={boards} setBoards={setBoards} weekly={weekly} />}
        {tab==="weekly"   && <WeeklySchedule weekly={weekly} setWeekly={setWeekly} routes={routes} aircraft={aircraft} />}
        {tab==="charters" && <SetupCharters charters={charters} setCharters={setCharters} aircraft={aircraft} airports={airports} />}
        {tab==="fleet"    && <SetupFleet aircraft={aircraft} setAircraft={setAircraft} airports={airports} routes={routes} acConfig={acConfig} setAcConfig={setAcConfig} />}
        {tab==="routes"   && <SetupRoutes routes={routes} setRoutes={setRoutes} airports={airports} />}
        {tab==="airports" && <SetupAirports airports={airports} setAirports={setAirports} />}
      </main>
    </div>
  );
}