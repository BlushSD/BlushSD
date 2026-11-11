// Blush SD — tiny helper in front of the website files.
// Only runs for the homepage address ("/"), which it serves from index.html.
// Every other address (about.html, images, ...) is served directly by Cloudflare.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/') {
      url.pathname = '/index.html';
      return env.ASSETS.fetch(new Request(url.toString(), request));
    }
    return env.ASSETS.fetch(request);
  }
};
