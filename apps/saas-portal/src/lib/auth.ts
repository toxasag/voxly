export function authHeaders() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('voxly_token') : null;
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}
