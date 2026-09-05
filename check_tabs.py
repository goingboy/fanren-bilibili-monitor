# -*- coding: utf-8 -*-
c = open('E:/test_claude/fanren_monitor/templates/wiki.html', 'r', encoding='utf-8').read()
tabs = ['tab-realms', 'tab-items', 'tab-pets', 'tab-formations', 'tab-world']
for t in tabs:
    idx = c.find('id="' + t + '"')
    section = c[idx:idx+5000]
    a = section.count('wiki-detail-avatar')
    th = section.count('wiki-card-thumb')
    h3 = section.count('<h3>')
    print(f'{t}: avatar={a} thumb={th} h3={h3}')
