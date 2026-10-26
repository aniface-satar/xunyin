# 临时脚本：提取 JUnit 失败堆栈（用后即删）
import glob
import xml.etree.ElementTree as ET

files = glob.glob('core/build/test-results/test/TEST-*.xml')
print('xml count:', len(files))
n = 0
for p in files:
    t = ET.parse(p).getroot()
    for tc in t.iter('testcase'):
        for fail in list(tc.findall('failure')) + list(tc.findall('error')):
            n += 1
            print('====', tc.get('classname').split('.')[-1], '::', tc.get('name'))
            print((fail.text or '')[:1300])
            print()
print('total failures:', n)
