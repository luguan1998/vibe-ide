import React from 'react'

function Greeting({ name, theme = 'light' }) {
  const [count, setCount] = React.useState(0)
  const bg = theme === 'light' ? '#fff' : '#222'
  return (
    <div className="greeting" style={{ background: bg }}>
      <h1>Hello, {name}!</h1>
      <p>Clicks: {count}</p>
      <button onClick={() => setCount((c) => c + 1)}>Click me</button>
    </div>
  )
}

export default Greeting
