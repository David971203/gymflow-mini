"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight, BadgeCheck, Banknote, BellRing, CalendarDays, Check, Cloud,
  ChevronRight, CircleUserRound, Dumbbell, Facebook, Gauge, Heart, Instagram,
  Layers3, MapPin, Menu, MessageCircle, RefreshCw, Search, ShieldCheck, Smartphone,
  UserPlus, Users, Wifi,
  TrendingUp,
} from "lucide-react";
import Image from "next/image";

const features = [
  { icon: Users, tag: "PERSONAS", title: "Miembros organizados", copy: "Registra, busca y consulta el historial completo de cada miembro." },
  { icon: CalendarDays, tag: "PLANES", title: "Membresías claras", copy: "Controla planes activos, vencimientos y renovaciones sin perder fechas." },
  { icon: Banknote, tag: "FINANZAS", title: "Cobros bajo control", copy: "Registra pagos y abonos, conoce el saldo pendiente y revisa cada movimiento." },
  { icon: BellRing, tag: "ALERTAS", title: "Vencimientos a tiempo", copy: "Recibe avisos antes de que una membresía expire y actúa con anticipación." },
  { icon: Cloud, tag: "NUBE", title: "Datos sincronizados", copy: "Trabaja desde el móvil y mantén tu información actualizada al recuperar conexión." },
  { icon: Gauge, tag: "CONTROL", title: "Visión inmediata", copy: "Consulta ingresos, miembros activos y deuda desde un inicio pensado para decidir." },
];

const plans = [
  { id:"trial", tag:"Empieza aquí", name:"Prueba gratuita", price:"0", suffix:"CUP / 7 días", copy:"Conoce GymFlow Mini con todas las funciones disponibles.", features:["Miembros y planes", "Cobros y abonos", "Avisos de vencimiento", "Sin compromiso"], cta:"Descargar y comenzar" },
  { id:"monthly", tag:"Flexibilidad total", badge:"Más elegido", name:"Plan mensual", price:"5 000", suffix:"CUP / mes", copy:"Ideal para avanzar mes a mes con toda la potencia de GymFlow.", features:["Todas las funciones", "Datos siempre disponibles", "Actualizaciones incluidas", "Soporte por WhatsApp"], cta:"Descargar y elegir mensual", featured:true },
  { id:"annual", tag:"Ahorra 10 000 CUP", name:"Plan anual", price:"50 000", suffix:"CUP / año", copy:"La mejor inversión para gimnasios que piensan a largo plazo.", features:["Todo el plan mensual", "Dos meses de ahorro", "Precio fijo por un año", "Soporte por WhatsApp"], cta:"Descargar y elegir anual" },
];

function whatsappUrl(plan?: string) {
  const number = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "5358497886").replace(/\D/g, "");
  const message = plan
    ? `Hola, quiero información sobre el ${plan} de GymFlow Mini.`
    : "Hola, quiero conocer GymFlow Mini para administrar mi gimnasio.";
  return `https://api.whatsapp.com/send?${number ? `phone=${number}&` : ""}text=${encodeURIComponent(message)}`;
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <span className="brand"><Image src="/icon.png" alt="" width={42} height={42}/><span><strong>GymFlow</strong><small>MINI{compact ? "" : " · GESTIÓN SIMPLE"}</small></span></span>;
}

function StoreButton({ kind }: { kind:"google"|"apple" }) {
  const isGoogle = kind === "google";
  const url = isGoogle ? (process.env.NEXT_PUBLIC_GOOGLE_PLAY_URL || process.env.NEXT_PUBLIC_APK_URL) : process.env.NEXT_PUBLIC_APP_STORE_URL;
  return <a className="store-button" href={url || "#descargar"} aria-label={isGoogle ? "Descargar en Google Play" : "Descargar en App Store"}>
    <Smartphone size={22}/><span><small>{isGoogle ? "DESCÁRGALA EN" : "DISPONIBLE EN"}</small><strong>{isGoogle ? "Google Play" : "App Store"}</strong></span>
  </a>;
}

function DashboardPreview({ large = false }: { large?: boolean }) {
  if (large) return <ShowcaseCarousel/>;
  return <div className={`dashboard-preview ${large ? "dashboard-large" : ""}`}>
    <div className="dash-top"><span><i/><i/><i/></span><b>GYMFLOW MINI</b><span className="dash-online"><Wifi size={12}/> En línea</span></div>
    <div className="dash-body">
      {large && <aside><Brand compact/><nav><span className="active"><Gauge/>Inicio</span><span><Users/>Miembros</span><span><Layers3/>Planes</span><span><Banknote/>Finanzas</span></nav><small>ADMINISTRACIÓN</small></aside>}
      <div className="dash-main">
        <div className="dash-greeting"><span><small>BUENOS DÍAS</small><strong>Habana Fitness</strong></span><span className="date-pill">AGOSTO 2026</span></div>
        <div className="metric-row"><article className="income-card"><small>INGRESOS DEL MES</small><strong>10,000 CUP</strong><span>Dinero realmente cobrado</span></article><article><small>MIEMBROS</small><strong>128</strong><span>+8 este mes</span></article><article><small>ACTIVAS</small><strong>94</strong><span>73% del total</span></article></div>
        <div className="dash-lower"><article><header><strong>Últimos cobros</strong><small>Ver todos</small></header><p><span className="avatar">DG</span><b>Daniel González<small>Plan mensual</small></b><strong>+ 1,500 CUP</strong></p><p><span className="avatar">AM</span><b>Ana Martínez<small>Plan trimestral</small></b><strong>+ 3,000 CUP</strong></p></article><article className="expiring"><header><strong>Por vencer</strong><small>10 días</small></header><div><BellRing/><b>6 membresías<small>requieren atención</small></b></div><span className="progress"><i/></span></article></div>
      </div>
    </div>
  </div>;
}

function HomeShowcaseSlide() {
  const navItems = [
    { label:"Inicio", icon:Gauge, active:true },
    { label:"Miembros", icon:Users },
    { label:"Planes", icon:Layers3 },
    { label:"Caja", icon:Banknote },
  ];
  return <div className="app-screen home-showcase-screen">
    <div className="home-showcase-body">
      <header className="home-showcase-header"><span><small>HABANA FITNESS</small><strong>Inicio</strong></span><i>GF</i></header>
      <div className="home-showcase-sync"><span><i/>Datos al día</span><strong><RefreshCw/>Sincronizar</strong></div>
      <div className="home-showcase-income"><small>INGRESOS DE AGOSTO</small><strong>10,000 CUP</strong><span>Dinero realmente cobrado</span></div>
      <div className="home-showcase-metrics"><article><small>Miembros</small><strong>3</strong></article><article><small>Membresías activas</small><strong>3</strong></article><article className="wide"><small>Por cobrar</small><strong>0 CUP</strong></article></div>
      <div className="home-showcase-expiring"><span><BellRing/></span><div><strong>Membresías próximas a vencer</strong><small>En los próximos 10 días</small></div><b>0</b></div>
      <div className="home-showcase-payments"><span><strong>Últimos cobros</strong><small>Movimientos registrados por el gimnasio</small></span><article><i>DG</i><b>Daniel Gonzales<small>Plan mensual</small></b><strong>+ 1,500 CUP</strong></article></div>
    </div>
    <nav className="home-showcase-nav">{navItems.map(({label,icon:Icon,active})=><span className={active?"active":undefined} key={label}><Icon/><small>{label}</small></span>)}</nav>
  </div>;
}

function MembersShowcaseSlide() {
  const filters = [["Todos","3"],["Activos","3"],["Inactivos","0"],["Por vencer","0"],["Vencidas","0"]];
  const members = [
    { initials:"AP", name:"Alejandro Pérez", ci:"90010112345", plan:"Mensual · Activa" },
    { initials:"DG", name:"Daniel Gonzales", ci:"01112270425", plan:"Quincenal · Activa" },
    { initials:"DB", name:"David Ernesto Becerra", ci:"97120310764", plan:"Mensual · Activa" },
  ];
  const navItems = [
    { label:"Inicio", icon:Gauge },
    { label:"Miembros", icon:Users, active:true },
    { label:"Planes", icon:Layers3 },
    { label:"Caja", icon:Banknote },
    { label:"Cuenta", icon:CircleUserRound },
  ];
  return <div className="app-screen members-showcase-screen">
    <div className="members-showcase-body">
      <header className="home-showcase-header"><span><small>HABANA FITNESS</small><strong>Miembros</strong></span><i>GF</i></header>
      <div className="home-showcase-sync"><span><i/>Datos al día</span><strong><RefreshCw/>Sincronizar</strong></div>
      <button className="members-showcase-add" type="button"><UserPlus/>Registrar miembro</button>
      <div className="members-showcase-search"><Search/><span>Nombre, código, CI o teléfono</span></div>
      <div className="members-showcase-filters">{filters.map(([label,count],index)=><span className={index===0?"active":undefined} key={label}>{label}<b>{count}</b></span>)}</div>
      <div className="members-showcase-heading"><strong>3 miembros</strong><small>Toca un miembro para ver sus opciones</small></div>
      <div className="members-showcase-list">{members.map(member=><article key={member.ci}><i>{member.initials}</i><span><strong>{member.name}</strong><small>CI {member.ci}</small><em><b/> {member.plan}</em></span><ChevronRight/></article>)}</div>
    </div>
    <nav className="members-showcase-nav">{navItems.map(({label,icon:Icon,active})=><span className={active?"active":undefined} key={label}><Icon/><small>{label}</small></span>)}</nav>
  </div>;
}

function CashShowcaseSlide() {
  const navItems = [
    { label:"Inicio", icon:Gauge },
    { label:"Miembros", icon:Users },
    { label:"Planes", icon:Layers3 },
    { label:"Caja", icon:Banknote, active:true },
    { label:"Cuenta", icon:CircleUserRound },
  ];
  return <div className="app-screen cash-showcase-screen">
    <div className="cash-showcase-body">
      <header className="home-showcase-header"><span><small>HABANA FITNESS</small><strong>Caja</strong></span><i>GF</i></header>
      <div className="home-showcase-sync"><span><i/>Datos al día</span><strong><RefreshCw/>Sincronizar</strong></div>
      <div className="cash-showcase-heading"><strong>Cobros</strong><small>Mostrando todos los períodos</small></div>
      <div className="cash-showcase-list">
        <article className="cash-card paid">
          <header><span><strong>Daniel Gonzales</strong><small>Quincenal</small></span><b>Pagado</b></header>
          <div className="cash-amounts"><span><small>PAGADO</small><strong>2,500 CUP</strong></span><span><small>TOTAL</small><strong>2,500 CUP</strong></span></div>
          <i className="cash-progress"/>
          <div className="cash-operations"><small>OPERACIONES</small><p><strong>Abono 2,500 CUP</strong><span>28/08/2026, 4:20 p.m.</span></p></div>
        </article>
        <article className="cash-card cancelled">
          <header><span><strong>Daniel Gonzales</strong><small>Trimestral</small></span><b>Cancelado</b></header>
          <div className="cash-amounts"><span><small>PAGO ANULADO</small><strong>9,000 CUP</strong></span><span><small>IMPORTE CANCELADO</small><strong>9,000 CUP</strong></span></div>
          <i className="cash-progress"/>
          <div className="cash-operations"><small>OPERACIONES</small><p><strong>Abono 4,000 CUP</strong><span>28/08/2026, 2:46 a.m.</span></p></div>
        </article>
      </div>
    </div>
    <nav className="members-showcase-nav">{navItems.map(({label,icon:Icon,active})=><span className={active?"active":undefined} key={label}><Icon/><small>{label}</small></span>)}</nav>
  </div>;
}

function ShowcaseCarousel() {
  const slides = [
    { title: "Inicio", custom:"home", kicker: "", value: "", detail: "", cards: [] as string[][] },
    { title: "Miembros", custom:"members", kicker: "", value: "", detail: "", cards: [] as string[][] },
    { title: "Caja", custom:"cash", kicker: "", value: "", detail: "", cards: [] as string[][] },
  ];
  const [active, setActive] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setActive((current) => (current + 1) % slides.length), 5000);
    return () => window.clearInterval(timer);
  }, [slides.length]);
  return <div className="showcase-carousel" aria-label="Pantallas de GymFlow Mini">
    <div className="carousel-track" style={{ transform: `translateX(-${active * 100}%)` }}>
      {slides.map((slide) => <div className="carousel-slide" key={slide.title}>
        {slide.custom === "home" ? <HomeShowcaseSlide/> : slide.custom === "members" ? <MembersShowcaseSlide/> : <CashShowcaseSlide/>}
      </div>)}
    </div>
    <div className="carousel-controls"><button type="button" onClick={() => setActive((active - 1 + slides.length) % slides.length)} aria-label="Pantalla anterior">←</button><div>{slides.map((slide, index) => <button type="button" className={index === active ? "active" : ""} onClick={() => setActive(index)} aria-label={`Ver pantalla ${slide.title}`} key={slide.title}/>)}</div><button type="button" onClick={() => setActive((active + 1) % slides.length)} aria-label="Pantalla siguiente">→</button></div>
  </div>;
}

export default function Home() {
  const instagram = process.env.NEXT_PUBLIC_INSTAGRAM_URL;
  const facebook = process.env.NEXT_PUBLIC_FACEBOOK_URL;
  const appDownloadUrl = process.env.NEXT_PUBLIC_APK_URL || process.env.NEXT_PUBLIC_GOOGLE_PLAY_URL || "#descargar";
  return <main>
    <header className="site-header"><Brand/><nav><a href="#producto">Producto</a><a href="#funciones">Funciones</a><a href="#nosotros">Nosotros</a><a href="#planes">Planes</a></nav><a className="nav-cta" href="#planes">Probar 7 días gratis <ArrowRight size={17}/></a><a className="mobile-menu" href="#planes" aria-label="Ver planes"><Menu/></a></header>

    <section className="hero" id="producto">
      <div className="hero-glow"/>
      <div className="hero-copy"><span className="eyebrow light"><i/>GESTIÓN HECHA PARA TU RITMO</span><h1>Tu gimnasio,<br/>bajo control.</h1><p>Miembros, membresías, cobros y vencimientos en una sola aplicación. Menos papeleo, más tiempo para hacer crecer tu comunidad.</p><div className="hero-actions"><a className="button lime" href="#planes">Comenzar gratis <ArrowRight/></a><a className="button ghost" href="#funciones">Conocer la app</a></div><span className="trust"><BadgeCheck/>7 días sin costo · Sin compromisos</span><div className="stores"><StoreButton kind="google"/><StoreButton kind="apple"/></div></div>
      <div className="hero-stage"><div className="lime-disc"/><DashboardPreview/><div className="phone-preview" aria-label="Vista conceptual de GymFlow Mini en un teléfono">
        <div className="phone-speaker"/>
        <div className="phone-header"><span><small>PANEL PRINCIPAL</small><strong>Buen día</strong></span><i>GF</i></div>
        <div className="phone-balance"><small>COBRADO ESTE MES</small><strong>248 500 CUP</strong><span><TrendingUp/>+12% frente al mes anterior</span></div>
        <div className="phone-metrics"><article><small>Activos</small><strong>128</strong></article><article><small>Por vencer</small><strong>6</strong></article></div>
        <div className="phone-members"><article><i>ME</i><span><strong>María Elena</strong><small>Plan mensual · Activo</small></span></article><article><i>CM</i><span><strong>Carlos Mena</strong><small>Plan anual · Activo</small></span></article></div>
      </div></div>
    </section>

    <section className="proof-strip"><div><span className="eyebrow">UNA OPERACIÓN MÁS CLARA</span><h2>Lo importante, visible en segundos.</h2></div><div className="proof-items"><article><span><Users/></span><div><strong>Todos</strong><small>tus miembros organizados</small></div></article><article><span><Layers3/></span><div><strong>1 app</strong><small>miembros, planes y cobros</small></div></article><article><span><Wifi/></span><div><strong>Siempre</strong><small>actualizada con conexión</small></div></article></div></section>

    <section className="section features" id="funciones"><div className="section-heading"><div><span className="eyebrow">TODO LO QUE NECESITAS</span><h2>Administra tu gimnasio sin perder el ritmo.</h2></div><p>Una experiencia pensada para operar rápido desde el móvil, con información clara para decidir mejor.</p></div><div className="feature-grid">{features.map(({icon:Icon,...feature})=><article key={feature.tag}><header><span><Icon/></span><small>{feature.tag}</small></header><h3>{feature.title}</h3><p>{feature.copy}</p></article>)}</div></section>

    <section className="showcase"><div className="showcase-visual"><DashboardPreview large/></div><div className="showcase-copy"><span className="eyebrow light">MÓVIL Y PANEL, UNA MISMA REALIDAD</span><h2>Control diario y visión de negocio.</h2><p>Opera desde la aplicación y mantén la administración central siempre al día. Cada cambio conectado se refleja sin fricciones.</p><div className="benefits"><span><RefreshCw/>Sincronización automática al recuperar conexión</span><span><ShieldCheck/>Información separada y segura por gimnasio</span><span><Smartphone/>Experiencia diseñada para usar con una mano</span><span><Gauge/>Indicadores claros para decidir rápidamente</span></div></div></section>

    <section className="about-download" id="nosotros"><article className="about-card"><span className="watermark">01</span><span className="square-icon"><Heart/></span><span className="eyebrow dark">QUIÉNES SOMOS</span><h2>Tecnología simple para gimnasios que quieren crecer.</h2><p>GymFlow Mini nace para convertir la gestión diaria en una tarea clara, rápida y confiable. Diseñamos desde las necesidades reales de los gimnasios cubanos.</p><span className="origin"><MapPin/>Creado en Cuba, pensado para tu comunidad.</span></article><article className="download-card" id="descargar"><span className="eyebrow">LLEVA GYMFLOW CONTIGO</span><h2>Tu operación cabe en la mano.</h2><p>Descarga la aplicación y gestiona miembros, planes y cobros desde donde estés.</p><div className="download-buttons"><StoreButton kind="google"/><StoreButton kind="apple"/></div><footer><span><small>SÍGUENOS</small><strong>Novedades y consejos</strong></span><span className="socials">{instagram ? <a href={instagram} aria-label="Instagram"><Instagram/></a> : <i><Instagram/></i>}{facebook ? <a href={facebook} aria-label="Facebook"><Facebook/></a> : <i><Facebook/></i>}</span></footer></article></section>

    <section className="section pricing" id="planes"><div className="section-heading"><div><span className="eyebrow">PLANES SIMPLES Y TRANSPARENTES</span><h2>Elige el ritmo que mejor funciona para ti.</h2></div><p>Descarga la app, crea tu cuenta y elige el plan dentro. Solo usamos WhatsApp para coordinar los pagos P2P.</p></div><div className="pricing-grid">{plans.map(plan=><article key={plan.id} className={plan.featured ? "featured" : ""}>{plan.badge&&<span className="popular">{plan.badge}</span>}<span className="plan-tag">{plan.tag}</span><h3>{plan.name}</h3><div className="price"><strong>{plan.price}</strong><small>{plan.suffix}</small></div><p>{plan.copy}</p><hr/><div className="plan-features">{plan.features.map(feature=><span key={feature}><Check/>{feature}</span>)}</div><a className="plan-cta" href={appDownloadUrl}><Smartphone/>{plan.cta}</a></article>)}</div></section>

    <footer className="site-footer"><div className="footer-top"><div className="footer-brand"><Brand/><h2>Menos papeleo.<br/>Más comunidad en movimiento.</h2><div className="footer-socials">{instagram ? <a href={instagram} aria-label="Instagram"><Instagram/></a> : <span><Instagram/></span>}{facebook ? <a href={facebook} aria-label="Facebook"><Facebook/></a> : <span><Facebook/></span>}<a href={whatsappUrl()} target="_blank" rel="noreferrer" aria-label="WhatsApp"><MessageCircle/></a></div></div><div className="footer-links"><div><strong>PRODUCTO</strong><a href="#funciones">Funciones</a><a href="#planes">Planes</a><a href="#descargar">Descargar</a><a href="#producto">Cómo funciona</a></div><div><strong>COMPAÑÍA</strong><a href="#nosotros">Quiénes somos</a><a href={whatsappUrl()} target="_blank" rel="noreferrer">Contacto</a><span>Privacidad</span><span>Términos</span></div><div><strong>HABLEMOS</strong><p>¿Quieres modernizar la gestión de tu gimnasio?</p><a className="footer-contact" href={whatsappUrl()} target="_blank" rel="noreferrer">Escríbenos por WhatsApp <ArrowRight/></a></div></div></div><div className="footer-bottom"><span>© 2026 GymFlow Mini. Todos los derechos reservados.</span><span>Diseñado para gimnasios cubanos.</span></div></footer>

    <a className="floating-whatsapp" href={whatsappUrl()} target="_blank" rel="noreferrer" aria-label="Consultar planes por WhatsApp"><span>¿Qué plan necesitas?</span><i><MessageCircle/></i></a>
  </main>;
}
