// Go 语法高亮测试

package main

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

// 常量
const (
	Greeting = "你好"
	MaxCount = 100
)

// 自定义类型
type ID int64
type JSON map[string]any

// 结构体
type User struct {
	Name  string `json:"name"`
	Age   int    `json:"age,omitempty"`
	Email string `json:"email"`
}

// 方法
func (u *User) Greet() string {
	return fmt.Sprintf("%s, 我是 %s，%d 岁", Greeting, u.Name, u.Age)
}

// 接口
type Speaker interface {
	Speak() string
}

type Dog struct {
	Name string
}

func (d Dog) Speak() string {
	return "汪汪！"
}

// 函数多返回值
func divide(a, b int) (int, error) {
	if b == 0 {
		return 0, errors.New("除数不能为零")
	}
	return a / b, nil
}

// 泛型 (Go 1.18+)
func Reverse[T any](s []T) []T {
	result := make([]T, len(s))
	for i, v := range s {
		result[len(s)-1-i] = v
	}
	return result
}

// goroutine + channel
func producer(ctx context.Context, out chan<- int) {
	for i := 0; i < 5; i++ {
		select {
		case out <- i:
			time.Sleep(100 * time.Millisecond)
		case <-ctx.Done():
			return
		}
	}
	close(out)
}

// defer + panic/recover
func safeCall(fn func()) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic: %v", r)
		}
	}()
	fn()
	return
}

// init
func init() {
	fmt.Println("包初始化")
}

func main() {
	// 变量声明
	var name string = "Go 世界"
	count := 42
	pi := 3.14159
	flag := true

	fmt.Printf("Hello, %s! count=%d pi=%.2f flag=%t\n", name, count, pi, flag)

	// slice / map
	items := []int{1, 2, 3, 4, 5}
	mapping := map[string]int{"a": 1, "b": 2, "c": 3}

	// slice 操作
	squares := make([]int, 0)
	for _, v := range items {
		if v%2 == 0 {
			squares = append(squares, v*v)
		}
	}
	fmt.Println(squares, mapping)

	// 接口
	var s Speaker = Dog{"旺财"}
	fmt.Println(s.Speak())

	// goroutine + sync
	var wg sync.WaitGroup
	for i := 0; i < 3; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			fmt.Println("goroutine", n)
		}(i)
	}
	wg.Wait()

	// channel
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()
	ch := make(chan int)
	go producer(ctx, ch)
	for v := range ch {
		fmt.Println("收到:", v)
	}

	// defer + error
	result, err := divide(10, 2)
	if err != nil {
		fmt.Println("错误:", err)
	} else {
		fmt.Println("结果:", result)
	}

	// 泛型
	rev := Reverse([]string{"a", "b", "c"})
	fmt.Println(rev)

	// struct literal
	u := User{Name: "Alice", Age: 30, Email: "alice@example.com"}
	fmt.Println(u.Greet())

	// type switch
	var val any = 42
	switch v := val.(type) {
	case int:
		fmt.Println("int:", v)
	case string:
		fmt.Println("string:", v)
	default:
		fmt.Println("unknown")
	}
}
