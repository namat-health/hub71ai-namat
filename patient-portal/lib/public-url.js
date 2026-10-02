// Behind a proxy such as Azure App Service, `next start` reports request.url
// as http(s)://localhost:<port>, so take the public host from the Host header.
export function publicUrl(request, path) {
  const { protocol } = new URL(request.url);
  const host = request.headers.get("host");
  return new URL(path, host ? `${protocol}//${host}` : request.url);
}
