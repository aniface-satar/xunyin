# 临时脚本：统计测试数（用后即删）
import glob
import xml.etree.ElementTree as ET

t = f = s = 0
for p in glob.glob('core/build/test-results/test/*.xml'):
    r = ET.parse(p).getroot()
    t += int(r.get('tests', 0))
    f += int(r.get('failures', 0))
    s += int(r.get('skipped', 0))
print('core tests', t, 'failures', f, 'skipped', s)
