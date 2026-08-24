/**
 * 凡人修仙传 · B站实时数据监控 - 前端逻辑
 */
(function () {
    'use strict';

    const state = {
        seasons: [],
        episodes: [],
        currentEp: null,
        currentSeasonId: null,
        autoRefresh: true,
        refreshTimer: null,
        quoteTimer: null,
        charts: {},
        trendData: [],
        totalEpisodes: 272,
        statsLoaded: false,
        galleryPage: 0,
        galleryPageSize: 4,
        chartPageSize: 52,
        chartPage: 0, // 0 = 最新52集
    };

    // 修仙境界（基于集数）
    const REALMS = [
        { name: '炼气期', ep: 0 },
        { name: '筑基期', ep: 25 },
        { name: '结丹期', ep: 65 },
        { name: '元婴期', ep: 120 },
        { name: '化神期', ep: 180 },
        { name: '合体期', ep: 220 },
        { name: '大乘期', ep: 255 },
        { name: '渡劫飞升', ep: 272 },
    ];

    function formatNumber(n) {
        if (n === null || n === undefined) return '--';
        if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿';
        if (n >= 10000) return (n / 10000).toFixed(1) + '万';
        return n.toLocaleString('zh-CN');
    }

    function formatTime(ts) {
        const d = new Date(ts * 1000);
        return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    async function fetchJSON(url) {
        const resp = await fetch(url);
        return resp.json();
    }

    function initParticles() {
        const container = document.getElementById('particles');
        for (let i = 0; i < 25; i++) {
            const p = document.createElement('div');
            p.className = 'particle';
            p.style.left = Math.random() * 100 + '%';
            p.style.animationDuration = (8 + Math.random() * 15) + 's';
            p.style.animationDelay = Math.random() * 10 + 's';
            const size = 1 + Math.random() * 3;
            p.style.width = p.style.height = size + 'px';
            if (Math.random() > 0.7) {
                p.style.background = '#3a86ff';
                p.style.boxShadow = '0 0 6px rgba(58,134,255,0.5)';
            } else {
                p.style.boxShadow = '0 0 6px rgba(201,169,110,0.5)';
            }
            container.appendChild(p);
        }
    }

    function initQuoteRotation() {
        const quotes = document.querySelectorAll('.quote');
        const dots = document.querySelectorAll('.quote-dot');
        let currentIndex = 0;

        function showQuote(index) {
            quotes.forEach(q => q.classList.remove('active'));
            dots.forEach(d => d.classList.remove('active'));
            quotes[index].classList.add('active');
            dots[index].classList.add('active');
            currentIndex = index;
        }

        state.quoteTimer = setInterval(() => {
            showQuote((currentIndex + 1) % quotes.length);
        }, 5000);

        dots.forEach(dot => {
            dot.addEventListener('click', () => {
                clearInterval(state.quoteTimer);
                showQuote(parseInt(dot.dataset.index));
                state.quoteTimer = setInterval(() => {
                    showQuote((currentIndex + 1) % quotes.length);
                }, 5000);
            });
        });
    }

    // ===== Gallery 翻页 =====
    function initGallery(episodes) {
        if (!episodes || !episodes.length) return;
        // 默认显示最后几集
        state.galleryPage = Math.max(0, episodes.length - state.galleryPageSize);
        renderGallery(episodes);

        document.getElementById('galleryPrev').addEventListener('click', () => {
            state.galleryPage = Math.max(0, state.galleryPage - state.galleryPageSize);
            renderGallery(episodes);
        });
        document.getElementById('galleryNext').addEventListener('click', () => {
            state.galleryPage = Math.min(episodes.length - state.galleryPageSize, state.galleryPage + state.galleryPageSize);
            renderGallery(episodes);
        });
    }

    function renderGallery(episodes) {
        const track = document.getElementById('galleryTrack');
        track.innerHTML = '';
        const start = state.galleryPage;
        const end = Math.min(start + state.galleryPageSize, episodes.length);
        const visible = episodes.slice(start, end);

        visible.forEach(ep => {
            const item = document.createElement('div');
            item.className = 'gallery-item';
            item.innerHTML = `
                <img src="/img_proxy?url=${encodeURIComponent(ep.cover)}" alt="第${ep.title}集" loading="lazy">
                <span class="gallery-label">第${ep.title}集</span>
            `;
            item.addEventListener('click', () => {
                const btn = document.querySelector(`.ep-btn[data-aid="${ep.aid}"]`);
                if (btn) selectEpisode(ep, btn);
            });
            track.appendChild(item);
        });
    }

    function getChartTheme() {
        return {
            backgroundColor: 'transparent',
            textStyle: { color: '#9a917e', fontFamily: 'Noto Serif SC, serif' },
        };
    }

    function initCharts() {
        const theme = getChartTheme();
        state.charts.views = echarts.init(document.getElementById('chartViews'));
        state.charts.radar = echarts.init(document.getElementById('chartRadar'));
        state.charts.trend = echarts.init(document.getElementById('chartTrend'));
        state.charts.interaction = echarts.init(document.getElementById('chartInteraction'));

        Object.values(state.charts).forEach(chart => {
            chart.setOption({
                ...theme,
                title: {
                    text: '加载中...',
                    left: 'center', top: 'center',
                    textStyle: { color: '#5a5548', fontSize: 14, fontWeight: 'normal' }
                }
            });
        });

        window.addEventListener('resize', () => {
            Object.values(state.charts).forEach(c => c.resize());
        });
    }

    // ===== 总览 =====
    function renderOverview(overviewList) {
        if (!overviewList || !overviewList.length) return;

        let totalView = 0, totalDanmaku = 0, totalCoin = 0, totalLike = 0, totalFavorite = 0;
        let score = 0;

        overviewList.forEach(item => {
            const s = item.stat || {};
            totalView += s.view || 0;
            totalDanmaku += s.danmaku || 0;
            totalCoin += s.coin || 0;
            totalLike += s.like || 0;
            totalFavorite += s.favorite || 0;
            if (item.rating && item.rating.score) {
                score = Math.max(score, item.rating.score);
            }
        });

        animateNumber('totalViews', totalView);
        animateNumber('totalDanmaku', totalDanmaku);
        animateNumber('totalCoin', totalCoin);
        animateNumber('totalLike', totalLike);
        animateNumber('totalFavorite', totalFavorite);
        document.getElementById('totalScore').textContent = score ? score.toFixed(1) : '--';

        const heroViews = document.getElementById('heroViews');
        if (heroViews) heroViews.textContent = formatNumber(totalView);
    }

    function animateNumber(id, target) {
        const el = document.getElementById(id);
        if (!el) return;
        const duration = 1500;
        const start = performance.now();

        function tick(now) {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            el.textContent = formatNumber(Math.floor(target * eased));
            if (progress < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    function renderSeasonTabs(seasons) {
        const container = document.getElementById('seasonTabs');
        container.innerHTML = '';
        const allTab = document.createElement('div');
        allTab.className = 'season-tab active';
        allTab.textContent = '全部';
        allTab.dataset.sid = 'all';
        allTab.addEventListener('click', () => filterBySeason('all'));
        container.appendChild(allTab);

        seasons.forEach(s => {
            const tab = document.createElement('div');
            tab.className = 'season-tab';
            tab.textContent = s.alias || s.title;
            tab.dataset.sid = s.season_id;
            tab.addEventListener('click', () => filterBySeason(s.season_id));
            container.appendChild(tab);
        });
    }

    function filterBySeason(sid) {
        state.currentSeasonId = sid === 'all' ? null : sid;
        document.querySelectorAll('.season-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.sid === String(sid));
        });
        renderEpisodeGrid(state.episodes);
    }

    function renderEpisodeGrid(episodes) {
        const container = document.getElementById('episodeGrid');
        container.innerHTML = '';

        let filtered = episodes;
        if (state.currentSeasonId) {
            filtered = episodes.filter(ep => ep.season_id === state.currentSeasonId);
        }

        const latestEp = filtered.reduce((latest, ep) => {
            if (!latest) return ep;
            return (ep.pub_time || 0) > (latest.pub_time || 0) ? ep : latest;
        }, null);

        filtered.forEach((ep, idx) => {
            const btn = document.createElement('div');
            btn.className = 'ep-btn';
            if (latestEp && ep.id === latestEp.id) btn.classList.add('latest');
            btn.textContent = `第${ep.title}集`;
            btn.title = ep.long_title ? `${ep.title} - ${ep.long_title}` : (ep.title || '');
            btn.dataset.aid = ep.aid;
            btn.dataset.cid = ep.cid;
            btn.dataset.epIdx = idx;

            btn.addEventListener('click', () => selectEpisode(ep, btn));

            if (state._searchTerm) {
                const term = state._searchTerm.toLowerCase();
                const title = (ep.title || '').toLowerCase();
                const longTitle = (ep.long_title || '').toLowerCase();
                if (!title.includes(term) && !longTitle.includes(term)) {
                    btn.style.display = 'none';
                }
            }

            container.appendChild(btn);
        });

        if (latestEp && !state.currentEp) {
            const latestBtn = container.querySelector('.ep-btn.latest');
            if (latestBtn) selectEpisode(latestEp, latestBtn);
        }
    }

    function selectEpisode(ep, btnEl) {
        state.currentEp = ep;
        document.querySelectorAll('.ep-btn').forEach(b => b.classList.remove('active'));
        if (btnEl) btnEl.classList.add('active');

        const infoEl = document.getElementById('currentEpInfo');
        infoEl.innerHTML = `
            <span class="ep-name" style="color:var(--accent-gold);font-size:1.1rem;">
                ${ep.season_alias ? ep.season_alias + ' · ' : ''}第${ep.title}集
            </span>
            ${ep.long_title ? `<br><span style="font-size:0.85rem;color:var(--text-secondary);margin-top:0.3rem;display:inline-block;">「${ep.long_title}」</span>` : ''}
            <br><a href="https://www.bilibili.com/bangumi/play/ep${ep.id}" target="_blank"
                style="color:var(--accent-blue);font-size:0.8rem;margin-top:0.5rem;display:inline-block;">
                前往B站观看 →
            </a>
        `;

        // 更新封面预览
        const coverImg = document.getElementById('epCoverImg');
        if (ep.cover) {
            coverImg.src = '/img_proxy?url=' + encodeURIComponent(ep.cover);
            coverImg.alt = '第' + ep.title + '集';
        }

        // 更新 mini stats
        updateMiniStats(ep);

        fetchRealtime(ep);
        updateRadar(ep);
        fetchTrend(ep.aid);
    }

    function updateMiniStats(ep) {
        const s = ep.stat || {};
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val != null ? formatNumber(val) : '--';
        };
        setVal('miniViews', s.view);
        setVal('miniDanmaku', s.danmaku);
        setVal('miniCoin', s.coin);
        setVal('miniLike', s.like);
    }

    async function fetchRealtime(ep) {
        try {
            const data = await fetchJSON(`/api/realtime?aid=${ep.aid}&cid=${ep.cid}`);
            if (data.code === 0) {
                updateRealtimeDisplay(data.data.count);
            }
        } catch (e) {
            console.error('获取实时数据失败:', e);
        }
    }

    function updateRealtimeDisplay(count) {
        const countEl = document.getElementById('realtimeCount');
        const ringEl = document.getElementById('ringProgress');
        const current = parseInt(countEl.textContent.replace(/[^0-9]/g, '')) || 0;
        animateCountUp(countEl, current, count);
        const pct = Math.min(count / 10000, 1);
        ringEl.style.strokeDashoffset = 2 * Math.PI * 90 * (1 - pct);
    }

    function animateCountUp(el, from, to) {
        const duration = 800;
        const start = performance.now();
        function tick(now) {
            const progress = Math.min((now - start) / duration, 1);
            el.textContent = Math.floor(from + (to - from) * (1 - Math.pow(1 - progress, 3))).toLocaleString('zh-CN');
            if (progress < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    // ===== 获取当前页的集数 =====
    function getPagedEpisodes() {
        const total = state.episodes.length;
        const pageSize = state.chartPageSize;
        const end = total - state.chartPage * pageSize;
        const start = Math.max(0, end - pageSize);
        return state.episodes.slice(start, end);
    }

    function getTotalPages() {
        return Math.ceil(state.episodes.length / state.chartPageSize);
    }

    // ===== 渲染分页控件 =====
    function renderChartPagination() {
        // 给播放量图表和互动图表加分页控件
        ['chartViews', 'chartInteraction'].forEach(chartId => {
            const card = document.getElementById(chartId).closest('.chart-card');
            let pagination = card.querySelector('.chart-pagination');
            if (!pagination) {
                pagination = document.createElement('div');
                pagination.className = 'chart-pagination';
                card.querySelector('.chart-header').appendChild(pagination);
            }

            const totalPages = getTotalPages();
            const current = state.chartPage;

            pagination.innerHTML = `
                <button class="chart-page-btn" data-dir="-1" ${current >= totalPages - 1 ? 'disabled' : ''}>◀ 上52集</button>
                <span class="chart-page-info">第${totalPages - current}页 / 共${totalPages}页</span>
                <button class="chart-page-btn" data-dir="1" ${current <= 0 ? 'disabled' : ''}>下52集 ▶</button>
            `;

            pagination.querySelectorAll('.chart-page-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const dir = parseInt(btn.dataset.dir);
                    state.chartPage = Math.max(0, Math.min(getTotalPages() - 1, state.chartPage - dir));
                    updateCharts();
                });
            });
        });
    }

    function updateCharts() {
        const paged = getPagedEpisodes();
        renderViewsChart(paged);
        renderInteractionChart(paged);
        renderChartPagination();
    }

    // ===== 播放量柱状图 =====
    function renderViewsChart(episodes) {
        const chart = state.charts.views;
        const labels = episodes.map(ep => `第${ep.title}集`);
        const views = episodes.map(ep => ep.stat ? ep.stat.view : 0);

        chart.setOption({
            ...getChartTheme(),
            title: null,
            tooltip: {
                trigger: 'axis',
                backgroundColor: '#1a1a3a',
                borderColor: 'rgba(201,169,110,0.3)',
                textStyle: { color: '#e8e0d0', fontSize: 12 },
                formatter: p => `<strong>${p[0].name}</strong><br/>播放量: ${formatNumber(p[0].value)}`
            },
            grid: { left: 60, right: 20, top: 20, bottom: 50 },
            xAxis: {
                type: 'category',
                data: labels,
                axisLine: { lineStyle: { color: 'rgba(201,169,110,0.2)' } },
                axisLabel: { color: '#9a917e', fontSize: 10, rotate: 45, interval: Math.floor(episodes.length / 8) },
            },
            yAxis: {
                type: 'value',
                splitLine: { lineStyle: { color: 'rgba(201,169,110,0.06)' } },
                axisLabel: { color: '#9a917e', formatter: v => formatNumber(v) },
            },
            series: [{
                type: 'bar',
                data: views,
                itemStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: '#f0d78c' },
                        { offset: 1, color: '#8b6914' },
                    ]),
                    borderRadius: [3, 3, 0, 0],
                },
                barMaxWidth: 20,
            }],
        });
    }

    // ===== 雷达图 =====
    function updateRadar(ep) {
        const chart = state.charts.radar;
        if (!ep.stat || !ep.stat.view) return;
        const s = ep.stat;
        const maxVals = { view: 50000000, danmaku: 2000000, coin: 500000, like: 1000000, reply: 300000, favorite: 800000 };

        chart.setOption({
            ...getChartTheme(),
            title: null,
            radar: {
                indicator: [
                    { name: '播放', max: maxVals.view },
                    { name: '弹幕', max: maxVals.danmaku },
                    { name: '投币', max: maxVals.coin },
                    { name: '点赞', max: maxVals.like },
                    { name: '评论', max: maxVals.reply },
                    { name: '收藏', max: maxVals.favorite },
                ],
                shape: 'polygon',
                splitNumber: 4,
                axisName: { color: '#9a917e', fontSize: 11 },
                splitLine: { lineStyle: { color: 'rgba(201,169,110,0.1)' } },
                splitArea: { show: false },
                axisLine: { lineStyle: { color: 'rgba(201,169,110,0.15)' } },
            },
            series: [{
                type: 'radar',
                data: [{
                    value: [s.view, s.danmaku, s.coin, s.like, s.reply, s.favorite],
                    name: `第${ep.title}集`,
                    areaStyle: { color: 'rgba(201, 169, 110, 0.15)' },
                    lineStyle: { color: '#c9a96e', width: 2 },
                    itemStyle: { color: '#c9a96e' },
                }],
            }],
            tooltip: {
                backgroundColor: '#1a1a3a',
                borderColor: 'rgba(201,169,110,0.3)',
                textStyle: { color: '#e8e0d0' },
            },
        });
    }

    // ===== 趋势图 =====
    async function fetchTrend(aid) {
        try {
            const data = await fetchJSON(`/api/trend?aid=${aid}`);
            if (data.code === 0) {
                state.trendData = data.data;
                renderTrendChart(data.data);
            }
        } catch (e) {
            console.error('获取趋势数据失败:', e);
        }
    }

    function renderTrendChart(trendList) {
        const chart = state.charts.trend;
        if (!trendList || trendList.length === 0) {
            chart.setOption({
                ...getChartTheme(),
                title: { text: '暂无趋势数据，等待自动刷新采集', left: 'center', top: 'center',
                    textStyle: { color: '#5a5548', fontSize: 13, fontWeight: 'normal' } },
                series: [],
            });
            return;
        }

        chart.setOption({
            ...getChartTheme(),
            title: null,
            tooltip: {
                trigger: 'axis',
                backgroundColor: '#1a1a3a',
                borderColor: 'rgba(201,169,110,0.3)',
                textStyle: { color: '#e8e0d0' },
            },
            grid: { left: 50, right: 20, top: 20, bottom: 30 },
            xAxis: {
                type: 'category',
                data: trendList.map(t => formatTime(t.time)),
                axisLine: { lineStyle: { color: 'rgba(201,169,110,0.2)' } },
                axisLabel: { color: '#9a917e', fontSize: 10 },
            },
            yAxis: {
                type: 'value',
                splitLine: { lineStyle: { color: 'rgba(201,169,110,0.06)' } },
                axisLabel: { color: '#9a917e' },
            },
            series: [{
                type: 'line',
                data: trendList.map(t => t.count),
                smooth: true,
                lineStyle: { color: '#3a86ff', width: 2 },
                areaStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: 'rgba(58,134,255,0.3)' },
                        { offset: 1, color: 'rgba(58,134,255,0)' },
                    ]),
                },
                itemStyle: { color: '#3a86ff' },
                symbol: 'circle',
                symbolSize: 4,
            }],
        });
    }

    // ===== 全集互动数据（分页） =====
    function renderInteractionChart(episodes) {
        const chart = state.charts.interaction;
        const labels = episodes.map(ep => `第${ep.title}集`);
        const views = episodes.map(ep => ep.stat ? ep.stat.view : 0);
        const danmaku = episodes.map(ep => ep.stat ? ep.stat.danmaku : 0);
        const coin = episodes.map(ep => ep.stat ? ep.stat.coin : 0);
        const like = episodes.map(ep => ep.stat ? ep.stat.like : 0);
        const favorite = episodes.map(ep => ep.stat ? ep.stat.favorite : 0);

        chart.setOption({
            ...getChartTheme(),
            title: null,
            tooltip: {
                trigger: 'axis',
                backgroundColor: '#1a1a3a',
                borderColor: 'rgba(201,169,110,0.3)',
                textStyle: { color: '#e8e0d0', fontSize: 11 },
            },
            legend: {
                data: ['播放', '弹幕', '投币', '点赞', '收藏'],
                top: 0,
                textStyle: { color: '#9a917e', fontSize: 11 },
            },
            grid: { left: 70, right: 20, top: 35, bottom: 40 },
            xAxis: {
                type: 'category',
                data: labels,
                axisLine: { lineStyle: { color: 'rgba(201,169,110,0.2)' } },
                axisLabel: { color: '#9a917e', fontSize: 10, interval: Math.floor(episodes.length / 8) },
            },
            yAxis: [
                {
                    type: 'value', name: '播放量', position: 'left',
                    splitLine: { lineStyle: { color: 'rgba(201,169,110,0.06)' } },
                    axisLabel: { color: '#9a917e', formatter: v => formatNumber(v) },
                    nameTextStyle: { color: '#9a917e' },
                },
                {
                    type: 'value', name: '互动数', position: 'right',
                    splitLine: { show: false },
                    axisLabel: { color: '#9a917e', formatter: v => formatNumber(v) },
                    nameTextStyle: { color: '#9a917e' },
                }
            ],
            series: [
                { name: '播放', type: 'line', yAxisIndex: 0, data: views, smooth: true, lineStyle: { color: '#f0d78c', width: 2 }, itemStyle: { color: '#f0d78c' }, symbol: 'none' },
                { name: '弹幕', type: 'line', yAxisIndex: 1, data: danmaku, smooth: true, lineStyle: { color: '#e63946', width: 1.5 }, itemStyle: { color: '#e63946' }, symbol: 'none' },
                { name: '投币', type: 'line', yAxisIndex: 1, data: coin, smooth: true, lineStyle: { color: '#3a86ff', width: 1.5 }, itemStyle: { color: '#3a86ff' }, symbol: 'none' },
                { name: '点赞', type: 'line', yAxisIndex: 1, data: like, smooth: true, lineStyle: { color: '#2ec4b6', width: 1.5 }, itemStyle: { color: '#2ec4b6' }, symbol: 'none' },
                { name: '收藏', type: 'line', yAxisIndex: 1, data: favorite, smooth: true, lineStyle: { color: '#8b5cf6', width: 1.5 }, itemStyle: { color: '#8b5cf6' }, symbol: 'none' },
            ],
        });
    }

    // ===== 修仙进度条（修正：进度条宽度与境界同步） =====
    function renderProgress(episodes) {
        const latestEp = episodes.reduce((latest, ep) => {
            if (!latest) return ep;
            return (ep.pub_time || 0) > (latest.pub_time || 0) ? ep : latest;
        }, null);

        const latestNum = latestEp ? parseInt(latestEp.title) || episodes.length : episodes.length;
        const total = state.totalEpisodes;

        document.getElementById('epUpdated').textContent = latestNum;
        document.getElementById('epTotal').textContent = total;

        // 基于集数确定境界
        let realm = REALMS[0].name;
        let realmIdx = 0;
        for (let i = REALMS.length - 1; i >= 0; i--) {
            if (latestNum >= REALMS[i].ep) {
                realm = REALMS[i].name;
                realmIdx = i;
                break;
            }
        }

        // 进度条宽度 = 当前境界的起始百分比 + 境界内进度
        const realmStartPct = (REALMS[realmIdx].ep / total) * 100;
        const realmEndPct = realmIdx < REALMS.length - 1
            ? (REALMS[realmIdx + 1].ep / total) * 100
            : 100;
        const realmSpan = realmEndPct - realmStartPct;
        const epInRealm = latestNum - REALMS[realmIdx].ep;
        const realmSize = (realmIdx < REALMS.length - 1 ? REALMS[realmIdx + 1].ep : total) - REALMS[realmIdx].ep;
        const pct = realmStartPct + (epInRealm / realmSize) * realmSpan;

        document.getElementById('progressPct').textContent = pct.toFixed(1) + '%';

        setTimeout(() => {
            document.getElementById('progressBar').style.width = pct + '%';
        }, 300);

        document.getElementById('currentRealm').textContent = realm;

        // 标记已达到的境界
        document.querySelectorAll('.progress-markers .marker').forEach((marker, idx) => {
            if (idx < REALMS.length && latestNum >= REALMS[idx].ep) {
                marker.classList.add('reached');
            }
        });
    }

    function initSearch() {
        const input = document.getElementById('searchInput');
        let timer;
        input.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                state._searchTerm = input.value.trim();
                renderEpisodeGrid(state.episodes);
            }, 200);
        });
    }

    function startAutoRefresh() {
        stopAutoRefresh();
        state.refreshTimer = setInterval(async () => {
            if (state.currentEp) {
                await fetchRealtime(state.currentEp);
                await fetchTrend(state.currentEp.aid);
            }
        }, 30000);
    }

    function stopAutoRefresh() {
        if (state.refreshTimer) {
            clearInterval(state.refreshTimer);
            state.refreshTimer = null;
        }
    }

    function initRefreshButton() {
        const btn = document.getElementById('btnRefresh');
        btn.addEventListener('click', async () => {
            btn.classList.add('spinning');
            setTimeout(() => btn.classList.remove('spinning'), 800);
            await loadAllData();
        });
    }

    // ===== 批量获取统计（串行批次 + 单个回退） =====
    async function fetchEpisodeStats(episodes) {
        const batchSize = 40;
        const aids = episodes.map(ep => ep.aid);
        const batches = [];
        for (let i = 0; i < aids.length; i += batchSize) {
            batches.push(aids.slice(i, i + batchSize));
        }

        // 串行请求每批，避免并发过多
        for (const batch of batches) {
            try {
                const data = await fetchJSON(`/api/episode_stats_batch?aids=${batch.join(',')}`);
                if (data.code === 0) {
                    const statsMap = data.data;
                    episodes.forEach(ep => {
                        if (statsMap[ep.aid] && statsMap[ep.aid].view != null) {
                            ep.stat = statsMap[ep.aid];
                        }
                    });
                }
            } catch (e) {
                console.error('Batch failed, trying individual:', e);
                // 回退：逐个获取
                for (const aid of batch) {
                    try {
                        const d = await fetchJSON(`/api/episode_stat?aid=${aid}`);
                        if (d.code === 0 && d.data && d.data.view != null) {
                            const ep = episodes.find(e => e.aid === aid);
                            if (ep) ep.stat = d.data;
                        }
                    } catch (_) {}
                }
            }
        }

        // 检查缺失的 stat，单独补请求
        const missing = episodes.filter(ep => !ep.stat || ep.stat.view == null);
        if (missing.length > 0 && missing.length < 20) {
            console.log(`补请求 ${missing.length} 个缺失统计`);
            for (const ep of missing) {
                try {
                    const d = await fetchJSON(`/api/episode_stat?aid=${ep.aid}`);
                    if (d.code === 0 && d.data) ep.stat = d.data;
                } catch (_) {}
            }
        }

        state.statsLoaded = true;
    }

    async function loadAllData() {
        try {
            const [episodesResp, overviewResp] = await Promise.all([
                fetchJSON('/api/episodes'),
                fetchJSON('/api/overview'),
            ]);

            if (episodesResp.code === 0) {
                state.episodes = episodesResp.data;

                const seasons = [...new Set(state.episodes.map(ep => ep.season_id))].map(sid => {
                    const ep = state.episodes.find(e => e.season_id === sid);
                    return { season_id: sid, title: ep.season_title, alias: ep.season_alias };
                });
                state.seasons = seasons;
                renderSeasonTabs(seasons);
                renderEpisodeGrid(state.episodes);
                renderProgress(state.episodes);
                initGallery(state.episodes);

                // 先渲染空图表（默认最新52集）
                const paged = getPagedEpisodes();
                renderViewsChart(paged);
                renderInteractionChart(paged);
                renderChartPagination();

                if (state.episodes.length > 0 && !state.currentEp) {
                    const latestBtn = document.querySelector('.ep-btn.latest');
                    if (latestBtn) latestBtn.click();
                }

                // 异步加载统计，完成后更新图表
                fetchEpisodeStats(state.episodes).then(() => {
                    updateCharts();
                    if (state.currentEp) {
                        updateRadar(state.currentEp);
                        updateMiniStats(state.currentEp);
                    }
                });
            }

            if (overviewResp.code === 0) {
                renderOverview(overviewResp.data);
            }
        } catch (e) {
            console.error('加载数据失败:', e);
        }
    }

    function hideLoadingOverlay() {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.classList.add('hidden');
            setTimeout(() => overlay.remove(), 800);
        }
    }

    async function init() {
        initParticles();
        initCharts();
        initSearch();
        initRefreshButton();
        initQuoteRotation();

        document.getElementById('autoRefresh').addEventListener('change', (e) => {
            state.autoRefresh = e.target.checked;
            if (state.autoRefresh) startAutoRefresh();
            else stopAutoRefresh();
        });

        await loadAllData();
        hideLoadingOverlay();

        if (state.autoRefresh) startAutoRefresh();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
