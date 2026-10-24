package cn.toside.music.nativeapp.userapi

import cn.toside.music.core.data.DataRepository
import cn.toside.music.core.setting.SettingsStore
import cn.toside.music.core.storage.InMemoryKvStore
import cn.toside.music.core.storage.ShardedKvStore
import cn.toside.music.core.userapi.BuiltinSeedDefinition
import cn.toside.music.core.userapi.BuiltinUpdateCatalog
import cn.toside.music.core.userapi.RemovedBuiltinSource
import cn.toside.music.core.userapi.ScriptHeaderInfo
import cn.toside.music.core.userapi.ScriptResolver
import cn.toside.music.core.userapi.UserApiCatalog
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 可写音源目录的整条链路：播种 → 导入 → 列表 → 换源/启停 → 更新地址编辑 → 换脚本 → 删除。
 *
 * 用 [InMemoryKvStore] + 假随包目录跑，不依赖 Android。
 */
class UserApiSourceStoreTest {
    private companion object {
        const val ONLINE_ID = "builtin_online"
        const val LOCAL_ID = "builtin_local"

        /** 头部注释必须是 ` * @key value` 的形式：ScriptResolver 与 RN 的 matchInfo 都这样认。 */
        fun script(
            name: String,
            version: String,
            updateUrl: String = "",
        ): String =
            buildString {
                append("/*\n")
                append(" * @name ").append(name).append('\n')
                append(" * @version ").append(version).append('\n')
                append(" * @description 测试脚本 ").append(version).append('\n')
                append(" * @author 测试者\n")
                append(" * @homepage https://example.com/author\n")
                if (updateUrl.isNotEmpty()) append(" * @updateUrl ").append(updateUrl).append('\n')
                append(" */\n")
                append("('use strict');\n")
                append("module.exports = function() { return { version: '").append(version).append("' } };\n")
            }

        val ONLINE_SCRIPT = script("在线内置源", "1.0.0")
        val LOCAL_SCRIPT = script("本地内置源", "1.0.0", "https://local.example/version")

        fun settingsStore(): SettingsStore = SettingsStore(DataRepository(ShardedKvStore(InMemoryKvStore())))
    }

    /** 假随包目录：正文「在 assets 里」，用 definitions 顶替。 */
    private class FakeCatalog(
        val definitions: List<BuiltinSeedDefinition>,
        val removed: List<RemovedBuiltinSource> = emptyList(),
    ) : BuiltinSourceCatalog {
        override fun definitions(): List<BuiltinSeedDefinition> = definitions

        override fun scriptOf(id: String): String? = definitions.firstOrNull { it.id == id }?.script

        override fun updateCatalog(): BuiltinUpdateCatalog = BuiltinUpdateCatalog.EMPTY
    }

    private fun catalog(removed: List<RemovedBuiltinSource> = emptyList()): FakeCatalog {
        // 下架的源不再随包发布：definitions 里没有它，assets 里的正文也跟着没了
        val retired = removed.map { it.id }.toSet()
        return FakeCatalog(
            removed = removed,
            definitions =
                allDefinitions().filterNot { it.id in retired },
        )
    }

    private fun allDefinitions(): List<BuiltinSeedDefinition> =
        listOf(
            BuiltinSeedDefinition(
                id = ONLINE_ID,
                kind = "online",
                name = "在线内置源",
                version = "1.0.0",
                description = "随包在线源",
                author = "作者A",
                homepage = "https://example.com/a",
                script = ONLINE_SCRIPT,
                updateUrl = "https://online.example/latest.js",
                fallbackUpdateUrls = listOf("https://mirror.example/latest.js"),
                autoUpdate = true,
                autoCheck = true,
            ),
            BuiltinSeedDefinition(
                id = LOCAL_ID,
                kind = "local",
                name = "本地内置源",
                version = "1.0.0",
                description = "随包本地源",
                author = "作者B",
                homepage = "https://example.com/b",
                script = LOCAL_SCRIPT,
                scriptUpdateUrl = "https://local.example/version",
                autoUpdate = true,
                autoCheck = true,
            ),
        )

    private fun store(
        kv: InMemoryKvStore = InMemoryKvStore(),
        catalog: FakeCatalog = catalog(),
    ): UserApiSourceStore =
        UserApiSourceStore(
            kv = kv,
            builtin = catalog,
            removedSources = catalog.removed,
            now = { 1_000L },
            randomSuffix = { "123" },
        )

    // ---------- 播种 ----------

    @Test
    fun firstReadSeedsBundledSources() =
        runBlocking {
            val list = store().list()

            assertEquals(listOf(ONLINE_ID, LOCAL_ID), list.map { it.id })
            assertEquals("在线内置源", list[0].name)
            assertEquals("https://online.example/latest.js", list[0].updateUrl)
            assertEquals("online", list[0].builtin)
            assertEquals("https://local.example/version", list[1].scriptUpdateUrl)
        }

    @Test
    fun bundledScriptsAreNotCopiedIntoKvButStillReadable() =
        runBlocking {
            val kv = InMemoryKvStore()

            val list = store(kv).list()

            // 随包正文留在 assets：KV 只存「用户/更新换上的那份」，350KB 的脚本不必存两遍
            assertNull(kv.snapshot()["userapi.script.$ONLINE_ID"])
            assertTrue(kv.snapshot().containsKey("userapi.list"))
            assertEquals(2, list.size)
            assertEquals(ONLINE_SCRIPT, store(kv).scriptOf(ONLINE_ID))
            assertEquals(LOCAL_SCRIPT, store(kv).scriptOf(LOCAL_ID))
        }

    @Test
    fun seedingIsIdempotentAcrossRestarts() =
        runBlocking {
            val kv = InMemoryKvStore()
            val imported = store(kv).importScript(script("我的源", "0.1"), "https://mine.example/x.js").getOrThrow()

            val reopened = store(kv)

            assertEquals(listOf(ONLINE_ID, LOCAL_ID, imported.id), reopened.list().map { it.id })
        }

    @Test
    fun removedBuiltinSourceLeavesTheListAndLosesItsScript() =
        runBlocking {
            val kv = InMemoryKvStore()
            store(kv).list()

            val reopened = store(kv, catalog(removed = listOf(RemovedBuiltinSource(LOCAL_ID, "本地内置源"))))

            assertEquals(listOf(LOCAL_ID), reopened.prepare())
            assertEquals(listOf(ONLINE_ID), reopened.list().map { it.id })
            assertNull(reopened.scriptOf(LOCAL_ID))
        }

    @Test
    fun removedBuiltinSourceHandedOverByTheUserStaysAsCustomSource() =
        runBlocking {
            val kv = InMemoryKvStore()
            val store = store(kv)
            store.list()
            // 用户接手 = 自己填过更新地址，并且真的换上过一份脚本（那份脚本是他自己的东西）
            val mine = script("本地内置源 用户版", "1.2.0")
            store.writeScript(LOCAL_ID, mine, ScriptResolver.parseScriptHeader(mine))
            store.refreshFromScript(LOCAL_ID)
            store.setUpdateUrl(LOCAL_ID, "https://user.example/mine.js")

            val reopened = store(kv, catalog(removed = listOf(RemovedBuiltinSource(LOCAL_ID, "本地内置源"))))

            val info = reopened.find(LOCAL_ID)
            assertNotNull(info)
            assertNull(info?.builtin)
            assertEquals("https://user.example/mine.js", info?.updateUrl)
            assertEquals(mine, reopened.scriptOf(LOCAL_ID))
        }

    @Test
    fun removedBuiltinSourceWithoutItsOwnScriptIsDropped() =
        runBlocking {
            val kv = InMemoryKvStore()
            val store = store(kv)
            store.list()

            val reopened = store(kv, catalog(removed = listOf(RemovedBuiltinSource(LOCAL_ID, "本地内置源"))))

            // 随包正文只在 assets：应用不再带这个源就没有任何地方还留着脚本，条目一起删掉
            assertEquals(listOf(LOCAL_ID), reopened.prepare())
            assertNull(reopened.find(LOCAL_ID))
            assertNull(reopened.scriptOf(LOCAL_ID))
        }

    // ---------- 导入 ----------

    @Test
    fun importAddsEntryToTheListAndStoresItsScript() =
        runBlocking {
            val store = store()
            val text = script("我的自定义源", "2.3.4", "https://mine.example/update")

            val info = store.importScript(text, "  https://mine.example/latest.js  ").getOrThrow()

            assertEquals("user_api_123_1000", info.id)
            assertEquals("我的自定义源", info.name)
            assertEquals("2.3.4", info.version)
            // 来源地址入库后就能参加自动检查；地址两侧的空格不算内容
            assertEquals("https://mine.example/latest.js", info.updateUrl)
            assertEquals("https://mine.example/update", info.scriptUpdateUrl)
            assertNull(info.builtin)
            assertEquals(text, store.scriptOf(info.id))
            assertEquals(
                listOf(ONLINE_ID, LOCAL_ID, info.id),
                store.list().map { it.id },
            )
        }

    @Test
    fun importWithoutHeaderCommentIsRejected() =
        runBlocking {
            val kv = InMemoryKvStore()
            val store = store(kv)

            val result = store.importScript("module.exports = function() {}")

            assertTrue(result.isFailure)
            assertEquals(listOf(ONLINE_ID, LOCAL_ID), store.list().map { it.id })
            assertFalse(kv.snapshot().containsKey("userapi.script.user_api_123_1000"))
        }

    @Test
    fun importedSourceIsVisibleAfterReopen() =
        runBlocking {
            val kv = InMemoryKvStore()
            val info = store(kv).importScript(script("我的源", "0.2"), null).getOrThrow()

            val reopened = store(kv)

            assertEquals(listOf(ONLINE_ID, LOCAL_ID, info.id), reopened.list().map { it.id })
            assertEquals("我的源", reopened.nameOf(info.id))
            assertEquals("0.2", reopened.versionOf(info.id))
            // 本地导入没有来源地址：不该被后台检查挑中
            assertEquals("", reopened.userUpdateUrl(info.id))
            assertTrue(reopened.updateUrlSource(info.id)?.updateUrl?.isEmpty() == true)
        }

    @Test
    fun importingBeyondTheCapIsRefusedAndTheListStaysAsIs() =
        runBlocking {
            // store() 的后缀是写死的，连着导入会撞同一个 id，这里要一份自增的
            var seq = 0
            val store =
                UserApiSourceStore(
                    kv = InMemoryKvStore(),
                    builtin = catalog(),
                    removedSources = emptyList(),
                    now = { 1_000L },
                    randomSuffix = { (++seq).toString() },
                )
            // 随包两个 + 自定义 18 个 = 上限 20
            repeat(UserApiCatalog.MAX_SOURCE_COUNT - 2) { store.importScript(script("我的源 $it", "0.1"), null).getOrThrow() }

            val result = store.importScript(script("装不下的源", "0.1"), null)

            assertTrue(result.isFailure)
            assertEquals(UserApiCatalog.MAX_SOURCE_COUNT, store.list().size)
            assertFalse(store.list().any { it.name == "装不下的源" })
        }

    // ---------- 启停 ----------

    @Test
    fun currentSourceFallsBackWhenTheStoredIdIsGone() =
        runBlocking {
            val settings = settingsStore()
            settings.set("common.apiSource", "builtin_gone")

            val target = UserApiSourceSelector(store(), settings).resolve()

            // 退到在线内置源（RN pickAvailableUserApiId 的顺序），并把结果写回设置
            assertEquals(ONLINE_ID, target)
            assertEquals(ONLINE_ID, settings.string("common.apiSource"))
        }

    @Test
    fun switchingSourcePersistsTheChoice() =
        runBlocking {
            val settings = settingsStore()
            val selector = UserApiSourceSelector(store(), settings)

            selector.select(LOCAL_ID)

            assertEquals(LOCAL_ID, settings.string("common.apiSource"))
            assertEquals(LOCAL_ID, selector.resolve())
        }

    @Test
    fun currentSourceWinsOverTheStoredOneWhenItIsStillListed() =
        runBlocking {
            val settings = settingsStore()
            settings.set("common.apiSource", ONLINE_ID)

            assertEquals(ONLINE_ID, UserApiSourceSelector(store(), settings).resolve())
        }

    // ---------- 更新地址编辑 ----------

    @Test
    fun updateUrlEditClearsTheRejectedMark() =
        runBlocking {
            val store = store()
            val info = store.importScript(script("我的源", "0.3"), "https://mine.example/a.js").getOrThrow()

            store.setUpdateUrlRejected(info.id, "https://mine.example/a.js")
            assertEquals("https://mine.example/a.js", store.find(info.id)?.updateUrlRejected)

            store.setUpdateUrl(info.id, "https://mine.example/b.js")

            val next = store.find(info.id)
            assertEquals("https://mine.example/b.js", next?.updateUrl)
            assertNull(next?.updateUrlRejected)
        }

    @Test
    fun clearingUpdateUrlStopsAutoChecksForThatSource() =
        runBlocking {
            val store = store()
            val info = store.importScript(script("我的源", "0.4"), "https://mine.example/a.js").getOrThrow()
            store.setUpdateUrl(info.id, "https://mine.example/c.js")

            store.setUpdateUrl(info.id, "")

            assertEquals("", store.find(info.id)?.updateUrl)
            assertEquals("", store.updateUrlSource(info.id)?.updateUrl)
        }

    @Test
    fun checkStatePersistsAcrossReopen() =
        runBlocking {
            val kv = InMemoryKvStore()
            val first = store(kv)
            first.importScript(script("我的源", "0.5"), null).getOrThrow()
            first.setLastCheckAt(ONLINE_ID, 123_456_789L)
            first.setVerifyPending(ONLINE_ID, true)

            val reopened = store(kv)

            assertEquals(123_456_789L, reopened.lastCheckAt(ONLINE_ID))
            assertTrue(reopened.verifyPending(ONLINE_ID))
        }

    @Test
    fun updateUrlSourceCarriesAddressKindAndVersion() =
        runBlocking {
            val source = store().updateUrlSource(LOCAL_ID)

            assertEquals(LOCAL_ID, source?.id)
            assertEquals("local", source?.builtinKind)
            assertEquals("", source?.updateUrl)
            assertEquals("https://local.example/version", source?.scriptUpdateUrl)
            assertEquals("1.0.0", source?.version)
            assertEquals(0L, source?.lastCheckAt)
        }

    // ---------- 换脚本 / 删除 ----------

    @Test
    fun refreshFromScriptFollowsTheNewHeaderButKeepsTheUserAddress() =
        runBlocking {
            val store = store()
            val info = store.importScript(script("我的源", "1.0.0", "https://old.example/update"), null).getOrThrow()
            store.setUpdateUrl(info.id, "https://user.example/mine.js")

            // 更新执行器写新脚本的样子：正文换掉、头部一起写
            val newer = script("我的源 改名了", "1.1.0", "https://new.example/update")
            store.writeScript(info.id, newer, ScriptResolver.parseScriptHeader(newer))

            assertTrue(store.refreshFromScript(info.id))

            val next = store.find(info.id)
            assertEquals("我的源 改名了", next?.name)
            assertEquals("1.1.0", next?.version)
            assertEquals("https://new.example/update", next?.scriptUpdateUrl)
            // 用户在设置里填的地址是用户的话，不能被他刚换上的脚本盖掉
            assertEquals("https://user.example/mine.js", next?.updateUrl)
        }

    @Test
    fun runtimeUpgradedBundledScriptSurvivesNextSeeding() =
        runBlocking {
            val kv = InMemoryKvStore()
            val store = store(kv)
            val newer = script("在线内置源", "1.1.0")

            // 真机上这份脚本是运行时更新出来的，清单早就播好了；不先播一次就直接写，
            // 等于模拟「清单还没落」的顺序——那时按 RN 的规则随包那份会重新盖进来，是对的。
            store.list()
            // 自动更新换上来的那份：正文 + 头部 + 「还没被加载验证过」的标记
            store.writeScript(ONLINE_ID, newer, ScriptResolver.parseScriptHeader(newer))
            store.refreshFromScript(ONLINE_ID)
            store.setVerifyPending(ONLINE_ID, true)

            val reopened = store(kv)

            assertEquals(newer, reopened.scriptOf(ONLINE_ID))
            assertEquals("1.1.0", reopened.versionOf(ONLINE_ID))
            assertEquals("1.1.0", reopened.updateUrlSource(ONLINE_ID)?.version)
            assertTrue(reopened.verifyPending(ONLINE_ID))
            assertEquals(listOf(ONLINE_ID, LOCAL_ID), reopened.list().map { it.id })
        }

    @Test
    fun removeSourceDropsEntryScriptAndBackup() =
        runBlocking {
            val kv = InMemoryKvStore()
            val store = store(kv)
            val info = store.importScript(script("我的源", "1.0.0"), null).getOrThrow()
            store.writeBackup(info.id, script("旧版", "0.9.0"))

            assertTrue(store.removeSource(info.id))

            assertEquals(listOf(ONLINE_ID, LOCAL_ID), store.list().map { it.id })
            assertNull(store.scriptOf(info.id))
            assertNull(store.readBackup(info.id))
            assertFalse(store.removeSource(info.id))
            assertFalse(kv.snapshot().containsKey("userapi.script.${info.id}"))
        }

    @Test
    fun scriptInfoPrefersTheScriptHeader() =
        runBlocking {
            val store = store()

            val info = store.scriptInfo(LOCAL_ID)

            assertEquals(LOCAL_ID, info?.id)
            assertEquals("本地内置源", info?.name)
            assertEquals(LOCAL_SCRIPT, info?.script)
            // 头部注释是作者手写的那份，随包清单只是占位：两者不同时以脚本头部为准
            assertEquals("测试脚本 1.0.0", info?.description)
            assertEquals("https://example.com/author", info?.homepage)
            assertNull(store.scriptInfo("nope"))
        }

    @Test
    fun scriptInfoFillsGapsFromTheCatalogEntry() =
        runBlocking {
            val store = store()
            store.list()
            // 更新执行器只写了名字和版本：其余字段头部是空的，得回落到清单条目
            store.writeScript(
                LOCAL_ID,
                LOCAL_SCRIPT,
                ScriptHeaderInfo(
                    name = "本地内置源 改过名",
                    version = "1.0.0",
                    description = "",
                    author = "",
                    homepage = "",
                    updateUrl = "",
                    buildTime = 0L,
                ),
            )

            val info = store.scriptInfo(LOCAL_ID)

            assertEquals("本地内置源 改过名", info?.name)
            assertEquals("随包本地源", info?.description)
            assertEquals("https://example.com/b", info?.homepage)
            assertEquals("作者B", info?.author)
        }
}
