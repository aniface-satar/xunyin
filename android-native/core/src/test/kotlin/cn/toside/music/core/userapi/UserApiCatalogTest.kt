package cn.toside.music.core.userapi

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * `UserApiCatalog` 用例 —— 逐条对照 RN：
 * `src/utils/data.ts` 的 `addUserApi` / `matchInfo` / `setUserApiUpdateUrl`、
 * `src/utils/builtinSources.ts` 的 `planBuiltinSeed` / `pickAvailableUserApiId`。
 */
class UserApiCatalogTest {
    private val headerScript =
        """
        /*
         * @name 测试音源
         * @version 1.2.3
         * @description 一个用来测试的源
         * @author tester
         * @homepage https://example.com
         * @updateUrl https://example.com/update.json
         */
        (() => {
          const apiFunc = {
            getMusicUrl: async() => ({ type: '128k', url: 'https://example.com/1.mp3' }),
          }
          return {
            sources: { test: { type: 'music', actions: ['musicUrl'], qualitys: ['128k'] } },
            __enum__: { qualitys: ['128k'] },
            ...apiFunc,
          }
        })()
        """.trimIndent()

    private fun script(
        name: String,
        version: String,
        updateUrl: String = "",
    ): String =
        "/*\n * @name $name\n * @version $version\n" +
            (if (updateUrl.isEmpty()) "" else " * @updateUrl $updateUrl\n") +
            " */\n(() => {})()"

    private fun onlineDef(
        id: String = "builtin_online",
        version: String = "1.0.0",
        updateUrl: String = "https://cdn.example.com/$id.js",
        legacy: List<String> = emptyList(),
        fallback: List<String> = emptyList(),
    ) = BuiltinSeedDefinition(
        id = id,
        kind = "online",
        name = id,
        version = version,
        script = script(id, version),
        updateUrl = updateUrl,
        legacyUpdateUrls = legacy,
        fallbackUpdateUrls = fallback,
        scriptUpdateUrl = "https://author.example.com/$id",
        autoUpdate = updateUrl.isNotEmpty(),
        autoCheck = updateUrl.isNotEmpty(),
    )

    private fun localDef(
        id: String = "builtin_local",
        version: String = "1.0.0",
        scriptUpdateUrl: String = "",
        checkUrls: List<String> = emptyList(),
    ) = BuiltinSeedDefinition(
        id = id,
        kind = "local",
        name = id,
        version = version,
        script = script(id, version),
        scriptUpdateUrl = scriptUpdateUrl,
        autoUpdate = scriptUpdateUrl.isNotEmpty() || checkUrls.isNotEmpty(),
        checkUpdateUrls = checkUrls,
        autoCheck = scriptUpdateUrl.isNotEmpty() || checkUrls.isNotEmpty(),
    )

    // ---------- 导入 ----------

    @Test
    fun importedInfoUsesHeaderFields() {
        val info = UserApiCatalog.buildImportedInfo(headerScript, now = 1_700_000_000_000L, randomSuffix = "123").getOrThrow()
        assertEquals("user_api_123_1700000000000", info.id)
        assertEquals("测试音源", info.name)
        assertEquals("1.2.3", info.version)
        assertEquals("一个用来测试的源", info.description)
        assertEquals("tester", info.author)
        assertEquals("https://example.com", info.homepage)
        // 脚本头部自己写的地址跟着入库，用户没填来源地址时也能检查更新
        assertEquals("https://example.com/update.json", info.scriptUpdateUrl)
        assertEquals(0L, info.lastCheckAt)
        assertFalse(info.verifyPending)
    }

    @Test
    fun importedInfoRecordsSourceUrlTrimmed() {
        val info = UserApiCatalog.buildImportedInfo(headerScript, updateUrl = "  https://a.com/x.js ", now = 1L, randomSuffix = "999").getOrThrow()
        assertEquals("https://a.com/x.js", info.updateUrl)
    }

    @Test
    fun importRejectsContentWithoutHeader() {
        val result = UserApiCatalog.buildImportedInfo("console.log('hi')")
        assertTrue(result.isFailure)
    }

    @Test
    fun importTruncatesLongHeaderFields() {
        val longName = "字".repeat(30)
        val longHomepage = "h".repeat(1100)
        val text = "/*\n * @name $longName\n * @version 1.0.0\n * @homepage $longHomepage\n */\n(() => {})()"
        val info = UserApiCatalog.buildImportedInfo(text, now = 1L, randomSuffix = "100").getOrThrow()
        // RN INFO_NAMES：name 24、homepage 1024，截断后补省略号
        assertEquals("字".repeat(24) + "...", info.name)
        assertEquals("h".repeat(1024) + "...", info.homepage)
    }

    @Test
    fun importFallsBackToGeneratedNameWhenHeaderHasNone() {
        val text = "/*\n * @version 1.0.0\n */\n(() => {})()"
        val info = UserApiCatalog.buildImportedInfo(text, now = 5L, randomSuffix = "777").getOrThrow()
        assertEquals("user_api_5", info.name)
    }

    // ---------- 更新后刷新条目 ----------

    @Test
    fun applyScriptInfoKeepsUserUpdateUrl() {
        val info =
            UserApiInfo(
                id = "user_api_1",
                name = "旧名",
                version = "1.0.0",
                description = "旧说明",
                updateUrl = "https://user.example.com/me.json",
                scriptUpdateUrl = "https://old.example.com/page",
            )
        val next =
            UserApiCatalog.applyScriptInfo(
                info,
                "/*\n * @name 新名\n * @version 2.0.0\n * @description 新说明\n * @updateUrl https://new.example.com/page\n */\n(() => {})()",
            )
        assertEquals("新名", next.name)
        assertEquals("2.0.0", next.version)
        assertEquals("新说明", next.description)
        assertEquals("https://new.example.com/page", next.scriptUpdateUrl)
        // 用户自己填的那个地址不动：覆盖它等于把他的话擦掉
        assertEquals("https://user.example.com/me.json", next.updateUrl)
    }

    @Test
    fun applyScriptInfoKeepsNameWhenNewHeaderOmitsIt() {
        val next =
            UserApiCatalog.applyScriptInfo(
                UserApiInfo(id = "a", name = "有名字"),
                "/*\n * @version 2.0.0\n */\n(() => {})()",
            )
        assertEquals("有名字", next.name)
        assertEquals("2.0.0", next.version)
    }

    @Test
    fun updateUserUrlClearsRejectedMark() {
        val info = UserApiInfo(id = "a", name = "n", updateUrl = "https://x/y", updateUrlRejected = "https://x/y")
        val next = UserApiCatalog.withUserUpdateUrl(info, " https://z ")
        assertEquals("https://z", next.updateUrl)
        assertNull(next.updateUrlRejected)
    }

    @Test
    fun rejectedUrlMarkIsIdempotent() {
        val info = UserApiInfo(id = "a", name = "n")
        assertEquals(info, UserApiCatalog.withRejectedUrl(info, ""))
        val marked = UserApiCatalog.withRejectedUrl(info, "https://bad")
        assertEquals("https://bad", marked.updateUrlRejected)
        assertEquals(marked, UserApiCatalog.withRejectedUrl(marked, "https://bad"))
    }

    // ---------- 下架后的换源建议 ----------

    @Test
    fun pickAvailableIdPrefersDefaultThenOnlineThenAnyBuiltin() {
        val custom = UserApiInfo(id = "user_api_1", name = "自定义")
        val local = custom.copy(id = "builtin_local", name = "本地", builtin = "local")
        val online = custom.copy(id = "builtin_online", name = "在线", builtin = "online")
        val list = listOf(custom, local, online)
        assertEquals("builtin_local", UserApiCatalog.pickAvailableId(list, "builtin_local"))
        assertEquals("builtin_online", UserApiCatalog.pickAvailableId(list, "gone"))
        assertEquals("builtin_local", UserApiCatalog.pickAvailableId(listOf(custom, local), "gone"))
        assertEquals("user_api_1", UserApiCatalog.pickAvailableId(listOf(custom), "gone"))
        assertEquals("", UserApiCatalog.pickAvailableId(emptyList(), "gone"))
    }

    // ---------- 随包内置源播种 ----------

    @Test
    fun seedFirstRunCreatesEveryBuiltin() {
        val plan = UserApiCatalog.seed(BuiltinSeedInput(existing = emptyList(), storedScripts = emptyMap(), definitions = listOf(onlineDef(), localDef())))
        assertTrue(plan.changed)
        assertEquals(2, plan.list.size)
        assertEquals(listOf("builtin_online", "builtin_local"), plan.writes.map { it.id })
        val online = plan.list.first { it.id == "builtin_online" }
        assertEquals("https://cdn.example.com/builtin_online.js", online.updateUrl)
        // 在线源播种时把目录地址同时记成「目录写的」，日后才认得出用户改没改
        assertEquals(online.updateUrl, online.builtinUpdateUrl)
        assertTrue(online.allowShowUpdateAlert)
        val local = plan.list.first { it.id == "builtin_local" }
        assertEquals("", local.updateUrl)
        assertEquals("1.0.0", local.builtinVersion)
        assertFalse(local.allowShowUpdateAlert)
    }

    @Test
    fun seedKeepsUserFieldsWhenNothingChanged() {
        val definition = localDef(id = "builtin_local", version = "1.0.0")
        val existing =
            listOf(
                UserApiInfo(
                    id = "builtin_local",
                    name = "builtin_local",
                    version = "1.0.0",
                    builtin = "local",
                    builtinVersion = "1.0.0",
                    scriptUpdateUrl = definition.scriptUpdateUrl,
                    updateUrl = "https://user.example.com/mine.json",
                    lastCheckAt = 12345L,
                ),
            )
        val plan = UserApiCatalog.seed(BuiltinSeedInput(existing, mapOf("builtin_local" to definition.script), listOf(definition)))
        assertFalse(plan.changed)
        assertEquals(emptyList<BuiltinSeedWrite>(), plan.writes)
        assertEquals(12345L, plan.list.single().lastCheckAt)
        assertEquals("https://user.example.com/mine.json", plan.list.single().updateUrl)
    }

    @Test
    fun seedStoredScriptMissingRewritesFromPackage() {
        val definition = localDef(id = "builtin_local", version = "2.0.0")
        val existing = listOf(UserApiInfo(id = "builtin_local", name = "旧名字", version = "1.0.0", builtin = "local", builtinVersion = "1.0.0"))
        val plan = UserApiCatalog.seed(BuiltinSeedInput(existing, mapOf("builtin_local" to null), listOf(definition)))
        assertTrue(plan.changed)
        assertEquals(listOf("builtin_local"), plan.writes.map { it.id })
        val info = plan.list.single()
        assertEquals("builtin_local", info.name)
        assertEquals("2.0.0", info.version)
        assertEquals("2.0.0", info.builtinVersion)
    }

    @Test
    fun seedSamePackageVersionKeepsRuntimeUpdatedScript() {
        val definition = localDef(id = "builtin_local", version = "1.0.0")
        val runtimeScript = script("builtin_local", "1.0.1", updateUrl = "https://author.example.com/check")
        val existing = listOf(UserApiInfo(id = "builtin_local", name = "builtin_local", version = "1.0.0", builtin = "local", builtinVersion = "1.0.0"))
        val plan = UserApiCatalog.seed(BuiltinSeedInput(existing, mapOf("builtin_local" to runtimeScript), listOf(definition)))
        // 同一个应用包里盘上的差异只可能是用户检查更新换上的，不能被随包旧脚本盖掉
        assertEquals(emptyList<BuiltinSeedWrite>(), plan.writes)
        assertEquals("1.0.0", plan.list.single().version)
        // 但脚本头部报的地址要补上，否则检查更新永远只能报「没有可用的更新地址」
        assertEquals("https://author.example.com/check", plan.list.single().scriptUpdateUrl)
        assertTrue(plan.changed)
    }

    @Test
    fun seedAppUpgradeKeepsNewerStoredScript() {
        val definition = localDef(id = "builtin_local", version = "1.0.0")
        val stored = script("builtin_local", "3.0.0")
        val existing = listOf(UserApiInfo(id = "builtin_local", name = "用户换过的名字", version = "3.0.0", builtin = "local", builtinVersion = "0.9.0"))
        val plan = UserApiCatalog.seed(BuiltinSeedInput(existing, mapOf("builtin_local" to stored), listOf(definition)))
        assertEquals(emptyList<BuiltinSeedWrite>(), plan.writes)
        // 应用升级标记照样更新，但脚本与信息都留着用户那份
        assertEquals("1.0.0", plan.list.single().builtinVersion)
        assertEquals("用户换过的名字", plan.list.single().name)
    }

    @Test
    fun seedAppUpgradeOverwritesOlderStoredScript() {
        val definition = localDef(id = "builtin_local", version = "5.0.0")
        val stored = script("builtin_local", "1.0.0")
        val existing = listOf(UserApiInfo(id = "builtin_local", name = "builtin_local", version = "1.0.0", builtin = "local", builtinVersion = "1.0.0"))
        val plan = UserApiCatalog.seed(BuiltinSeedInput(existing, mapOf("builtin_local" to stored), listOf(definition)))
        assertEquals(listOf("builtin_local"), plan.writes.map { it.id })
        assertEquals("5.0.0", plan.list.single().version)
    }

    @Test
    fun seedMigratesOnlineUpdateUrlOnlyWhenStillCatalogWritten() {
        val definition = onlineDef(id = "builtin_online", updateUrl = "https://new.example.com/x.js")
        val untouched = UserApiInfo(id = "builtin_online", name = "n", builtin = "online", updateUrl = "https://old.example.com/x.js", builtinUpdateUrl = "https://old.example.com/x.js")
        val plan = UserApiCatalog.seed(BuiltinSeedInput(listOf(untouched), mapOf("builtin_online" to definition.script), listOf(definition)))
        assertEquals("https://new.example.com/x.js", plan.list.single().updateUrl)
        assertEquals("https://new.example.com/x.js", plan.list.single().builtinUpdateUrl)

        val userEdited = untouched.copy(updateUrl = "https://user.example.com/me")
        val kept = UserApiCatalog.seed(BuiltinSeedInput(listOf(userEdited), mapOf("builtin_online" to definition.script), listOf(definition)))
        assertFalse(kept.changed)
        assertEquals("https://user.example.com/me", kept.list.single().updateUrl)
    }

    @Test
    fun seedMigratesLegacyOnlineUrlForOldData() {
        val definition =
            onlineDef(
                id = "builtin_online",
                updateUrl = "https://new.example.com/x.js",
                legacy = listOf("https://legacy.example.com/x.js"),
            )
        val old = UserApiInfo(id = "builtin_online", name = "n", builtin = "online", updateUrl = "https://legacy.example.com/x.js")
        val plan = UserApiCatalog.seed(BuiltinSeedInput(listOf(old), mapOf("builtin_online" to definition.script), listOf(definition)))
        assertEquals("https://new.example.com/x.js", plan.list.single().updateUrl)
        assertEquals("https://new.example.com/x.js", plan.list.single().builtinUpdateUrl)
    }

    @Test
    fun seedUnownedOnlineUrlIsNotTouchedAndNotMarked() {
        // 老数据认不准是不是用户改的：按用户的算，以后也不自动迁移
        val definition = onlineDef(id = "builtin_online", updateUrl = "https://new.example.com/x.js")
        val unknown = UserApiInfo(id = "builtin_online", name = "n", builtin = "online", updateUrl = "https://someone.example.com/x.js")
        val plan = UserApiCatalog.seed(BuiltinSeedInput(listOf(unknown), mapOf("builtin_online" to definition.script), listOf(definition)))
        assertFalse(plan.changed)
        assertEquals("https://someone.example.com/x.js", plan.list.single().updateUrl)
        assertNull(plan.list.single().builtinUpdateUrl)
    }

    @Test
    fun seedMarksCrossWiredBuiltinUpdateUrlAsRejected() {
        val owner = onlineDef(id = "builtin_other", updateUrl = "https://cdn.example.com/other.js")
        val victim = UserApiInfo(id = "builtin_online", name = "被塞错了", builtin = "online", updateUrl = owner.updateUrl)
        val plan = UserApiCatalog.seed(BuiltinSeedInput(listOf(victim), mapOf("builtin_online" to script("builtin_online", "1.0.0")), listOf(owner, onlineDef())))
        assertEquals("https://cdn.example.com/other.js", plan.list.first { it.id == "builtin_online" }.updateUrlRejected)

        // 名字相同的是用户自己又导入了一份同一个源，地址本来就能用
        val sameName = victim.copy(name = owner.name)
        val clean = UserApiCatalog.seed(BuiltinSeedInput(listOf(sameName), emptyMap(), listOf(owner, onlineDef())))
        assertNull(clean.list.first { it.id == "builtin_online" }.updateUrlRejected)
    }

    @Test
    fun seedRemovesDroppedBuiltinButLetsUserKeepIt() {
        val removed =
            listOf(
                RemovedBuiltinSource("builtin_gone", "已下架源"),
                RemovedBuiltinSource("builtin_other_gone", "另一个"),
            )
        val handed = UserApiInfo(id = "builtin_gone", name = "已下架源", builtin = "local", builtinVersion = "1.0.0", updateUrl = "https://user.example.com/mine")
        val abandoned = UserApiInfo(id = "builtin_other_gone", name = "另一个", builtin = "local", updateUrlRejected = "https://bad")

        val plan = UserApiCatalog.seed(BuiltinSeedInput(listOf(handed, abandoned), emptyMap(), listOf(localDef(id = "builtin_local")), removed))
        // 用户自己填过更新地址的：摘掉内置标记，留在自定义源里
        val kept = plan.list.first { it.id == "builtin_gone" }
        assertNull(kept.builtin)
        assertNull(kept.builtinVersion)
        assertEquals("https://user.example.com/mine", kept.updateUrl)
        // 没接手的：整条删掉，盘上脚本与备份跟着清
        assertEquals(listOf("builtin_other_gone"), plan.removedIds)
        assertTrue(plan.list.none { it.id == "builtin_other_gone" })
    }

    @Test
    fun seedOnlineWithoutStoredScriptSeedsPackageScript() {
        val definition = onlineDef(id = "builtin_online")
        val existing = UserApiInfo(id = "builtin_online", name = "", version = "", builtin = "online", updateUrl = definition.updateUrl, builtinUpdateUrl = definition.updateUrl)
        val plan = UserApiCatalog.seed(BuiltinSeedInput(listOf(existing), mapOf("builtin_online" to null), listOf(definition)))
        assertEquals(listOf("builtin_online"), plan.writes.map { it.id })
        assertEquals("builtin_online", plan.list.single().name)
        assertEquals(definition.scriptUpdateUrl, plan.list.single().scriptUpdateUrl)
    }

    // ---------- 编解码 ----------

    @Test
    fun codecDropsUnknownScriptFieldAndBadJson() {
        val list = listOf(UserApiInfo(id = "a", name = "n", scriptUpdateUrl = "https://u"))
        val text = UserApiCatalog.encode(list)
        assertEquals(list, UserApiCatalog.decode(text))
        assertEquals(emptyList<UserApiInfo>(), UserApiCatalog.decode("not json"))
        assertEquals(emptyList<UserApiInfo>(), UserApiCatalog.decode(null))
        // 旧版把脚本正文内联进过列表：解码时整字段丢弃
        val dirty = "[{\"id\":\"a\",\"name\":\"n\",\"script\":\"console.log(1)\"}]"
        assertEquals(1, UserApiCatalog.decode(dirty).size)
    }
}
