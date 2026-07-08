'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

const ADMIN_EMAIL = 'terry@hedonistasmezcal.com'

type Permission = {
  can_download: boolean
  can_dropbox: boolean
  can_delete: boolean
  can_dedup: boolean
  can_choose_folder: boolean
  can_upload: boolean
  is_admin: boolean
}

type User = {
  id: string
  email: string
  created_at: string
  last_sign_in: string
  permissions: Permission | null
}

const DEFAULT_PERMISSIONS: Permission = {
  can_download: true,
  can_dropbox: true,
  can_delete: false,
  can_dedup: false,
  can_choose_folder: false,
  can_upload: true,
  is_admin: false,
}

const PERMISSION_LABELS: { key: keyof Permission; label: string; description: string }[] = [
  { key: 'can_download', label: 'Download', description: 'Download files to their computer' },
  { key: 'can_dropbox', label: 'Open in Dropbox', description: 'View files directly in Dropbox' },
  { key: 'can_delete', label: 'Delete', description: 'Delete assets from the library' },
  { key: 'can_dedup', label: 'Find duplicates', description: 'Access the duplicate finder tool' },
  { key: 'can_choose_folder', label: 'Choose folder / sync', description: 'Sync files from Dropbox folders' },
  { key: 'can_upload', label: 'Upload files', description: 'Drag and drop files into the library' },
  { key: 'is_admin', label: 'Admin access', description: 'Can manage users and access admin page' },
]

export default function AdminPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [users, setUsers] = useState<User[]>([])
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPerms, setNewPerms] = useState<Permission>({ ...DEFAULT_PERMISSIONS })
  const [creating, setCreating] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showEditPassword, setShowEditPassword] = useState(false)
  const [editingUser, setEditingUser] = useState<string | null>(null)
  const [editPerms, setEditPerms] = useState<Permission>({ ...DEFAULT_PERMISSIONS })
  const [editPassword, setEditPassword] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.push('/login'); return }
      if (session.user.email !== ADMIN_EMAIL) { router.push('/'); return }
      setAuthorized(true)
      setToken(session.access_token)
      await loadUsers(session.access_token)
      setLoading(false)
    })
  }, [])

  async function loadUsers(t: string) {
    const res = await fetch('/api/admin', { headers: { authorization: `Bearer ${t}` } })
    const data = await res.json()
    if (data.users) setUsers(data.users)
  }

  async function createUser() {
    if (!newEmail || !newPassword) { setError('Email and password are required'); return }
    setCreating(true); setError(''); setSuccess('')
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ email: newEmail, password: newPassword, permissions: newPerms })
    })
    const data = await res.json()
    if (data.error) setError(data.error)
    else {
      setSuccess(`User ${newEmail} created successfully`)
      setNewEmail(''); setNewPassword(''); setNewPerms({ ...DEFAULT_PERMISSIONS })
      await loadUsers(token)
    }
    setCreating(false)
  }

  async function saveUser(email: string) {
    setSaving(true); setError(''); setSuccess('')
    const res = await fetch('/api/admin', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ email, permissions: editPerms, newPassword: editPassword || undefined })
    })
    const data = await res.json()
    if (data.error) setError(data.error)
    else {
      setSuccess(`User ${email} updated`)
      setEditingUser(null); setEditPassword('')
      await loadUsers(token)
    }
    setSaving(false)
  }

  async function deleteUser(email: string) {
    if (!confirm(`Delete user ${email}? This cannot be undone.`)) return
    const res = await fetch('/api/admin', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ email })
    })
    const data = await res.json()
    if (data.error) setError(data.error)
    else { setSuccess(`User ${email} deleted`); await loadUsers(token) }
  }

  function startEdit(user: User) {
    setEditingUser(user.email)
    setEditPerms(user.permissions || { ...DEFAULT_PERMISSIONS })
    setEditPassword('')
  }

  if (loading) return (
    <main className="min-h-screen bg-neutral-950 flex items-center justify-center">
      <p className="text-neutral-500 text-sm">Loading...</p>
    </main>
  )

  if (!authorized) return null

  return (
    <main className="min-h-screen bg-neutral-950 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <img src="/icon.png" alt="Hedonistas" className="w-10 h-10 rounded-xl object-contain" />
            <div>
              <h1 className="text-lg font-bold">Admin</h1>
              <p className="text-xs text-neutral-500">User management</p>
            </div>
          </div>
          <button onClick={() => router.push('/')}
            className="px-4 py-2 rounded-lg text-xs border border-neutral-700 text-neutral-400 hover:border-neutral-500 transition-colors">
            Back to library
          </button>
        </div>

        {error && <div className="mb-4 p-3 rounded-xl text-xs bg-red-950/50 text-red-400 border border-red-900">{error}</div>}
        {success && <div className="mb-4 p-3 rounded-xl text-xs bg-green-950/50 text-green-400 border border-green-900">{success}</div>}

        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 mb-6">
          <h2 className="text-sm font-medium mb-4">Add new user</h2>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-[10px] text-neutral-500 uppercase tracking-wider mb-1.5">Email</label>
              <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)}
                placeholder="user@example.com"
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500" />
            </div>
            <div>
              <label className="block text-[10px] text-neutral-500 uppercase tracking-wider mb-1.5">Password</label>
              <div className="relative">
                <input type={showNewPassword ? 'text' : 'password'} value={newPassword} onChange={e => setNewPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 pr-10 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500" />
                <button type="button" onClick={() => setShowNewPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300 text-xs">
                  {showNewPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-[10px] text-neutral-500 uppercase tracking-wider mb-2">Permissions</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {PERMISSION_LABELS.map(({ key, label, description }) => (
                <label key={key} className="flex items-start gap-2 p-3 rounded-lg bg-neutral-800 cursor-pointer border border-neutral-700">
                  <input type="checkbox" checked={newPerms[key]} onChange={e => setNewPerms(p => ({ ...p, [key]: e.target.checked }))}
                    className="mt-0.5 accent-amber-600 flex-shrink-0" />
                  <div>
                    <p className="text-xs text-white font-medium">{label}</p>
                    <p className="text-[10px] text-neutral-500 leading-tight">{description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <button onClick={createUser} disabled={creating}
            className="px-4 py-2 rounded-lg text-xs bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-black font-medium transition-colors">
            {creating ? 'Creating...' : 'Create user'}
          </button>
        </div>

        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-neutral-800">
            <h2 className="text-sm font-medium">Users ({users.length})</h2>
          </div>
          <div className="divide-y divide-neutral-800">
            {users.map(user => (
              <div key={user.id} className="px-6 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium truncate">{user.email}</p>
                      {user.email === ADMIN_EMAIL && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-600/20 text-amber-500 border border-amber-600/30 flex-shrink-0">Admin</span>
                      )}
                    </div>
                    <p className="text-[10px] text-neutral-600">
                      Joined {new Date(user.created_at).toLocaleDateString()}
                      {user.last_sign_in ? ` · Last seen ${new Date(user.last_sign_in).toLocaleDateString()}` : ' · Never signed in'}
                    </p>
                    {editingUser !== user.email && user.permissions && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {PERMISSION_LABELS.map(({ key, label }) => (
                          <span key={key} className={`text-[10px] px-1.5 py-0.5 rounded border ${user.permissions![key] ? 'bg-neutral-800 text-neutral-300 border-neutral-700' : 'bg-neutral-900 text-neutral-600 border-neutral-800 line-through'}`}>
                            {label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {user.email !== ADMIN_EMAIL && editingUser !== user.email && (
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={() => startEdit(user)}
                        className="px-3 py-1.5 rounded-lg text-xs border border-neutral-700 text-neutral-400 hover:border-neutral-500 transition-colors">
                        Edit
                      </button>
                      <button onClick={() => deleteUser(user.email)}
                        className="px-3 py-1.5 rounded-lg text-xs border border-red-900 text-red-500 hover:bg-red-950 transition-colors">
                        Delete
                      </button>
                    </div>
                  )}
                </div>
                {editingUser === user.email && (
                  <div className="mt-4 pt-4 border-t border-neutral-800">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
                      {PERMISSION_LABELS.map(({ key, label, description }) => (
                        <label key={key} className="flex items-start gap-2 p-3 rounded-lg bg-neutral-800 cursor-pointer border border-neutral-700">
                          <input type="checkbox" checked={editPerms[key]} onChange={e => setEditPerms(p => ({ ...p, [key]: e.target.checked }))}
                            className="mt-0.5 accent-amber-600 flex-shrink-0" />
                          <div>
                            <p className="text-xs text-white font-medium">{label}</p>
                            <p className="text-[10px] text-neutral-500 leading-tight">{description}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                    <div className="flex items-center gap-3">
                      <input type="password" value={editPassword} onChange={e => setEditPassword(e.target.value)}
                          placeholder="New password (leave blank to keep current)"
                        type={showEditPassword ? 'text' : 'password'}
                        className="flex-1 bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 pr-16 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500" />
                      <button type="button" onClick={() => setShowEditPassword(v => !v)}
                        className="absolute right-36 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300 text-xs">
                        {showEditPassword ? 'Hide' : 'Show'}
                      </button>
                      <button onClick={() => saveUser(user.email)} disabled={saving}
                        className="px-4 py-2 rounded-lg text-xs bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-black font-medium transition-colors flex-shrink-0">
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                      <button onClick={() => setEditingUser(null)}
                        className="px-4 py-2 rounded-lg text-xs border border-neutral-700 text-neutral-400 hover:border-neutral-500 transition-colors flex-shrink-0">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  )
}
