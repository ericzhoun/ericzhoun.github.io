document.addEventListener('DOMContentLoaded', () => {
  const dialog = document.getElementById('portfolio-lightbox');
  const lightboxImg = document.getElementById('portfolio-lightbox-img');
  const closeBtn = document.getElementById('portfolio-lightbox-close');

  if (!dialog || !lightboxImg || !closeBtn) {
    return;
  }

  document.querySelectorAll('.portfolio-thumb').forEach((thumb) => {
    thumb.addEventListener('click', () => {
      const img = thumb.querySelector('img');
      lightboxImg.src = img.src;
      lightboxImg.alt = img.alt;
      dialog.showModal();
    });
  });

  closeBtn.addEventListener('click', () => {
    dialog.close();
  });

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });
});
