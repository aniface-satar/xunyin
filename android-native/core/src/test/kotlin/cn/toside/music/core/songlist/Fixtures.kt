package cn.toside.music.core.songlist

/** 读取 `core/src/test/resources` 下的真实/合成 fixture。 */
internal object Fixtures {
    fun text(name: String): String =
        requireNotNull(Fixtures::class.java.getResourceAsStream("/$name")) { "fixture missing: $name" }
            .use { it.readBytes().toString(Charsets.UTF_8) }
}
