# 水墨风重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, chosen by owner) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将凡人修仙传 B站监控站全面重写为宣纸白淡雅水墨风，修复数据准确性与性能问题，补全错误态与人性化细节。

**Architecture:** Flask 后端拆分为 config/cache_store/img_cache/sampler 模块；前端用 Jinja base.html 继承 + 分层 CSS 设计系统（tokens/base/components/pages）+ 页面级 JS（common/index/wiki）；ECharts 本地化。

**Tech Stack:** Python3 Flask requests / 原生 ES6 / ECharts 5（本地 vendor）/ Puppeteer MCP 验证。

## Global Constraints

- 色板（必须逐字使用）：纸 `#f5f1e8`、纸深 `#efe9db`、墨主 `#1a1a18`、墨次 `#4a4a45`、淡墨 `#8a8578`、朱砂 `#b03a2e`、黛青 `#3d4a5c`
- 依赖只允许：flask==3.0.0、requests==2.31.0（移除 flask-cors）
- 所有 `_cache` 类共享状态必须持锁访问；失败缓存 TTL=60s，成功统计 TTL=600s
- 禁止任何硬编码业务数字上屏（评分/追番/集数等一律来自 API 或运行时探测）
- 每个任务结束必须通过「验证步骤」全部检查点后才 commit
- 页面 JS 内建 `window.__pageErrors` 错误收集器，供验证断言为空数组

## API 契约（前后端以此为准）

| 端点 | 成功返回 | 失败返回 |
|------|---------|---------|
| GET /api/episodes | `{code:0,data:[{id,aid,cid,title,long_title,cover,pub_time,season_id,season_title,season_alias}]}` | `{code:-1,message}` |
| GET /api/overview | `{code:0,data:[{season_id,title,cover,total,new_ep,rating:{score},stat:{view,danmaku,coin,like,favorite,reply,share,follow?}}]}` follow 字段仅当上游存在时出现 | 同上 |
| GET /api/realtime?aid&cid | `{code:0,data:{aid,cid,count}}` | 同上 |
| GET /api/trend?aid | `{code:0,data:[{count,time}]}` | - |
| GET /api/episode_stat?aid | `{code:0,data:{view,danmaku,coin,like,reply,favorite,share}}` | 同上 |
| GET /api/episode_stats_batch?aids=1,2 | `{code:0,data:{"<aid>":stat|null}}` 失败项为 null 且不写长缓存 | 同上 |
| GET /img_proxy?url= | 图片字节流（磁盘缓存命中时 <10ms） | 400/502 |

---

### Task 1: 后端重构（R1）

**Files:**
- Create: `config.py`, `cache_store.py`, `img_cache.py`, `sampler.py`, `.gitignore`
- Modify: `bilibili_api.py`, `app.py`, `requirements.txt`
- Delete: `debug_output.txt`, `debug_search.html`

**Interfaces (Produces):**
- `config.py`: `PORT:int, DATA_DIR:str, IMG_CACHE_DIR:str, EPISODES_TTL=300, OVERVIEW_TTL=300, REALTIME_TTL=20, STAT_OK_TTL=600, STAT_FAIL_TTL=60, TREND_MAX=200, SAMPLER_INTERVAL=60, IMG_CACHE_MAX_BYTES=200*1024*1024`
- `cache_store.CacheStore`: `get(k)->(val,hit)`, `set(k,v,ttl)`, `get_stat(aid)->(stat,hit)`, `set_stat(aid,stat)`(空 dict 按 FAIL_TTL), `append_trend(aid,point)`(裁剪 TREND_MAX), `get_trend(aid)->list`, `load()`, `save()`(trend+ep_stat 落盘 `data/store.json`)
- `img_cache.fetch_cached(session,url)->tuple(bytes,mime)|None`
- `sampler.start(app_ctx)`：daemon 线程，每 SAMPLER_INTERVAL 秒对最新集采 realtime 并 append_trend
- `bilibili_api.BilibiliAPI.get_episode_stats_concurrent(aids,workers=6)->{str(aid):dict|None}`
- overview 归一化保留上游存在的任意字段（含可能的 follow），并注入 `rating`

**Steps:**
- [ ] 写 `.gitignore`（`__pycache__/`, `data/`, `static/images/cache/`）
- [ ] 实现 config/cache_store/img_cache/sampler（完整代码按上述接口）
- [ ] 重写 bilibili_api：并发批量、overview 透传未知字段、所有请求带 timeout 与异常兜底
- [ ] 重写 app.py：create_app 工厂、路由薄层调用模块、`threaded=True`、静态文件 `SEND_FILE_MAX_AGE_DEFAULT=86400`、移除 CORS
- [ ] requirements.txt 收敛为 flask+requests
- [ ] 验证：
  ```powershell
  python -c "import app"                    # 无导入错误
  Start-Process python -ArgumentList "app.py" -WindowStyle Hidden; Start-Sleep 6
  (Invoke-WebRequest http://localhost:5000/api/episodes).Content.Contains('"code":0')
  (Measure-Command { Invoke-WebRequest http://localhost:5000/api/episodes }).TotalMilliseconds -lt 200   # 缓存命中
  Invoke-WebRequest ("http://localhost:5000/img_proxy?url=" + [uri]::EscapeDataString("https://i0.hdslb.com/bfs/bangumi/image/0af10a0c3258186e96fde4406b384c13dd643d8f.png")).StatusCode -eq 200
  Test-Path data/img_cache/*.png            # 磁盘缓存落盘
  ```
  停服：`Get-Process python | Stop-Process`
- [ ] Commit: `refactor(backend): 模块化+线程安全缓存+图片磁盘缓存+并发批量+后台采样`

### Task 2: 设计系统与页面骨架（R2）

**Files:**
- Create: `templates/base.html`, `static/css/tokens.css`, `static/css/base.css`, `static/css/components.css`, `static/css/pages.css`, `static/js/common.js`
- Modify: `templates/index.html`, `templates/wiki.html`（改为 extends base 的骨架）

**Interfaces:** `common.js` 导出全局 `FM = {fetchJSON, fmt(n), fmtRel(ts), PALETTE, markError(e)}`；base.html 提供 `{% block content %}{% block scripts %}`、header nav、水墨背景层（CSS 山影渐变 + 少量墨点）、footer。

**设计要点：**
- 宣纸底：`#f5f1e8` + 两层 radial-gradient 纸纹 + 极淡山影 SVG 固定背景
- 卡片：白纸面 `#fbf8f1`、1px `rgba(26,26,24,.12)` 墨线框、hover 时墨色加深 + 轻投影，圆角 2px（水墨用直角/微圆角）
- 印章元素：`.seal`（朱砂底白字方章，用于 logo 角标与最新集标记）
- 标题装饰：横线 + 菱形墨点替代 emoji ◆；图标一律内联 SVG 描边风格（不用彩色 emoji）
- 移除粒子/mist 动画，改为一处极淡的墨晕呼吸动画；`prefers-reduced-motion: reduce` 时全禁

**Steps:**
- [ ] 写四个 CSS 文件（tokens 先行，变量命名 `--paper/--ink/--ink-2/--ink-3/--cinnabar/--indigo`）
- [ ] base.html + common.js（含 `window.__pageErrors` 收集器：`window.addEventListener('error',...)` 与 unhandledrejection）
- [ ] 两页骨架换肤（保留旧区块 id 以便后续任务填充）
- [ ] 下载 `static/vendor/echarts.min.js`
- [ ] 验证：起服后 Puppeteer 打开 `/` 与 `/wiki`，截图 1440×900 与 390×844，`__pageErrors` 为空，无横向滚动
- [ ] Commit: `feat(ui): 水墨设计系统+base模板+双页骨架`

### Task 3: 首页功能区块重建（R3）

**Files:**
- Modify: `templates/index.html`（完整区块）, `static/js/index.js`（新建，替换 main.js 引用）, 删除 `static/js/main.js`

**Interfaces:** 消费 Task1 全部端点；渲染要求：
- 英雄区四指标全部来自 `/api/overview`（score 取 rating.score；follow 仅当字段存在才显示该卡）
- 总览六卡数值滚动动画；卡片下标注「更新于 x 分钟前」（overview_time 由前端记录）
- 进度条境界阈值沿用 REALMS 常量并注明「示意」title
- 选集面板：环形进度基准改为 `max(当前值, 该集趋势最大值, 500)`，避免 >10000 人时溢出失真
- `/api/*` code!=0 或网络异常 → 区块显示错误态卡片 + 重试按钮；不再静默
- 自动刷新间隔 30s 可关；手动刷新按钮旋转反馈

**Steps:**
- [ ] 重写 index.html 结构 + index.js 全部逻辑
- [ ] 验证（Puppeteer）：heroScore 与 `/api/overview` rating.score 一致；点击第 1 集 → `#realtimeCount` 非 "--"；搜索"韩立"后网格可见按钮数变化；`__pageErrors` 空；截图两视口
- [ ] Commit: `feat(index): 功能区块重建+真实数据+错误态`

### Task 4: 图表重建（R4）

**Files:**
- Modify: `static/js/index.js`（图表部分）, `templates/index.html`（图表容器）

**要点:** 四图（各集播放柱状 / 选中集雷达 / 实时趋势线 / 全集互动多线）统一墨色主题：柱=墨梯度 `#1a1a18→#4a4a45`、强调线=朱砂、辅助=黛青；播放量与互动图加 `dataZoom(inside+slider)` 替代自绘分页；`IntersectionObserver` 懒初始化离屏图表；resize 用 150ms debounce。

**Steps:**
- [ ] 实现并接入四图
- [ ] 验证：Puppeteer evaluate `Object.keys(window.__charts||{}).length>=4`（index.js 暴露调试句柄）；滚动至图表区截图确认 canvas 已绘；dataZoom 拖动后轴标签变化
- [ ] Commit: `feat(charts): 四图墨色重建+dataZoom+懒加载`

### Task 5: 百科页完善（R5）

**Files:**
- Create: `static/js/wiki.js`; Modify: `templates/wiki.html`

**要点:** 顶部固定搜索框实时过滤所有 `.wiki-detail-card`（匹配标题/正文/标签，无结果时显示空态文案）；tab 切换逻辑迁入 wiki.js；卡片样式走新组件类。

**Steps:**
- [ ] 实现
- [ ] 验证：输入"蜂云"→ 可见卡片数减少且含青竹蜂云剑条目；清空恢复；切换 6 个 tab 正常；截图
- [ ] Commit: `feat(wiki): 搜索过滤+样式统一`

### Task 6: 性能与体验收尾（R6）

**Files:** Modify 各 CSS/JS/模板

**清单:** 字体回退栈核验（无网环境可用宋体）；骨架屏（选集网格与图表初载）；aria-label/role 补齐；focus-visible 样式；时效徽标统一组件；移动端 390px 无横向滚动、网格单列；`loading="lazy"` 全图片。

**Steps:**
- [ ] 逐项落实
- [ ] 验证：两视口截图比对；`document.documentElement.scrollWidth<=innerWidth` 断言；键盘 Tab 可聚焦刷新按钮且有可见焦点环
- [ ] Commit: `polish: 可达性+骨架屏+移动端适配`

### Task 7: 端到端终验（R7）

**Steps:**
- [ ] 杀进程 → 冷启动 → 依序执行 Task3/4/5 全部验证命令 + 两页 × 两视口截图人工复核
- [ ] 数据抽查：任选一集 view 数与 bilibili 网页展示值同数量级且比例合理
- [ ] 全绿后 commit `release: 水墨风重构完成`，向用户汇报轮次记录与改进清单
