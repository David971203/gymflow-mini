import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
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

test("server-renders the GymFlow Mini login", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>GymFlow Mini \| Plataforma<\/title>/i);
  assert.match(html, /Panel del superadministrador/);
  assert.match(html, /Explorar demostraci(?:ó|&oacute;)n/);
  assert.match(html, /super@gymflowmini\.cu/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("keeps the product metadata and API integration configured", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /NEXT_PUBLIC_API_URL/);
  assert.match(page, /\/platform\/overview/);
  assert.match(page, /\/platform\/gyms/);
  assert.match(page, /\/admins/);
  assert.match(page, /\/members/);
  assert.match(page, /Gestión de gimnasio/i);
  assert.match(page, /Guardar información/);
  assert.match(page, /gymflow_mini_super_token/);
  assert.match(layout, /title:\s*"GymFlow Mini \| Plataforma"/);
  assert.match(layout, /images:\s*\["\/og\.png"\]/);
  assert.match(packageJson, /"build": "vinext build"/);
  assert.doesNotMatch(page + layout, /codex-preview|_sites-preview|SkeletonPreview/);
});
