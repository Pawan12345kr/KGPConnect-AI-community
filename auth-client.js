// Shared KGPConnect Auth & API Bridge (works on both http://localhost:3000 and file://)
(function () {
  const IS_FILE_PROTOCOL = window.location.protocol === 'file:';
  const API_ORIGIN = IS_FILE_PROTOCOL ? 'http://localhost:3000' : '';
  const originalFetch = window.fetch.bind(window);

  window.getStoredKgpUser = function () {
    try {
      const raw = localStorage.getItem('kgp-user') || localStorage.getItem('kgp_user');
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  };

  window.setStoredKgpUser = function (user) {
    try {
      if (user) {
        const serialized = JSON.stringify(user);
        localStorage.setItem('kgp-user', serialized);
        localStorage.removeItem('kgp_user');
      } else {
        localStorage.removeItem('kgp-user');
        localStorage.removeItem('kgp_user');
      }
    } catch (e) {}
  };

  window.fetch = async function (input, init = {}) {
    let url = typeof input === 'string' ? input : input.url;
    if (typeof url === 'string' && url.startsWith('/api/')) {
      url = API_ORIGIN + url;
    }

    const headers = new Headers(init.headers || {});
    if (IS_FILE_PROTOCOL) {
      const storedUser = window.getStoredKgpUser();
      if (storedUser && storedUser.id) {
        headers.set('x-user-id', String(storedUser.id));
      }
    }

    const finalInit = {
      ...init,
      headers,
      credentials: 'include',
      cache: 'no-store',
    };

    const response = await originalFetch(url, finalInit);

    // Clone response to inspect auth payloads and keep localStorage in sync
    try {
      const clone = response.clone();
      if (url.includes('/api/auth/logout') && response.ok) {
        window.setStoredKgpUser(null);
      } else if (url.includes('/api/auth/me') && !response.ok) {
        window.setStoredKgpUser(null);
      } else if (
        (url.includes('/api/auth/') || url.includes('/api/user/dashboard')) &&
        response.ok
      ) {
        const data = await clone.json();
        if (data && data.user) {
          window.setStoredKgpUser(data.user);
        }
      }
    } catch (e) {}

    return response;
  };
})();
