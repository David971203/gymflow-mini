"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Overview = { gyms: number; activeGyms: number; members: number; newMembers: number; monthlyRevenue: number; pendingDebt: number };
type Gym = { id: string; name: string; slug: string; province?: string; isActive: boolean; _count: { members: number }; users: { name: string; email: string }[] };
const API = `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3100"}/api`;
const demoOverview: Overview = { gyms: 3, activeGyms: 3, members: 341, newMembers: 38, monthlyRevenue: 98050, pendingDebt: 12300 };
const demoGyms: Gym[] = [
  { id: "1", name: "Habana Fitness", slug: "habana-fitness", province: "La Habana", isActive: true, _count: { members: 184 }, users: [{ name: "Laura", email: "admin@habanafitness.cu" }] },
  { id: "2", name: "Titan Gym", slug: "titan-gym", province: "Villa Clara", isActive: true, _count: { members: 96 }, users: [{ name: "Carlos", email: "admin@titangym.cu" }] },
  { id: "3", name: "Zona Fuerte", slug: "zona-fuerte", province: "Santiago de Cuba", isActive: true, _count: { members: 61 }, users: [{ name: "Marta", email: "admin@zonafuerte.cu" }] },
];

async function api<T>(path: string, token: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, { ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...options?.headers } });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message ?? "No se pudo completar la operación");
  return data as T;
}

export default function Home() {
  const [token, setToken] = useState("");
  const [demo, setDemo] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => { const timer = window.setTimeout(() => setToken(localStorage.getItem("gymflow_mini_super_token") ?? ""), 0); return () => window.clearTimeout(timer); }, []);
  const load = useCallback(async () => {
    if (demo) { setOverview(demoOverview); setGyms(demoGyms); return; }
    if (!token) return;
    try { const [nextOverview, nextGyms] = await Promise.all([api<Overview>("/platform/overview", token), api<Gym[]>("/platform/gyms", token)]); setOverview(nextOverview); setGyms(nextGyms); }
    catch (error) { setNotice((error as Error).message); }
  }, [token, demo]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  if (!token && !demo) return <Login onLogin={(value) => { localStorage.setItem("gymflow_mini_super_token", value); setToken(value); }} onDemo={() => setDemo(true)} />;
  const logout = () => { localStorage.removeItem("gymflow_mini_super_token"); setToken(""); setDemo(false); setOverview(null); };
  const currency = (value = 0) => `$${value.toLocaleString("es-CU")} CUP`;

  return <main className="app-shell">
    <aside className="sidebar"><div className="brand"><span>G</span><div>GymFlow <small>MINI</small></div></div><nav aria-label="Navegación principal"><a className="active" href="#resumen">Resumen</a><a href="#gimnasios">Gimnasios</a><a href="#finanzas">Finanzas</a></nav><button className="profile" onClick={logout}><span>DA</span><div><strong>David</strong><small>{demo ? "Salir de la demo" : "Cerrar sesión"}</small></div></button></aside>
    <section className="workspace" id="resumen">
      {demo && <div className="demo-banner">Vista demostrativa con datos simulados. Conecta la API para administrar gimnasios reales.</div>}
      {notice && <button className="notice" onClick={() => setNotice("")}>{notice} ×</button>}
      <header><div><p className="eyebrow">PANEL DE PLATAFORMA</p><h1>Buenos días, David</h1><p>Así marcha la prueba de GymFlow Mini en Cuba.</p></div><button onClick={() => demo ? setNotice("La creación está desactivada en la demostración") : setCreating(true)}>+ Añadir gimnasio</button></header>
      <div className="metrics"><article><span>Gimnasios activos</span><strong>{overview?.activeGyms ?? "—"}</strong><small>{overview?.gyms ?? 0} registrados</small></article><article><span>Miembros registrados</span><strong>{overview?.members ?? "—"}</strong><small className="positive">+{overview?.newMembers ?? 0} este mes</small></article><article><span>Ingresos registrados</span><strong>{currency(overview?.monthlyRevenue)} <i>CUP</i></strong><small>Mes actual</small></article><article><span>Cobros pendientes</span><strong>{currency(overview?.pendingDebt)} <i>CUP</i></strong><small className="warning">Saldo acumulado</small></article></div>
      <div className="content-grid"><article className="panel trend" id="finanzas"><div className="panel-title"><div><h2>Actividad de la plataforma</h2><p>Miembros activos en los últimos 6 meses</p></div><span>6 meses</span></div><div className="chart" aria-label="Gráfico ilustrativo de miembros activos">{[42,55,50,68,76,92].map((height,index)=><div key={height} className="bar-wrap"><div className="bar" style={{height:`${height}%`}}/><small>{["Mar","Abr","May","Jun","Jul","Ago"][index]}</small></div>)}</div></article><article className="panel pulse"><div className="panel-title"><div><h2>Señales del piloto</h2><p>Indicadores que conviene medir</p></div></div><div className="signal"><span>Crecimiento este mes</span><strong>+{overview?.newMembers ?? 0}</strong></div><div className="signal"><span>Gimnasios operando</span><strong>{overview?.activeGyms ?? 0}/{overview?.gyms ?? 0}</strong></div><div className="signal"><span>Ingreso por miembro</span><strong>{currency((overview?.monthlyRevenue ?? 0) / Math.max(overview?.members ?? 1,1))}</strong></div></article></div>
      <article className="panel gym-table" id="gimnasios"><div className="panel-title"><div><h2>Gimnasios</h2><p>Negocios participantes en la prueba</p></div><button className="link-button" onClick={() => void load()}>Actualizar</button></div><div className="table-head"><span>Gimnasio</span><span>Miembros</span><span>Administrador</span><span>Estado</span></div>{gyms.map(gym=><div className="table-row" key={gym.id}><div className="gym-name"><span>{gym.name.slice(0,2).toUpperCase()}</span><div><strong>{gym.name}</strong><small>{gym.province ?? gym.slug}</small></div></div><strong>{gym._count.members}</strong><div className="admin-cell"><strong>{gym.users[0]?.name ?? "Sin asignar"}</strong><small>{gym.users[0]?.email}</small></div><button className={gym.isActive ? "badge" : "badge trial"} onClick={async()=>{ if(demo)return; await api(`/platform/gyms/${gym.id}/status`,token,{method:"PATCH",body:JSON.stringify({isActive:!gym.isActive})}); await load(); }}>{gym.isActive ? "Activo" : "Inactivo"}</button></div>)}</article>
    </section>
    {creating && <CreateGym token={token} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); void load(); }} />}
  </main>;
}

function Login({ onLogin, onDemo }: { onLogin: (token: string) => void; onDemo: () => void }) {
  const [email,setEmail]=useState("super@gymflowmini.cu"); const [password,setPassword]=useState("SuperMini123!"); const [error,setError]=useState(""); const [loading,setLoading]=useState(false);
  const submit=async(event:FormEvent)=>{ event.preventDefault();setLoading(true);setError("");try{const response=await fetch(`${API}/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password})});const data=await response.json();if(!response.ok)throw new Error(data.message);if(data.user.role!=="SUPER_ADMIN")throw new Error("Este panel es exclusivo para el superadministrador");onLogin(data.accessToken);}catch(reason){setError((reason as Error).message || "No se pudo conectar con la API");}finally{setLoading(false);}};
  return <main className="login-shell"><section className="login-story"><div className="brand"><span>G</span><div>GymFlow <small>MINI</small></div></div><div><p className="eyebrow light">PLATAFORMA DE VALIDACIÓN</p><h1>Menos complejidad.<br/>Más control.</h1><p>Una forma clara de medir si los gimnasios cubanos están listos para digitalizar su operación.</p></div><small>MIEMBROS · PLANES · FINANZAS</small></section><section className="login-form"><form onSubmit={submit}><p className="eyebrow">ACCESO RESTRINGIDO</p><h2>Panel del superadministrador</h2><p>Consulta el rendimiento de los gimnasios del piloto.</p><label>Correo<input value={email} onChange={event=>setEmail(event.target.value)} type="email" required/></label><label>Contraseña<input value={password} onChange={event=>setPassword(event.target.value)} type="password" required/></label>{error&&<div className="form-error">{error}</div>}<button className="submit" disabled={loading}>{loading?"Entrando…":"Entrar al panel"}</button><button className="demo-button" type="button" onClick={onDemo}>Explorar demostración</button></form></section></main>;
}

function CreateGym({token,onClose,onCreated}:{token:string;onClose:()=>void;onCreated:()=>void}){
  const [error,setError]=useState(""); const submit=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const form=new FormData(event.currentTarget);try{await api("/platform/gyms",token,{method:"POST",body:JSON.stringify(Object.fromEntries(form))});onCreated();}catch(reason){setError((reason as Error).message);}};
  return <div className="modal" role="dialog" aria-modal="true"><form className="modal-card" onSubmit={submit}><div className="modal-head"><div><p className="eyebrow">NUEVO PILOTO</p><h2>Añadir gimnasio</h2></div><button type="button" onClick={onClose}>×</button></div><label>Nombre<input name="name" required/></label><label>Identificador<input name="slug" placeholder="ej. titan-gym" required/></label><label>Provincia<input name="province"/></label><label>Teléfono<input name="phone"/></label><div className="two"><label>Administrador<input name="adminName" required/></label><label>Correo<input name="adminEmail" type="email" required/></label></div><label>Contraseña temporal<input name="adminPassword" type="password" minLength={8} required/></label>{error&&<div className="form-error">{error}</div>}<button className="submit">Crear gimnasio y administrador</button></form></div>;
}
