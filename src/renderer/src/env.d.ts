/// <reference types="vite/client" />

declare module '*?worker' {
  const workerConstructor: new () => Worker
  export default workerConstructor
}

declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
