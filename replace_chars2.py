# -*- coding: utf-8 -*-
import re

with open('E:/test_claude/fanren_monitor/templates/wiki.html', 'r', encoding='utf-8') as f:
    content = f.read()

with open('E:/test_claude/fanren_monitor/chars_new.html', 'r', encoding='utf-8') as f:
    chars_html = f.read()

pattern = re.compile(r'        <!-- \u4eba\u7269\u5fd7 -->.*?(?=        <!-- \u5883\u754c\u5f55 -->)', re.DOTALL)
if not pattern.search(content):
    print('ERROR: section not found')
    raise SystemExit(1)

new_block = (
    '        <!-- \u4eba\u7269\u5fd7 -->\n'
    '        <div class="wiki-tab-content active" id="tab-characters">\n'
    '            <div class="wiki-section-grid">\n'
    + chars_html + '\n'
    '            </div>\n'
    '        </div>\n\n'
)

content = pattern.sub(new_block, content, count=1)

with open('E:/test_claude/fanren_monitor/templates/wiki.html', 'w', encoding='utf-8') as f:
    f.write(content)

# Count
cards = content.count('wiki-detail-card')
print(f'Cards in file: {cards}')
print(f'File size: {len(content)}')
