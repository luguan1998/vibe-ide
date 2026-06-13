// Rust 语法高亮测试

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

// 常量
const GREETING: &str = "你好";
const MAX_COUNT: u32 = 100;

// 类型别名
type ID = u64;

// 枚举
enum Status {
    Pending,
    Running,
    Done(u32),
    Failed(String),
}

impl Status {
    fn code(&self) -> i32 {
        match self {
            Status::Pending => 0,
            Status::Running => 1,
            Status::Done(_) => 2,
            Status::Failed(_) => -1,
        }
    }
}

// 结构体 + 派生宏
#[derive(Debug, Clone)]
struct User {
    name: String,
    age: u32,
    email: Option<String>,
}

impl User {
    pub fn new(name: &str, age: u32) -> Self {
        Self {
            name: name.to_string(),
            age,
            email: None,
        }
    }

    pub fn greet(&self) -> String {
        format!("{}，我是 {}，{} 岁", GREETING, self.name, self.age)
    }
}

// trait
trait Speaker {
    fn speak(&self) -> &str;
}

struct Dog {
    name: String,
}

impl Speaker for Dog {
    fn speak(&self) -> &str {
        "汪汪！"
    }
}

// 泛型函数
fn reverse<T: Clone>(items: &[T]) -> Vec<T> {
    items.iter().rev().cloned().collect()
}

// 错误处理
#[derive(Debug)]
enum MathError {
    DivisionByZero,
    NegativeInput(i64),
}

impl std::fmt::Display for MathError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MathError::DivisionByZero => write!(f, "除数不能为零"),
            MathError::NegativeInput(n) => write!(f, "负数输入: {}", n),
        }
    }
}

impl std::error::Error for MathError {}

fn divide(a: i64, b: i64) -> Result<i64, MathError> {
    if b == 0 {
        return Err(MathError::DivisionByZero);
    }
    if a < 0 {
        return Err(MathError::NegativeInput(a));
    }
    Ok(a / b)
}

// 闭包 + 迭代器
fn process_numbers(nums: &[i32]) -> Vec<i32> {
    nums.iter()
        .filter(|&&n| n > 0)
        .map(|&n| n * n)
        .collect()
}

// 生命周期标注
fn longest<'a>(x: &'a str, y: &'a str) -> &'a str {
    if x.len() > y.len() { x } else { y }
}

// 属性宏
#[allow(dead_code)]
fn unused_helper() {}

// 条件编译
#[cfg(target_os = "windows")]
fn platform() -> &'static str {
    "Windows"
}

#[cfg(target_os = "linux")]
fn platform() -> &'static str {
    "Linux"
}

// 测试模块
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_divide() {
        assert_eq!(divide(10, 2).unwrap(), 5);
    }

    #[test]
    fn test_reverse() {
        assert_eq!(reverse(&[1, 2, 3]), vec![3, 2, 1]);
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 变量绑定
    let name = "Rust 世界";
    let count: u32 = 42;
    let pi = 3.14159;
    let flag = true;

    println!("Hello, {name}! count={count} pi={pi} flag={flag}");

    // Vec / HashMap
    let items = vec![1, 2, 3, 4, 5];
    let mut mapping = HashMap::new();
    mapping.insert("a", 1);
    mapping.insert("b", 2);

    let squares: Vec<_> = items.iter().filter(|&&x| x % 2 == 0).map(|&x| x * x).collect();
    println!("{:?} {:?}", squares, mapping);

    // trait 对象
    let dog = Dog { name: "旺财".into() };
    println!("{}", dog.speak());

    // 多线程
    let counter = Arc::new(Mutex::new(0));
    let mut handles = vec![];

    for _ in 0..3 {
        let c = Arc::clone(&counter);
        handles.push(thread::spawn(move || {
            let mut num = c.lock().unwrap();
            *num += 1;
        }));
    }

    for h in handles {
        h.join().unwrap();
    }
    println!("counter: {}", *counter.lock().unwrap());

    // 错误处理
    match divide(10, 0) {
        Ok(v) => println!("结果: {}", v),
        Err(e) => println!("错误: {}", e),
    }

    // 闭包
    let add = |a: i32, b: i32| a + b;
    println!("add: {}", add(3, 4));

    // 迭代器链
    let sum: i32 = process_numbers(&[-2, -1, 0, 1, 2, 3]).iter().sum();
    println!("sum: {}", sum);

    // 生命周期
    let s = longest("短", "比较长的字符串");
    println!("longest: {}", s);

    // match 模式匹配
    let status = Status::Done(42);
    match status {
        Status::Pending => println!("pending"),
        Status::Running => println!("running"),
        Status::Done(code) => println!("done with code {}", code),
        Status::Failed(msg) => println!("failed: {}", msg),
    }

    // if let
    if let Status::Done(code) = status {
        println!("code: {}", code);
    }

    Ok(())
}
