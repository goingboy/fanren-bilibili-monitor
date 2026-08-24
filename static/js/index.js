/**
 * 凡人修仙传 · 首页逻辑（Task 2 存根：名句轮换；Task 3 完整重写）
 */
(function () {
    'use strict';
    const quotes = document.querySelectorAll('.quote');
    const dots = document.querySelectorAll('.quote-dot');
    if (!quotes.length) return;
    let idx = 0, timer = null;

    function show(i) {
        quotes.forEach((q, k) => q.classList.toggle('active', k === i));
        dots.forEach((d, k) => d.classList.toggle('active', k === i));
        idx = i;
    }
    function schedule() {
        clearInterval(timer);
        timer = setInterval(() => show((idx + 1) % quotes.length), 5000);
    }
    dots.forEach(d => d.addEventListener('click', () => { show(+d.dataset.index); schedule(); }));
    schedule();
})();
