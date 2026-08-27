"use client";
/* eslint-disable @next/next/no-html-link-for-pages */

import { FormEvent, MouseEvent, useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type Overview = { gyms: number; activeGyms: number; members: number; newMembers: number; monthlyRevenue: number; pendingDebt: number };
type Admin = { id: string; name: string; email: string; isActive: boolean; createdAt?: string };
type Plan = { id: string; name: string; description?: string; price: number | string; durationDays: number; isActive: boolean; createdAt?: string; updatedAt?: string };
type DeleteOutcome = { id: string; disposition: "DELETED" | "ARCHIVED" };
type Notice = { message: string; tone: "success" | "error" | "warning" };
type Membership = { id: string; status: string; startDate: string; endDate: string; planId?: string; plan: Plan; payment?: { id: string; status: string; amount: number | string; paidAmount: number | string } | null };
type MemberSex = "MALE" | "FEMALE" | "OTHER";
type Member = { id: string; ci: string; code?: string | null; firstName: string; lastName: string; age?: number | null; sex?: MemberSex | null; phone?: string; address?: string; status: "ACTIVE" | "INACTIVE"; joinedAt: string; memberships: Membership[] };
type PaymentMovement = { id: string; amount: number | string; method: string; reference?: string; occurredAt: string; actor?: { id: string; name: string } };
type Payment = { id: string; amount: number | string; paidAmount: number | string; dueDate?: string; status: string; createdAt: string; member: Pick<Member, "id" | "firstName" | "lastName" | "ci">; membership: { id: string; plan: Plan }; movements: PaymentMovement[] };
type GymFinances = { totalBilled: number; totalCollected: number; pendingBalance: number; overdueBalance: number; monthlyRevenue: number; pendingPayments: number; recentMovements: Array<PaymentMovement & { payment: Payment }> };
type Gym = {
  id: string;
  name: string;
  slug: string;
  province?: string;
  phone?: string;
  currency?: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
  _count: { members: number; plans?: number; payments?: number };
  users: Admin[];
};

const API = `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3100"}/api`;
const demoOverview: Overview = { gyms: 3, activeGyms: 3, members: 341, newMembers: 38, monthlyRevenue: 98050, pendingDebt: 12300 };
const demoGyms: Gym[] = [
  { id: "1", name: "Habana Fitness", slug: "habana-fitness", province: "La Habana", phone: "+53 5 123 4567", currency: "CUP", isActive: true, _count: { members: 184, plans: 3, payments: 172 }, users: [{ id: "a1", name: "Laura", email: "admin@habanafitness.cu", isActive: true }] },
  { id: "2", name: "Titan Gym", slug: "titan-gym", province: "Villa Clara", currency: "CUP", isActive: true, _count: { members: 96, plans: 2, payments: 88 }, users: [{ id: "a2", name: "Carlos", email: "admin@titangym.cu", isActive: true }] },
  { id: "3", name: "Zona Fuerte", slug: "zona-fuerte", province: "Santiago de Cuba", currency: "CUP", isActive: true, _count: { members: 61, plans: 3, payments: 55 }, users: [{ id: "a3", name: "Marta", email: "admin@zonafuerte.cu", isActive: true }] },
];
const demoPlans: Plan[] = [
  { id: "p1", name: "Mensual", description: "Acceso completo durante 30 días", price: 1500, durationDays: 30, isActive: true },
  { id: "p2", name: "Trimestral", description: "Acceso completo durante 90 días", price: 4000, durationDays: 90, isActive: true },
];
const demoPayments: Payment[] = [
  { id: "pay-1", amount: 1500, paidAmount: 500, dueDate: new Date().toISOString(), status: "PARTIAL", createdAt: new Date().toISOString(), member: { id: "m-1", firstName: "Ana", lastName: "Pérez", ci: "90010112345" }, membership: { id: "ms-1", plan: demoPlans[0] }, movements: [] },
  { id: "pay-2", amount: 4000, paidAmount: 4000, dueDate: new Date().toISOString(), status: "PAID", createdAt: new Date().toISOString(), member: { id: "m-2", firstName: "Luis", lastName: "Gómez", ci: "91020212345" }, membership: { id: "ms-2", plan: demoPlans[1] }, movements: [] },
];
const demoFinances: GymFinances = { totalBilled: 5500, totalCollected: 4500, pendingBalance: 1000, overdueBalance: 0, monthlyRevenue: 4500, pendingPayments: 1, recentMovements: [] };

async function api<T>(path: string, token: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...options?.headers },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = Array.isArray(data?.message) ? data.message.join(". ") : data?.message;
    throw new Error(message ?? "No se pudo completar la operación");
  }
  return data as T;
}

export default function Home() {
  const pathname = usePathname();
  const [clientPath, setClientPath] = useState("");
  const [sessionReady, setSessionReady] = useState(false);
  const isGymsPage = (clientPath || pathname) === "/gimnasios";
  const [token, setToken] = useState("");
  const [demo, setDemo] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<Gym | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedToken = localStorage.getItem("gymflow_mini_super_token") ?? "";
      setToken(savedToken);
      setDemo(!savedToken && sessionStorage.getItem("gymflow_mini_super_demo") === "true");
      setSessionReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const syncPath = () => setClientPath(window.location.pathname);
    window.addEventListener("popstate", syncPath);
    return () => window.removeEventListener("popstate", syncPath);
  }, []);

  const load = useCallback(async () => {
    if (demo) { setOverview(demoOverview); setGyms(demoGyms); return; }
    if (!token) return;
    try {
      const [nextOverview, nextGyms] = await Promise.all([
        api<Overview>("/platform/overview", token),
        api<Gym[]>("/platform/gyms", token),
      ]);
      setOverview(nextOverview);
      setGyms(nextGyms);
    } catch (error) {
      setNotice({ message: (error as Error).message, tone: "error" });
    }
  }, [token, demo]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (!sessionReady) {
    return <SessionLoader />;
  }

  if (!token && !demo) {
    return <Login onLogin={(value) => { sessionStorage.removeItem("gymflow_mini_super_demo"); localStorage.setItem("gymflow_mini_super_token", value); setToken(value); }} onDemo={() => { sessionStorage.setItem("gymflow_mini_super_demo", "true"); setDemo(true); }} />;
  }

  const logout = () => {
    localStorage.removeItem("gymflow_mini_super_token");
    sessionStorage.removeItem("gymflow_mini_super_demo");
    setToken(""); setDemo(false); setOverview(null); setGyms([]);
  };
  const navigate = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.history.pushState({}, "", href);
    setClientPath(href.split("#")[0] || "/");
    if (href.includes("#")) window.setTimeout(() => document.querySelector(href.slice(href.indexOf("#")))?.scrollIntoView(), 0);
  };
  const currency = (value = 0) => `$${value.toLocaleString("es-CU")}`;

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span>G</span><div>GymFlow <small>MINI</small></div></div>
      <nav aria-label="Navegación principal"><a className={!isGymsPage ? "active" : undefined} href="/" onClick={event => navigate(event, "/")}>Resumen</a><a className={isGymsPage ? "active" : undefined} href="/gimnasios" onClick={event => navigate(event, "/gimnasios")}>Gimnasios</a><a href="/#finanzas" onClick={event => navigate(event, "/#finanzas")}>Finanzas</a></nav>
      <button className="profile" onClick={logout}><span>DA</span><div><strong>David</strong><small>{demo ? "Salir de la demo" : "Cerrar sesión"}</small></div></button>
    </aside>

    <section className="workspace" id={isGymsPage ? "gimnasios" : "resumen"}>
      {demo && <div className="demo-banner">Vista demostrativa. Puedes explorar la gestión; las escrituras están desactivadas.</div>}
      {notice && <NoticeBanner notice={notice} onClose={() => setNotice(null)}/>}
      <header><div><p className="eyebrow">PANEL DE PLATAFORMA</p><h1>{isGymsPage ? "Gimnasios" : "Resumen"}</h1><p>{isGymsPage ? "Administra los negocios, responsables y miembros de la plataforma." : "Consulta el estado general y la actividad de la plataforma."}</p></div>{isGymsPage && <button onClick={() => demo ? setNotice({ message: "La creación está desactivada en la demostración", tone: "warning" }) : setCreating(true)}>+ Añadir gimnasio</button>}</header>

      {!isGymsPage && <><div className="metrics">
        <article><span>Gimnasios activos</span><strong>{overview?.activeGyms ?? "—"}</strong><small>{overview?.gyms ?? 0} registrados</small></article>
        <article><span>Miembros registrados</span><strong>{overview?.members ?? "—"}</strong><small className="positive">+{overview?.newMembers ?? 0} este mes</small></article>
        <article><span>Ingresos registrados</span><strong>{currency(overview?.monthlyRevenue)} <i>CUP</i></strong><small>Mes actual</small></article>
        <article><span>Cobros pendientes</span><strong>{currency(overview?.pendingDebt)} <i>CUP</i></strong><small className="warning">Saldo acumulado</small></article>
      </div>

      <div className="content-grid" id="finanzas">
        <article className="panel trend"><div className="panel-title"><div><h2>Actividad de la plataforma</h2><p>Miembros activos en los últimos 6 meses</p></div><span>6 meses</span></div><div className="chart" aria-label="Gráfico ilustrativo de miembros activos">{[42,55,50,68,76,92].map((height,index)=><div key={height} className="bar-wrap"><div className="bar" style={{height:`${height}%`}}/><small>{["Mar","Abr","May","Jun","Jul","Ago"][index]}</small></div>)}</div></article>
        <article className="panel pulse"><div className="panel-title"><div><h2>Señales del piloto</h2><p>Indicadores que conviene medir</p></div></div><div className="signal"><span>Crecimiento este mes</span><strong>+{overview?.newMembers ?? 0}</strong></div><div className="signal"><span>Gimnasios operando</span><strong>{overview?.activeGyms ?? 0}/{overview?.gyms ?? 0}</strong></div><div className="signal"><span>Ingreso por miembro</span><strong>{currency((overview?.monthlyRevenue ?? 0) / Math.max(overview?.members ?? 1,1))}</strong></div></article>
      </div></>}

      {isGymsPage && <article className="panel gym-table">
        <div className="panel-title"><div><h2>Gimnasios</h2><p>Selecciona un negocio para editar sus datos, administradores y miembros.</p></div><button className="link-button" onClick={() => void load()}>Actualizar</button></div>
        <div className="table-head"><span>Gimnasio</span><span>Miembros</span><span>Administradores</span><span>Estado</span><span>Gestión</span></div>
        {gyms.map(gym => <div className="table-row" key={gym.id}>
          <div className="gym-name"><span>{gym.name.slice(0,2).toUpperCase()}</span><div><strong>{gym.name}</strong><small>{gym.province ?? gym.slug}</small></div></div>
          <strong>{gym._count.members}</strong>
          <div className="admin-cell"><strong>{gym.users[0]?.name ?? "Sin asignar"}</strong><small>{gym.users.length > 1 ? `+${gym.users.length - 1} adicional(es)` : gym.users[0]?.email}</small></div>
          <button className={gym.isActive ? "badge" : "badge trial"} onClick={async()=>{ if(demo)return; await api(`/platform/gyms/${gym.id}/status`,token,{method:"PATCH",body:JSON.stringify({isActive:!gym.isActive})}); await load(); }}>{gym.isActive ? "Activo" : "Inactivo"}</button>
          <button className="manage-button" onClick={() => setManaging(gym)}>Gestionar</button>
        </div>)}
        {!gyms.length && <p className="empty-copy">No hay gimnasios registrados.</p>}
      </article>}
    </section>

    {creating && <CreateGym token={token} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); void load(); }} />}
    {managing && <ManageGym token={token} gym={managing} demo={demo} onClose={() => setManaging(null)} onChanged={async () => { await load(); }} />}
  </main>;
}

function SessionLoader() {
  return <main className="session-loader" aria-live="polite"><div className="brand"><span>G</span><div>GymFlow <small>MINI</small></div></div><p>Comprobando sesión…</p></main>;
}

function NoticeBanner({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  return <button className={`notice ${notice.tone}`} onClick={onClose} aria-live="polite"><span>{notice.message}</span><strong aria-label="Cerrar">×</strong></button>;
}

function Login({ onLogin, onDemo }: { onLogin: (token: string) => void; onDemo: () => void }) {
  const [email,setEmail]=useState("super@gymflowmini.cu");
  const [password,setPassword]=useState("SuperMini123!");
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const submit=async(event:FormEvent)=>{
    event.preventDefault(); setLoading(true); setError("");
    try {
      const response=await fetch(`${API}/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password})});
      const data=await response.json();
      if(!response.ok)throw new Error(data.message);
      if(data.user.role!=="SUPER_ADMIN")throw new Error("Este panel es exclusivo para el superadministrador");
      onLogin(data.accessToken);
    } catch(reason) { setError((reason as Error).message || "No se pudo conectar con la API"); }
    finally { setLoading(false); }
  };
  return <main className="login-shell"><section className="login-story"><div className="brand"><span>G</span><div>GymFlow <small>MINI</small></div></div><div><p className="eyebrow light">PLATAFORMA DE VALIDACIÓN</p><h1>Menos complejidad.<br/>Más control.</h1><p>Una forma clara de medir si los gimnasios cubanos están listos para digitalizar su operación.</p></div><small>MIEMBROS · PLANES · FINANZAS</small></section><section className="login-form"><form onSubmit={submit}><p className="eyebrow">ACCESO RESTRINGIDO</p><h2>Panel del superadministrador</h2><p>Consulta y administra los gimnasios del piloto.</p><label>Correo<input value={email} onChange={event=>setEmail(event.target.value)} type="email" required/></label><label>Contraseña<input value={password} onChange={event=>setPassword(event.target.value)} type="password" required/></label>{error&&<div className="form-error">{error}</div>}<button className="submit" disabled={loading}>{loading?"Entrando…":"Entrar al panel"}</button><button className="demo-button" type="button" onClick={onDemo}>Explorar demostración</button></form></section></main>;
}

function CreateGym({token,onClose,onCreated}:{token:string;onClose:()=>void;onCreated:()=>void}) {
  const [error,setError]=useState("");
  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault(); const form=new FormData(event.currentTarget);
    try { await api("/platform/gyms",token,{method:"POST",body:JSON.stringify(Object.fromEntries(form))}); onCreated(); }
    catch(reason){setError((reason as Error).message);}
  };
  return <div className="modal" role="dialog" aria-modal="true" aria-label="Añadir gimnasio"><form className="modal-card" onSubmit={submit}><ModalHead eyebrow="NUEVO PILOTO" title="Añadir gimnasio" onClose={onClose}/><label>Nombre<input name="name" required/></label><label>Identificador<input name="slug" placeholder="ej. titan-gym" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required/></label><div className="two"><label>Provincia<input name="province"/></label><label>Teléfono<input name="phone"/></label></div><label>Moneda del gimnasio<select name="currency" defaultValue="CUP" required><option value="CUP">CUP · Peso cubano</option><option value="USD">USD · Dólar estadounidense</option></select></label><div className="two"><label>Administrador<input name="adminName" required/></label><label>Correo<input name="adminEmail" type="email" required/></label></div><label>Contraseña temporal<input name="adminPassword" type="password" minLength={8} required/></label>{error&&<div className="form-error">{error}</div>}<button className="submit">Crear gimnasio y administrador</button></form></div>;
}

function ManageGym({ token, gym, demo, onClose, onChanged }: { token: string; gym: Gym; demo: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const [detail, setDetail] = useState(gym);
  const [admins, setAdmins] = useState<Admin[]>(gym.users);
  const [plans, setPlans] = useState<Plan[]>(demo ? demoPlans : []);
  const [members, setMembers] = useState<Member[]>([]);
  const [payments, setPayments] = useState<Payment[]>(demo ? demoPayments : []);
  const [finances, setFinances] = useState<GymFinances | null>(demo ? demoFinances : null);
  const [tab, setTab] = useState<"gym" | "admins" | "plans" | "members" | "payments" | "finances">("gym");
  const [editingAdmin, setEditingAdmin] = useState<Admin | null>(null);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [editingMembershipMember, setEditingMembershipMember] = useState<Member | null>(null);
  const [memberMemberships, setMemberMemberships] = useState<Membership[]>([]);
  const [editingMembership, setEditingMembership] = useState<Membership | null>(null);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [addingAdmin, setAddingAdmin] = useState(false);
  const [addingPlan, setAddingPlan] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [addingMembership, setAddingMembership] = useState(false);
  const [membershipLoading, setMembershipLoading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ path: string; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(!demo);

  const load = useCallback(async (memberSearch = "") => {
    if (demo) return;
    setLoading(true);
    try {
      const [nextGym, nextAdmins, nextPlans, nextMembers, nextPayments, nextFinances] = await Promise.all([
        api<Gym>(`/platform/gyms/${gym.id}`, token),
        api<Admin[]>(`/platform/gyms/${gym.id}/admins`, token),
        api<Plan[]>(`/platform/gyms/${gym.id}/plans`, token),
        api<Member[]>(`/platform/gyms/${gym.id}/members${memberSearch ? `?search=${encodeURIComponent(memberSearch)}` : ""}`, token),
        api<Payment[]>(`/platform/gyms/${gym.id}/payments`, token),
        api<GymFinances>(`/platform/gyms/${gym.id}/finances`, token),
      ]);
      setDetail(nextGym); setAdmins(nextAdmins); setPlans(nextPlans); setMembers(nextMembers); setPayments(nextPayments); setFinances(nextFinances);
    } catch (error) { setNotice({ message: (error as Error).message, tone: "error" }); }
    finally { setLoading(false); }
  }, [demo, gym.id, token]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const complete = async (message: string) => {
    setNotice({ message, tone: "success" }); setEditingAdmin(null); setEditingPlan(null); setEditingMember(null); setEditingMembershipMember(null); setEditingMembership(null); setEditingPayment(null); setAddingAdmin(false); setAddingPlan(false); setAddingMember(false); setAddingMembership(false);
    await load(search); await onChanged();
  };
  const openMemberships = async (member: Member) => {
    setEditingMembershipMember(member); setEditingMember(null); setAddingMember(false); setEditingMembership(null); setAddingMembership(false);
    if (demo) { setMemberMemberships(member.memberships); return; }
    setMembershipLoading(true);
    try { setMemberMemberships(await api<Membership[]>(`/platform/gyms/${gym.id}/members/${member.id}/memberships`, token)); }
    catch (error) { setNotice({ message: (error as Error).message, tone: "error" }); }
    finally { setMembershipLoading(false); }
  };
  const removeEntity = (path: string, label: string) => {
    setPendingDelete({ path, label });
  };
  const confirmRemove = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const result = await api<DeleteOutcome>(pendingDelete.path, token, { method: "DELETE" });
      const label = pendingDelete.label;
      setPendingDelete(null);
      await complete(result.disposition === "DELETED" ? `${label} eliminado` : `${label} archivado`);
    } catch (error) { setNotice({ message: (error as Error).message, tone: "error" }); }
    finally { setDeleting(false); }
  };

  return <div className="modal" role="dialog" aria-modal="true" aria-label={`Gestionar ${gym.name}`}>
    <section className="modal-card manage-card">
      <ModalHead eyebrow="GESTIÓN DE GIMNASIO" title={detail.name} onClose={onClose}/>
      <div className="manage-summary"><span>{detail.province || "Provincia sin definir"}</span><span>{detail._count.members} miembros</span><span>{plans.length} planes</span><span>{admins.length} administradores</span><span className={detail.isActive ? "status-dot active" : "status-dot"}>{detail.isActive ? "Activo" : "Inactivo"}</span></div>
      {demo && <div className="demo-banner">La demostración es de solo lectura. Inicia sesión para guardar cambios reales.</div>}
      {notice && <NoticeBanner notice={notice} onClose={() => setNotice(null)}/>}
      <div className="manage-tabs" role="tablist">
        <button className={tab === "gym" ? "active" : ""} onClick={() => setTab("gym")}>Información</button>
        <button className={tab === "admins" ? "active" : ""} onClick={() => setTab("admins")}>Administradores <span>{admins.length}</span></button>
        <button className={tab === "plans" ? "active" : ""} onClick={() => setTab("plans")}>Planes <span>{plans.length}</span></button>
        <button className={tab === "members" ? "active" : ""} onClick={() => setTab("members")}>Miembros <span>{detail._count.members}</span></button>
        <button className={tab === "payments" ? "active" : ""} onClick={() => setTab("payments")}>Cobros <span>{payments.filter(payment => paymentBalance(payment) > 0 && payment.status !== "CANCELLED").length}</span></button>
        <button className={tab === "finances" ? "active" : ""} onClick={() => setTab("finances")}>Finanzas</button>
      </div>
      {loading ? <div className="loading-block">Cargando información…</div> : <>
        {tab === "gym" && <GymEditor gym={detail} disabled={demo} onSave={async payload => { const updated=await api<Gym>(`/platform/gyms/${gym.id}`,token,{method:"PATCH",body:JSON.stringify(payload)}); setDetail({...detail,...updated}); await complete("Información actualizada"); }}/>}
        {tab === "admins" && <section className="manager-section">
          <div className="section-tools"><div><h3>Administradores</h3><p>Cuentas con acceso operativo a este gimnasio.</p></div><button disabled={demo} onClick={() => { setAddingAdmin(true); setEditingAdmin(null); }}>+ Añadir</button></div>
          {(addingAdmin || editingAdmin) && <AdminEditor admin={editingAdmin} onCancel={() => { setAddingAdmin(false); setEditingAdmin(null); }} onSave={async payload => { if(editingAdmin) await api(`/platform/gyms/${gym.id}/admins/${editingAdmin.id}`,token,{method:"PATCH",body:JSON.stringify(payload)}); else await api(`/platform/gyms/${gym.id}/admins`,token,{method:"POST",body:JSON.stringify(payload)}); await complete(editingAdmin ? "Administrador actualizado" : "Administrador creado"); }}/>}
          <div className="entity-list">{admins.map(admin=><article className="entity-row" key={admin.id}><div className="entity-avatar">{initials(admin.name)}</div><div><strong>{admin.name}</strong><small>{admin.email}</small></div><span className={admin.isActive ? "state active" : "state"}>{admin.isActive ? "Activo" : "Inactivo"}</span><div className="row-actions"><button disabled={demo} onClick={() => { setEditingAdmin(admin); setAddingAdmin(false); }}>Editar</button><button className="danger-action" disabled={demo} onClick={() => void removeEntity(`/platform/gyms/${gym.id}/admins/${admin.id}`, `el administrador ${admin.name}`)}>Eliminar</button></div></article>)}</div>
        </section>}
        {tab === "plans" && <section className="manager-section">
          <div className="section-tools"><div><h3>Planes</h3><p>Oferta comercial disponible para las membresías del gimnasio.</p></div><button disabled={demo} onClick={() => { setAddingPlan(true); setEditingPlan(null); }}>+ Añadir</button></div>
          {(addingPlan || editingPlan) && <PlanEditor plan={editingPlan} onCancel={() => { setAddingPlan(false); setEditingPlan(null); }} onSave={async payload => { if(editingPlan) await api(`/platform/gyms/${gym.id}/plans/${editingPlan.id}`,token,{method:"PATCH",body:JSON.stringify(payload)}); else await api(`/platform/gyms/${gym.id}/plans`,token,{method:"POST",body:JSON.stringify(payload)}); await complete(editingPlan ? "Plan actualizado" : "Plan creado"); }}/>}
          <div className="plan-list">{plans.map(plan=><article className="plan-row" key={plan.id}><div><strong>{plan.name}</strong><small>{plan.description || "Sin descripción"}</small></div><div><strong>{currencyValue(plan.price, detail.currency)}</strong><small>{plan.durationDays} días</small></div><span className={plan.isActive ? "state active" : "state"}>{plan.isActive ? "Activo" : "Inactivo"}</span><div className="row-actions"><button disabled={demo} onClick={() => { setEditingPlan(plan); setAddingPlan(false); }}>Editar</button><button className="danger-action" disabled={demo} onClick={() => void removeEntity(`/platform/gyms/${gym.id}/plans/${plan.id}`, `el plan ${plan.name}`)}>Eliminar</button></div></article>)}{!plans.length&&<p className="empty-copy">No hay planes registrados.</p>}</div>
        </section>}
        {tab === "members" && <section className="manager-section">
          <div className="section-tools"><div><h3>Miembros</h3><p>Datos personales y estado dentro del gimnasio.</p></div><button disabled={demo} onClick={() => { setAddingMember(true); setEditingMember(null); }}>+ Añadir</button></div>
          <form className="search-row" onSubmit={event=>{event.preventDefault();void load(search);}}><input aria-label="Buscar miembros" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Buscar por nombre, código, CI o teléfono"/><button>Buscar</button></form>
          {(addingMember || editingMember) && <MemberEditor member={editingMember} onCancel={() => { setAddingMember(false); setEditingMember(null); }} onSave={async payload => { if(editingMember) await api(`/platform/gyms/${gym.id}/members/${editingMember.id}`,token,{method:"PATCH",body:JSON.stringify(payload)}); else await api(`/platform/gyms/${gym.id}/members`,token,{method:"POST",body:JSON.stringify(payload)}); await complete(editingMember ? "Miembro actualizado" : "Miembro creado"); }}/>}
          {editingMembershipMember && <section className="membership-manager"><div className="section-tools"><div><h3>Membresías de {editingMembershipMember.firstName} {editingMembershipMember.lastName}</h3><p>Edita directamente la membresía existente o añade una cuando no haya otra activa.</p></div><div className="membership-tools"><button onClick={() => setEditingMembershipMember(null)}>Cerrar</button><button className="primary" disabled={demo || hasActiveMembership(memberMemberships) || !plans.some(plan=>plan.isActive)} onClick={() => { setAddingMembership(true); setEditingMembership(null); }}>+ Añadir</button></div></div>{membershipLoading ? <div className="loading-block">Cargando membresías…</div> : <>{(addingMembership || editingMembership) && <MembershipEditor membership={editingMembership} plans={plans} currency={detail.currency ?? "CUP"} onCancel={() => { setAddingMembership(false); setEditingMembership(null); }} onSave={async payload => { const base=`/platform/gyms/${gym.id}/members/${editingMembershipMember.id}/memberships`; await api(editingMembership ? `${base}/${editingMembership.id}` : base,token,{method:editingMembership?"PATCH":"POST",body:JSON.stringify(payload)}); await complete(editingMembership ? "Membresía actualizada" : "Membresía añadida"); }}/>}<div className="membership-list">{memberMemberships.map(membership=><article className="membership-row" key={membership.id}><div><strong>{membership.plan.name}</strong><small>{membershipLabel(membership)}</small></div><div><strong>{membership.payment ? currencyValue(membership.payment.amount,detail.currency) : "Sin cobro"}</strong><small>{membership.payment ? `${currencyValue(membership.payment.paidAmount,detail.currency)} abonados · ${paymentLabel(membership.payment.status)}` : ""}</small></div><div className="row-actions"><button disabled={demo} onClick={() => { setEditingMembership(membership); setAddingMembership(false); }}>Editar</button><button className="danger-action" disabled={demo} onClick={() => void removeEntity(`/platform/gyms/${gym.id}/members/${editingMembershipMember.id}/memberships/${membership.id}`, `la membresía ${membership.plan.name}`)}>Eliminar</button></div></article>)}{!memberMemberships.length&&<p className="empty-copy">Este miembro no tiene membresías.</p>}</div></>}</section>}
          <div className="member-list">{members.map(member=>{const latest=activeMembership(member.memberships)??member.memberships[0];return <article className="member-row" key={member.id}><div className="entity-avatar member">{initials(`${member.firstName} ${member.lastName}`)}</div><div><strong>{member.firstName} {member.lastName}</strong><small>{member.code ? `Código ${member.code} · ` : ""}CI {member.ci}</small><small>{member.age ? `${member.age} años · ` : ""}{member.sex ? sexLabel(member.sex) : "Sexo no indicado"} · {member.phone || "Sin teléfono"}</small></div><div><strong>{latest?.plan.name ?? "Sin plan"}</strong><small>{latest ? membershipLabel(latest) : "Sin membresía"}</small></div><span className={member.status === "ACTIVE" ? "state active" : "state"}>{member.status === "ACTIVE" ? "Activo" : "Inactivo"}</span><div className="row-actions"><button onClick={() => void openMemberships(member)}>Membresías</button><button disabled={demo} onClick={() => { setEditingMember(member); setAddingMember(false); setEditingMembershipMember(null); }}>Editar</button><button className="danger-action" disabled={demo} onClick={() => void removeEntity(`/platform/gyms/${gym.id}/members/${member.id}`, `el miembro ${member.firstName} ${member.lastName}`)}>Eliminar</button></div></article>})}{!members.length&&<p className="empty-copy">No se encontraron miembros.</p>}</div>
        </section>}
        {tab === "payments" && <section className="manager-section">
          <div className="section-tools"><div><h3>Cobros</h3><p>Consulta saldos y procesa abonos de las membresías del gimnasio.</p></div></div>
          {editingPayment && (
            <PaymentEditor payment={editingPayment} currency={detail.currency ?? "CUP"} onCancel={() => setEditingPayment(null)} onSave={async payload => { await api(`/platform/gyms/${gym.id}/payments/${editingPayment.id}/applications`, token, { method: "POST", body: JSON.stringify(payload) }); await complete("Pago procesado correctamente"); }}/>
          )}
          <div className="payment-list">{payments.map(payment=><article className="payment-row" key={payment.id}><div><strong>{payment.member.firstName} {payment.member.lastName}</strong><small>CI {payment.member.ci} · {payment.membership.plan.name}</small></div><div><strong>{currencyValue(payment.paidAmount, detail.currency)} / {currencyValue(payment.amount, detail.currency)}</strong><small>Saldo {currencyValue(paymentBalance(payment), detail.currency)}</small></div><span className={`state ${payment.status === "PAID" ? "active" : payment.status === "OVERDUE" ? "overdue" : ""}`}>{paymentLabel(payment.status)}</span><div className="row-actions"><button className="primary" disabled={demo || paymentBalance(payment) <= 0 || payment.status === "CANCELLED"} onClick={() => setEditingPayment(payment)}>{payment.status === "PAID" ? "Pagado" : "Procesar pago"}</button></div></article>)}{!payments.length&&<p className="empty-copy">No hay cobros registrados.</p>}</div>
        </section>}
        {tab === "finances" && (
          <FinancePanel finances={finances} currency={detail.currency ?? "CUP"}/>
        )}
      </>}
    </section>
    {pendingDelete && (
      <ConfirmDelete label={pendingDelete.label} deleting={deleting} onCancel={() => setPendingDelete(null)} onConfirm={() => void confirmRemove()}/>
    )}
  </div>;
}

function ConfirmDelete({ label, deleting, onCancel, onConfirm }: { label: string; deleting: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div className="confirm-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-copy"><section className="confirm-card"><div className="confirm-icon">!</div><h3 id="delete-title">Eliminar registro</h3><p id="delete-copy">¿Deseas eliminar {label}?</p><div className="confirm-actions"><button disabled={deleting} onClick={onCancel}>Cancelar</button><button className="delete-confirm" disabled={deleting} onClick={onConfirm}>{deleting ? "Eliminando…" : "Eliminar"}</button></div></section></div>;
}

function GymEditor({ gym, disabled, onSave }: { gym: Gym; disabled: boolean; onSave: (payload: Record<string, unknown>) => Promise<void> }) {
  const [error,setError]=useState(""); const [saving,setSaving]=useState(false);
  const submit=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();setSaving(true);setError("");const form=new FormData(event.currentTarget);const payload={...Object.fromEntries(form),isActive:form.get("isActive")==="on"};try{await onSave(payload);}catch(reason){setError((reason as Error).message);}finally{setSaving(false);}};
  return <form className="editor-form" onSubmit={submit}><div className="form-grid"><label>Nombre<input name="name" defaultValue={gym.name} required disabled={disabled}/></label><label>Identificador<input name="slug" defaultValue={gym.slug} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required disabled={disabled}/></label><label>Provincia<input name="province" defaultValue={gym.province ?? ""} disabled={disabled}/></label><label>Teléfono<input name="phone" defaultValue={gym.phone ?? ""} disabled={disabled}/></label><label>Moneda del gimnasio<select name="currency" defaultValue={gym.currency ?? "CUP"} required disabled={disabled}><option value="CUP">CUP · Peso cubano</option><option value="USD">USD · Dólar estadounidense</option></select></label><label className="check-label"><input name="isActive" type="checkbox" defaultChecked={gym.isActive} disabled={disabled}/><span>Gimnasio activo y con acceso habilitado</span></label></div>{error&&<div className="form-error">{error}</div>}<button className="submit compact" disabled={disabled||saving}>{saving?"Guardando…":"Guardar información"}</button></form>;
}

function AdminEditor({ admin, onCancel, onSave }: { admin: Admin | null; onCancel: () => void; onSave: (payload: Record<string, unknown>) => Promise<void> }) {
  const [error,setError]=useState(""); const [saving,setSaving]=useState(false);
  const submit=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();setSaving(true);setError("");const form=new FormData(event.currentTarget);const payload:Record<string,unknown>={name:form.get("name"),email:form.get("email"),isActive:form.get("isActive")==="on"};const password=String(form.get("password")??"");if(password)payload.password=password;try{await onSave(payload);}catch(reason){setError((reason as Error).message);}finally{setSaving(false);}};
  return <form className="inline-editor" onSubmit={submit}><div className="form-grid"><label>Nombre<input name="name" defaultValue={admin?.name ?? ""} required/></label><label>Correo<input name="email" type="email" defaultValue={admin?.email ?? ""} required/></label><label>{admin?"Nueva contraseña (opcional)":"Contraseña temporal"}<input name="password" type="password" minLength={8} required={!admin}/></label><label className="check-label"><input name="isActive" type="checkbox" defaultChecked={admin?.isActive ?? true}/><span>Cuenta activa</span></label></div>{error&&<div className="form-error">{error}</div>}<div className="form-actions"><button type="button" onClick={onCancel}>Cancelar</button><button className="primary" disabled={saving}>{saving?"Guardando…":admin?"Guardar cambios":"Crear administrador"}</button></div></form>;
}

function PlanEditor({ plan, onCancel, onSave }: { plan: Plan | null; onCancel: () => void; onSave: (payload: Record<string, unknown>) => Promise<void> }) {
  const [error,setError]=useState(""); const [saving,setSaving]=useState(false);
  const submit=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();setSaving(true);setError("");const form=new FormData(event.currentTarget);const payload={name:form.get("name"),description:form.get("description"),price:Number(form.get("price")),durationDays:Number(form.get("durationDays")),isActive:form.get("isActive")==="on"};try{await onSave(payload);}catch(reason){setError((reason as Error).message);}finally{setSaving(false);}};
  return <form className="inline-editor" onSubmit={submit}><div className="form-grid"><label>Nombre<input name="name" defaultValue={plan?.name ?? ""} maxLength={80} required/></label><label>Precio<input name="price" type="number" min="0.01" step="0.01" defaultValue={plan ? Number(plan.price) : ""} required/></label><label>Duración en días<input name="durationDays" type="number" min="1" step="1" defaultValue={plan?.durationDays ?? 30} required/></label><label className="check-label"><input name="isActive" type="checkbox" defaultChecked={plan?.isActive ?? true}/><span>Disponible para nuevas membresías</span></label><label className="field-wide">Descripción<textarea name="description" defaultValue={plan?.description ?? ""} maxLength={300}/></label></div>{error&&<div className="form-error">{error}</div>}<div className="form-actions"><button type="button" onClick={onCancel}>Cancelar</button><button className="primary" disabled={saving}>{saving?"Guardando…":plan?"Guardar plan":"Crear plan"}</button></div></form>;
}

function MembershipEditor({ membership, plans, currency, onCancel, onSave }: { membership: Membership | null; plans: Plan[]; currency: string; onCancel: () => void; onSave: (payload: Record<string, unknown>) => Promise<void> }) {
  const [error,setError]=useState(""); const [saving,setSaving]=useState(false); const [initialPayment,setInitialPayment]=useState("");
  const availablePlans=plans.filter(plan=>plan.isActive||plan.id===membership?.plan.id); const currentPlanId=membership?.plan.id??availablePlans[0]?.id;
  const submit=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();setSaving(true);setError("");const form=new FormData(event.currentTarget);const payload:Record<string,unknown>={planId:form.get("planId")};if(membership){payload.startDate=new Date(`${form.get("startDate")}T00:00:00`).toISOString();payload.endDate=new Date(`${form.get("endDate")}T23:59:59`).toISOString();payload.status=form.get("status");}else if(initialPayment){payload.initialPayment=Number(initialPayment);payload.paymentMethod=form.get("paymentMethod");const reference=String(form.get("reference")??"");if(reference)payload.reference=reference;}try{await onSave(payload);}catch(reason){setError((reason as Error).message);}finally{setSaving(false);}};
  return <form className="inline-editor membership-editor" onSubmit={submit}><div className="editor-heading"><div><strong>{membership?"Editar membresía":"Añadir membresía"}</strong><small>{membership?`${membership.plan.name} · ${membershipLabel(membership)}`:"Solo puede añadirse cuando el miembro no tiene otra activa"}</small></div></div><div className="form-grid"><label>Plan<select name="planId" defaultValue={currentPlanId} required>{availablePlans.map(plan=><option key={plan.id} value={plan.id}>{plan.name} · {currencyValue(plan.price,currency)} / {plan.durationDays} días</option>)}</select></label>{membership?<><label>Estado<select name="status" defaultValue={membership.status}><option value="ACTIVE">Activa</option><option value="SCHEDULED">Programada</option><option value="EXPIRED">Vencida</option><option value="CANCELLED">Cancelada</option></select></label><label>Fecha inicial<input name="startDate" type="date" defaultValue={dateInput(membership.startDate)} required/></label><label>Fecha final<input name="endDate" type="date" defaultValue={dateInput(membership.endDate)} required/></label></>:<><label>Abono inicial (opcional)<input name="initialPayment" type="number" min="0.01" step="0.01" value={initialPayment} onChange={event=>setInitialPayment(event.target.value)}/></label><label>Método de pago<select name="paymentMethod" defaultValue="" required={Number(initialPayment)>0}><option value="">Seleccionar</option><option value="CASH">Efectivo</option><option value="TRANSFER">Transferencia</option><option value="OTHER">Otro</option></select></label><label>Referencia<input name="reference" maxLength={100}/></label></>}</div>{membership?.payment&&<p className="logic-note">Cobro: {currencyValue(membership.payment.amount,currency)} · abonado {currencyValue(membership.payment.paidAmount,currency)}. Los abonos existentes no se modifican.</p>}{error&&<div className="form-error">{error}</div>}<div className="form-actions"><button type="button" onClick={onCancel}>Cancelar</button><button className="primary" disabled={saving||!availablePlans.length}>{saving?"Guardando…":membership?"Guardar membresía":"Añadir membresía"}</button></div></form>;
}

function PaymentEditor({ payment, currency, onCancel, onSave }: { payment: Payment; currency: string; onCancel: () => void; onSave: (payload: Record<string, unknown>) => Promise<void> }) {
  const [error,setError]=useState(""); const [saving,setSaving]=useState(false); const balance=paymentBalance(payment);
  const submit=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();setSaving(true);setError("");const form=new FormData(event.currentTarget);const reference=String(form.get("reference")??"");const payload:Record<string,unknown>={amount:Number(form.get("amount")),method:form.get("method")};if(reference)payload.reference=reference;try{await onSave(payload);}catch(reason){setError((reason as Error).message);}finally{setSaving(false);}};
  return <form className="inline-editor payment-editor" onSubmit={submit}><div className="editor-heading"><div><strong>Procesar pago</strong><small>{payment.member.firstName} {payment.member.lastName} · {payment.membership.plan.name}</small></div><strong>Saldo {currencyValue(balance,currency)}</strong></div><div className="form-grid three"><label>Importe<input name="amount" type="number" min="0.01" max={balance} step="0.01" defaultValue={balance} required/></label><label>Método<select name="method" defaultValue="CASH" required><option value="CASH">Efectivo</option><option value="TRANSFER">Transferencia</option><option value="OTHER">Otro</option></select></label><label>Referencia<input name="reference" maxLength={100} placeholder="Opcional"/></label></div>{error&&<div className="form-error">{error}</div>}<div className="form-actions"><button type="button" onClick={onCancel}>Cancelar</button><button className="primary" disabled={saving}>{saving?"Procesando…":"Confirmar pago"}</button></div></form>;
}

function FinancePanel({ finances, currency }: { finances: GymFinances | null; currency: string }) {
  if (!finances) return <div className="loading-block">Cargando finanzas…</div>;
  return <section className="manager-section finance-panel"><div className="section-tools"><div><h3>Finanzas</h3><p>Facturación, ingresos y deuda acumulada del gimnasio.</p></div></div><div className="finance-metrics"><article><span>Facturado</span><strong>{currencyValue(finances.totalBilled,currency)}</strong><small>Histórico total</small></article><article><span>Cobrado</span><strong>{currencyValue(finances.totalCollected,currency)}</strong><small>{currencyValue(finances.monthlyRevenue,currency)} este mes</small></article><article><span>Por cobrar</span><strong>{currencyValue(finances.pendingBalance,currency)}</strong><small>{finances.pendingPayments} cobros pendientes</small></article><article className={finances.overdueBalance > 0 ? "attention" : ""}><span>Deuda vencida</span><strong>{currencyValue(finances.overdueBalance,currency)}</strong><small>Requiere seguimiento</small></article></div><div className="finance-history"><h4>Movimientos recientes</h4>{finances.recentMovements.map(movement=><article key={movement.id}><div><strong>{movement.payment.member.firstName} {movement.payment.member.lastName}</strong><small>{movement.payment.membership.plan.name} · {paymentMethodLabel(movement.method)}</small></div><div><strong>{currencyValue(movement.amount,currency)}</strong><small>{new Date(movement.occurredAt).toLocaleString("es-CU")}</small></div></article>)}{!finances.recentMovements.length&&<p className="empty-copy">Todavía no hay movimientos de pago.</p>}</div></section>;
}

function MemberEditor({ member, onCancel, onSave }: { member: Member | null; onCancel: () => void; onSave: (payload: Record<string, unknown>) => Promise<void> }) {
  const [error,setError]=useState(""); const [saving,setSaving]=useState(false);
  const submit=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();setSaving(true);setError("");const form=new FormData(event.currentTarget);const code=String(form.get("code")??"").trim();const age=String(form.get("age")??"");const sex=String(form.get("sex")??"");const payload:Record<string,unknown>={ci:form.get("ci"),code:code||null,firstName:form.get("firstName"),lastName:form.get("lastName"),age:age?Number(age):null,sex:sex||null,phone:form.get("phone"),address:form.get("address")};if(member)payload.status=form.get("status");try{await onSave(payload);}catch(reason){setError((reason as Error).message);}finally{setSaving(false);}};
  return <form className="inline-editor" onSubmit={submit}><div className="form-grid three"><label>Nombre<input name="firstName" defaultValue={member?.firstName ?? ""} required/></label><label>Apellidos<input name="lastName" defaultValue={member?.lastName ?? ""} required/></label><label>Código interno<input name="code" maxLength={40} defaultValue={member?.code ?? ""} placeholder="Opcional"/></label><label>Carnet de identidad<input name="ci" inputMode="numeric" pattern="[0-9]{11}" maxLength={11} defaultValue={member?.ci ?? ""} required/></label><label>Edad<input name="age" type="number" min={1} max={120} step={1} defaultValue={member?.age ?? ""} placeholder="Opcional"/></label><label>Sexo<select name="sex" defaultValue={member?.sex ?? ""}><option value="">Sin especificar</option><option value="MALE">Masculino</option><option value="FEMALE">Femenino</option><option value="OTHER">Otro</option></select></label><label>Teléfono<input name="phone" defaultValue={member?.phone ?? ""}/></label><label>Dirección<input name="address" defaultValue={member?.address ?? ""}/></label>{member&&<label>Estado<select name="status" defaultValue={member.status}><option value="ACTIVE">Activo</option><option value="INACTIVE">Inactivo</option></select></label>}</div>{error&&<div className="form-error">{error}</div>}<div className="form-actions"><button type="button" onClick={onCancel}>Cancelar</button><button className="primary" disabled={saving}>{saving?"Guardando…":member?"Guardar cambios":"Crear miembro"}</button></div></form>;
}

function ModalHead({ eyebrow, title, onClose }: { eyebrow: string; title: string; onClose: () => void }) {
  return <div className="modal-head"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><button type="button" aria-label="Cerrar" onClick={onClose}>×</button></div>;
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0,2).map(word=>word[0]).join("").toUpperCase();
}

function sexLabel(sex: MemberSex) {
  return ({ MALE: "Masculino", FEMALE: "Femenino", OTHER: "Otro" } as Record<MemberSex,string>)[sex];
}

function currencyValue(value: number | string, currency = "CUP") {
  try { return `${Number(value).toLocaleString("es-CU", { style: "currency", currency })} ${currency}`; }
  catch { return `$${Number(value).toLocaleString("es-CU")} ${currency}`; }
}

function membershipLabel(membership: Membership) {
  const labels: Record<string,string> = { ACTIVE: "activa", SCHEDULED: "programada", EXPIRED: "vencida", CANCELLED: "cancelada" };
  return `${labels[membership.status] ?? membership.status.toLowerCase()} · vence ${new Date(membership.endDate).toLocaleDateString("es-CU")}`;
}

function activeMembership(memberships: Membership[]) {
  const now = Date.now();
  return memberships.find(membership => membership.status === "ACTIVE" && new Date(membership.endDate).getTime() >= now);
}

function hasActiveMembership(memberships: Membership[]) {
  return Boolean(activeMembership(memberships));
}

function paymentLabel(status: string) {
  return ({ PENDING: "pendiente", PARTIAL: "parcial", OVERDUE: "vencido", PAID: "pagado", CANCELLED: "cancelado" } as Record<string,string>)[status] ?? status.toLowerCase();
}

function paymentBalance(payment: Payment) {
  return Math.max(0, Number(payment.amount) - Number(payment.paidAmount));
}

function paymentMethodLabel(method: string) {
  return ({ CASH: "Efectivo", TRANSFER: "Transferencia", OTHER: "Otro" } as Record<string,string>)[method] ?? method;
}

function dateInput(value: string) {
  return new Date(value).toISOString().slice(0,10);
}
