# -*- coding: utf-8 -*-
"""Add thumbnail images to wiki cards using Bilibili episode covers."""
import json, re, urllib.request

# Fetch episode covers
data = json.loads(urllib.request.urlopen('http://localhost:5000/api/episodes', timeout=10).read())
eps = data['data']

# Map character names to episode index (1-based)
CHAR_EP_MAP = {
    '韩立': 1, '南宫婉': 15, '墨大夫': 3, '厉飞雨': 5, '张铁': 4,
    '墨彩环': 8, '钟卫天': 2, '陈巧倩': 20, '三叔': 1, '万小山': 10,
    '金光上人': 12, '贾天龙': 6, '李化元': 22, '董萱儿': 25, '红拂': 28,
    '令狐老祖': 30, '马师伯': 18, '吴师叔': 16, '王蝉': 32, '辛如音': 38,
    '齐云霄': 40, '菡云芝': 14, '浮云子': 24, '穹老怪': 23, '陆云风': 11,
    '胥王': 42, '叶蛇': 44, '青纹': 43, '冰妖': 45, '铁罗': 46,
    '紫灵': 80, '银月': 85, '文思月': 90, '元瑶': 88, '金魁': 95,
    '极阴': 100, '玄骨': 105, '文樯': 92, '顾东主': 91, '乌丑': 102,
    '童老': 35, '鬼老': 36, '古长老': 98, '范静梅': 82, '妍丽': 87,
    '向之礼': 110, '慕兰': 130, '苗长老': 97, '极炫': 106, '燕如嫣': 33,
    '田不缺': 37, '燕家老祖': 34,
    '落云宗': 150, '天南修士': 140, '慕兰圣女': 135, '慕兰大祭司': 138,
    '天南元婴': 145, '天南结丹': 142, '天南筑基': 141, '慕兰法士团': 136,
    '慕兰勇士': 137, '九国盟': 148, '天南散修': 143, '掩月宗弟子': 152,
    '落云宗弟子': 151, '黄枫谷遗众': 149, '天南灵脉': 155, '天南凡人': 156,
    '慕兰部落': 139, '落云宗掌门': 153, '掩月宗掌门': 154, '天南商会': 157,
    '南宫婉（重逢）': 158, '韩立（元婴）': 160,
}

# Build cover map: episode_number -> cover_url
cover_map = {}
for i, ep in enumerate(eps):
    cover = ep.get('cover', '')
    if cover:
        cover_map[i + 1] = cover

# Read wiki.html
with open('E:/test_claude/fanren_monitor/templates/wiki.html', 'r', encoding='utf-8') as f:
    html = f.read()

# For each character card, add a small thumbnail image
# Strategy: after the wiki-detail-avatar div, add a small cover image
added = 0
for char_name, ep_idx in CHAR_EP_MAP.items():
    cover = cover_map.get(ep_idx, '')
    if not cover:
        continue
    
    # Find the card containing this character name
    # Pattern: <h3>CHAR_NAME</h3> ... look backwards for the card opening
    # Simpler: find the h3 and add image after the header section
    
    # Find h3 with this character name (exact match)
    escaped_name = re.escape(char_name)
    pattern = r'(<h3>' + escaped_name + r'</h3>)'
    match = re.search(pattern, html)
    if not match:
        # Try partial match
        short_name = char_name.split('（')[0].split('·')[0].strip()
        pattern = r'(<h3>' + re.escape(short_name) + r'(?:\s*<small[^>]*>[^<]*</small>)?</h3>)'
        match = re.search(pattern, html)
    
    if not match:
        continue
    
    # Find the parent wiki-detail-header div that contains this h3
    # We'll add the image right before the closing </div> of wiki-detail-header
    h3_pos = match.start()
    
    # Search forward for </div> that closes wiki-detail-header
    header_close = html.find('</div>', h3_pos)
    if header_close == -1:
        continue
    
    # Check this is the header close (not a nested div)
    # Count opens/closes between h3 and this </div>
    segment = html[h3_pos:header_close+6]
    depth = 0
    real_close = -1
    for m in re.finditer(r'<div|</div>', segment):
        if m.group() == '<div':
            depth += 1
        else:
            depth -= 1
            if depth == 0:
                real_close = h3_pos + m.end()
                break
    
    if real_close == -1:
        continue
    
    # Insert thumbnail image before the header's closing </div>
    # proxy the cover URL through img_proxy
    proxy_url = '/img_proxy?url=' + cover
    img_html = (
        f'\n                        <img src="{proxy_url}" '
        f'alt="{char_name}" class="wiki-card-thumb" loading="lazy">'
    )
    
    html = html[:real_close] + img_html + html[real_close:]
    added += 1

# Write back
with open('E:/test_claude/fanren_monitor/templates/wiki.html', 'w', encoding='utf-8') as f:
    f.write(html)

print(f'Added {added} thumbnail images')
