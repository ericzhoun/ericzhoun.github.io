document.addEventListener('DOMContentLoaded', () => {
  const carousel = document.querySelector('.art-class-carousel');
  if (!carousel) return;

  const slides = Array.from(carousel.querySelectorAll('.art-class-carousel-slide'));
  if (slides.length < 2) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let activeIndex = slides.findIndex((slide) => slide.classList.contains('is-active'));
  if (activeIndex < 0) activeIndex = 0;

  let timer = null;
  let isHovered = false;
  let isFocused = false;

  // Navigation buttons (left/right padding click targets)
  const prevBtn = carousel.querySelector('.art-class-carousel-prev');
  const nextBtn = carousel.querySelector('.art-class-carousel-next');

  // Create or select dots container
  let dotsContainer = carousel.querySelector('.art-class-carousel-dots');
  if (!dotsContainer) {
    dotsContainer = document.createElement('div');
    dotsContainer.className = 'art-class-carousel-dots';
    dotsContainer.setAttribute('role', 'tablist');
    dotsContainer.setAttribute('aria-label', 'Slide navigation');
    carousel.appendChild(dotsContainer);
  }
  dotsContainer.innerHTML = '';

  const dots = slides.map((_, index) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'art-class-carousel-dot' + (index === activeIndex ? ' is-active' : '');
    dot.setAttribute('aria-label', `Go to slide ${index + 1}`);
    if (index === activeIndex) {
      dot.setAttribute('aria-current', 'true');
    }
    dot.addEventListener('click', () => {
      goToSlide(index);
    });
    dotsContainer.appendChild(dot);
    return dot;
  });

  const goToSlide = (newIndex) => {
    if (newIndex === activeIndex) return;

    slides[activeIndex].classList.remove('is-active');
    if (dots[activeIndex]) {
      dots[activeIndex].classList.remove('is-active');
      dots[activeIndex].removeAttribute('aria-current');
    }

    activeIndex = (newIndex + slides.length) % slides.length;

    slides[activeIndex].classList.add('is-active');
    if (dots[activeIndex]) {
      dots[activeIndex].classList.add('is-active');
      dots[activeIndex].setAttribute('aria-current', 'true');
    }
  };

  if (prevBtn) {
    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      goToSlide(activeIndex - 1);
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      goToSlide(activeIndex + 1);
    });
  }

  const showNextSlide = () => {
    goToSlide(activeIndex + 1);
  };

  const stopRotation = () => {
    if (timer) {
      window.clearInterval(timer);
      timer = null;
    }
  };

  const startRotation = () => {
    if (!timer && !isHovered && !isFocused && !reduceMotion.matches) {
      timer = window.setInterval(showNextSlide, 6000);
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
