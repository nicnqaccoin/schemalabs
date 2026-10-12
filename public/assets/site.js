const menuButton = document.querySelector('.menu-toggle');
const menu = document.querySelector('#site-nav');
menuButton?.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', String(open));
  menu?.classList.toggle('open', open);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menuButton?.getAttribute('aria-expanded') === 'true') {
    menuButton.setAttribute('aria-expanded', 'false');
    menu?.classList.remove('open');
    menuButton.focus();
  }
});
const tocLinks = [...document.querySelectorAll('.article-nav a[href^="#"]')];
if (tocLinks.length && 'IntersectionObserver' in window) {
  const sections = tocLinks.map(link => document.getElementById(link.hash.slice(1))).filter(Boolean);
  const mark = id => tocLinks.forEach(link => link.hash === '#' + id ? link.setAttribute('aria-current', 'true') : link.removeAttribute('aria-current'));
  const observer = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (visible) mark(visible.target.id);
  }, { rootMargin: '-80px 0px -65% 0px' });
  sections.forEach(section => observer.observe(section));
  if (sections[0]) mark(location.hash && document.getElementById(location.hash.slice(1)) ? location.hash.slice(1) : sections[0].id);
}
