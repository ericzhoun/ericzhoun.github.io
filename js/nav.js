document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('nav-toggle');
  const nav = document.getElementById('site-nav');

  if (nav) {
    try {
      const user = JSON.parse(localStorage.getItem('olivistart_user') || 'null');
      const adminEmails = ['herfield8@gmail.com', 'lightbyolivia@gmail.com', 'olivistastudio@gmail.com'];
      if (user && adminEmails.includes(user.email) && !nav.querySelector('.nav-admin')) {
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
});
