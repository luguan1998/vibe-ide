// Kotlin 语法高亮测试

package com.example

import kotlinx.coroutines.*
import java.util.UUID

// 常量
const val GREETING = "你好"
const val MAX_COUNT = 100

// 数据类
data class User(
    val name: String,
    var age: Int,
    val email: String? = null,
)

// 密封类
sealed class Result<out T> {
    data class Success<T>(val data: T) : Result<T>()
    data class Error(val message: String, val code: Int = -1) : Result<Nothing>()
    object Loading : Result<Nothing>()
}

// 枚举
enum class Status(val code: Int) {
    PENDING(0),
    RUNNING(1),
    DONE(2),
    FAILED(-1);

    fun display(): String = when (this) {
        PENDING -> "等待中"
        RUNNING -> "运行中"
        DONE -> "已完成"
        FAILED -> "失败"
    }
}

// 接口
interface Speaker {
    fun speak(): String
}

// 类继承
open class Animal(val name: String) {
    open fun speak(): String = "..."
}

class Dog(name: String) : Animal(name) {
    override fun speak(): String = "汪汪！"
}

// 单例
object Config {
    val host: String = "localhost"
    val port: Int = 8080
    val debug: Boolean = true
}

// 伴生对象
class Factory {
    companion object {
        fun create(type: String): Any? = when (type) {
            "dog" -> Dog("默认")
            else -> null
        }
    }
}

// 泛型
class Box<T>(val value: T) {
    fun <R> map(transform: (T) -> R): Box<R> = Box(transform(value))
}

// 扩展函数
fun String.greet(): String = "$GREETING, $this!"

fun Int.squared(): Int = this * this

// 高阶函数
fun <T, R> List<T>.mapNotNull(transform: (T) -> R?): List<R> {
    val result = mutableListOf<R>()
    for (item in this) {
        transform(item)?.let { result.add(it) }
    }
    return result
}

// 挂起函数
suspend fun fetchData(url: String): String {
    delay(1000)
    return """{"status": 200, "data": "ok"}"""
}

// 注解
@Target(AnnotationTarget.FUNCTION)
@Retention(AnnotationRetention.RUNTIME)
annotation class Loggable(val level: Int = 1)

// when 表达式
fun describe(obj: Any): String = when (obj) {
    is String -> "字符串: $obj (${obj.length})"
    is Int -> "整数: $obj"
    in 1..10 -> "在 1..10 范围内"
    is List<*> -> "列表, 大小=${obj.size}"
    null -> "null"
    else -> "未知类型: ${obj::class.simpleName}"
}

// 作用域函数
fun scopeDemo() {
    val user = User("Alice", 30).apply {
        age = 31  // apply: 配置对象
    }

    val greeting = user.let { "Hello, ${it.name}" }  // let: 变换

    val name = user.run { "姓名: $name" }  // run: 执行并返回

    val alsoUser = user.also { println("创建用户: ${it.name}") }  // also: 副作用

    println(greeting)
    println(name)
}

// 协程
fun coroutineDemo() = runBlocking {
    val deferred = async {
        delay(100)
        42
    }

    val jobs = List(3) { index ->
        launch(Dispatchers.Default) {
            delay(50L * index)
            println("协程 $index 完成")
        }
    }

    jobs.forEach { it.join() }
    println("async 结果: ${deferred.await()}")
}

// 运算符重载
data class Vector(val x: Int, val y: Int) {
    operator fun plus(other: Vector) = Vector(x + other.x, y + other.y)
    operator fun times(scalar: Int) = Vector(x * scalar, y * scalar)
}

fun main() {
    // 变量
    val name = "Kotlin 世界"
    var count = 42
    val pi = 3.14159
    val flag = true

    println("Hello, $name! count=$count pi=$pi flag=$flag")

    // 集合
    val items = listOf(1, 2, 3, 4, 5)
    val mapping = mapOf("a" to 1, "b" to 2, "c" to 3)
    val mutableList = mutableListOf(1, 2, 3)

    // 集合操作
    val squares = items
        .filter { it % 2 == 0 }
        .map { it * it }
    println(squares)

    // 数据类
    val user = User("Bob", 25, email = "bob@example.com")
    val (userName, userAge, userEmail) = user  // 解构
    println("$userName, $userAge, $userEmail")

    // when
    println(describe(42))
    println(describe("hello"))
    println(describe(listOf(1, 2, 3)))

    // 扩展函数
    println("世界".greet())
    println(5.squared())

    // 密封类
    val result: Result<Int> = Result.Success(42)
    when (result) {
        is Result.Success -> println("成功: ${result.data}")
        is Result.Error -> println("错误: ${result.message}")
        Result.Loading -> println("加载中")
    }

    // 运算符重载
    val v1 = Vector(1, 2)
    val v2 = Vector(3, 4)
    println(v1 + v2)
    println(v1 * 3)

    // 协程
    coroutineDemo()

    // 单例
    println("${Config.host}:${Config.port}")

    // 伴生对象
    Factory.create("dog")

    // 泛型
    val box = Box(10)
    val mapped = box.map { it * 2 }
    println(mapped.value)

    // Elvis 操作符
    val nullable: String? = null
    val length = nullable?.length ?: -1
    println(length)

    // 安全转换
    val num = "42" as? Int ?: 0
    println(num)
}
