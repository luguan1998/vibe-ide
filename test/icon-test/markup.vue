<template>
  <div class="app">
    <h1>{{ title }}</h1>
    <p>Count: {{ count }}</p>
    <button @click="increment">Add</button>
    <button @click="count = 0">Reset</button>
    <ul>
      <li v-for="item in items" :key="item.id">{{ item.name }}</li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const title = 'Vibe IDE'
const count = ref(0)
const items = [
  { id: 1, name: 'Terminal' },
  { id: 2, name: 'Git' },
  { id: 3, name: 'Editor' },
]

function increment() {
  count.value++
}
</script>

<style scoped>
.app { padding: 2em; font-family: sans-serif; }
button { margin: 0 4px; }
</style>
