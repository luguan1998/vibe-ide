import React, { useState } from 'react'

interface CounterProps {
  initial?: number
  step?: number
  label?: string
}

function Counter({ initial = 0, step = 1, label = 'Count' }: CounterProps) {
  const [count, setCount] = useState(initial)
  return (
    <div className="counter">
      <span>
        {label}: {count}
      </span>
      <button onClick={() => setCount((c) => c + step)}>+{step}</button>
      <button onClick={() => setCount(initial)}>Reset</button>
    </div>
  )
}

export default Counter
