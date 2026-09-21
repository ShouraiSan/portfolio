# R2 JPG to AVIF batch converter

This is a separate admin Worker. It reads JPG/JPEG objects from the `photo` R2 bucket, writes an AVIF beside each source object, and keeps the original JPG unchanged.

## Deploy

From this directory:

```powershell
cd E:\codex\个人网站\image-converter
pnpm exec wrangler login
pnpm exec wrangler secret put CONVERTER_TOKEN --config wrangler.toml
pnpm exec wrangler deploy --config wrangler.toml
```

The token is required for every conversion request. Keep it private and send it in an `Authorization` header; do not put it in a URL.

## Trigger a conversion

After deployment, use the Worker URL and an optional `prefix`:

```powershell
$token = 'replace-with-your-token'
$headers = @{ Authorization = "Bearer $token" }

Invoke-RestMethod `
  -Method Get `
  -Headers $headers `
  -Uri 'https://photo-avif-batch.<your-subdomain>.workers.dev/?prefix=photos/'
```

Omit `?prefix=photos/` to scan the whole bucket.

The response contains `converted`, `skipped`, or `error` for every JPG/JPEG object. Existing AVIF files are detected with `R2.head()` and skipped, so running the request again does not convert them again. Files are written next to their source:

```text
photos/xxx.jpg   -> photos/xxx.avif
```

AVIF objects are stored with `Content-Type: image/avif` and a one-year immutable cache policy. The frontend can reference the AVIF key for a thumbnail and keep the JPG key for the full-size viewer.

## Local verification

```powershell
cd E:\codex\个人网站
node --test image-converter/test/*.test.js
pnpm exec wrangler deploy --config image-converter/wrangler.toml --dry-run
```

Cloudflare Images Binding accepts image inputs up to its documented size limit. An oversized or invalid source is reported as `error` for that file while the remaining files continue processing.
