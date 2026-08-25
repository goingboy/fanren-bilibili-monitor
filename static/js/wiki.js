/**
 * 凡人修仙传 · 动画百科 —— 标签切换 + 全文搜索
 */
(function () {
    'use strict';

    // ---- 标签切换 ----
    const tabs = document.querySelectorAll('.wiki-tab');
    const contents = document.querySelectorAll('.wiki-tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => {
                t.classList.remove('active');
                t.setAttribute('aria-selected', 'false');
            });
            contents.forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');
            document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
            applyFilter(); // 切换后按当前关键词重新过滤
        });
    });

    // ---- 全文搜索（防抖 180ms）----
    const input = document.getElementById('wikiSearch');
    let timer = null;

    function applyFilter() {
        if (!input) return;
        const term = input.value.trim().toLowerCase();
        let totalVisible = 0;

        contents.forEach(content => {
            let visibleInTab = 0;
            content.querySelectorAll('.wiki-detail-card, .wiki-timeline-item').forEach(card => {
                if (!term) {
                    card.style.display = '';
                    visibleInTab++;
                    return;
                }
                // 卡片全文 + 标签拼接匹配
                const text = (card.dataset.search ||
                    (card.dataset.search = card.textContent.toLowerCase()));
                const hit = text.includes(term);
                card.style.display = hit ? '' : 'none';
                if (hit) visibleInTab++;
            });
            content.dataset.visible = visibleInTab;
            totalVisible += visibleInTab;
        });

        // 空结果提示
        let emptyTip = document.getElementById('wikiEmptyTip');
        if (!emptyTip) {
            emptyTip = document.createElement('div');
            emptyTip.id = 'wikiEmptyTip';
            emptyTip.className = 'state-block';
            emptyTip.innerHTML =
                '<div class="state-icon">墨</div><p>未寻得相关条目，换个词试试？</p>';
            emptyTip.style.display = 'none';
            const bar = document.querySelector('.wiki-searchbar');
            if (bar) bar.appendChild(emptyTip);
        }
        emptyTip.style.display = (term && totalVisible === 0) ? 'block' : 'none';

        // 若当前激活标签下无可见项，自动跳到第一个有结果的标签
        if (term) {
            const activeContent = document.querySelector('.wiki-tab-content.active');
            if (activeContent && Number(activeContent.dataset.visible) === 0) {
                const firstWithHit = Array.from(contents)
                    .find(c => Number(c.dataset.visible) > 0);
                if (firstWithHit) {
                    const targetTab = document.querySelector(
                        `.wiki-tab[data-tab="${firstWithHit.id.replace('tab-', '')}"]`);
                    if (targetTab) targetTab.click();
                }
            }
        }
    }

    if (input) {
        input.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(applyFilter, 180);
        });
    }
})();
