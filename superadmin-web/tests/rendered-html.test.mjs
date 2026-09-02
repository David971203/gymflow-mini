import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the session gate without flashing the login", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>GymFlow Mini \| Plataforma<\/title>/i);
  assert.match(html, /Comprobando sesi(?:ó|&oacute;)n/);
  assert.doesNotMatch(html, /Panel del superadministrador/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("keeps the product metadata and API integration configured", async () => {
  const [page, gymsRoute, layout, styles, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/gimnasios/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /NEXT_PUBLIC_API_URL/);
  assert.match(page, /\/platform\/overview/);
  assert.match(page, /aria-label="Buscar solicitudes de planes"/);
  assert.match(page, /filteredRequests/);
  assert.match(page, /\/platform\/gyms/);
  assert.match(page, /\/admins/);
  assert.match(page, /\/members/);
  assert.match(page, /\/plans/);
  assert.match(page, /\/memberships/);
  assert.match(page, /\/payments/);
  assert.match(page, /\/finances/);
  assert.match(page, />Cobros/);
  assert.match(page, />Finanzas</);
  assert.match(page, /Procesar pago/);
  assert.match(page, /Confirmar pago/);
  assert.match(page, /Deuda vencida/);
  assert.match(page, /Movimientos recientes/);
  assert.match(page, /Gestión de gimnasio/i);
  assert.match(page, /Guardar información/);
  assert.match(page, /Oferta comercial disponible/);
  assert.match(page, /Edita directamente la membresía existente/);
  assert.match(page, /Guardar membresía/);
  assert.match(page, /hasActiveMembership/);
  assert.match(page, /Los abonos existentes no se modifican/);
  assert.doesNotMatch(page, /Programar cambio|programará el nuevo plan|\/renew/);
  assert.match(page, /method:\s*"DELETE"/);
  assert.match(page, />Eliminar<\/button>/);
  assert.match(page, /Eliminar registro/);
  assert.match(page, /confirm-backdrop/);
  assert.doesNotMatch(page, /window\.confirm/);
  assert.doesNotMatch(page, /Si tiene historial en GymFlow/);
  assert.match(page, /tone:\s*"success"/);
  assert.match(page, /tone:\s*"error"/);
  assert.match(styles, /\.notice\.success/);
  assert.match(styles, /\.notice\.error/);
  assert.match(page, /gymflow_mini_super_token/);
  assert.match(page, /sessionReady/);
  assert.match(page, /history\.pushState/);
  assert.match(page, /gymflow_mini_super_demo/);
  assert.match(page, /\(clientPath \|\| pathname\) === "\/gimnasios"/);
  assert.match(page, /href="\/gimnasios"/);
  assert.match(page, /!isGymsPage &&/);
  assert.match(page, /isGymsPage && <article className="panel gym-table"/);
  assert.match(gymsRoute, /default.*"\.\.\/page"/);
  assert.match(layout, /title:\s*"GymFlow Mini \| Plataforma"/);
  assert.match(layout, /images:\s*\["\/og\.png"\]/);
  assert.match(packageJson, /"build": "vinext build"/);
  assert.doesNotMatch(page + layout, /codex-preview|_sites-preview|SkeletonPreview/);
});

test("serves the dedicated gyms route locally", async () => {
  const response = await render("/gimnasios");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.match(await response.text(), /Comprobando sesi(?:ó|&oacute;)n/);
});
