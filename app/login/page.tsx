'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/')
      router.refresh()
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img src="/icon.png" alt="Hedonistas Mezcal" className="w-16 h-16 rounded-xl object-contain mb-4" />
          <h1 className="text-3xl text-center" style={{fontFamily: 'Pacifico, cursive', color: '#F3E6D1'}}>
            Hedonistas Mezcal
          </h1>
          <p className="text-neutral-500 text-sm mt-1">Media library</p>
        </div>

        <form onSubmit={handleLogin} className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
          <div className="mb-4">
            <label className="block text-xs text-neutral-400 mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500"
              placeholder="you@hedonistas.com"
            />
          </div>
          <div className="mb-6">
            <label className="block text-xs text-neutral-400 mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500"
              placeholder="••••••••"
            />
          </div>
          {error && <p className="text-red-400 text-xs mb-4">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 mb-3"
            style={{background: '#c8a96e', color: '#000'}}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
          <a href="/reset-password" className="block text-center text-xs text-neutral-600 hover:text-neutral-400 transition-colors">
            Forgot password?
          </a>
        </form>
      </div>
    </main>
  )
}
