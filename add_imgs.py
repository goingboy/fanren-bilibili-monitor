# -*- coding: utf-8 -*-
import json, re, urllib.request

data = json.loads(urllib.request.urlopen('http://localhost:5000/api/episodes', timeout=10).read())
eps = data['data']

cover_map = {}
for i, ep in enumerate(eps):
    c = ep.get('cover', '')
    if c:
        cover_map[i+1] = c

with open('E:/test_claude/fanren_monitor/templates/wiki.html', 'r', encoding='utf-8') as f:
    html = f.read()

h3s = re.findall(r'<h3>([^<]+)</h3>', html)
print(f'Found {len(h3s)} h3 tags')

added = 0
for idx, h3_text in enumerate(h3s):
    search = '<h3>' + h3_text + '</h3>'
    pos = html.find(search)
    if pos == -1:
        continue

    before = html[max(0, pos-2000):pos]
    card_re = re.compile(r'<div class="wiki-detail-card[^"]*">')
    card_matches = list(card_re.finditer(before))
    if not card_matches:
        continue

    card_start = max(0, pos-2000) + card_matches[-1].start()

    next_card = html.find('class="wiki-detail-card', pos + len(search))
    next_arc = html.find('wiki-arc-header', pos + len(search))
    candidates = [x for x in [next_card, next_arc] if x > 0]
    card_end = min(candidates) if candidates else len(html)
    card_html = html[card_start:card_end]

    if 'wiki-card-thumb' in card_html:
        continue

    cover_idx = (idx % len(cover_map)) + 1
    cover_url = cover_map.get(cover_idx, '')
    if not cover_url:
        continue

    header_idx = card_html.find('wiki-detail-header')
    if header_idx == -1:
        continue
    header_close = card_html.find('</div>', header_idx)
    if header_close == -1:
        continue

    seg = card_html[header_idx:header_close + 6]
    depth = 0
    inject_offset = -1
    for m in re.finditer(r'<div|</div>', seg):
        if m.group() == '<div':
            depth += 1
        else:
            depth -= 1
            if depth == 0:
                inject_offset = header_idx + m.end()
                break

    if inject_offset == -1:
        continue

    proxy_url = '/img_proxy?url=' + cover_url
    img_tag = '<img src="' + proxy_url + '" alt="" class="wiki-card-thumb" loading="lazy">'

    actual_pos = card_start + inject_offset
    html = html[:actual_pos] + '\n                        ' + img_tag + html[actual_pos:]
    added += 1

with open('E:/test_claude/fanren_monitor/templates/wiki.html', 'w', encoding='utf-8') as f:
    f.write(html)

print(f'Added {added} thumbnail images')
