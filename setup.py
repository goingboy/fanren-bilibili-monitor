from setuptools import setup, find_packages

setup(
    name="fanren-monitor",
    version="1.0.0",
    py_modules=["app", "bilibili_api", "cache_store", "config", "img_cache", "sampler", "wsgi"],
    install_requires=[
        "flask==3.0.0",
        "requests==2.31.0",
        "gunicorn==22.0.0",
    ],
)
