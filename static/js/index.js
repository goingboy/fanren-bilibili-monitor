/**
 * 凡人修仙传 · 首页逻辑（水墨重构版）
 * 数据驱动 + 错误态 + 动态环形基准 + 渐进式统计加载
 */
(function () {
    'use strict';

    const { PALETTE, fmt, fmtRel, fetchJSON, animateNumber, debounce, toast } = window.FM;
    const $ = (id) => document.getElementById(id);
    const RING_LEN = 565.49; // 2πr, r=90

    // 修仙境界（基于集数，示意；元婴期起自慕兰之战前后）
    const REALMS = [
        { name: '炼气期', ep: 0 }, { name: '筑基期', ep: 25 },
        { name: '结丹期', ep: 65 }, { name: '元婴期', ep: 180 },
        { name: '化神期', ep: 260 }, { name: '合体期', ep: 280 },
        { name: '大乘期', ep: 290 }, { name: '渡劫飞升', ep: 293 },
    ];

    const state = {
        episodes: [], overview: null, currentEp: null,
        seasonId: null, searchTerm: '',
        autoRefresh: true, refreshTimer: null, quoteTimer: null,
        trendMax: {},        // aid -> 历史最大实时人数（环形基准）
        overviewTime: 0, statsReady: false, loading: false,
    };
    window.__fm = state; // 自动化验证句柄

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function renderError(el, msg) {
        if (!el) return;
        el.innerHTML =
            '<div class="state-block">' +
            '<div class="state-icon">墨</div>' +
            '<p>' + escapeHtml(msg || '数据加载失败') + '</p>' +
            '<button class="btn btn-retry" data-retry="1">重试</button></div>';
    }

    // ============ 名句轮换 ============
    function initQuotes() {
        const quotes = document.querySelectorAll('.quote');
        const dots = document.querySelectorAll('.quote-dot');
        if (!quotes.length) return;
        let idx = 0;
        function show(i) {
            quotes.forEach((q, k) => q.classList.toggle('active', k === i));
            dots.forEach((d, k) => d.classList.toggle('active', k === i));
            idx = i;
        }
        clearInterval(state.quoteTimer);
        state.quoteTimer = setInterval(() => show((idx + 1) % quotes.length), 5000);
        dots.forEach(d => d.addEventListener('click', () => {
            show(+d.dataset.index);
            clearInterval(state.quoteTimer);
            state.quoteTimer = setInterval(() => show((idx + 1) % quotes.length), 5000);
        }));
    }

    // ============ 英雄区（全部来自 API） ============
    function renderHero() {
        const ov = state.overview;
        if (!ov) return;
        const s = ov.stat || {};
        if (ov.rating && ov.rating.score) {
            $('heroScore').textContent = Number(ov.rating.score).toFixed(1);
        }
        animateNumber($('heroViews'), s.view || 0, 1300);
        animateNumber($('heroEps'), ov.total || state.episodes.length, 900);
        if (s.follow_text) {
            // 上游形如 "1772.8万追番"，去掉文字后缀避免与卡片标签重复
            $('heroFollow').textContent = String(s.follow_text).replace(/[^\d.万亿]/g, '');
            $('heroFollowCard').hidden = false;
        }
    }

    // ============ 总览卡 ============
    function renderOverview() {
        const ov = state.overview;
        if (!ov) return;
        const s = ov.stat || {};
        animateNumber($('totalViews'), s.view || 0);
        animateNumber($('totalDanmaku'), s.danmaku || 0);
        animateNumber($('totalCoin'), s.coin || 0);
        animateNumber($('totalLike'), s.like || 0);
        animateNumber($('totalFavorite'), s.favorite || 0);
        if (ov.rating && ov.rating.score) {
            $('totalScore').textContent = Number(ov.rating.score).toFixed(1);
        }
        state.overviewTime = Date.now() / 1000;
        updateStamp();
    }

    function updateStamp() {
        const stamp = $('overviewStamp');
        if (!stamp || !state.overviewTime) return;
        stamp.hidden = false;
        stamp.textContent = '更新于 ' + fmtRel(state.overviewTime);
    }

    // ============ 修仙进度 ============
    const NOMINAL_TOTAL = 293; // 修仙历程示意总长（与真实更新数无关）

    function renderProgress() {
        const eps = state.episodes;
        if (!eps.length) return;
        const latest = eps.reduce((a, b) => (b.pub_time || 0) > (a.pub_time || 0) ? b : a);
        const latestNum = parseInt(latest.title, 10) || eps.length;
        const total = NOMINAL_TOTAL;

        $('epUpdated').textContent = latestNum;

        let idx = 0;
        REALMS.forEach((r, i) => { if (latestNum >= r.ep) idx = i; });
        const startEp = REALMS[idx].ep;
        const endEp = idx < REALMS.length - 1 ? REALMS[idx + 1].ep : total;
        const startPct = startEp / total * 100;
        const endPct = idx < REALMS.length - 1 ? endEp / total * 100 : 100;
        const pct = startPct + (latestNum - startEp) / Math.max(1, endEp - startEp) * (endPct - startPct);

        // 境界细分：初/中/后期（最后一档不细分）
        let realmLabel = REALMS[idx].name;
        if (idx < REALMS.length - 1 && endEp > startEp) {
            const within = (latestNum - startEp) / (endEp - startEp);
            const sub = within < 1 / 3 ? '初期' : (within < 2 / 3 ? '中期' : '后期');
            realmLabel = REALMS[idx].name + ' · ' + sub;
        }
        $('currentRealm').textContent = realmLabel;
        $('progressPct').textContent = pct.toFixed(1) + '%';
        $('progressOuter').setAttribute('aria-valuenow', pct.toFixed(1));
        setTimeout(() => { $('progressBar').style.width = pct + '%'; }, 250);

        // 刻度按当前总集数动态生成
        const markers = $('progressMarkers');
        markers.innerHTML = '';
        REALMS.forEach((r, i) => {
            if (r.ep > total && i !== 0) return;
            const m = document.createElement('span');
            m.className = 'marker';
            const pct = Math.min(r.ep / total * 100, 99.5);
            m.style.left = pct.toFixed(1) + '%';
            if (pct >= 95) m.style.transform = 'translateX(-100%)';
            m.textContent = r.name.replace('期', '');
            markers.appendChild(m);
        });
        markers.dataset.total = String(total);
        const visibleRealms = REALMS.filter((r, i) => r.ep <= total || i === 0);
        document.querySelectorAll('#progressMarkers .marker').forEach((m, i) => {
            m.classList.toggle('reached', !!visibleRealms[i] && latestNum >= visibleRealms[i].ep);
        });
        document.title = '凡人修仙传 · 已更新至第' + latestNum + '集';
    }

    // ============ 季度标签 ============
    function renderSeasonTabs() {
        const c = $('seasonTabs');
        c.innerHTML = '';
        const seasons = [...new Set(state.episodes.map(e => e.season_id))];
        const mk = (label, sid) => {
            const b = document.createElement('button');
            b.className = 'season-tab';
            b.textContent = label;
            b.setAttribute('role', 'tab');
            b.addEventListener('click', () => {
                state.seasonId = sid;
                c.querySelectorAll('.season-tab').forEach(t => t.classList.toggle('active', t === b));
                renderGrid();
            });
            return b;
        };
        const all = mk('全部', null);
        all.classList.add('active');
        c.appendChild(all);
        seasons.forEach(sid => {
            const ep = state.episodes.find(e => e.season_id === sid);
            c.appendChild(mk(ep ? (ep.season_alias || ep.season_title || '季度' + sid) : '季度' + sid, sid));
        });
    }

    // ============ 集数网格 ============
    function renderGrid() {
        const c = $('episodeGrid');
        c.innerHTML = '';
        let list = state.episodes;
        if (state.seasonId) list = list.filter(e => e.season_id === state.seasonId);
        const latest = [...list].sort((a, b) => (b.pub_time || 0) - (a.pub_time || 0))[0];
        const term = state.searchTerm.toLowerCase();
        let shown = 0;

        list.forEach(ep => {
            if (term) {
                const t = (ep.title + ' ' + (ep.long_title || '')).toLowerCase();
                if (!t.includes(term)) return;
            }
            shown++;
            const b = document.createElement('div');
            b.className = 'ep-btn';
            b.setAttribute('role', 'option');
            b.tabIndex = 0;
            if (latest && ep.id === latest.id) b.classList.add('latest');
            b.textContent = ep.title;
            b.title = ep.long_title ? '第' + ep.title + '集 · ' + ep.long_title : '第' + ep.title + '集';
            b.dataset.aid = ep.aid;
            b.addEventListener('click', () => selectEpisode(ep));
            b.addEventListener('keydown', ev => {
                if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selectEpisode(ep); }
            });
            c.appendChild(b);
        });

        if (!shown) {
            c.innerHTML = '<div class="state-block"><div class="state-icon">墨</div><p>未找到匹配集数</p></div>';
            return;
        }
        if (state.currentEp) {
            const btn = c.querySelector('[data-aid="' + state.currentEp.aid + '"]');
            if (btn) btn.classList.add('active');
        }
    }

    // ============ 剧照画廊（最新12集） ============
    function renderGallery() {
        const track = $('galleryTrack');
        if (!track) return;
        track.innerHTML = '';
        const latest = [...state.episodes]
            .sort((a, b) => (b.pub_time || 0) - (a.pub_time || 0))
            .slice(0, 12).reverse();
        latest.forEach(ep => {
            const item = document.createElement('div');
            item.className = 'gallery-item';
            item.setAttribute('role', 'button');
            item.tabIndex = 0;
            item.setAttribute('aria-label', '选择第' + ep.title + '集');
            const img = document.createElement('img');
            img.loading = 'lazy';
            img.alt = '第' + ep.title + '集剧照';
            img.src = '/img_proxy?url=' + encodeURIComponent(ep.cover || '');
            const label = document.createElement('span');
            label.className = 'gallery-label';
            label.textContent = '第' + ep.title + '集' + (ep.long_title ? ' · ' + ep.long_title : '');
            item.appendChild(img);
            item.appendChild(label);
            const pick = () => {
                selectEpisode(ep);
                const btn = document.querySelector('.ep-btn[data-aid="' + ep.aid + '"]');
                if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            };
            item.addEventListener('click', pick);
            item.addEventListener('keydown', ev => {
                if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); }
            });
            track.appendChild(item);
        });
    }

    // ============ 选集 ============
    function selectEpisode(ep) {
        state.currentEp = ep;
        document.querySelectorAll('.ep-btn').forEach(b =>
            b.classList.toggle('active', +b.dataset.aid === ep.aid));

        const cover = $('epCoverImg');
        const sk = $('epCoverSkeleton');
        sk.style.display = '';
        cover.onload = () => { sk.style.display = 'none'; };
        cover.onerror = () => { sk.style.display = 'none'; cover.hidden = true; };
        if (ep.cover) {
            cover.hidden = false;
            cover.src = '/img_proxy?url=' + encodeURIComponent(ep.cover);
            cover.alt = '第' + ep.title + '集剧照';
        } else {
            cover.hidden = true;
            sk.style.display = 'none';
        }

        const info = $('currentEpInfo');
        if (info) {
            info.innerHTML =
                '<span class="ep-name">' +
                (ep.season_alias ? escapeHtml(ep.season_alias) + ' · ' : '') +
                '第' + escapeHtml(ep.title) + '集</span>' +
                (ep.long_title ? '<span class="ep-longtitle">「' + escapeHtml(ep.long_title) + '」</span>' : '') +
                '<a class="ep-link" href="https://www.bilibili.com/bangumi/play/ep' + ep.id + '" target="_blank" rel="noopener">前往B站观看 ↗</a>';
        }

        updateMiniStats(ep);
        fetchRealtime(ep);
        fetchTrend(ep.aid);
        if (window.__chartsHook) window.__chartsHook.epChanged(ep);
    }

    function updateMiniStats(ep) {
        const s = ep.stat || {};
        const set = (id, v) => { const el = $(id); if (el) el.textContent = fmt(v); };
        set('miniViews', s.view);
        set('miniDanmaku', s.danmaku);
        set('miniCoin', s.coin);
        set('miniLike', s.like);
    }

    // ============ 实时人数（动态基准环） ============
    async function fetchRealtime(ep) {
        try {
            const d = await fetchJSON('/api/realtime?aid=' + ep.aid + '&cid=' + ep.cid);
            if (d.code === 0) updateRealtime(d.data.count, d.data.display);
            else toast(d.message || '实时人数获取失败', 'error');
        } catch (e) {
            toast('实时人数获取失败', 'error');
        }
    }

    function updateRealtime(count, display) {
        const el = $('realtimeCount');
        if (display) {
            el.textContent = display; // 上游截断值（如 1000+）如实展示
        } else {
            animateNumber(el, count, 700);
        }
        const aid = state.currentEp && state.currentEp.aid;
        const base = Math.max(500, state.trendMax[aid] || 0, count);
        const pct = Math.min(count / base, 1);
        $('ringProgress').style.strokeDashoffset = (RING_LEN * (1 - pct)).toFixed(1);
    }

    async function fetchTrend(aid) {
        try {
            const d = await fetchJSON('/api/trend?aid=' + aid);
            if (d.code === 0) {
                const list = d.data || [];
                state.trendMax[aid] = list.reduce((m, p) => Math.max(m, p.count), 0);
                if (window.__chartsHook) window.__chartsHook.trendChanged(list);
            }
        } catch (e) { /* 趋势失败静默 */ }
    }

    // ============ 渐进式批量统计 ============
    async function fetchStats() {
        const aids = state.episodes.map(e => e.aid);
        for (let i = 0; i < aids.length; i += 40) {
            const batch = aids.slice(i, i + 40);
            try {
                const d = await fetchJSON('/api/episode_stats_batch?aids=' + batch.join(','));
                if (d.code === 0) {
                    state.episodes.forEach(ep => {
                        const s = d.data[ep.aid];
                        if (s) ep.stat = s;
                    });
                    if (state.currentEp) updateMiniStats(state.currentEp);
                    if (window.__chartsHook) window.__chartsHook.statsChanged();
                }
            } catch (e) {
                console.warn('统计批次失败:', e);
            }
        }
        state.statsReady = true;
    }

    // ============ 总装载 ============
    async function loadAll(manual) {
        if (state.loading) return;
        state.loading = true;
        if (manual) $('btnRefresh').classList.add('spinning');
        try {
            const [epR, ovR] = await Promise.all([
                fetchJSON('/api/episodes').catch(() => ({ code: -1, message: '集数数据加载失败' })),
                fetchJSON('/api/overview').catch(() => ({ code: -1, message: '总览数据加载失败' })),
            ]);

            if (epR.code === 0 && epR.data.length) {
                state.episodes = epR.data;
                renderSeasonTabs();
                renderGrid();
                renderGallery();
                renderProgress();
                if (!state.currentEp) {
                    const latest = [...state.episodes]
                        .sort((a, b) => (b.pub_time || 0) - (a.pub_time || 0))[0];
                    if (latest) selectEpisode(latest);
                }
                fetchStats();
            } else {
                renderError($('episodeGrid'), epR.message || '集数数据加载失败');
                renderError($('overviewCards'), epR.message || '数据加载失败');
            }

            if (ovR.code === 0 && ovR.data && ovR.data.length) {
                state.overview = ovR.data[0];
                renderHero();
                renderOverview();
                if (epR.code === 0) renderProgress(); // 用总览集数修正进度
            } else if (epR.code !== 0) {
                renderHeroError();
            }
        } finally {
            state.loading = false;
            if (manual) setTimeout(() => $('btnRefresh').classList.remove('spinning'), 500);
        }
    }

    function renderHeroError() { /* 英雄区保持 --，由 toast 提示 */ }

    // ============ 自动刷新 ============
    function startAuto() {
        stopAuto();
        state.refreshTimer = setInterval(() => {
            if (state.currentEp) {
                fetchRealtime(state.currentEp);
                fetchTrend(state.currentEp.aid);
            }
        }, 30000);
    }
    function stopAuto() {
        if (state.refreshTimer) { clearInterval(state.refreshTimer); state.refreshTimer = null; }
    }

    // ============ 图表（墨色主题，懒初始化） ============
    const charts = {};
    let chartsInited = false;

    function chartBase() {
        return {
            backgroundColor: 'transparent',
            textStyle: { color: PALETTE.ink2, fontFamily: 'Noto Serif SC, SimSun, serif' },
            tooltip: {
                backgroundColor: 'rgba(251,248,241,0.97)',
                borderColor: 'rgba(26,26,24,0.25)',
                borderWidth: 1,
                padding: [8, 12],
                textStyle: { color: PALETTE.ink, fontSize: 12 },
                extraCssText: 'box-shadow:0 4px 16px rgba(26,26,24,.16);border-radius:3px;'
            },
        };
    }

    const AXIS_LINE = { lineStyle: { color: 'rgba(26,26,24,.28)' } };
    const SPLIT_LINE = { lineStyle: { color: 'rgba(26,26,24,.07)' } };

    function zoomConfig(defaultStart) {
        return [
            { type: 'inside', start: defaultStart, end: 100, zoomOnMouseWheel: false },
            {
                type: 'slider', height: 16, bottom: 6,
                borderColor: 'rgba(26,26,24,.18)',
                backgroundColor: 'rgba(239,233,219,.55)',
                fillerColor: 'rgba(26,26,24,.10)',
                handleStyle: { color: PALETTE.ink, borderColor: PALETTE.ink },
                moveHandleStyle: { color: PALETTE.ink2 },
                textStyle: { color: PALETTE.ink3, fontSize: 10 },
                dataBackground: {
                    lineStyle: { color: 'rgba(26,26,24,.25)' },
                    areaStyle: { color: 'rgba(26,26,24,.06)' }
                },
                selectedDataBackground: {
                    lineStyle: { color: PALETTE.cinnabar },
                    areaStyle: { color: 'rgba(176,58,46,.10)' }
                },
            },
        ];
    }

    function emptyChart(chart, text) {
        chart.setOption({
            ...chartBase(),
            title: {
                text: text, left: 'center', top: 'middle',
                textStyle: { color: PALETTE.ink3, fontSize: 13, fontWeight: 'normal' }
            },
            xAxis: { show: false }, yAxis: { show: false }, series: [],
        });
    }

    function renderViewsChart() {
        if (!charts.views || !state.episodes.length) return;
        const eps = state.episodes;
        const labels = eps.map(e => '第' + e.title + '集');
        const views = eps.map(e => (e.stat && e.stat.view) || null);
        charts.views.setOption({
            ...chartBase(),
            tooltip: { ...chartBase().tooltip, trigger: 'axis',
                formatter: ps => '<strong>' + ps[0].name + '</strong><br>播放 ' + fmt(ps[0].value) },
            grid: { left: 62, right: 14, top: 18, bottom: 58 },
            xAxis: { type: 'category', data: labels, axisLine: AXIS_LINE, axisTick: { show: false },
                axisLabel: { color: PALETTE.ink3, fontSize: 10, rotate: 45,
                    interval: Math.max(0, Math.floor(eps.length / 14)) } },
            yAxis: { type: 'value', splitLine: SPLIT_LINE,
                axisLabel: { color: PALETTE.ink3, formatter: v => fmt(v) } },
            dataZoom: zoomConfig(Math.max(0, 100 - Math.ceil(60 / eps.length * 100))),
            series: [{
                name: '播放量', type: 'bar', data: views, barMaxWidth: 13,
                itemStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1,
                        [{ offset: 0, color: '#3c3c38' }, { offset: 1, color: '#9a948a' }]),
                    borderRadius: [2, 2, 0, 0],
                },
                emphasis: { itemStyle: { color: PALETTE.cinnabar } },
            }],
        }, { notMerge: true });
    }

    function renderInteractionChart() {
        if (!charts.inter || !state.episodes.length) return;
        const eps = state.episodes;
        const labels = eps.map(e => '第' + e.title + '集');
        const pick = k => eps.map(e => (e.stat && e.stat[k]) || null);
        const SERIES_STYLE = [
            { name: '播放', key: 'view', color: PALETTE.ink, width: 2.2, yIdx: 0 },
            { name: '弹幕', key: 'danmaku', color: PALETTE.cinnabar, width: 1.4, yIdx: 1 },
            { name: '投币', key: 'coin', color: PALETTE.indigo, width: 1.4, yIdx: 1 },
            { name: '点赞', key: 'like', color: PALETTE.indigoLight, width: 1.4, yIdx: 1 },
            { name: '收藏', key: 'favorite', color: PALETTE.ink3, width: 1.4, yIdx: 1 },
        ];
        charts.inter.setOption({
            ...chartBase(),
            tooltip: { ...chartBase().tooltip, trigger: 'axis',
                formatter: ps => '<strong>' + ps[0].name + '</strong><br>' +
                    ps.filter(p => p.value != null)
                      .map(p => p.marker + p.seriesName + ' ' + fmt(p.value)).join('<br>') },
            legend: { top: 0, textStyle: { color: PALETTE.ink2, fontSize: 11 },
                itemWidth: 18, itemHeight: 2, icon: 'rect' },
            grid: { left: 62, right: 58, top: 34, bottom: 58 },
            xAxis: { type: 'category', data: labels, axisLine: AXIS_LINE, axisTick: { show: false },
                axisLabel: { color: PALETTE.ink3, fontSize: 10,
                    interval: Math.max(0, Math.floor(eps.length / 14)) } },
            yAxis: [
                { type: 'value', name: '播放', nameTextStyle: { color: PALETTE.ink3 },
                    splitLine: SPLIT_LINE, axisLabel: { color: PALETTE.ink3, formatter: v => fmt(v) } },
                { type: 'value', name: '互动', nameTextStyle: { color: PALETTE.ink3 },
                    splitLine: { show: false }, axisLabel: { color: PALETTE.ink3, formatter: v => fmt(v) } },
            ],
            dataZoom: zoomConfig(Math.max(0, 100 - Math.ceil(60 / eps.length * 100))),
            series: SERIES_STYLE.map(s => ({
                name: s.name, type: 'line', yAxisIndex: s.yIdx, data: pick(s.key),
                smooth: true, symbol: 'none',
                lineStyle: { color: s.color, width: s.width },
                itemStyle: { color: s.color },
                emphasis: { focus: 'series' },
            })),
        }, { notMerge: true });
    }

    function computePeaks() {
        const keys = ['view', 'danmaku', 'coin', 'like', 'reply', 'favorite'];
        const peaks = {};
        keys.forEach(k => { peaks[k] = 0; });
        state.episodes.forEach(e => {
            keys.forEach(k => {
                const v = (e.stat && Number(e.stat[k])) || 0;
                if (v > peaks[k]) peaks[k] = v;
            });
        });
        return peaks;
    }

    function renderRadar(ep) {
        if (!charts.radar) return;
        const s = (ep && ep.stat) || null;
        if (!s || !s.view) {
            emptyChart(charts.radar, ep ? '该集统计加载中…' : '选择剧集后展示');
            return;
        }
        const keys = ['view', 'danmaku', 'coin', 'like', 'reply', 'favorite'];
        const names = ['播放', '弹幕', '投币', '点赞', '评论', '收藏'];
        const peaks = computePeaks();
        const vals = keys.map(k => Number(s[k]) || 0);
        const peakVals = keys.map(k => peaks[k]);
        charts.radar.setOption({
            ...chartBase(),
            legend: {
                bottom: 0, textStyle: { color: PALETTE.ink2, fontSize: 11 },
                itemWidth: 18, itemHeight: 2, icon: 'rect',
                data: ['当前集', '全剧之最'],
            },
            tooltip: {
                ...chartBase().tooltip,
                formatter: ps => '<strong>第' + ep.title + '集</strong><br>' +
                    names.map((n, i) =>
                        fmt(vals[i]) + ' / 峰值 ' + fmt(peakVals[i]) + '（' + n + '）'
                    ).join('<br>'),
            },
            radar: {
                indicator: names.map((n, i) => ({
                    name: n, max: Math.max(peakVals[i] * 1.12, 10),
                })),
                radius: '56%',
                splitNumber: 3,
                axisName: { color: PALETTE.ink2, fontSize: 11 },
                splitLine: { lineStyle: { color: 'rgba(26,26,24,.14)' } },
                splitArea: { show: false },
                axisLine: { lineStyle: { color: 'rgba(26,26,24,.16)' } },
            },
            series: [{
                type: 'radar',
                data: [
                    {
                        value: peakVals, name: '全剧之最',
                        lineStyle: { color: PALETTE.ink3, width: 1.2, type: 'dashed' },
                        itemStyle: { color: PALETTE.ink3 },
                        symbol: 'none',
                        areaStyle: { color: 'rgba(138,133,120,.07)' },
                    },
                    {
                        value: vals, name: '当前集',
                        areaStyle: { color: 'rgba(176,58,46,.16)' },
                        lineStyle: { color: PALETTE.cinnabar, width: 2 },
                        itemStyle: { color: PALETTE.cinnabar },
                        symbolSize: 3,
                    },
                ],
            }],
        }, { notMerge: true });
    }

    function renderTrend(list) {
        if (!charts.trend) return;
        if (!list || !list.length) {
            emptyChart(charts.trend, '暂无趋势数据 · 服务端每60秒自动采集');
            return;
        }
        charts.trend.setOption({
            ...chartBase(),
            tooltip: { ...chartBase().tooltip, trigger: 'axis',
                formatter: ps => '<strong>' + ps[0].name + '</strong><br>在线 ' + fmt(ps[0].value) },
            grid: { left: 56, right: 18, top: 18, bottom: 30 },
            xAxis: { type: 'category',
                data: list.map(p => new Date(p.time * 1000).toLocaleTimeString('zh-CN',
                    { hour: '2-digit', minute: '2-digit' })),
                axisLine: AXIS_LINE, axisTick: { show: false },
                axisLabel: { color: PALETTE.ink3, fontSize: 10 } },
            yAxis: { type: 'value', splitLine: SPLIT_LINE,
                axisLabel: { color: PALETTE.ink3, formatter: v => fmt(v) } },
            series: [{
                name: '实时在线', type: 'line',
                data: list.map(p => p.count),
                smooth: true, symbol: 'circle', symbolSize: 4,
                lineStyle: { color: PALETTE.cinnabar, width: 2 },
                itemStyle: { color: PALETTE.cinnabar },
                areaStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1,
                        [{ offset: 0, color: 'rgba(176,58,46,.16)' },
                         { offset: 1, color: 'rgba(176,58,46,0)' }]),
                },
            }],
        }, { notMerge: true });
    }

    function initCharts() {
        if (chartsInited || typeof echarts === 'undefined') return;
        chartsInited = true;
        charts.views = echarts.init($('chartViews'));
        charts.radar = echarts.init($('chartRadar'));
        charts.trend = echarts.init($('chartTrend'));
        charts.inter = echarts.init($('chartInteraction'));
        window.__charts = charts; // 验证句柄

        renderViewsChart();
        renderInteractionChart();
        renderRadar(state.currentEp);
        renderTrend(state._trendList || []);

        window.addEventListener('resize',
            debounce(() => Object.values(charts).forEach(c => c.resize()), 150));
    }

    // 图表数据钩子：数据先于图表就绪时缓存，初始化后补渲染
    window.__chartsHook = {
        epChanged(ep) { renderRadar(ep); },
        trendChanged(list) { state._trendList = list; renderTrend(list); },
        statsChanged() { renderViewsChart(); renderInteractionChart(); },
    };

    // ============ 初始化 ============
    function init() {
        initQuotes();

        $('btnRefresh').addEventListener('click', () => loadAll(true));
        document.addEventListener('click', e => {
            if (e.target.closest('[data-retry]')) loadAll(true);
        });

        $('autoRefresh').addEventListener('change', e => {
            state.autoRefresh = e.target.checked;
            if (state.autoRefresh) { startAuto(); toast('自动刷新已开启'); }
            else { stopAuto(); toast('自动刷新已关闭'); }
        });

        const search = $('searchInput');
        search.addEventListener('input', debounce(() => {
            state.searchTerm = search.value.trim();
            renderGrid();
        }, 200));
        search.addEventListener('keydown', e => { if (e.key === 'Enter') search.blur(); });

        setInterval(updateStamp, 30000);

        // 图表懒初始化：滚动接近时才建实例
        const chartSection = document.querySelector('.charts-grid');
        if (chartSection && 'IntersectionObserver' in window) {
            const io = new IntersectionObserver(entries => {
                if (entries.some(e => e.isIntersecting)) {
                    io.disconnect();
                    initCharts();
                }
            }, { rootMargin: '250px' });
            io.observe(chartSection);
        } else {
            initCharts();
        }

        loadAll(false);
        startAuto();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
