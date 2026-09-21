const AVIF_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const AVIF_CONTENT_TYPE = 'image/avif';
const AVIF_QUALITY = 80;
const MAX_PREFIX_LENGTH = 512;

export function avifKeyFor(key) {
  return key.replace(/\.jpe?g$/i, '.avif');
}

export function isJpegKey(key) {
  return typeof key === 'string' && /\.jpe?g$/i.test(key);
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function authorized(request, env) {
  if (!env.CONVERTER_TOKEN) return false;
  return request.headers.get('Authorization') === `Bearer ${env.CONVERTER_TOKEN}`;
}

async function responseFromImageOutput(output) {
  if (!output || typeof output.response !== 'function') {
    throw new Error('Images binding returned an invalid output');
  }
  const response = await output.response();
  if (!response?.ok || !response.body) {
    throw new Error(`Images binding failed${response?.status ? ` (${response.status})` : ''}`);
  }
  return response;
}

export async function convertOne(object, env) {
  const avifKey = avifKeyFor(object.key);
  const result = { key: object.key, avifKey, size: object.size ?? null };

  try {
    if (await env.R2.head(avifKey)) {
      result.status = 'skipped';
      console.log(JSON.stringify({ event: 'avif-skip', key: object.key, avifKey }));
      return result;
    }

    const original = await env.R2.get(object.key);
    if (!original?.body) throw new Error('Original object was not found or has no body');

    const output = await env.IMAGES
      .input(original.body)
      .output({ format: AVIF_CONTENT_TYPE, quality: AVIF_QUALITY });
    const transformed = await responseFromImageOutput(output);

    await env.R2.put(avifKey, transformed.body, {
      httpMetadata: {
        contentType: AVIF_CONTENT_TYPE,
        cacheControl: AVIF_CACHE_CONTROL,
      },
    });

    result.status = 'converted';
    console.log(JSON.stringify({ event: 'avif-converted', key: object.key, avifKey }));
  } catch (error) {
    result.status = 'error';
    result.error = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ event: 'avif-error', key: object.key, avifKey, error: result.error }));
  }

  return result;
}

export async function convertPrefix(prefix, env) {
  const results = [];
  let cursor;
  let pages = 0;

  do {
    const options = { prefix };
    if (cursor) options.cursor = cursor;
    const page = await env.R2.list(options);
    pages += 1;

    for (const object of page.objects || []) {
      if (!isJpegKey(object.key)) continue;
      results.push(await convertOne(object, env));
    }

    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return { prefix, pages, scanned: results.length, results };
}

export default {
  async fetch(request, env) {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    if (!env.R2?.list || !env.R2?.head || !env.R2?.get || !env.R2?.put || !env.IMAGES?.input) {
      return json({ error: 'R2 or Images binding is not configured' }, 503);
    }
    if (!env.CONVERTER_TOKEN) return json({ error: 'CONVERTER_TOKEN is not configured' }, 503);
    if (!authorized(request, env)) return json({ error: 'Unauthorized' }, 401);

    const prefix = new URL(request.url).searchParams.get('prefix') || '';
    if (prefix.length > MAX_PREFIX_LENGTH) return json({ error: 'prefix is too long' }, 400);

    console.log(JSON.stringify({ event: 'avif-batch-start', prefix }));
    try {
      const summary = await convertPrefix(prefix, env);
      const counts = summary.results.reduce((value, item) => {
        value[item.status] = (value[item.status] || 0) + 1;
        return value;
      }, {});
      const response = { ...summary, counts };
      console.log(JSON.stringify({ event: 'avif-batch-complete', prefix, pages: summary.pages, counts }));
      return json(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ event: 'avif-batch-error', prefix, error: message }));
      return json({ error: 'Batch conversion failed', message }, 500);
    }
  },
};
