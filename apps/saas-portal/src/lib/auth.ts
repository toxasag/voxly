/** Auth headers for portal API calls. Content-Type is always set for JSON routes;
 * saas-api treats empty bodies as `{}` so DELETE/POST-without-body do not 400. */
export function authHeaders() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('voxly_token') : null;
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}
