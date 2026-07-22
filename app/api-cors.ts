const allowedOrigins = new Set([
  "https://avernus990.github.io",
  "http://localhost:4173",
]);

function getAllowedOrigin(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  return allowedOrigins.has(origin.toLowerCase()) ? origin : null;
}

export function withCors(request: Request, response: Response) {
  const origin = getAllowedOrigin(request);
  if (!origin) return response;

  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  headers.set("Access-Control-Max-Age", "86400");
  headers.append("Vary", "Origin");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function corsPreflight(request: Request) {
  const origin = getAllowedOrigin(request);
  if (!origin) return new Response(null, { status: 403 });
  return withCors(request, new Response(null, { status: 204 }));
}
