/**
 * 凡人修仙传 · 水墨监控 —— 共享工具层
 */
(function () {
    'use strict';

    // 页面错误收集器（供自动化验证断言）
    window.__pageErrors = [];
    window.addEventListener('error', function (e) {
        window.__pageErrors.push(String(e.message || e));
    });
    window.addEventListener('unhandledrejection', function (e) {
        window.__pageErrors.push('rejection: ' + String(e.reason));
    });

    const PALETTE = {
        ink: '#1a1a18',
        ink2: '#4a4a45',
        ink3: '#8a8578',
        cinnabar: '#b03a2e',
        indigo: '#3d4a5c',
        indigoLight: '#6b7a8f',
        paperCard: '#fbf8f1',
        line: 'rgba(26,26,24,0.12)'
    };

    /** 数字缩写：1.2亿 / 34.5万 / 9,860 */
    function fmt(n) {
        if (n === null || n === undefined || isNaN(n)) return '--';
        n = Number(n);
        if (Math.abs(n) >= 1e8) {
            const v = (n / 1e8).toFixed(2).replace(/\.?0+$/, '');
            return v + '亿';
        }
        if (Math.abs(n) >= 1e4) {
            return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '万';
        }
        return Math.round(n).toLocaleString('zh-CN');
    }

    /** 相对时间：刚刚 / x 分钟前 / x 小时前 / x 天前 */
    function fmtRel(tsSec) {
        if (!tsSec) return '';
        const d = Date.now() / 1000 - tsSec;
        if (d < 60) return '刚刚';
        if (d < 3600) return Math.floor(d / 60) + ' 分钟前';
        if (d < 86400) return Math.floor(d / 3600) + ' 小时前';
        return Math.floor(d / 86400) + ' 天前';
    }

    async function fetchJSON(url, opt) {
        const resp = await fetch(url, opt);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
    }

    /** 数字滚动动画（配合 .num 类使用） */
    function animateNumber(el, target, duration) {
        if (!el) return;
        duration = duration || 1100;
        const startVal = parseFloat(String(el.textContent).replace(/[^\d.-]/g, '')) || 0;
        const start = performance.now();
        function tick(now) {
            const p = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - p, 3);
            el.textContent = fmt(startVal + (target - startVal) * eased);
            if (p < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    function debounce(fn, ms) {
        let t;
        return function () {
            clearTimeout(t);
            const args = arguments, self = this;
            t = setTimeout(() => fn.apply(self, args), ms);
        };
    }

    /** 墨色轻提示 */
    let toastWrap = null;
    function toast(msg, type) {
        if (!toastWrap) {
            toastWrap = document.createElement('div');
            toastWrap.className = 'toast-wrap';
            document.body.appendChild(toastWrap);
        }
        const el = document.createElement('div');
        el.className = 'toast' + (type === 'error' ? ' error' : '');
        el.setAttribute('role', 'status');
        el.textContent = msg;
        toastWrap.appendChild(el);
        setTimeout(() => el.remove(), 3200);
    }

    window.FM = { PALETTE, fmt, fmtRel, fetchJSON, animateNumber, debounce, toast };
})();
