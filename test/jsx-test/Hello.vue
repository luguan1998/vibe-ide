<template>
  <div class="hello">
    <h1>{{ title }}</h1>
    <p>{{ description }}</p>
    <button @click="handleClick">Click me</button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const title = ref('Hello Vue')
const description = ref('This is a Vue SFC test file')

function handleClick() {
  console.log('clicked')
}
</script>

<style scoped>
.hello {
  padding: 16px;
  border: 1px solid #ccc;
}
.hello h1 {
  color: #42b883;
}
</style>
