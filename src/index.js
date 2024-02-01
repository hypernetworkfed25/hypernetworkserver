/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import apiRouter from './router';

const handleOptions = async (request) => {
  if (
    request.headers.get('Origin') !== null &&
    request.headers.get('Access-Control-Request-Method') !== null &&
    request.headers.get('Access-Control-Request-Headers') !== null
  ) {
    // Handle CORS preflight requests.
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
        'Access-Control-Max-Age': '86400',
        'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers'),
      },
    });
  } else {
    // Handle standard OPTIONS request.
    return new Response(null, {
      headers: {
        Allow: 'GET, HEAD, POST, OPTIONS',
      },
    });
  }
};

// Export a default object containing event handlers
export default {
  // The fetch handler is invoked when this worker receives a HTTP(S) request
  // and should return a Response (optionally wrapped in a Promise)
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      // Handle CORS preflight requests
      return handleOptions(request);
    }
    // You'll find it helpful to parse the request.url string into a URL object. Learn more at https://developer.mozilla.org/en-US/docs/Web/API/URL
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      const response = await apiRouter.handle(request, env, ctx);
      response.headers.set('Access-Control-Allow-Origin', '*');
      response.headers.append('Vary', 'Origin');
      response.headers.set('Content-Type', 'application/json');

      return Promise.resolve(response);
    }

    return new Response(
      `Try making requests to:
    <ul>
    <li><code><a href="/api/hypernetwork">/api/hypernetwork</a></code></li>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  },
};
