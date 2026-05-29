import ReactDOM from 'react-dom/client'

function App() {
  const message = 'Hello JSX'
  const items = ['apple', 'banana', 'orange']

  return (
    <div className="app">
      <h1>{message}</h1>
      <ul>
        {items.map((item, i) => (
          <li key={i} className="item">
            {item}
          </li>
        ))}
      </ul>
      <Footer year={2025} />
    </div>
  )
}

function Footer({ year }) {
  return <footer>© {year} Vibe IDE</footer>
}

const root = ReactDOM.createRoot(document.getElementById('root'))
root.render(<App />)
