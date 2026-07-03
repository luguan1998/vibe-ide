export const readJson = async (filePath) => {
  const text = await fetch(filePath).then((r) => r.text())
  return JSON.parse(text)
}

export const debounce = (fn, ms = 200) => {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

export const groupBy = (arr, key) =>
  arr.reduce((acc, item) => {
    const k = item[key]
    ;(acc[k] ||= []).push(item)
    return acc
  }, {})
