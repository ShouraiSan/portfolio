const media = new Map([
  ['2026japan_tour.mp4', '2026japan_tour.mp4'],
  ['Hokkaidou_tour（4k）.mp4', 'Hokkaidou_tour（4k）.mp4'],
  ['KANSAI(4k).mp4', 'KANSAI(4k).mp4'],
  ['未知彼时花开名.mp4', '未知彼时花开名.mp4'],
]);

function trustedOrigins(env) {
  return (env.ALLOWED_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function requestOrigin(value) {
  try {
    return value ? new URL(value).origin : null;
  } catch {
    return null;
  }
}

function corsHeaders(origin, allowed) {
  return origin && allowed.includes(origin) ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range, ETag',
    'Vary': 'Origin',
  } : {};
}

function isTrustedMediaRequest(request, allowed) {
  const origin = request.headers.get('Origin');
  const refererOrigin = requestOrigin(request.headers.get('Referer'));

  // Require a browser-originated request from a known site. A present Origin
  // must also match, which rejects requests manually forged from another site.
  return Boolean(refererOrigin && allowed.includes(refererOrigin))
    && (!origin || allowed.includes(origin));
}

function portfolioUrl(request, env) {
  const site = new URL(env.PORTFOLIO_ORIGIN);
  const requestUrl = new URL(request.url);
  const path = requestUrl.pathname === '/' ? '' : requestUrl.pathname.replace(/^\//, '');
  return new URL(path + requestUrl.search, site);
}

export default {
  async fetch(request, env) {
    const allowed = trustedOrigins(env);
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin, allowed);
    if (request.method === 'OPTIONS') {
      return allowed.includes(origin)
        ? new Response(null, { status: 204, headers: cors })
        : new Response('Forbidden', { status: 403 });
    }
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });

    const url = new URL(request.url);
    if (!url.pathname.startsWith('/media/')) {
      const upstream = await fetch(portfolioUrl(request, env), {
        method: request.method,
        headers: { 'User-Agent': 'Kensym Portfolio Worker' },
      });
      const headers = new Headers(upstream.headers);
      headers.set('Cache-Control', 'public, max-age=300');
      return new Response(request.method === 'HEAD' ? null : upstream.body, {
        status: upstream.status,
        headers,
      });
    }

    if (!isTrustedMediaRequest(request, allowed)) return new Response('Forbidden', { status: 403 });
    const slug = decodeURIComponent(url.pathname.replace(/^\/media\/?/, ''));
    const key = media.get(slug);
    if (!key) return new Response('Not found', { status: 404, headers: cors });

    const object = await env.MEDIA.get(key, { range: request.headers });
    if (!object) return new Response('Not found', { status: 404, headers: cors });

    const headers = new Headers(cors);
    object.writeHttpMetadata(headers);
    headers.set('ETag', object.httpEtag);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', 'public, max-age=3600');
    headers.set('X-Content-Type-Options', 'nosniff');

    const range = object.range;
    if (range) {
      headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
      headers.set('Content-Length', String(range.length));
    } else {
      headers.set('Content-Length', String(object.size));
    }

    return new Response(request.method === 'HEAD' ? null : object.body, {
      status: range ? 206 : 200,
      headers,
    });
  },
};
