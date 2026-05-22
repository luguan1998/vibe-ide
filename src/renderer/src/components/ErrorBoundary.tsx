import React from 'react'

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo)
  }

  handleRestart = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-screen bg-ide-bg">
          <div className="text-center max-w-md mx-4">
            <div className="text-6xl mb-4">⚠</div>
            <h1 className="text-lg font-semibold text-ide-text mb-2">Something went wrong</h1>
            <p className="text-sm text-ide-text-muted mb-4 break-all">
              {this.state.error?.message || 'Unknown error'}
            </p>
            <button
              onClick={this.handleRestart}
              className="px-4 py-2 text-sm bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors"
            >
              Restart
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
