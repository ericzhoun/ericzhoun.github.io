document.addEventListener('DOMContentLoaded', () => {
  const carousel = document.querySelector('.art-class-carousel');
  if (!carousel) return;

  const slides = Array.from(carousel.querySelectorAll('.art-class-carousel-slide'));
  if (slides.length < 2) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduceMotion.matches) return;

  let activeIndex = slides.findIndex((slide) => slide.classList.contains('is-active'));
  let timer = null;
  let isHovered = false;
  let isFocused = false;

  if (activeIndex < 0) activeIndex = 0;

  const showNextSlide = () => {
    slides[activeIndex].classList.remove('is-active');
    activeIndex = (activeIndex + 1) % slides.length;
    slides[activeIndex].classList.add('is-active');
  };

  const stopRotation = () => {
    if (timer) {
      window.clearInterval(timer);
      timer = null;
    }
  };

  const startRotation = () => {
    if (!timer && !isHovered && !isFocused) {
      timer = window.setInterval(showNextSlide, 5000);
    }
  };

  carousel.addEventListener('mouseenter', () => {
    isHovered = true;
    stopRotation();
  });

  carousel.addEventListener('mouseleave', () => {
    isHovered = false;
    startRotation();
  });

  carousel.addEventListener('focusin', () => {
    isFocused = true;
    stopRotation();
  });

  carousel.addEventListener('focusout', () => {
    isFocused = false;
    startRotation();
  });

  startRotation();
});
