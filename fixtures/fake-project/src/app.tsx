import { useRouter } from 'next/navigation'
import { create } from 'zustand'

const useStore = create(() => ({ count: 0 }))

export function App() {
  const router = useRouter()
  const count = useStore(s => s.count)
  return { router, count }
}
