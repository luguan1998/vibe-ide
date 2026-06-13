# Python 语法高亮测试

# 基础类型
name = "世界"
count = 42
pi = 3.14159
flag = True
nothing = None

# 列表、字典、集合、元组
items = [1, 2, 3, 4, 5]
mapping = {"a": 1, "b": 2, "c": 3}
unique = {1, 2, 3}
coords = (10, 20)

# 列表推导式
squares = [x * x for x in range(10) if x % 2 == 0]

# f-string 格式化
print(f"Hello, {name}! count={count} pi={pi:.2f}")

# 函数定义
def greet(name: str, repeat: int = 1) -> str:
    """打招呼"""
    return f"你好, {name}!\n" * repeat


# 类定义
class Animal:
    species: str = "动物"

    def __init__(self, name: str):
        self.name = name

    def speak(self) -> str:
        return "..."

    @classmethod
    def create(cls, name: str) -> "Animal":
        return cls(name)


class Dog(Animal):
    def speak(self) -> str:
        return "汪汪！"


# 装饰器
def log_call(func):
    def wrapper(*args, **kwargs):
        print(f"调用 {func.__name__}")
        return func(*args, **kwargs)
    return wrapper


@log_call
def add(a: int, b: int) -> int:
    return a + b


# 异常处理
try:
    result = 10 / 0
except ZeroDivisionError as e:
    print(f"错误: {e}")
finally:
    print("清理资源")


# 异步
async def fetch_data(url: str) -> dict:
    import asyncio
    await asyncio.sleep(1)
    return {"status": 200, "data": "ok"}


# lambda
double = lambda x: x * 2
print(double(21))

# 类型注解
from typing import List, Optional, Dict, Union

Vector: List[float] = [1.0, 2.0, 3.0]


def find(items: List[int], target: int) -> Optional[int]:
    for i, v in enumerate(items):
        if v == target:
            return i
    return None


# if __name__ 守卫
if __name__ == "__main__":
    d = Dog("旺财")
    print(d.speak())
    print(add(3, 4))
