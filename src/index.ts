export interface Env {}

export function health(): { ok: true; app: string } {
  return { ok: true, app: 'cesta-compra' };
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json(health());
    return new Response('cesta-compra: under construction', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
} satisfies ExportedHandler<Env>;
