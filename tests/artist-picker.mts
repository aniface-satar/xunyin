import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { buildArtistCandidates } from '../src/core/musicLinks.ts'

const src = (rel: string) => readFileSync(path.join(import.meta.dirname, '..', rel), 'utf8')

test('多歌手候选保留顺序并按归一化名字去重', () => {
  assert.deepEqual(buildArtistCandidates('周杰伦、费玉清、周杰伦'), ['周杰伦', '费玉清'])
  assert.deepEqual(buildArtistCandidates('jay chou / Jay Chou'), ['jay chou'])
  assert.deepEqual(buildArtistCandidates('费玉清 / 张惠妹'), ['费玉清', '张惠妹'])
  assert.deepEqual(buildArtistCandidates('A|B；C;D／E'), ['A', 'B', 'C', 'D', 'E'])
})

test('单歌手与非歌手串不被误拆', () => {
  assert.deepEqual(buildArtistCandidates('周杰伦'), ['周杰伦'])
  assert.deepEqual(buildArtistCandidates('AC/DC'), ['AC/DC'])
  assert.deepEqual(buildArtistCandidates('Simon & Garfunkel'), ['Simon & Garfunkel'])
})

test('空歌手返回空候选', () => {
  assert.deepEqual(buildArtistCandidates(''), [])
  assert.deepEqual(buildArtistCandidates(' 、; '), [])
})

test('歌手选择面板：预解析、未找到置灰、底部滑入', () => {
  const sheet = src('src/components/ArtistPickerSheet/index.tsx')
  assert.match(sheet, /findArtistByName/)
  assert.match(sheet, /useSheetSlideAnimation/)
  assert.match(sheet, /artist_picker_title/)
  assert.match(sheet, /artist_picker_missing/)
  assert.match(sheet, /disabled=\{entry\.status == 'missing'\}/)
})

test('歌手选择面板的歌手间分割线复用更多菜单的配方', () => {
  const sheet = src('src/components/ArtistPickerSheet/index.tsx')
  assert.match(sheet, /separator: \{\s*borderBottomWidth: BorderWidths\.normal/)
  assert.match(sheet, /\[styles\.separator, \{ borderBottomColor: theme\['c-border-background'\] \}\]/)
  assert.match(sheet, /index < entries\.length - 1/)
  assert.doesNotMatch(sheet, /borderTopWidth/)
})

test('共享 hook：单歌手直接跳，多歌手弹选择面板', () => {
  const hook = src('src/utils/hooks/useArtistPicker.ts')
  assert.match(hook, /buildArtistCandidates/)
  assert.match(hook, /names\.length > 1/)
  assert.match(hook, /resolveArtistForMusic/)
  assert.match(hook, /useOpenMusicDetail/)
  assert.match(hook, /artist_not_found/)
})

test('播控页三处歌手入口统一走选择器', () => {
  for (const rel of [
    'src/screens/PlayDetail/Vertical/Player/components/MusicInfo.tsx',
    'src/screens/PlayDetail/Vertical/components/MusicSummary.tsx',
  ]) {
    const file = src(rel)
    assert.match(file, /useArtistPicker/, `${rel} 未接共享 hook`)
    assert.match(file, /<ArtistPickerSheet ref=\{artistSheetRef\}/, `${rel} 未挂选择面板`)
    assert.doesNotMatch(file, /resolveArtistForMusic/, `${rel} 仍在直连单歌手解析`)
  }

  const more = src('src/screens/PlayDetail/Vertical/Player/components/MusicMoreSheet.tsx')
  assert.match(more, /onOpenArtist/)
  assert.match(more, /hide\(\(\) => \{[\s\S]{0,120}onOpenArtist/)
})

test('专辑页头部作者可点进歌手详情', () => {
  const header = src('src/screens/SonglistDetail/Header.tsx')
  assert.match(header, /useArtistPicker/)
  assert.match(header, /<ArtistPickerSheet ref=\{artistSheetRef\}/)
  assert.match(header, /openArtist\(\{ source: info\.source, singer: detailInfo\.author/)
})

test('三语文案包含歌手选择器文案', () => {
  for (const lang of ['zh-cn', 'zh-tw', 'en-us']) {
    const messages = JSON.parse(src(`src/lang/${lang}.json`))
    for (const key of ['artist_picker_title', 'artist_picker_missing']) {
      assert.equal(typeof messages[key], 'string', `${lang} 缺少 ${key}`)
      assert.ok(messages[key].length > 0, `${lang} 的 ${key} 不能为空`)
    }
  }
})
