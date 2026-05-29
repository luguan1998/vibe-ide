import React, { useState } from 'react'

interface CardProps {
  title: string
  count: number
  onClick?: () => void
}

function Card({ title, count, onClick }: CardProps) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className="card"
      style={{ backgroundColor: hovered ? '#eee' : '#fff' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <h2>{title} ({count})</h2>
      <p>Status: {hovered ? 'hovered' : 'idle'}</p>
      <button onClick={onClick}>Click me</button>
      <List items={[1, 2, 3]} renderItem={(n) => <span key={n}>{n}</span>} />
    </div>
  )
}

function List<T>({ items, renderItem }: { items: T[]; renderItem: (item: T) => React.ReactNode }) {
  return <ul>{items.map(renderItem)}</ul>
}

export default Card
