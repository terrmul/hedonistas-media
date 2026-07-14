'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

type Asset = {
  id: string
  name: string
  type: string
  url: string
  thumbnail_url: string
  dropbox_path: string
  description: string
  tags: string[]
  analyzed: boolean
  created_at: string
  file_size: number | null
  file_date: string | null
}

type Folder = { name: string; path: string }

// Canonical supported formats -- keep in sync with app/api/dropbox-sync/route.ts
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'tiff', 'tif']
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'm4v', 'webm', 'wmv']

function getExt(name: string): string {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i + 1).toLowerCase()
}
type BrowseFile = { name: string; path: string; size: number }

export default function Home() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [filtered, setFiltered] = useState<Asset[]>([])
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set(['all']))
  const [folderFilter, setFolderFilter] = useState<string | null>(null)
  const [draftTypeFilter, setDraftTypeFilter] = useState<Set<string>>(new Set(['all']))
  const [sortBy, setSortBy] = useState<'date_desc' | 'date_asc' | 'date_range'>('date_desc')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [draftDateFrom, setDraftDateFrom] = useState('')
  const [draftDateTo, setDraftDateTo] = useState('')
  const [draftSortBy, setDraftSortBy] = useState<'date_desc' | 'date_asc' | 'date_range'>('date_desc')
  const [showTypeDropdown, setShowTypeDropdown] = useState(false)
  const [showSortDropdown, setShowSortDropdown] = useState(false)
  const [selected, setSelected] = useState<Asset | null>(null)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<any>(null)
  const [webhookNotification, setWebhookNotification] = useState<{ count: number; timestamp: string } | null>(null)
  const [syncProgress, setSyncProgress] = useState({ processed: 0, total: 0, current: '' })
  const [syncPath, setSyncPath] = useState('')
  const [tagOnSync, setTagOnSync] = useState(true)
  const [showFolderBrowser, setShowFolderBrowser] = useState(false)
  const [showDuplicates, setShowDuplicates] = useState(false)
  const [duplicateGroups, setDuplicateGroups] = useState<Asset[][]>([])
  const [dupesToDelete, setDupesToDelete] = useState<Set<string>>(new Set())
  const [deletingDupes, setDeletingDupes] = useState(false)
  const [fixingThumbs, setFixingThumbs] = useState(false)
  const [fixThumbsResult, setFixThumbsResult] = useState<{ fixed: number; failed: number } | null>(null)
  const [missingThumbCount, setMissingThumbCount] = useState(0)
  const ROOT_PATH = '/hdlf team'
  const [browserPath, setBrowserPath] = useState('')
  const [browserFolders, setBrowserFolders] = useState<Folder[]>([])
  const [browserFiles, setBrowserFiles] = useState<BrowseFile[]>([])
  const [browserLoading, setBrowserLoading] = useState(false)
  const [browserHistory, setBrowserHistory] = useState<string[]>([])
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [videoPlayer, setVideoPlayer] = useState<Asset | null>(null)
  const [lightboxPlaying, setLightboxPlaying] = useState(false)
  const [user, setUser] = useState<any>(null)
  const [perms, setPerms] = useState<any>(null)
  const [permsLoaded, setPermsLoaded] = useState(false)
  const isAdmin = user?.email === 'terry@hedonistasmezcal.com' || perms?.is_admin === true
  const [authLoading, setAuthLoading] = useState(true)
  const router = useRouter()
  const [tagging, setTagging] = useState(false)
  const [tagProgress, setTagProgress] = useState({ done: 0, total: 0 })
  const [taggingIds, setTaggingIds] = useState<Set<string>>(new Set())
  const [currentlyTagging, setCurrentlyTagging] = useState<string | null>(null)
  const taggingRef = useRef(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) router.push('/login')
      else {
        setUser(session.user)
        supabase.from('user_permissions').select('*').eq('email', session.user.email).single().then(({ data, error }: any) => { setPerms(error ? { can_download: true, can_dropbox: true, can_delete: false, can_dedup: false, can_choose_folder: false, can_upload: true, is_admin: false } : (data || { can_download: true, can_dropbox: true, can_delete: false, can_dedup: false, can_choose_folder: false, can_upload: true, is_admin: false })); setPermsLoaded(true) })
      }
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.push('/login')
      else {
        setUser(session.user)
        supabase.from('user_permissions').select('*').eq('email', session.user.email).single().then(({ data, error }: any) => { setPerms(error ? { can_download: true, can_dropbox: true, can_delete: false, can_dedup: false, can_choose_folder: false, can_upload: true, is_admin: false } : (data || { can_download: true, can_dropbox: true, can_delete: false, can_dedup: false, can_choose_folder: false, can_upload: true, is_admin: false })); setPermsLoaded(true) })
      }
    })
    return () => subscription.unsubscribe()
  }, [router])

  const fetchAssets = useCallback(async () => {
    const { data } = await supabase.from('assets').select('*').order('created_at', { ascending: false }).limit(20000)
    if (data) {
      setAssets(data)
      setFiltered(data)
      setMissingThumbCount(data.filter(a => !a.thumbnail_url).length)
    }
  }, [])

  useEffect(() => { fetchAssets() }, [fetchAssets])

  // Poll for new assets and webhook notifications every 60 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      fetchAssets()
      if (isAdmin) {
        const { data } = await supabase.from('sync_state').select('value').eq('key', 'webhook_notification').single()
        if (data?.value) {
          try {
            const n = JSON.parse(data.value)
            if (!n.dismissed) setWebhookNotification({ count: n.count, timestamp: n.timestamp })
          } catch {}
        }
      }
    }, 60000)
    return () => clearInterval(interval)
  }, [fetchAssets, isAdmin])

  useEffect(() => {
    if (!isAdmin) return
    supabase.from('sync_state').select('value').eq('key', 'webhook_notification').single()
      .then(({ data }) => {
        if (data?.value) {
          try {
            const n = JSON.parse(data.value)
            if (!n.dismissed) setWebhookNotification({ count: n.count, timestamp: n.timestamp })
          } catch {}
        }
      })
  }, [isAdmin])

  useEffect(() => {
    const terms = search.toLowerCase().split(' ').filter(Boolean)
    const noFilter = typeFilter.size === 0 || typeFilter.has('all')
    const results = assets.filter(a => {
      if (folderFilter && a.dropbox_path) {
        const folder = a.dropbox_path.substring(0, a.dropbox_path.lastIndexOf('/'))
        if (folder !== folderFilter) return false
      }
      if (!noFilter) {
        const matches = Array.from(typeFilter).some(f => {
          if (f === 'no-thumbnail') return !a.thumbnail_url
          if (f.startsWith('ext:')) return getExt(a.name) === f.slice(4)
          if (f === 'image' || f === 'video') return a.type === f
          return false
        })
        if (!matches) return false
      }
      if (!terms.length) return true
      const hay = [...(a.tags || []), a.name, a.description].join(' ').toLowerCase()
      return terms.every(t => hay.includes(t))
    })
    const dateFiltered = sortBy === 'date_range' && (dateFrom || dateTo)
      ? results.filter(a => {
          const d = new Date(a.file_date || a.created_at).getTime()
          if (dateFrom && d < new Date(dateFrom).getTime()) return false
          if (dateTo && d > new Date(dateTo).getTime() + 86400000) return false
          return true
        })
      : results
    const sorted = [...dateFiltered].sort((a, b) => {
      const dateA = new Date(a.file_date || a.created_at).getTime()
      const dateB = new Date(b.file_date || b.created_at).getTime()
      return sortBy === 'date_asc' ? dateA - dateB : dateB - dateA
    })
    setFiltered(sorted)
  }, [search, typeFilter, sortBy, dateFrom, dateTo, folderFilter, assets])

  async function browseTo(path: string) {
    setBrowserLoading(true)
    setSelectedFiles(new Set())
    try {
      const res = await fetch('/api/dropbox-browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      })
      const data = await res.json()
      if (data.error) {
        alert('Could not browse: ' + data.error)
      } else {
        setBrowserFolders(data.folders)
        setBrowserFiles(data.files || [])
        setBrowserPath(path)
      }
    } catch (err) {
      console.error('Browse failed:', err)
    }
    setBrowserLoading(false)
  }

  function openFolderBrowser() {
    setShowFolderBrowser(true)
    setSelectedFiles(new Set())
    browseTo(browserPath || ROOT_PATH)
  }

  function findDuplicates() {
    const byName = new Map<string, Asset[]>()
    for (const a of assets) {
      const key = a.name.toLowerCase().trim()
      if (!byName.has(key)) byName.set(key, [])
      byName.get(key)!.push(a)
    }
    const groups = Array.from(byName.values())
      .filter(g => g.length > 1)
      .sort((a, b) => b.length - a.length)
    setDuplicateGroups(groups)
    setDupesToDelete(new Set())
    setShowDuplicates(true)
  }

  function toggleDupeDelete(id: string) {
    setDupesToDelete(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function deleteSelectedDupes() {
    if (dupesToDelete.size === 0) return
    setDeletingDupes(true)
    try {
      const ids = Array.from(dupesToDelete)
      await supabase.from('assets').delete().in('id', ids)
      setDuplicateGroups(prev => prev
        .map(g => g.filter(a => !dupesToDelete.has(a.id)))
        .filter(g => g.length > 1)
      )
      setDupesToDelete(new Set())
      await fetchAssets()
    } catch (err) {
      console.error('Failed to delete duplicates:', err)
    }
    setDeletingDupes(false)
  }

  async function fixBrokenThumbnails() {
    setFixingThumbs(true)
    setFixThumbsResult(null)
    let totalFixed = 0
    let totalFailed = 0
    try {
      while (true) {
        const res = await fetch('/api/fix-thumbnails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 30 })
        })
        const data = await res.json()
        if (data.error) break
        totalFixed += data.processed || 0
        totalFailed += data.failed || 0
        setFixThumbsResult({ fixed: totalFixed, failed: totalFailed })
        setMissingThumbCount(data.remaining || 0)
        await fetchAssets()
        if (data.done || (data.processed === 0 && data.failed === 0)) break
        await new Promise(r => setTimeout(r, 400))
      }
    } catch (err) {
      console.error('Fix thumbnails failed:', err)
    }
    setFixingThumbs(false)
  }

  function navigateInto(folder: Folder) {
    setBrowserHistory(prev => [...prev, browserPath])
    browseTo(folder.path)
  }

  function navigateBack() {
    const prev = browserHistory[browserHistory.length - 1]
    setBrowserHistory(h => h.slice(0, -1))
    browseTo(prev || '')
  }

  function toggleFileSelect(path: string) {
    setSelectedFiles(prev => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }

  function toggleAllFiles() {
    if (selectedFiles.size === browserFiles.length) {
      setSelectedFiles(new Set())
    } else {
      setSelectedFiles(new Set(browserFiles.map(f => f.path)))
    }
  }

  async function runSync(path: string, tag: boolean, resume = true) {
    setSyncing(true)
    setSyncResult(null)
    setSyncProgress({ processed: 0, total: 0, current: '' })
    let totalProcessed = 0
    let totalFailed = 0
    let totalSkipped = 0
    let grandTotal = 0
    let isFirstBatch = true
    try {
      while (true) {
        const res = await fetch('/api/dropbox-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, limit: 100, tagOnSync: tag, resetCursor: isFirstBatch && !resume })
        })
        isFirstBatch = false
        const reader = res.body?.getReader()
        const decoder = new TextDecoder()
        if (!reader) throw new Error('No response body')
        let batchComplete: any = null
        let batchProcessed = 0
        let buffer = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const data = JSON.parse(line.slice(6))
              if (data.type === 'start') {
                if (grandTotal === 0) grandTotal = data.grandTotal || 0
              } else if (data.type === 'progress') {
                batchProcessed = data.processed
                setSyncProgress({ processed: totalProcessed + batchProcessed, total: Math.max(grandTotal, totalProcessed + data.total), current: data.current })
              } else if (data.type === 'complete') {
                batchComplete = data
                batchProcessed = data.processed
              }
            } catch {}
          }
        }
        totalProcessed += batchProcessed
        totalFailed += batchComplete?.failed || 0
        totalSkipped += batchComplete?.skipped || 0
        if (batchComplete?.grandTotal) grandTotal = Math.max(grandTotal, totalProcessed + (batchComplete.hasMore ? batchComplete.grandTotal : 0))
        await fetchAssets()
        if (!batchComplete || batchComplete.processed === 0) break
        if (!batchComplete.hasMore) break
        await new Promise(r => setTimeout(r, 500))
      }
      setSyncResult({ processed: totalProcessed, failed: totalFailed, skipped: totalSkipped, remaining: 0 })
    } catch (err) {
      setSyncResult({ error: 'Sync failed — you can resume by syncing the same folder again' })
    }
    setSyncing(false)
    setSyncProgress({ processed: 0, total: 0, current: '' })
  }

  async function syncSelected() {
    const specificFiles = Array.from(selectedFiles)
    const syncAll = specificFiles.length === 0
    setShowFolderBrowser(false)
    if (syncAll) setSyncPath(browserPath)
    if (syncAll) {
      await runSync(browserPath, tagOnSync, false)
    } else {
      setSyncing(true)
      setSyncResult(null)
      try {
        const res = await fetch('/api/dropbox-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ specificFiles, path: browserPath, tagOnSync })
        })
        const reader = res.body?.getReader()
        const decoder = new TextDecoder()
        if (!reader) throw new Error('No response body')
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value)
          const lines = chunk.split('\n').filter(l => l.startsWith('data: '))
          for (const line of lines) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.type === 'progress') {
                setSyncProgress({ processed: data.processed, total: data.total, current: data.current })
              } else if (data.type === 'complete') {
                setSyncResult(data)
                await fetchAssets()
              }
            } catch {}
          }
        }
      } catch (err) {
        setSyncResult({ error: 'Sync failed' })
      }
      setSyncing(false)
      setSyncProgress({ processed: 0, total: 0, current: '' })
    }
  }

  async function convertHeicToJpeg(file: File): Promise<File> {
    if (file.type === 'image/heic' || file.type === 'image/heif' ||
        file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif')) {
      try {
        const formData = new FormData()
        formData.append('file', file)
        const res = await fetch('/api/convert-heic', { method: 'POST', body: formData })
        if (!res.ok) throw new Error('Conversion failed')
        const blob = await res.blob()
        return new File([blob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' })
      } catch (err) {
        console.error('HEIC conversion failed:', err)
        return file
      }
    }
    return file
  }

  async function handleUpload(files: FileList | null) {
    if (!files) return
    setUploading(true)
    for (const file of Array.from(files)) {
      const converted = await convertHeicToJpeg(file)
      const isVideo = converted.type.startsWith('video/')
      let thumbnailUrl = ''
      if (!isVideo) {
        try {
          const formData = new FormData()
          formData.append('file', converted)
          const res = await fetch('/api/thumbnail', { method: 'POST', body: formData })
          if (res.ok) {
            const blob = await res.blob()
            const thumbName = `${Date.now()}_${converted.name}`
            const { data: uploadData } = await supabase.storage
              .from('thumbnails').upload(thumbName, blob, { contentType: 'image/jpeg' })
            if (uploadData) {
              const { data: urlData } = supabase.storage.from('thumbnails').getPublicUrl(thumbName)
              thumbnailUrl = urlData.publicUrl
            }
          }
        } catch (err) { console.error('Thumbnail failed:', err) }
      }

      let dropboxUrl = ''
      let dropboxPath = ''
      let dropboxId = ''
      let fileSize: number | null = file.size || null
      try {
        const dbxFormData = new FormData()
        dbxFormData.append('file', file)
        const dbxRes = await fetch('/api/upload-to-dropbox', { method: 'POST', body: dbxFormData })
        if (dbxRes.ok) {
          const dbxData = await dbxRes.json()
          dropboxUrl = dbxData.url || ''
          dropboxPath = dbxData.dropbox_path || ''
          dropboxId = dbxData.dropbox_id || ''
          fileSize = dbxData.file_size || fileSize
        } else {
          console.error('Dropbox upload failed:', await dbxRes.text())
        }
      } catch (err) { console.error('Dropbox upload failed:', err) }

      const fallbackUrl = URL.createObjectURL(converted)
      const { data } = await supabase.from('assets').insert({
        name: converted.name,
        type: isVideo ? 'video' : 'image',
        url: dropboxUrl || thumbnailUrl || fallbackUrl,
        thumbnail_url: thumbnailUrl,
        dropbox_path: dropboxPath || null,
        dropbox_id: dropboxId || null,
        file_size: fileSize,
        tags: [],
        analyzed: false
      }).select().single()
      if (data) {
        setAssets(prev => [data, ...prev])
        analyzeAsset(data, converted)
      }
    }
    setUploading(false)
  }

  async function analyzeAsset(asset: Asset, file: File) {
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('assetId', asset.id)
      formData.append('type', asset.type)
      const res = await fetch('/api/analyze', { method: 'POST', body: formData })
      const result = await res.json()
      if (result.tags) {
        await supabase.from('assets').update({ tags: result.tags, description: result.description, analyzed: true }).eq('id', asset.id)
        setAssets(prev => prev.map(a => a.id === asset.id ? { ...a, tags: result.tags, description: result.description, analyzed: true } : a))
      }
    } catch (err) { console.error(err) }
  }

  async function runTagging(toTag: Asset[]) {
    setTagging(true)
    taggingRef.current = true
    setTaggingIds(new Set(toTag.map(a => a.id)))
    setTagProgress({ done: 0, total: toTag.length })
    for (let i = 0; i < toTag.length; i++) {
      if (!taggingRef.current) break
      const asset = toTag[i]
      setCurrentlyTagging(asset.id)
      try {
        const res = await fetch('/api/tag-untagged', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assetId: asset.id })
        })
        const result = await res.json()
        if (result.tags) {
          setAssets(prev => [...prev.map(a => a.id === asset.id ? { ...a, tags: result.tags, description: result.description, analyzed: true } : a)])
          setTaggingIds(prev => {
            const next = new Set(prev)
            next.delete(asset.id)
            return next
          })
        }
      } catch (err) { console.error('Tag failed for', asset.name, err) }
      setTagProgress(prev => ({ ...prev, done: i + 1 }))
      await new Promise(r => setTimeout(r, 50))
    }
    setTagging(false)
    setCurrentlyTagging(null)
    setTaggingIds(new Set())
    taggingRef.current = false
  }

  async function tagAllUntagged() {
    const untagged = assets.filter(a => !a.analyzed)
    if (!untagged.length) return
    await runTagging(untagged)
  }

  function stopTagging() {
    taggingRef.current = false
    setTagging(false)
  }

  async function deleteSingle(id: string) {
    if (!confirm('Delete this asset?')) return
    const asset = assets.find(a => a.id === id)
    await supabase.from('assets').delete().eq('id', id)
    if (asset?.dropbox_path) {
      await supabase.from('deleted_assets').upsert({ dropbox_path: asset.dropbox_path, name: asset.name })
    }
    setAssets(prev => prev.filter(a => a.id !== id))
    if (selected?.id === id) setSelected(null)
  }

  async function deleteSelected() {
    if (!confirm(`Delete ${selectedIds.size} asset${selectedIds.size !== 1 ? 's' : ''}?`)) return
    setDeleting(true)
    const ids = Array.from(selectedIds)
    const toDelete = assets.filter(a => selectedIds.has(a.id) && a.dropbox_path)
    await supabase.from('assets').delete().in('id', ids)
    if (toDelete.length > 0) {
      await supabase.from('deleted_assets').upsert(toDelete.map(a => ({ dropbox_path: a.dropbox_path, name: a.name })))
    }
    setAssets(prev => {
      const next = prev.filter(a => !selectedIds.has(a.id))
      setMissingThumbCount(next.filter(a => !a.thumbnail_url).length)
      return next
    })
    if (selected && selectedIds.has(selected.id)) setSelected(null)
    setSelectedIds(new Set())
    setSelectMode(false)
    setDeleting(false)
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function selectAll() {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(filtered.map(a => a.id)))
  }

  function toggleSelectMode() {
    if (selectMode && selectedIds.size > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectMode(prev => !prev)
      setSelectedIds(new Set())
      setSelected(null)
    }
  }

  function handleCardClick(asset: Asset) {
    if (selectMode) toggleSelect(asset.id)
    else { setSelected(selected?.id === asset.id ? null : asset); setLightboxPlaying(false) }
  }

  function getDisplayUrl(asset: Asset) {
    return asset.thumbnail_url || asset.url || ''
  }

  function formatSize(bytes: number) {
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  }

  async function dismissWebhookNotification() {
    setWebhookNotification(null)
    await supabase.from('sync_state').upsert({
      key: 'webhook_notification',
      value: JSON.stringify({ dismissed: true })
    })
  }

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (authLoading) {
    return (
      <main className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="text-neutral-600 text-sm">Loading...</div>
      </main>
    )
  }

  const taggedCount = assets.filter(a => a.analyzed).length
  const untaggedCount = assets.filter(a => !a.analyzed).length
  const allSelected = filtered.length > 0 && selectedIds.size === filtered.length
  const tagPercent = tagProgress.total > 0 ? Math.round((tagProgress.done / tagProgress.total) * 100) : 0
  const breadcrumbs = browserPath ? browserPath.split('/').filter(Boolean) : []
  const allFilesSelected = browserFiles.length > 0 && selectedFiles.size === browserFiles.length
  const syncButtonLabel = selectedFiles.size > 0
    ? `Sync ${selectedFiles.size} file${selectedFiles.size !== 1 ? 's' : ''}`
    : browserPath ? 'Sync entire folder' : 'Sync'

  return (
    <main className="min-h-screen bg-neutral-950 text-white flex">
      {/* Fixed left sidebar */}
      <div className="w-72 flex-shrink-0 h-screen sticky top-0 overflow-y-auto bg-neutral-950 border-r border-neutral-800 flex flex-col">
        <div className="px-5 py-6 flex flex-col gap-4 flex-1">

          {/* Logo */}
          <div className="flex items-center gap-3 mb-2">
            <img src="/icon.png" alt="Hedonistas Mezcal" className="w-10 h-10 rounded-xl object-contain" />
            <div>
              <h1 style={{fontFamily: "Pacifico, serif"}} className="text-base tracking-tight">Hedonistas Mezcal</h1>
              <p className="text-neutral-500 text-xs">Media library</p>
            </div>
          </div>

          {/* Search */}
          <input type="text" placeholder="Search by subject..."
            className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-600"
            value={search} onChange={e => setSearch(e.target.value)} />

          {/* Drop zone */}
          {(isAdmin || !permsLoaded || perms?.can_upload) && <div className="block border border-dashed border-neutral-700 rounded-xl p-4 text-center cursor-pointer hover:border-amber-600 transition-colors"
            onDrop={e => { e.preventDefault(); e.stopPropagation(); handleUpload(e.dataTransfer.files) }}
            onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
            onClick={() => document.getElementById('fileInput')?.click()}>
            <input id="fileInput" type="file" multiple accept="image/*,video/*,.heic,.heif,.tiff,.tif,.webp,.avi,.mkv,.m4v,.webm,.wmv" className="hidden"
              onChange={e => handleUpload(e.target.files)} />
            <p className="text-white text-xs">{uploading ? 'Uploading...' : 'Drop files or click to browse'}</p>
            <p className="text-neutral-600 text-[10px] mt-1">JPG PNG WEBP HEIC TIFF MP4 MOV AVI MKV</p>
          </div>}

          {/* Type filter */}
          <div>
            <p className="text-[10px] text-neutral-500 uppercase tracking-widest mb-1.5">File type</p>
            <div className="relative">
              <button onClick={() => { setShowTypeDropdown(v => !v); setShowSortDropdown(false) }}
                className="w-full px-3 py-2 rounded-lg text-xs border border-neutral-700 text-white hover:border-neutral-500 transition-colors flex items-center justify-between">
                <span>{typeFilter.size === 0 || typeFilter.has('all') ? 'All types' : typeFilter.size === 1 ? (() => { const f = Array.from(typeFilter)[0]; return f === 'image' ? 'Images' : f === 'video' ? 'Video' : f === 'no-thumbnail' ? 'No thumbnail' : f.startsWith('ext:') ? f.slice(4).toUpperCase() : 'All types' })() : `${typeFilter.size} types selected`}</span>
                <span className="text-neutral-500 text-[10px]">▾</span>
              </button>
              {showTypeDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-neutral-900 border border-neutral-700 rounded-lg overflow-hidden z-20 max-h-64 flex flex-col">
                  <div className="overflow-y-auto flex-1">
                    <label className="flex items-center gap-2 px-3 py-2 text-xs text-white hover:bg-neutral-800 cursor-pointer">
                      <input type="checkbox" checked={draftTypeFilter.has('all')} onChange={() => setDraftTypeFilter(new Set(['all']))} className="accent-amber-600" />All types
                    </label>
                    <label className="flex items-center gap-2 px-3 py-2 text-xs text-white hover:bg-neutral-800 cursor-pointer">
                      <input type="checkbox" checked={draftTypeFilter.has('image')} onChange={() => setDraftTypeFilter(prev => { const next = new Set(prev); next.delete('all'); if (next.has('image')) next.delete('image'); else next.add('image'); return next.size === 0 ? new Set(['all']) : next })} className="accent-amber-600" />All images
                    </label>
                    {IMAGE_EXTENSIONS.map(ext => (
                      <label key={ext} className="flex items-center gap-2 pl-8 pr-3 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-white cursor-pointer">
                        <input type="checkbox" checked={draftTypeFilter.has('ext:' + ext)} onChange={() => setDraftTypeFilter(prev => { const next = new Set(prev); next.delete('all'); const key = 'ext:' + ext; if (next.has(key)) next.delete(key); else next.add(key); return next.size === 0 ? new Set(['all']) : next })} className="accent-amber-600" />{ext.toUpperCase()}
                      </label>
                    ))}
                    <div className="border-t border-neutral-800 my-1" />
                    <label className="flex items-center gap-2 px-3 py-2 text-xs text-white hover:bg-neutral-800 cursor-pointer">
                      <input type="checkbox" checked={draftTypeFilter.has('video')} onChange={() => setDraftTypeFilter(prev => { const next = new Set(prev); next.delete('all'); if (next.has('video')) next.delete('video'); else next.add('video'); return next.size === 0 ? new Set(['all']) : next })} className="accent-amber-600" />All video
                    </label>
                    {VIDEO_EXTENSIONS.map(ext => (
                      <label key={ext} className="flex items-center gap-2 pl-8 pr-3 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-white cursor-pointer">
                        <input type="checkbox" checked={draftTypeFilter.has('ext:' + ext)} onChange={() => setDraftTypeFilter(prev => { const next = new Set(prev); next.delete('all'); const key = 'ext:' + ext; if (next.has(key)) next.delete(key); else next.add(key); return next.size === 0 ? new Set(['all']) : next })} className="accent-amber-600" />{ext.toUpperCase()}
                      </label>
                    ))}
                    {missingThumbCount > 0 && (<>
                      <div className="border-t border-neutral-800 my-1" />
                      <label className="flex items-center gap-2 px-3 py-2 text-xs text-red-500 hover:bg-neutral-800 cursor-pointer">
                        <input type="checkbox" checked={draftTypeFilter.has('no-thumbnail')} onChange={() => setDraftTypeFilter(prev => { const next = new Set(prev); next.delete('all'); if (next.has('no-thumbnail')) next.delete('no-thumbnail'); else next.add('no-thumbnail'); return next.size === 0 ? new Set(['all']) : next })} className="accent-red-600" />No thumbnail ({missingThumbCount})
                      </label>
                    </>)}
                  </div>
                  <div className="border-t border-neutral-800 p-2">
                    <button onClick={() => { setTypeFilter(new Set(draftTypeFilter)); setShowTypeDropdown(false) }} className="w-full px-3 py-1.5 rounded-md text-xs bg-amber-600 hover:bg-amber-500 text-black font-medium transition-colors">Apply</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Sort by date */}
          <div>
            <p className="text-[10px] text-neutral-500 uppercase tracking-widest mb-1.5">Sort by date</p>
            <div className="relative">
              <button onClick={() => { if (!showSortDropdown) { setDraftSortBy(sortBy); setDraftDateFrom(dateFrom); setDraftDateTo(dateTo) }; setShowSortDropdown(v => !v); setShowTypeDropdown(false) }}
                className="w-full px-3 py-2 rounded-lg text-xs border border-neutral-700 text-white hover:border-neutral-500 transition-colors flex items-center justify-between">
                <span>{sortBy === 'date_desc' ? 'Newest first' : sortBy === 'date_asc' ? 'Oldest first' : 'Date range'}</span>
                <span className="text-neutral-500 text-[10px]">▾</span>
              </button>
              {showSortDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-neutral-900 border border-neutral-700 rounded-lg overflow-hidden z-20 p-1">
                  <button onClick={() => setDraftSortBy('date_desc')} className={`block w-full text-left px-3 py-2 text-xs rounded-md transition-colors ${draftSortBy === 'date_desc' ? 'bg-amber-600 text-black font-medium' : 'text-white hover:bg-neutral-800'}`}>Newest first</button>
                  <button onClick={() => setDraftSortBy('date_asc')} className={`block w-full text-left px-3 py-2 text-xs rounded-md transition-colors ${draftSortBy === 'date_asc' ? 'bg-amber-600 text-black font-medium' : 'text-white hover:bg-neutral-800'}`}>Oldest first</button>
                  <div className="border-t border-neutral-800 my-1" />
                  <div className="px-2 py-1">
                    <p className="text-[10px] text-neutral-500 mb-2">Date range</p>
                    <div className="flex flex-col gap-2">
                      <label className="flex items-center gap-2 text-[11px] text-white">From<input type="date" value={draftDateFrom} onChange={e => { setDraftDateFrom(e.target.value); setDraftSortBy('date_range') }} className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-[11px] text-white focus:outline-none" /></label>
                      <label className="flex items-center gap-2 text-[11px] text-white">To<input type="date" value={draftDateTo} onChange={e => { setDraftDateTo(e.target.value); setDraftSortBy('date_range') }} className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-[11px] text-white focus:outline-none" /></label>
                      {(draftDateFrom || draftDateTo) && <button onClick={() => { setDraftDateFrom(''); setDraftDateTo(''); setDraftSortBy('date_desc') }} className="text-[11px] text-amber-500 text-left">Clear range</button>}
                    </div>
                  </div>
                  <div className="border-t border-neutral-800 p-2 mt-1">
                    <button onClick={() => { setSortBy(draftSortBy); setDateFrom(draftDateFrom); setDateTo(draftDateTo); setShowSortDropdown(false) }} className="w-full px-3 py-1.5 rounded-md text-xs bg-amber-600 hover:bg-amber-500 text-black font-medium transition-colors">Apply</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <p className="text-xs text-neutral-500">{filtered.length} results</p>
          {folderFilter && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-950/30 border border-amber-800">
              <p className="text-[10px] text-amber-500 truncate flex-1">{folderFilter.split('/').pop()}</p>
              <button onClick={() => setFolderFilter(null)} className="text-amber-600 hover:text-amber-400 flex-shrink-0 text-[10px]">Clear</button>
            </div>
          )}

          {/* Sync status */}
          {syncPath && (
            <div className="flex items-center gap-2 text-xs text-neutral-500 bg-neutral-900 rounded-lg px-3 py-2">
              <span className="truncate">{syncPath}</span>
              <button onClick={() => setSyncPath('')} className="text-neutral-600 hover:text-red-400 flex-shrink-0">✕</button>
            </div>
          )}
          {syncing && syncProgress.total > 0 && (
            <div className="p-3 rounded-xl bg-neutral-900 border border-neutral-800">
              <div className="flex justify-between text-xs text-neutral-400 mb-2"><span>Syncing...</span><span>{syncProgress.processed} / {syncProgress.total}</span></div>
              {syncProgress.current && <p className="text-[10px] text-neutral-600 truncate mb-2">{syncProgress.current}</p>}
              <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden"><div className="h-full bg-blue-600 rounded-full transition-all duration-300" style={{width: `${Math.round((syncProgress.processed / syncProgress.total) * 100)}%`}} /></div>
            </div>
          )}
          {tagging && (
            <div className="p-3 rounded-xl bg-neutral-900 border border-neutral-800">
              <div className="flex justify-between text-xs text-neutral-400 mb-2"><span>Tagging with AI</span><span>{tagPercent}%</span></div>
              <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden"><div className="h-full bg-amber-600 rounded-full transition-all duration-500" style={{width: `${tagPercent}%`}} /></div>
            </div>
          )}
          {syncResult && (
            <div className={`p-3 rounded-xl text-xs border ${syncResult.error ? 'bg-red-950/50 text-red-400 border-red-900' : 'bg-neutral-900 text-neutral-400 border-neutral-800'}`}>
              {syncResult.error
                ? <div className="flex flex-col gap-2"><span>{syncResult.error}</span>{syncPath && <button onClick={() => runSync(syncPath, tagOnSync, true)} className="px-2 py-1 rounded border border-amber-800 text-amber-500 hover:bg-amber-950 transition-colors text-left">Resume sync</button>}</div>
                : `Sync complete — ${syncResult.processed} added, ${syncResult.skipped} skipped, ${syncResult.failed} failed`}
            </div>
          )}
          {!fixingThumbs && fixThumbsResult && (
            <div className="p-3 rounded-xl text-xs border bg-neutral-900 text-neutral-400 border-neutral-800">Thumbnail repair: {fixThumbsResult.fixed} fixed, {fixThumbsResult.failed} failed</div>
          )}

          {/* Select mode + bulk actions -- sits below filters */}
          <div className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
            <button onClick={toggleSelectMode}
              className={`w-full px-3 py-2 rounded-lg text-xs border transition-colors text-left ${selectMode ? 'border-amber-600 text-amber-500 bg-amber-950/30' : 'border-neutral-700 text-neutral-400 hover:border-neutral-500'}`}>
              {selectMode && selectedIds.size > 0 ? 'Deselect all' : selectMode ? 'Cancel selection' : 'Select files'}
            </button>
            {selectMode && selectedIds.size > 0 && (
              <>
                {(isAdmin || !permsLoaded || perms?.can_download) && (
                  <button onClick={async () => {
                    const sel = assets.filter(a => selectedIds.has(a.id) && a.dropbox_path)
                    for (const a of sel) {
                      const link = document.createElement('a')
                      link.href = `/api/dropbox-download?path=${encodeURIComponent(a.dropbox_path)}&name=${encodeURIComponent(a.name)}`
                      link.download = a.name
                      document.body.appendChild(link)
                      link.click()
                      document.body.removeChild(link)
                      await new Promise(r => setTimeout(r, 300))
                    }
                  }} className="w-full px-3 py-2 rounded-lg text-xs border border-amber-800 text-amber-500 hover:bg-amber-950 transition-colors text-left">
                    Download {selectedIds.size} file{selectedIds.size !== 1 ? 's' : ''}
                  </button>
                )}
                {(isAdmin || !permsLoaded || perms?.can_delete) && (
                  <button onClick={deleteSelected} disabled={deleting}
                    className="w-full px-3 py-2 rounded-lg text-xs border border-red-900 text-red-500 hover:bg-red-950 transition-colors text-left">
                    {deleting ? 'Deleting...' : `Delete ${selectedIds.size} file${selectedIds.size !== 1 ? 's' : ''}`}
                  </button>
                )}
                <button onClick={selectAll}
                  className="w-full px-3 py-2 rounded-lg text-xs border border-neutral-700 text-neutral-400 hover:border-neutral-500 transition-colors text-left">
                  {allSelected ? 'Deselect all' : 'Select all'}
                </button>
              </>
            )}
          </div>

          {/* Bottom action buttons */}
          <div className="flex flex-col gap-2 mt-auto pt-4 border-t border-neutral-800">
            {untaggedCount > 0 && !tagging && (
              <button onClick={tagAllUntagged} className="w-full px-3 py-2 rounded-lg text-xs border border-amber-800 text-amber-500 hover:bg-amber-950 transition-colors text-left">Tag {untaggedCount} untagged</button>
            )}
            {tagging && (
              <button onClick={stopTagging} className="w-full px-3 py-2 rounded-lg text-xs border border-red-900 text-red-500 hover:bg-red-950 transition-colors text-left">Stop tagging</button>
            )}
            {missingThumbCount > 0 && (
              <button onClick={fixBrokenThumbnails} disabled={fixingThumbs} className="w-full px-3 py-2 rounded-lg text-xs border border-amber-800 text-amber-500 hover:bg-amber-950 disabled:opacity-50 transition-colors text-left">
                {fixingThumbs ? `Fixing thumbnails... ${fixThumbsResult?.fixed || 0} fixed` : `Fix ${missingThumbCount} broken thumbnails`}
              </button>
            )}
            {(isAdmin || !permsLoaded || perms?.can_dedup) && <button onClick={findDuplicates} className="w-full px-3 py-2 rounded-lg text-xs border border-neutral-700 text-neutral-400 hover:border-neutral-500 transition-colors text-left">Find duplicates</button>}
            {(isAdmin || !permsLoaded || perms?.can_choose_folder) && <button onClick={openFolderBrowser} className="w-full px-3 py-2 rounded-lg text-xs border border-neutral-700 text-neutral-400 hover:border-neutral-500 transition-colors text-left">Choose folder</button>}
            <div className="flex items-center gap-2 pt-1">
              <span className="text-xs text-neutral-500 truncate">{user?.email}</span>
              <button onClick={signOut} className="ml-auto text-xs text-neutral-600 hover:text-neutral-400 transition-colors flex-shrink-0">Sign out</button>
            </div>
            {isAdmin && <a href="/admin" className="w-full px-3 py-2 rounded-lg text-xs border border-neutral-700 text-neutral-500 hover:border-neutral-500 hover:text-neutral-300 transition-colors text-left block">Admin</a>}
          </div>

        </div>
      </div>

      {/* Right scrolling content */}
      <div className="flex-1 min-w-0 overflow-y-auto h-screen" onClick={() => { if (selected) setSelected(null) }}>
        <div className="px-6 py-6">

          {webhookNotification && (
            <div className="mb-4 p-4 rounded-xl bg-amber-950/40 border border-amber-800 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-amber-400 font-medium">
                  {webhookNotification.count} new file{webhookNotification.count !== 1 ? 's' : ''} were automatically imported from Dropbox
                </p>
                <p className="text-xs text-amber-600 mt-0.5">
                  {new Date(webhookNotification.timestamp).toLocaleString()}
                </p>
              </div>
              <button onClick={dismissWebhookNotification}
                className="text-amber-600 hover:text-amber-400 text-xs flex-shrink-0 transition-colors">
                Dismiss
              </button>
            </div>
          )}

          <div className="flex gap-2 mb-4 items-center">
            <span className="text-xs text-neutral-500">{assets.length} assets / {taggedCount} tagged</span>
            {selectMode && selectedIds.size > 0 && (
              <button onClick={async () => {
                const toTag = assets.filter(a => selectedIds.has(a.id) && !a.analyzed)
                if (!toTag.length) return
                setSelectMode(false)
                setSelectedIds(new Set())
                runTagging(toTag)
              }} disabled={tagging || assets.filter(a => selectedIds.has(a.id) && !a.analyzed).length === 0}
                className="ml-auto px-3 py-1.5 rounded-lg text-xs border border-amber-800 text-amber-500 hover:bg-amber-950 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                {tagging ? `Tagging... ${tagProgress.done}/${tagProgress.total}` : `Tag ${assets.filter(a => selectedIds.has(a.id) && !a.analyzed).length} untagged`}
              </button>
            )}
          </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {filtered.map(asset => {
            const isChecked = selectedIds.has(asset.id)
            const displayUrl = getDisplayUrl(asset)
            return (
              <div key={asset.id} onClick={e => { e.stopPropagation(); handleCardClick(asset) }}
                className={`rounded-xl overflow-hidden border transition-all group relative cursor-pointer ${isChecked ? 'border-amber-600 ring-1 ring-amber-600' : taggingIds.has(asset.id) ? 'border-amber-800 ring-1 ring-amber-900' : selected?.id === asset.id ? 'border-amber-600' : 'border-neutral-800 hover:border-neutral-600'}`}>
                <div className="aspect-[4/3] bg-neutral-900 flex items-center justify-center relative">
                  {displayUrl
                    ? <div className="relative w-full h-full">
                        <img src={displayUrl} alt={asset.name} className="w-full h-full object-cover" />
                        {asset.type === 'video' && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/10 hover:bg-black/25 transition-colors pointer-events-none">
                            <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center">
                              <span className="text-white text-sm ml-0.5">▶</span>
                            </div>
                          </div>
                        )}
                      </div>
                    : <div className="flex flex-col items-center gap-1">
                        <span className="text-neutral-600 text-2xl">▶</span>
                        <span className="text-neutral-700 text-xs">{asset.type === 'video' ? 'Video' : 'No preview'}</span>
                      </div>}
                  {!asset.analyzed && !taggingIds.has(asset.id) && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <span className="text-xs text-amber-400">Untagged</span>
                    </div>
                  )}
                  {taggingIds.has(asset.id) && (
                    <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2">
                      <span className="text-xs text-amber-400">
                        {currentlyTagging === asset.id ? 'Tagging...' : 'Queued'}
                      </span>
                      {currentlyTagging === asset.id && (
                        <div className="w-16 h-1 bg-neutral-700 rounded-full overflow-hidden">
                          <div className="h-full bg-amber-500 rounded-full animate-pulse" style={{width: '60%'}} />
                        </div>
                      )}
                    </div>
                  )}
                  <div className={`absolute top-2 left-2 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-opacity ${selectMode || isChecked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} ${isChecked ? 'bg-amber-600 border-amber-600' : 'bg-black/60 border-neutral-500'}`}>
                    {isChecked && <span className="text-black text-xs font-bold">✓</span>}
                  </div>
                  {!selectMode && (isAdmin || !permsLoaded || perms?.can_delete) && (
                    <button onClick={e => { e.stopPropagation(); deleteSingle(asset.id) }}
                      className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/70 text-neutral-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs">
                      X
                    </button>
                  )}
                </div>
                <div className="p-2.5 bg-neutral-900">
                  <div className="flex items-center justify-between gap-1 mb-1.5">
                    <p className="text-xs text-white truncate">{asset.name}</p>
                    {asset.file_size ? <span className="text-xs text-white whitespace-nowrap flex-shrink-0">{asset.file_size < 1048576 ? Math.round(asset.file_size/1024)+'KB' : (asset.file_size/1048576).toFixed(1)+'MB'}</span> : null}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(asset.tags || []).slice(0,3).map(tag => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-md bg-neutral-800 text-neutral-500">{tag}</span>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-20 text-neutral-600">
            <p className="text-sm">{assets.length === 0 ? 'Upload your first asset to get started' : 'No assets match your search'}</p>
          </div>
        )}
        </div>
      </div>

      {selected && !selectMode && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4"
          onClick={() => setSelected(null)}>
          <div className="bg-neutral-900 rounded-2xl border border-neutral-800 w-full max-w-5xl flex overflow-hidden"
            style={{maxHeight: '90vh'}}
            onClick={e => e.stopPropagation()}>

            {/* Large image/video on the left */}
            <div className="flex-1 min-w-0 bg-black flex items-center justify-center relative" style={{minHeight: '60vh'}}>
              <button onClick={() => { setSelected(null); setLightboxPlaying(false) }}
                className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-neutral-400 hover:text-white transition-colors z-10">
                ✕
              </button>
              {selected.type === 'video' ? (
                lightboxPlaying && selected.dropbox_path ? (
                  <video
                    src={`/api/video-proxy?path=${encodeURIComponent(selected.dropbox_path)}`}
                    controls autoPlay
                    className="max-w-full max-h-full rounded-lg"
                    style={{maxHeight: '85vh'}}>
                    Your browser does not support video playback.
                  </video>
                ) : (
                  <div className="relative w-full h-full flex items-center justify-center cursor-pointer"
                    onClick={e => { e.stopPropagation(); setLightboxPlaying(true) }}>
                    {getDisplayUrl(selected)
                      ? <img src={getDisplayUrl(selected)} alt={selected.name} className="max-w-full max-h-full object-contain" style={{maxHeight: '85vh'}} />
                      : <div className="w-24 h-24 rounded-full bg-neutral-800 flex items-center justify-center"><span className="text-neutral-500 text-4xl">▶</span></div>}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/40 transition-colors">
                      <div className="w-20 h-20 rounded-full bg-black/70 hover:bg-black/90 flex items-center justify-center transition-colors">
                        <span className="text-white text-3xl ml-1">▶</span>
                      </div>
                    </div>
                  </div>
                )
              ) : getDisplayUrl(selected) ? (
                <img src={getDisplayUrl(selected)} alt={selected.name}
                  className="max-w-full max-h-full object-contain"
                  style={{maxHeight: '85vh'}} />
              ) : (
                <div className="flex flex-col items-center gap-3 text-neutral-600">
                  <span className="text-5xl">▶</span>
                  <span className="text-sm">No preview available</span>
                </div>
              )}
            </div>

            {/* Metadata panel on the right */}
            <div className="w-72 flex-shrink-0 border-l border-neutral-800 flex flex-col overflow-y-auto">
              <div className="p-5 flex-1">
                <p className="font-medium text-sm mb-0.5 leading-snug">{selected.name}</p>
                <p className="text-xs text-neutral-500 mb-4 capitalize">{selected.type}{selected.file_size ? ` · ${selected.file_size < 1048576 ? Math.round(selected.file_size/1024)+'KB' : (selected.file_size/1048576).toFixed(1)+'MB'}` : ''}</p>

                {selected.dropbox_path && (
                  <div className="flex flex-col gap-2 mb-4">
                    <a href={`/api/dropbox-download?path=${encodeURIComponent(selected.dropbox_path)}&name=${encodeURIComponent(selected.name)}`}
                      download={selected.name}
                      className={`w-full text-center text-xs bg-amber-600 hover:bg-amber-500 text-black font-medium py-2 rounded-lg transition-colors ${!isAdmin && permsLoaded && !perms?.can_download ? "hidden" : ""}`}>
                      Download
                    </a>
                    <a href={selected.url} target="_blank" rel="noopener noreferrer"
                      className={`w-full text-center text-xs border border-neutral-700 hover:border-amber-600 text-neutral-400 hover:text-amber-500 py-2 rounded-lg transition-colors ${!isAdmin && permsLoaded && !perms?.can_dropbox ? "hidden" : ""}`}>
                      Open in Dropbox
                    </a>
                  </div>
                )}

                {selected.description && (
                  <p className="text-xs text-neutral-400 mb-4 leading-relaxed">{selected.description}</p>
                )}

                {(selected.tags || []).length > 0 && (
                  <>
                    <p className="text-[10px] text-neutral-600 uppercase tracking-wider mb-2">Tags</p>
                    <div className="flex flex-wrap gap-1.5 mb-4">
                      {(selected.tags || []).map(tag => (
                        <span key={tag} className="text-xs px-2 py-1 rounded-lg bg-neutral-800 text-neutral-400">{tag}</span>
                      ))}
                    </div>
                  </>
                )}

                {selected.file_date && (
                  <p className="text-xs text-neutral-600 mb-4">
                    {new Date(selected.file_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                  </p>
                )}
                {selected.dropbox_path && (
                  <div className="mb-4">
                    <p className="text-[10px] text-neutral-600 break-all leading-relaxed mb-1">{selected.dropbox_path}</p>
                    <button onClick={() => {
                      const folder = selected.dropbox_path!.substring(0, selected.dropbox_path!.lastIndexOf('/'))
                      setFolderFilter(folder)
                      setSelected(null)
                    }} className="text-[10px] text-amber-500 hover:text-amber-400 transition-colors">
                      Filter to this folder
                    </button>
                  </div>
                )}
              </div>

              <div className="p-5 border-t border-neutral-800">
                {(isAdmin || !permsLoaded || perms?.can_delete) && <button onClick={() => { deleteSingle(selected.id); setSelected(null) }}
                  className="w-full py-2 rounded-lg border border-red-900 text-red-500 hover:bg-red-950 text-xs transition-colors">
                  Delete asset
                </button>}
              </div>
            </div>
          </div>
        </div>
      )}

      {videoPlayer && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4"
          onClick={() => setVideoPlayer(null)}>
          <div className="w-full max-w-4xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-neutral-300 truncate flex-1 mr-4">{videoPlayer.name}</p>
              <button onClick={() => setVideoPlayer(null)}
                className="w-8 h-8 rounded-full bg-neutral-800 hover:bg-neutral-700 flex items-center justify-center text-neutral-400 hover:text-white transition-colors flex-shrink-0">
                ✕
              </button>
            </div>
            <video
              src={`/api/video-proxy?path=${encodeURIComponent(videoPlayer.dropbox_path)}`}
              controls
              autoPlay
              className="w-full rounded-xl bg-black"
              style={{maxHeight: '75vh'}}
              onError={(e) => console.error('Video error:', e)}>
              Your browser does not support video playback.
            </video>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(videoPlayer.tags || []).map(tag => (
                <span key={tag} className="text-xs px-2 py-1 rounded-lg bg-neutral-800 text-neutral-400">{tag}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {showDuplicates && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-neutral-900 border border-neutral-700 rounded-2xl w-full max-w-2xl flex flex-col" style={{maxHeight: '85vh'}}>

            <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Duplicate file names</p>
                <p className="text-xs text-neutral-500 mt-0.5">
                  {duplicateGroups.length === 0
                    ? 'No duplicates found'
                    : `${duplicateGroups.length} group${duplicateGroups.length !== 1 ? 's' : ''} of files sharing a name -- review and select which to delete`}
                </p>
              </div>
              <button onClick={() => setShowDuplicates(false)}
                className="w-7 h-7 rounded-full bg-neutral-800 hover:bg-neutral-700 flex items-center justify-center text-neutral-400 hover:text-white transition-colors text-xs">
                X
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {duplicateGroups.length === 0 && (
                <div className="flex items-center justify-center py-12 text-sm text-neutral-500">
                  Every file name in your library is unique
                </div>
              )}
              {duplicateGroups.map((group, gi) => (
                <div key={gi} className="border border-neutral-800 rounded-xl p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-xs text-neutral-400 truncate">{group[0].name} <span className="text-neutral-600">({group.length} copies)</span></p>
                    <button onClick={() => setDupesToDelete(prev => {
                      const next = new Set(prev)
                      group.slice(1).forEach(a => next.add(a.id))
                      return next
                    })}
                      className="text-[10px] text-amber-500 hover:text-amber-400 transition-colors whitespace-nowrap flex-shrink-0">
                      Keep first, mark rest
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {group.map(asset => {
                      const marked = dupesToDelete.has(asset.id)
                      return (
                        <button key={asset.id} onClick={() => toggleDupeDelete(asset.id)}
                          className={`relative rounded-lg overflow-hidden border-2 transition-colors text-left ${marked ? 'border-red-700' : 'border-neutral-800 hover:border-neutral-600'}`}>
                          <div className="aspect-square bg-neutral-800 flex items-center justify-center">
                            {asset.thumbnail_url ? (
                              <img src={asset.thumbnail_url} alt={asset.name} className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-neutral-600 text-xs">No preview</span>
                            )}
                          </div>
                          {marked && (
                            <div className="absolute inset-0 bg-red-950/60 flex items-center justify-center">
                              <span className="text-[10px] font-medium text-red-400 bg-black/60 px-2 py-1 rounded">Will delete</span>
                            </div>
                          )}
                          <div className="px-1.5 py-1 bg-neutral-900">
                            <p className="text-[10px] text-neutral-500 truncate">{asset.dropbox_path ? asset.dropbox_path.split('/').slice(-2).join('/') : '--'}</p>
                            {asset.file_size ? <p className="text-[9px] text-neutral-600">{asset.file_size < 1048576 ? Math.round(asset.file_size/1024)+'KB' : (asset.file_size/1048576).toFixed(1)+'MB'}</p> : null}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            {duplicateGroups.length > 0 && (
              <div className="px-5 py-4 border-t border-neutral-800 flex items-center justify-between">
                <span className="text-xs text-neutral-500">{dupesToDelete.size} selected for deletion</span>
                <button onClick={deleteSelectedDupes} disabled={dupesToDelete.size === 0 || deletingDupes}
                  className="px-4 py-2 rounded-lg text-xs bg-red-900 hover:bg-red-800 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors">
                  {deletingDupes ? 'Deleting...' : `Delete ${dupesToDelete.size} file${dupesToDelete.size !== 1 ? 's' : ''}`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showFolderBrowser && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-neutral-900 border border-neutral-700 rounded-2xl w-full max-w-lg flex flex-col" style={{maxHeight: '80vh'}}>

            <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Choose Dropbox folder</p>
                <p className="text-xs text-neutral-500 mt-0.5">Navigate to a folder, then select all or specific files</p>
              </div>
              <button onClick={() => setShowFolderBrowser(false)}
                className="w-7 h-7 rounded-full bg-neutral-800 hover:bg-neutral-700 flex items-center justify-center text-neutral-400 hover:text-white transition-colors text-xs">
                ✕
              </button>
            </div>

            <div className="px-5 py-2.5 border-b border-neutral-800 flex items-center gap-1.5 min-h-[40px] flex-wrap">
              {browserHistory.length > 0 && (
                <button onClick={navigateBack}
                  className="text-neutral-500 hover:text-white transition-colors mr-1 text-sm">
                  ←
                </button>
              )}
              <button onClick={() => { setBrowserHistory([]); browseTo(ROOT_PATH) }}
                className="text-neutral-600 hover:text-neutral-300 text-xs transition-colors">
                Dropbox
              </button>
              {breadcrumbs.map((crumb, i) => {
                const crumbPath = '/' + breadcrumbs.slice(0, i + 1).join('/')
                const isLast = i === breadcrumbs.length - 1
                return (
                  <span key={i} className="flex items-center gap-1.5">
                    <span className="text-neutral-700 text-xs">/</span>
                    {isLast ? (
                      <span className="text-xs text-neutral-300">{crumb}</span>
                    ) : (
                      <button onClick={() => {
                        setBrowserHistory(prev => [...prev, browserPath])
                        browseTo(crumbPath)
                      }} className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors">
                        {crumb}
                      </button>
                    )}
                  </span>
                )
              })}
            </div>

            <div className="flex-1 overflow-y-auto">
              {browserLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="text-xs text-neutral-500">Loading...</div>
                </div>
              ) : (
                <div>
                  {browserFolders.length > 0 && (
                    <div className="p-3 border-b border-neutral-800/50">
                      <p className="text-[10px] text-neutral-600 uppercase tracking-wider px-2 mb-1">Folders</p>
                      {browserFolders.map(folder => (
                        <button key={folder.path} onClick={() => navigateInto(folder)}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-neutral-800 transition-colors flex items-center gap-3 group">
                          <span className="text-base leading-none">📁</span>
                          <span className="text-sm text-neutral-300 group-hover:text-white flex-1 truncate">{folder.name}</span>
                          <span className="text-neutral-600 group-hover:text-neutral-400 text-xs">›</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {browserFiles.length > 0 && (
                    <div className="p-3">
                      <div className="flex items-center justify-between px-2 mb-1">
                        <p className="text-[10px] text-neutral-600 uppercase tracking-wider">{browserFiles.length} media files</p>
                        <button onClick={toggleAllFiles}
                          className="text-[10px] text-neutral-500 hover:text-amber-500 transition-colors">
                          {allFilesSelected ? 'Deselect all' : 'Select all'}
                        </button>
                      </div>
                      {browserFiles.map(file => {
                        const isSelected = selectedFiles.has(file.path)
                        const isVideo = ['.mp4', '.mov', '.avi', '.mkv', '.m4v'].some(ext => file.name.toLowerCase().endsWith(ext))
                        return (
                          <button key={file.path} onClick={() => toggleFileSelect(file.path)}
                            className={`w-full text-left px-3 py-2 rounded-lg transition-colors flex items-center gap-3 ${isSelected ? 'bg-amber-950/30' : 'hover:bg-neutral-800'}`}>
                            <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${isSelected ? 'bg-amber-600 border-amber-600' : 'border-neutral-600'}`}>
                              {isSelected && <span className="text-black text-[9px] font-bold">✓</span>}
                            </div>
                            <span className="text-sm leading-none">{isVideo ? '🎬' : '🖼'}</span>
                            <span className="text-xs text-neutral-300 flex-1 truncate">{file.name}</span>
                            <span className="text-[10px] text-neutral-600">{formatSize(file.size)}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {browserFolders.length === 0 && browserFiles.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 gap-2">
                      <div className="text-2xl">📂</div>
                      <div className="text-xs text-neutral-500">No media files or subfolders here</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-neutral-800">
              <div className="flex gap-2">
                <button onClick={() => setShowFolderBrowser(false)}
                  className="px-4 py-2 rounded-lg text-xs border border-neutral-700 text-neutral-400 hover:border-neutral-600 transition-colors">
                  Cancel
                </button>
                <label className="flex items-center gap-2 text-sm text-neutral-300 cursor-pointer whitespace-nowrap">
                  <input type="checkbox" checked={tagOnSync} onChange={e => setTagOnSync(e.target.checked)}
                    className="w-4 h-4 rounded accent-amber-500" />
                  Tag on sync
                </label>
                <button onClick={syncSelected} disabled={!browserPath}
                  className="flex-1 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{
                    background: browserPath ? '#c8a96e' : undefined,
                    color: browserPath ? '#000' : undefined,
                    border: browserPath ? 'none' : '1px solid #404040'
                  }}>
                  {syncButtonLabel}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
