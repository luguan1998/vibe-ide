// JavaScript 语法高亮测试

'use strict';

// 基础类型
const name = 'JS 世界';
let count = 42;
var pi = 3.14159; // eslint-disable-line
const flag = true;
const nothing = null;
let undef = undefined;

// 对象 / 数组
const items = [1, 2, 3, 4, 5];
const mapping = { a: 1, b: 2, c: 3 };
const coords = [10, 20];

// 模板字符串
console.log(`Hello, ${name}! count=${count} pi=${pi}`);

// 箭头函数
const add = (a, b) => a + b;
const greet = (name, repeat = 1) => `你好, ${name}!\n`.repeat(repeat);

// 普通函数
function divide(a, b) {
  if (b === 0) throw new Error('除数不能为零');
  return a / b;
}

// 生成器
function* range(start, end) {
  for (let i = start; i < end; i++) {
    yield i;
  }
}

// class
class Animal {
  #name; // 私有字段

  constructor(name) {
    this.#name = name;
  }

  speak() {
    return '...';
  }

  getName() {
    return this.#name;
  }

  static create(name) {
    return new Animal(name);
  }
}

class Dog extends Animal {
  speak() {
    return '汪汪！';
  }
}

// Promise / async-await
async function fetchData(url) {
  const response = await fetch(url);
  const data = await response.json();
  return data;
}

// Promise 链
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function demoAsync() {
  console.log('等待...');
  await delay(100);
  console.log('完成');
}

// 解构赋值
const [first, ...rest] = items;
const { a, b, ...others } = mapping;
console.log(first, rest, a, b, others);

// 展开运算符
const merged = [...items, 6, 7, 8];
const combined = { ...mapping, d: 4 };
console.log(merged, combined);

// 数组方法链
const squares = items
  .filter((n) => n % 2 === 0)
  .map((n) => n * n);
console.log(squares);

// 可选链 / 空值合并
const user = { profile: { name: 'Alice' } };
console.log(user?.profile?.name ?? '匿名');
console.log(user?.nonExistent ?? '默认值');

// 闭包
function counter() {
  let i = 0;
  return () => ++i;
}
const c = counter();
console.log(c(), c(), c());

// 混入 / 对象扩展
const canSpeak = {
  speak() {
    return this.name;
  },
};
const person = { name: 'Bob', ...canSpeak };
console.log(person.speak());

// 动态 import 模拟
const dynamicImport = (mod) => import(mod);

// IIFE
(function () {
  const x = 42;
  console.log('IIFE:', x);
})();

// 事件循环 / setTimeout
setTimeout(() => {
  console.log('定时器');
}, 0);

// Proxy
const handler = {
  get(target, prop) {
    return prop in target ? target[prop] : 'not found';
  },
};
const proxy = new Proxy({ foo: 'bar' }, handler);
console.log(proxy.foo, proxy.unknown);

// tag 模板
function tag(strings, ...values) {
  return strings.reduce((acc, str, i) => acc + str + (values[i] || ''), '');
}
const result =tag`Hello ${name}! count=${count}`;
console.log(result);

// export / import 语法 (作为示例)
export { add, divide, greet };
export default demoAsync;
