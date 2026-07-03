<script>
  let count = 0
  let name = 'World'

  function handleClick() {
    count += 1
  }
</script>

<main>
  <h1>Hello {name}!</h1>
  <button on:click={handleClick}>
    Clicked {count} {count === 1 ? 'time' : 'times'}
  </button>
</main>

<style>
  main {
    text-align: center;
    padding: 2em;
  }
  button {
    font-size: 1.2em;
    padding: 0.5em 1em;
    border-radius: 4px;
    cursor: pointer;
  }
</style>
