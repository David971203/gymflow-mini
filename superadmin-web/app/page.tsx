"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Overview = { gyms: number; activeGyms: number; members: number; newMembers: number; monthlyRevenue: number; pendingDebt: number };
type Admin = { id: string; name: string; email: string; isActive: boolean; createdAt?: string };
type Membership = { id: string; status: string; endDate: string; plan: { name: string }; payment?: { status: string; amount: number; paidAmount: number } | null };
type Member = { id: string; ci: string; firstName: string; lastName: string; phone?: string; address?: string; status: "ACTIVE" | "INACTIVE"; joinedAt: string; memberships: Membership[] };
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
  const [token, setToken] = useState("");
  const [demo, setDemo] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<Gym | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setToken(localStorage.getItem("gymflow_mini_super_token") ?? ""), 0);
    return () => window.clearTimeout(timer);
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
      setNotice((error as Error).message);
    }
  }, [token, demo]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (!token && !demo) {
    return <Login onLogin={(value) => { localStorage.setItem("gymflow_mini_super_token", value); setToken(value); }} onDemo={() => setDemo(true)} />;
  }

  const logout = () => {
    localStorage.removeItem("gymflow_mini_super_token");
    setToken(""); setDemo(false); setOverview(null); setGyms([]);
  };
  const currency = (value = 0) => `$${value.toLocaleString("es-CU")}`;

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span>G</span><div>GymFlow <small>MINI</small></div></div>
      <nav aria-label="Navegación principal"><a href="#resumen">Resumen</a><a className="active" href="#gimnasios">Gimnasios</a><a href="#finanzas">Finanzas</a></nav>
      <button className="profile" onClick={logout}><span>DA</span><div><strong>David</strong><small>{demo ? "Salir de la demo" : "Cerrar sesión"}</small></div></button>
    </aside>

    <section className="workspace" id="resumen">
      {demo && <div className="demo-banner">Vista demostrativa. Puedes explorar la gestión; las escrituras están desactivadas.</div>}
      {notice && <button className="notice" onClick={() => setNotice("")}>{notice} ×</button>}
      <header><div><p className="eyebrow">PANEL DE PLATAFORMA</p><h1>Administración de gimnasios</h1><p>Controla negocios, responsables y miembros desde un solo lugar.</p></div><button onClick={() => demo ? setNotice("La creación está desactivada en la demostración") : setCreating(true)}>+ Añadir gimnasio</button></header>

      <div className="metrics">
        <article><span>Gimnasios activos</span><strong>{overview?.activeGyms ?? "—"}</strong><small>{overview?.gyms ?? 0} registrados</small></article>
        <article><span>Miembros registrados</span><strong>{overview?.members ?? "—"}</strong><small className="positive">+{overview?.newMembers ?? 0} este mes</small></article>
        <article><span>Ingresos registrados</span><strong>{currency(overview?.monthlyRevenue)} <i>CUP</i></strong><small>Mes actual</small></article>
        <article><span>Cobros pendientes</span><strong>{currency(overview?.pendingDebt)} <i>CUP</i></strong><small className="warning">Saldo acumulado</small></article>
      </div>

      <div className="content-grid" id="finanzas">
        <article className="panel trend"><div className="panel-title"><div><h2>Actividad de la plataforma</h2><p>Miembros activos en los últimos 6 meses</p></div><span>6 meses</span></div><div className="chart" aria-label="Gráfico ilustrativo de miembros activos">{[42,55,50,68,76,92].map((height,index)=><div key={height} className="bar-wrap"><div className="bar" style={{height:`${height}%`}}/><small>{["Mar","Abr","May","Jun","Jul","Ago"][index]}</small></div>)}</div></article>
        <article className="panel pulse"><div className="panel-title"><div><h2>Señales del piloto</h2><p>Indicadores que conviene medir</p></div></div><div className="signal"><span>Crecimiento este mes</span><strong>+{overview?.newMembers ?? 0}</strong></div><div className="signal"><span>Gimnasios operando</span><strong>{overview?.activeGyms ?? 0}/{overview?.gyms ?? 0}</strong></div><div className="signal"><span>Ingreso por miembro</span><strong>{currency((overview?.monthlyRevenue ?? 0) / Math.max(overview?.members ?? 1,1))}</strong></div></article>
      </div>

      <article className="panel gym-table" id="gimnasios">
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
      </article>
    </section>

    {creating && <CreateGym token={token} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); void load(); }} />}
    {managing && <ManageGym token={token} gym={managing} demo={demo} onClose={() => setManaging(null)} onChanged={async () => { await load(); }} />}
  </main>;
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
  return <div className="modal" role="dialog" aria-modal="true" aria-label="Añadir gimnasio"><form className="modal-card" onSubmit={submit}><ModalHead eyebrow="NUEVO PILOTO" title="Añadir gimnasio" onClose={onClose}/><label>Nombre<input name="name" required/></label><label>Identificador<input name="slug" placeholder="ej. titan-gym" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required/></label><div className="two"><label>Provincia<input name="province"/></label><label>Teléfono<input name="phone"/></label></div><div className="two"><label>Administrador<input name="adminName" required/></label><label>Correo<input name="adminEmail" type="email" required/></label></div><label>Contraseña temporal<input name="adminPassword" type="password" minLength={8} required/></label>{error&&<div className="form-error">{error}</div>}<button className="submit">Crear gimnasio y administrador</button></form></div>;
}

function ManageGym({ token, gym, demo, onClose, onChanged }: { token: string; gym: Gym; demo: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const [detail, setDetail] = useState(gym);
  const [admins, setAdmins] = useState<Admin[]>(gym.users);
  const [members, setMembers] = useState<Member[]>([]);
  const [tab, setTab] = useState<"gym" | "admins" | "members">("gym");
  const [editingAdmin, setEditingAdmin] = useState<Admin | null>(null);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [addingAdmin, setAddingAdmin] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(!demo);

  const load = useCallback(async (memberSearch = "") => {
    if (demo) return;
    setLoading(true);
    try {
      const [nextGym, nextAdmins, nextMembers] = await Promise.all([
        api<Gym>(`/platform/gyms/${gym.id}`, token),
        api<Admin[]>(`/platform/gyms/${gym.id}/admins`, token),
        api<Member[]>(`/platform/gyms/${gym.id}/members${memberSearch ? `?search=${encodeURIComponent(memberSearch)}` : ""}`, token),
      ]);
      setDetail(nextGym); setAdmins(nextAdmins); setMembers(nextMembers);
    } catch (error) { setNotice((error as Error).message); }
    finally { setLoading(false); }
  }, [demo, gym.id, token]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const complete = async (message: string) => {
    setNotice(message); setEditingAdmin(null); setEditingMember(null); setAddingAdmin(false); setAddingMember(false);
    await load(search); await onChanged();
  };

  return <div className="modal" role="dialog" aria-modal="true" aria-label={`Gestionar ${gym.name}`}>
    <section className="modal-card manage-card">
      <ModalHead eyebrow="GESTIÓN DE GIMNASIO" title={detail.name} onClose={onClose}/>
      <div className="manage-summary"><span>{detail.province || "Provincia sin definir"}</span><span>{detail._count.members} miembros</span><span>{admins.length} administradores</span><span className={detail.isActive ? "status-dot active" : "status-dot"}>{detail.isActive ? "Activo" : "Inactivo"}</span></div>
      {demo && <div className="demo-banner">La demostración es de solo lectura. Inicia sesión para guardar cambios reales.</div>}
      {notice && <button className="notice" onClick={() => setNotice("")}>{notice} ×</button>}
      <div className="manage-tabs" role="tablist">
        <button className={tab === "gym" ? "active" : ""} onClick={() => setTab("gym")}>Información</button>
        <button className={tab === "admins" ? "active" : ""} onClick={() => setTab("admins")}>Administradores <span>{admins.length}</span></button>
        <button className={tab === "members" ? "active" : ""} onClick={() => setTab("members")}>Miembros <span>{detail._count.members}</span></button>
      </div>
      {loading ? <div className="loading-block">Cargando información…</div> : <>
        {tab === "gym" && <GymEditor gym={detail} disabled={demo} onSave={async payload => { const updated=await api<Gym>(`/platform/gyms/${gym.id}`,token,{method:"PATCH",body:JSON.stringify(payload)}); setDetail({...detail,...updated}); await complete("Información actualizada"); }}/>}
        {tab === "admins" && <section className="manager-section">
          <div className="section-tools"><div><h3>Administradores</h3><p>Cuentas con acceso operativo a este gimnasio.</p></div><button disabled={demo} onClick={() => { setAddingAdmin(true); setEditingAdmin(null); }}>+ Añadir</button></div>
          {(addingAdmin || editingAdmin) && <AdminEditor admin={editingAdmin} onCancel={() => { setAddingAdmin(false); setEditingAdmin(null); }} onSave={async payload => { if(editingAdmin) await api(`/platform/gyms/${gym.id}/admins/${editingAdmin.id}`,token,{method:"PATCH",body:JSON.stringify(payload)}); else await api(`/platform/gyms/${gym.id}/admins`,token,{method:"POST",body:JSON.stringify(payload)}); await complete(editingAdmin ? "Administrador actualizado" : "Administrador creado"); }}/>}
          <div className="entity-list">{admins.map(admin=><article className="entity-row" key={admin.id}><div className="entity-avatar">{initials(admin.name)}</div><div><strong>{admin.name}</strong><small>{admin.email}</small></div><span className={admin.isActive ? "state active" : "state"}>{admin.isActive ? "Activo" : "Inactivo"}</span><button disabled={demo} onClick={() => { setEditingAdmin(admin); setAddingAdmin(false); }}>Editar</button></article>)}</div>
        </section>}
        {tab === "members" && <section className="manager-section">
          <div className="section-tools"><div><h3>Miembros</h3><p>Datos personales y estado dentro del gimnasio.</p></div><button disabled={demo} onClick={() => { setAddingMember(true); setEditingMember(null); }}>+ Añadir</button></div>
          <form className="search-row" onSubmit={event=>{event.preventDefault();void load(search);}}><input aria-label="Buscar miembros" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Buscar por nombre, CI o teléfono"/><button>Buscar</button></form>
          {(addingMember || editingMember) && <MemberEditor member={editingMember} onCancel={() => { setAddingMember(false); setEditingMember(null); }} onSave={async payload => { if(editingMember) await api(`/platform/gyms/${gym.id}/members/${editingMember.id}`,token,{method:"PATCH",body:JSON.stringify(payload)}); else await api(`/platform/gyms/${gym.id}/members`,token,{method:"POST",body:JSON.stringify(payload)}); await complete(editingMember ? "Miembro actualizado" : "Miembro creado"); }}/>}
          <div className="member-list">{members.map(member=>{const latest=member.memberships[0];return <article className="member-row" key={member.id}><div className="entity-avatar member">{initials(`${member.firstName} ${member.lastName}`)}</div><div><strong>{member.firstName} {member.lastName}</strong><small>CI {member.ci} · {member.phone || "Sin teléfono"}</small></div><div><strong>{latest?.plan.name ?? "Sin plan"}</strong><small>{latest ? `Membresía ${latest.status.toLowerCase()}` : "Sin membresía"}</small></div><span className={member.status === "ACTIVE" ? "state active" : "state"}>{member.status === "ACTIVE" ? "Activo" : "Inactivo"}</span><button disabled={demo} onClick={() => { setEditingMember(member); setAddingMember(false); }}>Editar</button></article>})}{!members.length&&<p className="empty-copy">No se encontraron miembros.</p>}</div>
        </section>}
      </>}
    </section>
  </div>;
}

function GymEditor({ gym, disabled, onSave }: { gym: Gym; disabled: boolean; onSave: (payload: Record<string, unknown>) => Promise<void> }) {
  const [error,setError]=useState(""); const [saving,setSaving]=useState(false);
  const submit=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();setSaving(true);setError("");const form=new FormData(event.currentTarget);const payload={...Object.fromEntries(form),isActive:form.get("isActive")==="on"};try{await onSave(payload);}catch(reason){setError((reason as Error).message);}finally{setSaving(false);}};
  return <form className="editor-form" onSubmit={submit}><div className="form-grid"><label>Nombre<input name="name" defaultValue={gym.name} required disabled={disabled}/></label><label>Identificador<input name="slug" defaultValue={gym.slug} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required disabled={disabled}/></label><label>Provincia<input name="province" defaultValue={gym.province ?? ""} disabled={disabled}/></label><label>Teléfono<input name="phone" defaultValue={gym.phone ?? ""} disabled={disabled}/></label><label>Moneda<input name="currency" defaultValue={gym.currency ?? "CUP"} pattern="[A-Z]{3}" maxLength={3} required disabled={disabled}/></label><label className="check-label"><input name="isActive" type="checkbox" defaultChecked={gym.isActive} disabled={disabled}/><span>Gimnasio activo y con acceso habilitado</span></label></div>{error&&<div className="form-error">{error}</div>}<button className="submit compact" disabled={disabled||saving}>{saving?"Guardando…":"Guardar información"}</button></form>;
}

function AdminEditor({ admin, onCancel, onSave }: { admin: Admin | null; onCancel: () => void; onSave: (payload: Record<string, unknown>) => Promise<void> }) {
  const [error,setError]=useState(""); const [saving,setSaving]=useState(false);
  const submit=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();setSaving(true);setError("");const form=new FormData(event.currentTarget);const payload:Record<string,unknown>={name:form.get("name"),email:form.get("email"),isActive:form.get("isActive")==="on"};const password=String(form.get("password")??"");if(password)payload.password=password;try{await onSave(payload);}catch(reason){setError((reason as Error).message);}finally{setSaving(false);}};
  return <form className="inline-editor" onSubmit={submit}><div className="form-grid"><label>Nombre<input name="name" defaultValue={admin?.name ?? ""} required/></label><label>Correo<input name="email" type="email" defaultValue={admin?.email ?? ""} required/></label><label>{admin?"Nueva contraseña (opcional)":"Contraseña temporal"}<input name="password" type="password" minLength={8} required={!admin}/></label><label className="check-label"><input name="isActive" type="checkbox" defaultChecked={admin?.isActive ?? true}/><span>Cuenta activa</span></label></div>{error&&<div className="form-error">{error}</div>}<div className="form-actions"><button type="button" onClick={onCancel}>Cancelar</button><button className="primary" disabled={saving}>{saving?"Guardando…":admin?"Guardar cambios":"Crear administrador"}</button></div></form>;
}

function MemberEditor({ member, onCancel, onSave }: { member: Member | null; onCancel: () => void; onSave: (payload: Record<string, unknown>) => Promise<void> }) {
  const [error,setError]=useState(""); const [saving,setSaving]=useState(false);
  const submit=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();setSaving(true);setError("");const form=new FormData(event.currentTarget);const payload:Record<string,unknown>={ci:form.get("ci"),firstName:form.get("firstName"),lastName:form.get("lastName"),phone:form.get("phone"),address:form.get("address")};if(member)payload.status=form.get("status");try{await onSave(payload);}catch(reason){setError((reason as Error).message);}finally{setSaving(false);}};
  return <form className="inline-editor" onSubmit={submit}><div className="form-grid three"><label>Nombre<input name="firstName" defaultValue={member?.firstName ?? ""} required/></label><label>Apellidos<input name="lastName" defaultValue={member?.lastName ?? ""} required/></label><label>Carnet de identidad<input name="ci" inputMode="numeric" pattern="[0-9]{11}" maxLength={11} defaultValue={member?.ci ?? ""} required/></label><label>Teléfono<input name="phone" defaultValue={member?.phone ?? ""}/></label><label>Dirección<input name="address" defaultValue={member?.address ?? ""}/></label>{member&&<label>Estado<select name="status" defaultValue={member.status}><option value="ACTIVE">Activo</option><option value="INACTIVE">Inactivo</option></select></label>}</div>{error&&<div className="form-error">{error}</div>}<div className="form-actions"><button type="button" onClick={onCancel}>Cancelar</button><button className="primary" disabled={saving}>{saving?"Guardando…":member?"Guardar cambios":"Crear miembro"}</button></div></form>;
}

function ModalHead({ eyebrow, title, onClose }: { eyebrow: string; title: string; onClose: () => void }) {
  return <div className="modal-head"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><button type="button" aria-label="Cerrar" onClick={onClose}>×</button></div>;
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0,2).map(word=>word[0]).join("").toUpperCase();
}
