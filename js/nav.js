import { ADMIN_EMAILS } from './auth.js';

function initNav() {
  const toggle = document.getElementById('nav-toggle');
  const nav = document.getElementById('site-nav');

  if (nav) {
    try {
      const user = JSON.parse(localStorage.getItem('olivistart_user') || 'null');
      if (user && ADMIN_EMAILS.includes(user.email) && !nav.querySelector('.nav-admin')) {
        const adminLink = document.createElement('a');
        adminLink.href = 'admin.html';
        adminLink.className = 'nav-admin';
        adminLink.textContent = 'Admin CMS';
        nav.appendChild(adminLink);
      }
    } catch {
      // Ignore malformed local account data. The user can sign in again.
    }
  }

  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const isOpen = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(isOpen));
    });
  }
}

// Module scripts are deferred, so DOMContentLoaded has usually not fired yet -
// but guard anyway so the nav still builds if this ever loads late.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initNav);
} else {
  initNav();
}
