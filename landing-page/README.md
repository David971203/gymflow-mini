# GymFlow Mini Landing

Landing page de GymFlow Mini desarrollada con Next.js, TypeScript y CSS responsivo a partir de la maqueta de Wonder.

## Desarrollo local

```bash
npm install
npm run dev
```

Abre `http://localhost:3000`.

## Configuración

Copia `.env.example` como `.env.local` y completa:

- `NEXT_PUBLIC_SITE_URL`: dominio final de la landing.
- `NEXT_PUBLIC_WHATSAPP_NUMBER`: número de WhatsApp con código de país, sin signos.
- `NEXT_PUBLIC_GOOGLE_PLAY_URL`: enlace de Google Play.
- `NEXT_PUBLIC_APP_STORE_URL`: enlace de App Store.
- `NEXT_PUBLIC_INSTAGRAM_URL`: perfil de Instagram.
- `NEXT_PUBLIC_FACEBOOK_URL`: perfil de Facebook.

Si todavía no existen los enlaces de las tiendas, los botones llevan a la sección de descarga. Los botones de los planes preparan automáticamente un mensaje de WhatsApp con el plan elegido.

## Producción

```bash
npm run lint
npm run build
```

El proyecto usa `output: "export"`. La carpeta `out` resultante puede publicarse en Vercel, Netlify, Cloudflare Pages o un hosting estático. En Vercel también se puede importar directamente la carpeta del proyecto.
