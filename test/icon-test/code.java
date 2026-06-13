// Java 语法高亮测试

package com.example;

import java.util.*;
import java.util.concurrent.*;
import java.util.stream.*;

/**
 * 基础演示类
 */
public class Code {

    // 静态常量
    public static final String GREETING = "你好";
    private static final int MAX_COUNT = 100;

    // 实例字段
    private String name;
    private int count;
    private double pi;
    private boolean flag;

    // 构造器
    public Code(String name) {
        this.name = name;
        this.count = 42;
        this.pi = 3.14159;
        this.flag = true;
    }

    // getter/setter
    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    // 带注解的方法
    @Override
    public String toString() {
        return String.format("Code{name='%s', count=%d}", name, count);
    }

    // 泛型方法
    public static <T> List<T> reverse(List<T> list) {
        List<T> result = new ArrayList<>(list);
        Collections.reverse(result);
        return result;
    }

    // 内部类
    static class Animal {
        protected String name;

        public Animal(String name) {
            this.name = name;
        }

        public String speak() {
            return "...";
        }
    }

    // 继承
    static class Dog extends Animal {
        public Dog(String name) {
            super(name);
        }

        @Override
        public String speak() {
            return "汪汪！";
        }
    }

    // 接口
    interface Runnable {
        void run();
    }

    // 匿名类 & lambda
    public void demoLambda() {
        Runnable r = () -> System.out.println("lambda 执行");

        List<Integer> numbers = Arrays.asList(1, 2, 3, 4, 5);
        List<Integer> squares = numbers.stream()
                .filter(n -> n % 2 == 0)
                .map(n -> n * n)
                .collect(Collectors.toList());
        System.out.println(squares);
    }

    // 枚举
    enum Status {
        PENDING(0),
        RUNNING(1),
        DONE(2),
        FAILED(-1);

        final int code;

        Status(int code) {
            this.code = code;
        }

        public int getCode() {
            return code;
        }
    }

    // 异常处理
    public void demoException() {
        try {
            int result = 10 / 0;
        } catch (ArithmeticException e) {
            System.err.println("除数不能为零: " + e.getMessage());
        } finally {
            System.out.println("清理资源");
        }

        try (Scanner sc = new Scanner(System.in)) {
            // try-with-resources
        } catch (Exception e) {
            throw new RuntimeException("读取失败", e);
        }
    }

    // 注解定义
    @Retention(RetentionPolicy.RUNTIME)
    @interface Loggable {
        String value() default "";
        int level() default 1;
    }

    // 泛型类
    public static class Box<T extends Number> {
        private T value;

        public Box(T value) {
            this.value = value;
        }

        public T get() {
            return value;
        }

        public double doubleValue() {
            return value.doubleValue();
        }
    }

    // 多线程
    public void demoConcurrency() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(4);
        Future<Integer> future = pool.submit(() -> {
            Thread.sleep(100);
            return 42;
        });
        System.out.println(future.get());
        pool.shutdown();
    }

    // main 方法
    public static void main(String[] args) {
        Code code = new Code("Java 世界");
        System.out.println(code);

        Dog dog = new Dog("旺财");
        System.out.println(dog.speak());

        Status s = Status.DONE;
        System.out.println("状态码: " + s.getCode());

        Box<Double> box = new Box<>(3.14);
        System.out.println(box.doubleValue());

        code.demoLambda();
        code.demoException();

        // stream API
        IntStream.range(0, 10)
                .filter(i -> i % 2 == 0)
                .forEach(i -> System.out.print(i + " "));
        System.out.println();
    }
}
