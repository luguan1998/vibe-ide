// Dart 语法高亮测试

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' show pi;

// 常量
const String greeting = '你好';
const int maxCount = 100;

// 枚举
enum Status {
  pending(0),
  running(1),
  done(2),
  failed(-1);

  const Status(this.code);
  final int code;

  String display() {
    switch (this) {
      case Status.pending:
        return '等待中';
      case Status.running:
        return '运行中';
      case Status.done:
        return '已完成';
      case Status.failed:
        return '失败';
    }
  }
}

// mixin
mixin Speaker {
  String speak();
}

mixin Logger {
  void log(String msg) => print('[log] $msg');
}

// 继承 + mixin
class Animal {
  final String name;
  Animal(this.name);

  String speak() => '...';
}

class Dog extends Animal with Speaker, Logger {
  Dog(super.name);

  @override
  String speak() => '汪汪！';

  void bark() {
    log('$name 在叫');
    print(speak());
  }
}

// 抽象类
abstract class Shape {
  double area();
  double perimeter();
}

class Circle implements Shape {
  final double radius;
  Circle(this.radius);

  @override
  double area() => pi * radius * radius;

  @override
  double perimeter() => 2 * pi * radius;
}

// 泛型
class Box<T extends num> {
  final T value;
  const Box(this.value);

  Box<U> map<U>(U Function(T) transform) => Box(transform(value));
}

// 扩展方法
extension StringGreeting on String {
  String greet() => '$greeting, $this!';
}

extension IntSquare on int {
  int squared() => this * this;
}

// 可调用类
class Adder {
  final int addend;
  const Adder(this.addend);
  int call(int value) => value + addend;
}

// Future / async-await
Future<String> fetchData(String url) async {
  await Future.delayed(const Duration(seconds: 1));
  return '{"status": 200, "data": "ok"}';
}

// Stream
Stream<int> countStream(int max) async* {
  for (var i = 0; i < max; i++) {
    await Future.delayed(const Duration(milliseconds: 100));
    yield i;
  }
}

// Record (Dart 3+)
(String, int) createPerson() => ('Alice', 30);

// 模式匹配 (Dart 3+)
void describe(dynamic value) {
  switch (value) {
    case int(:var isEven) when isEven:
      print('偶数: $value');
    case int():
      print('奇数: $value');
    case String(:var length) when length > 5:
      print('长字符串: $value ($length)');
    case String():
      print('短字符串: $value');
    case [int a, int b, ...]:
      print('以整数开头的列表: $a, $b');
    case {'key': var key}:
      print('包含 key 的 map: $key');
    default:
      print('其他: $value');
  }
}

// 注解
class Loggable {
  final int level;
  const Loggable({this.level = 1});
}

@Loggable(level: 2)
void annotatedFunc() {}

// 隔离区 (Isolate)
Future<void> isolateDemo() async {
  final result = await Isolate.run(() {
    var sum = 0;
    for (var i = 0; i < 1000000; i++) {
      sum += i;
    }
    return sum;
  });
  print('isolate 结果: $result');
}

void main() async {
  // 变量
  final name = 'Dart 世界';
  var count = 42;
  const pi = 3.14159;
  final flag = true;
  dynamic flexible = '可以是任何类型';
  flexible = 42;

  print('Hello, $name! count=$count pi=$pi flag=$flag');

  // 集合
  final items = [1, 2, 3, 4, 5];
  final mapping = {'a': 1, 'b': 2, 'c': 3};
  final set = {1, 2, 3, 4, 5};

  // 集合操作
  final squares = items
      .where((n) => n.isEven)
      .map((n) => n * n)
      .toList();
  print(squares);

  // 空安全
  String? nullable = null;
  final length = nullable?.length ?? -1;
  print(length);
  nullable ??= '默认值';
  print(nullable);

  // 级联运算符
  final buffer = StringBuffer()
    ..write('Hello')
    ..write(' ')
    ..write('Dart')
    ..write('!');
  print(buffer.toString());

  // mixin
  final dog = Dog('旺财');
  dog.bark();

  // 抽象类
  final circle = Circle(5.0);
  print('面积: ${circle.area()}, 周长: ${circle.perimeter()}');

  // 扩展方法
  print('世界'.greet());
  print(5.squared());

  // 可调用类
  final add5 = Adder(5);
  print(add5(10)); // 15

  // Record 解构
  final (personName, personAge) = createPerson();
  print('$personName, $personAge');

  // 模式匹配
  describe(42);
  describe('hello world');
  describe([1, 2, 3]);
  describe({'key': 'value'});

  // async / await
  final data = await fetchData('https://example.com');
  print(data);

  // Stream
  await for (final v in countStream(3)) {
    print('stream: $v');
  }

  // 泛型
  final box = Box<int>(10);
  final mapped = box.map((v) => v * 2);
  print(mapped.value);

  // Isolate
  await isolateDemo();

  // 枚举
  final status = Status.done;
  print('${status.code}: ${status.display()}');

  // 类型转换
  final jsonStr = jsonEncode({'name': 'Dart', 'type': 'language'});
  final decoded = jsonDecode(jsonStr) as Map<String, dynamic>;
  print(decoded['name']);
}
