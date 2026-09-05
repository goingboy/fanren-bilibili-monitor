# 凡人修仙传 B站实时数据监控

实时监控《凡人修仙传》动画在 Bilibili 的播放数据。

## 功能

- 实时在线人数监控
- 播放量、弹幕数、点赞数、收藏数统计
- 多季支持（凡人修仙传全四季）
- ECharts 趋势图 & 雷达图
- 图片代理与懒加载
- 后台定时采样趋势数据

## 快速启动

```bash
pip install flask requests
python app.py
```

访问 http://localhost:5000

## 配置

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| FM_HOST | 127.0.0.1 | 监听地址 |
| FM_PORT | 5000 | 监听端口 |
| FM_DEBUG | 0 | 调试模式 |

## 技术栈

- **后端**: Flask + requests
- **前端**: 原生 JS + ECharts
- **数据源**: Bilibili API
