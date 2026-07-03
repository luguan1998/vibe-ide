interface User {
  id: number
  name: string
  email: string
  role: 'admin' | 'user' | 'guest'
}

function formatUser(user: User): string {
  return `${user.name} <${user.email}> [${user.role}]`
}

function filterByRole(users: User[], role: User['role']): User[] {
  return users.filter((u) => u.role === role)
}

const admin: User = {
  id: 1,
  name: 'Alice',
  email: 'alice@example.com',
  role: 'admin',
}

export { User, formatUser, filterByRole, admin }
