# -*- coding: utf-8 -*-
import re

with open('E:/test_claude/fanren_monitor/templates/wiki.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Remove wiki-detail-avatar divs
content = re.sub(r'<div class="wiki-detail-avatar"[^>]*>[^<]*</div>\s*', '', content)

# Remove img.wiki-card-thumb
content = re.sub(r'<img [^>]*class="wiki-card-thumb"[^>]*>\s*', '', content)

# Remove wiki-detail-subtitle spans
content = re.sub(r'<span class="wiki-detail-subtitle">[^<]*</span>\s*', '', content)

# Remove wiki-detail-header wrapper (keep inner h3)
# Pattern: <div class="wiki-detail-header">\n...<div>\n<h3>...</h3>\n</div>\n</div>
# becomes just: <h3>...</h3>
content = re.sub(
    r'<div class="wiki-detail-header">\s*<div>\s*(<h3>.*?</h3>)\s*</div>\s*</div>',
    r'\1',
    content,
    flags=re.DOTALL
)

# Clean up empty wiki-detail-body divs that may result
content = re.sub(r'<div class="wiki-detail-body">\s*</div>', '', content)

# Verify
avatars = content.count('wiki-detail-avatar')
thumbs = content.count('wiki-card-thumb')
subtitles = content.count('wiki-detail-subtitle')
headers = content.count('wiki-detail-header')
cards = content.count('wiki-detail-card')
h3s = content.count('<h3>')
print(f'avatars={avatars} thumbs={thumbs} subtitles={subtitles} headers={headers} cards={cards} h3={h3s}')

with open('E:/test_claude/fanren_monitor/templates/wiki.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done. File size:', len(content))
