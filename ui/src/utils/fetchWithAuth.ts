/**
 * Helper to make authenticated fetch requests.
 * Uses sessionStorage so closing the window = logout (password required again).
 */
export const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
  const token = sessionStorage.getItem('authToken');
  const headers = new Headers(options.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(url, { ...options, headers });
};
