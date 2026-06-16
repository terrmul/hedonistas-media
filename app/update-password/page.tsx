'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function UpdatePassword() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/')
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

        <form onSubmit={handleUpdate} className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
          <p className="text-neutral-400 text-xs mb-4">Choose a new password for your account.</p>
          <div className="mb-4">
            <label className="block text-xs text-neutral-400 mb-1.5">New password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500"
              placeholder="••••••••"
            />
          </div>
          <div className="mb-6">
            <label className="block text-xs text-neutral-400 mb-1.5">Confirm password</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500"
              placeholder="••••••••"
            />
          </div>
          {error && <p className="text-red-400 text-xs mb-4">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            style={{background: '#c8a96e', color: '#000'}}>
            {loading ? 'Updating...' : 'Update password'}
          </button>
        </form>
      </div>
    </main>
  )
}
