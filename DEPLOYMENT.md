# DevOrbit Deployment Guide

This guide explains how to deploy the DevOrbit landing page and dashboard separately.

## Architecture Overview

DevOrbit is built as a **multi-page Vite application** with two independently deployable components:

1. **Landing Page** (`landing.html`) - Marketing/promotional page with WebGL shaders
2. **Dashboard** (`dashboard.html`) - Full application with backend integration

## Development

### Running Locally

**Landing Page Only:**
```bash
npm run dev:landing
```
Access at: `http://localhost:3000/landing.html`

**Dashboard Only (with backend):**
```bash
npm run dev:dashboard
```
Access at: `http://localhost:3000/dashboard.html`

**Both Together:**
```bash
npm run dev
```

## Building for Production

### Build Both
```bash
npm run build
```
Output: `dist/` directory with both landing and dashboard

### Build Landing Page Only
```bash
npm run build:landing
```
Output: `dist/landing/index.html` and assets

### Build Dashboard Only
```bash
npm run build:dashboard
```
Output: `dist/dashboard/index.html` and assets

## Deployment Scenarios

### Scenario 1: Separate Hosting (Recommended)

Deploy landing and dashboard to different domains/subdomains:

**Landing Page:**
- Domain: `devorbit.com` or `landing.devorbit.com`
- Build: `npm run build:landing`
- Deploy: Upload `dist/` contents to static host (Vercel, Netlify, Cloudflare Pages)
- Size: ~1.2MB (includes Three.js, Framer Motion)

**Dashboard:**
- Domain: `app.devorbit.com`
- Build: `npm run build:dashboard`
- Deploy: Upload `dist/` contents + configure backend API
- Requires: Backend server running on separate instance

**Configuration:**
```bash
# Landing deployment (Vercel/Netlify)
npm run build:landing
# Deploy dist/ to landing.devorbit.com

# Dashboard deployment (with backend)
npm run build:dashboard
# Deploy dist/ to app.devorbit.com
# Deploy server/ to backend instance
```

### Scenario 2: Same Host, Different Paths

Serve both from the same domain with different paths:

**Build both:**
```bash
npm run build
```

**Server configuration (nginx example):**
```nginx
server {
    server_name devorbit.com;

    # Landing page at root
    location / {
        root /var/www/devorbit/landing;
        try_files $uri $uri/ /index.html;
    }

    # Dashboard at /app
    location /app {
        alias /var/www/devorbit/dashboard;
        try_files $uri $uri/ /app/index.html;
    }

    # API proxy
    location /api {
        proxy_pass http://localhost:3099;
    }
}
```

### Scenario 3: Static Landing + Dynamic Dashboard

Host landing page on CDN, dashboard on cloud platform:

**Landing (Cloudflare Pages / Vercel):**
```bash
npm run build:landing
# Auto-deploy on git push
```

**Dashboard (AWS / DigitalOcean / Railway):**
```bash
npm run build:dashboard
# Deploy with Docker
docker build -f Dockerfile -t devorbit-dashboard .
docker run -p 3000:3000 -p 3099:3099 devorbit-dashboard
```

## Environment Variables

### Landing Page
No environment variables required (static build).

### Dashboard
Required:
- `GEMINI_API_KEY` - For AI analysis features
- `NODE_ENV` - Set to `production`

Optional:
- `PORT` - Backend server port (default: 3099)
- `DATABASE_URL` - PostgreSQL connection string

Create `.env` file:
```bash
GEMINI_API_KEY=your_api_key_here
NODE_ENV=production
PORT=3099
```

## Security Configuration

### Content Security Policy (CSP)

Both the landing page and dashboard require specific CSP headers to function properly, especially for WebGL and inline styles.

#### Landing Page CSP Headers

The landing page uses WebGL shaders (Three.js) and requires the following CSP configuration:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'unsafe-eval';
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data: https:;
  connect-src 'self';
  worker-src 'self' blob:;
```

**Why these directives are needed:**
- `'unsafe-eval'` in `script-src`: Required by Three.js for shader compilation
- `'unsafe-inline'` in `style-src`: Required by Framer Motion for animation styles
- `blob:` in `worker-src`: Three.js may use Web Workers for performance

#### Dashboard CSP Headers

The dashboard requires WebSocket support and additional permissions:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'unsafe-eval';
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data: https:;
  connect-src 'self' ws: wss:;
  worker-src 'self' blob:;
```

**Additional requirements:**
- `ws:` and `wss:` in `connect-src`: Required for WebSocket connections to backend
- `'unsafe-eval'`: Required for terminal emulator and dynamic code execution features

#### Nginx Configuration Example

```nginx
server {
  server_name landing.devorbit.com;

  location / {
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; worker-src 'self' blob:;" always;

    # Other headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  }
}
```

#### Vercel/Netlify Configuration

**vercel.json:**
```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; worker-src 'self' blob:"
        }
      ]
    }
  ]
}
```

**netlify.toml:**
```toml
[[headers]]
  for = "/*"
  [headers.values]
    Content-Security-Policy = "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; worker-src 'self' blob:"
```

### Additional Security Headers

For both deployments, add these security headers:

```
X-Frame-Options: SAMEORIGIN
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

## Performance Considerations

### Landing Page
- **Bundle Size:** ~1.2MB uncompressed (Three.js heavy)
- **First Load:** May take 2-3s on slow connections
- **Optimization:** Consider lazy-loading Three.js components
- **CDN:** Recommended for global audience

### Dashboard
- **Bundle Size:** ~800KB + backend
- **Dependencies:** Requires WebSocket connection to backend
- **Scaling:** Use load balancer for multiple instances

## Deployment Checklist

### Landing Page Deployment
- [ ] Build with `npm run build:landing`
- [ ] Test all animations and shader effects
- [ ] Verify mobile responsiveness
- [ ] Check WebGL fallback for unsupported browsers
- [ ] Test CTA buttons link correctly
- [ ] Configure CDN caching (cache for 1 year, use cache busting)
- [ ] Set up custom domain
- [ ] Enable HTTPS
- [ ] Test loading performance (Lighthouse score)

### Dashboard Deployment
- [ ] Build with `npm run build:dashboard`
- [ ] Configure environment variables
- [ ] Deploy backend server
- [ ] Test WebSocket connections
- [ ] Verify API proxy configuration
- [ ] Test terminal functionality
- [ ] Configure CORS for API
- [ ] Set up database migrations
- [ ] Enable monitoring/logging
- [ ] Configure auto-scaling (if needed)

## Troubleshooting

### Landing Page Issues

**Shader not rendering:**
- Check browser WebGL support
- Open console for WebGL errors
- Ensure no CSP blocking canvas

**Fonts not loading:**
- Verify Google Fonts CDN is accessible
- Check network tab for font loading errors

### Dashboard Issues

**API connection failed:**
- Verify backend server is running
- Check CORS configuration
- Ensure WebSocket support in reverse proxy

**Terminal not working:**
- Check `node-pty` installation
- Verify pty-host process is running
- Check WebSocket connection to `/api`

## Cost Estimates

### Scenario 1: Fully Separated
- Landing (Vercel): Free tier (100GB bandwidth)
- Dashboard (Railway): $5-20/month
- Total: $5-20/month

### Scenario 2: Single VPS
- DigitalOcean Droplet: $6-12/month
- CloudFlare CDN: Free
- Total: $6-12/month

### Scenario 3: Enterprise
- AWS CloudFront (landing): ~$10/month
- AWS ECS (dashboard): ~$30-100/month
- AWS RDS (database): ~$15-50/month
- Total: $55-160/month

## Continuous Deployment

### GitHub Actions Example

```yaml
# .github/workflows/deploy-landing.yml
name: Deploy Landing Page
on:
  push:
    branches: [main]
    paths:
      - 'components/Landing/**'
      - 'landing.*'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run build:landing
      - uses: amondnet/vercel-action@v20
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.ORG_ID }}
          vercel-project-id: ${{ secrets.PROJECT_ID }}
```

## Support

For deployment issues:
- Check [GitHub Issues](https://github.com/hpmartini/DevHub/issues)
- Review CLAUDE.md for project-specific guidance
- Consult Vite documentation for build configuration

---

**Last Updated:** 2026-01-10
