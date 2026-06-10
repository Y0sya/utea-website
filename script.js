// Collapse the nav wordmark to "UTEA" once the page is scrolled.
(function () {
  var nav = document.querySelector(".nav");
  if (!nav) return;

  function onScroll() {
    nav.classList.toggle("is-scrolled", window.scrollY > 40);
  }

  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
})();
