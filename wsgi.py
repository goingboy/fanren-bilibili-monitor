"""WSGI 入口 - 供 gunicorn 使用"""
from app import create_app, store

app = create_app()

# 启动时加载缓存
store.load()
