'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

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
}

export default function Home() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [filtered, setFiltered] = useState<Asset[]>([])
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [selected, setSelected] = useState<Asset | null>(null)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<any>(null)
  const [syncPath, setSyncPath] = useState('/HDLF Team/Marketing Assets/Content')

  const fetchAssets = useCallback(async () => {
    const { data } = await supabase.from('assets').select('*').order('created_at', { ascending: false })
    if (data) { setAssets(data); setFiltered(data) }
  }, [])

  useEffect(() => { fetchAssets() }, [fetchAssets])

  useEffect(() => {
    const terms = search.toLowerCase().split(' ').filter(Boolean)
    const results = assets.filter(a => {
      if (typeFilter !== 'all' && a.type !== typeFilter) return false
      if (!terms.length) return true
      const hay = [...(a.tags || []), a.name, a.description].join(' ').toLowerCase()
      return terms.every(t => hay.includes(t))
    })
    setFiltered(results)
  }, [search, typeFilter, assets])

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
              .from('thumbnails')
              .upload(thumbName, blob, { contentType: 'image/jpeg' })
            if (uploadData) {
              const { data: urlData } = supabase.storage
                .from('thumbnails')
                .getPublicUrl(thumbName)
              thumbnailUrl = urlData.publicUrl
            }
          }
        } catch (err) {
          console.error('Thumbnail generation failed:', err)
        }
      }
      const url = URL.createObjectURL(converted)
      const { data } = await supabase.from('assets').insert({
        name: converted.name,
        type: isVideo ? 'video' : 'image',
        url: thumbnailUrl || url,
        thumbnail_url: thumbnailUrl,
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
        await supabase.from('assets').update({
          tags: result.tags,
          description: result.description,
          analyzed: true
        }).eq('id', asset.id)
        setAssets(prev => prev.map(a =>
          a.id === asset.id
            ? { ...a, tags: result.tags, description: result.description, analyzed: true }
            : a
        ))
      }
    } catch (err) { console.error(err) }
  }

  async function deleteSingle(id: string) {
    if (!confirm('Delete this asset?')) return
    await supabase.from('assets').delete().eq('id', id)
    setAssets(prev => prev.filter(a => a.id !== id))
    if (selected?.id === id) setSelected(null)
  }

  async function deleteSelected() {
    if (!confirm(`Delete ${selectedIds.size} asset${selectedIds.size !== 1 ? 's' : ''}?`)) return
    setDeleting(true)
    const ids = Array.from(selectedIds)
    await supabase.from('assets').delete().in('id', ids)
    setAssets(prev => prev.filter(a => !selectedIds.has(a.id)))
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
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map(a => a.id)))
    }
  }

  function toggleSelectMode() {
    setSelectMode(prev => !prev)
    setSelectedIds(new Set())
    setSelected(null)
  }

  function handleCardClick(asset: Asset) {
    if (selectMode) {
      toggleSelect(asset.id)
    } else {
      setSelected(selected?.id === asset.id ? null : asset)
    }
  }

  async function syncDropbox() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/dropbox-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '' })
      })
      const result = await res.json()
      setSyncResult(result)
      await fetchAssets()
    } catch (err) {
      console.error('Sync failed:', err)
      setSyncResult({ error: 'Sync failed' })
    }
    setSyncing(false)
  }

  function getDisplayUrl(asset: Asset) {
    return asset.thumbnail_url || asset.url || ''
  }

  const taggedCount = assets.filter(a => a.analyzed).length
  const allSelected = filtered.length > 0 && selectedIds.size === filtered.length

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{background:'#c8a96e'}}>
              <span className="text-black font-semibold text-sm">HM</span>
            </div>
            <div>
              <h1 className="text-lg font-medium">Hedonistas Mezcal</h1>
              <p className="text-xs text-neutral-500">Media library</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs text-neutral-500">{assets.length} assets / {taggedCount} tagged</div>
            <div className="flex gap-2 items-center">
  <input
    type="text"
    value={syncPath}
    onChange={e => setSyncPath(e.target.value)}
    placeholder="Dropbox folder path"
    className="bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-600 w-64"
  />
  <button onClick={syncDropbox} disabled={syncing}
    className="px-3 py-1.5 rounded-lg text-xs border border-neutral-700 text-neutral-400 hover:border-amber-600 hover:text-amber-600 transition-colors whitespace-nowrap">
    {syncing ? 'Syncing...' : 'Sync Dropbox'}
  </button>
</div>
          </div>
        </div>

        {syncResult && (
          <div className={`mb-4 p-3 rounded-lg text-xs ${syncResult.error ? 'bg-red-950 text-red-400' : 'bg-neutral-900 text-neutral-400'}`}>
            {syncResult.error ? syncResult.error : `Sync complete — ${syncResult.processed} new assets added, ${syncResult.skipped} already imported, ${syncResult.failed} failed`}
          </div>
        )}

        <div className="block border border-dashed border-neutral-700 rounded-xl p-8 text-center cursor-pointer hover:border-amber-600 transition-colors mb-6"
          onClick={() => document.getElementById('fileInput')?.click()}
          onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
          onDrop={e => { e.preventDefault(); e.stopPropagation(); handleUpload(e.dataTransfer.files) }}>
          <input id="fileInput" type="file" multiple accept="image/*,video/*,.heic,.heif" className="hidden"
            onChange={e => handleUpload(e.target.files)} />
          <p className="text-neutral-400 text-sm">{uploading ? 'Uploading and analyzing...' : 'Drop images or videos here, or click to browse'}</p>
          <p className="text-neutral-600 text-xs mt-1">Supports JPG, PNG, HEIC, MP4, MOV</p>
        </div>

        <div className="flex gap-3 mb-4">
          <input type="text" placeholder="Search by subject — bottle, beach, smoke, agave..."
            className="flex-1 bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-2.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-600"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div className="flex gap-2 mb-6 items-center">
          {['all','image','video'].map(f => (
            <button key={f} onClick={() => setTypeFilter(f)}
              className={`px-4 py-1.5 rounded-full text-xs border transition-colors ${typeFilter === f ? 'bg-amber-600 border-amber-600 text-black font-medium' : 'border-neutral-700 text-neutral-400 hover:border-neutral-500'}`}>
              {f === 'all' ? 'All' : f === 'image' ? 'Images' : 'Video'}
            </button>
          ))}
          <span className="text-xs text-neutral-600">{filtered.length} results</span>
          <div className="ml-auto flex gap-2">
            {selectMode && (
              <button onClick={selectAll}
                className="px-3 py-1.5 rounded-lg text-xs border border-neutral-700 text-neutral-400 hover:border-neutral-500 transition-colors">
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
            )}
            {selectMode && selectedIds.size > 0 && (
              <button onClick={deleteSelected} disabled={deleting}
                className="px-3 py-1.5 rounded-lg text-xs border border-red-900 text-red-500 hover:bg-red-950 transition-colors">
                {deleting ? 'Deleting...' : `Delete ${selectedIds.size}`}
              </button>
            )}
            <button onClick={toggleSelectMode}
              className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${selectMode ? 'border-amber-600 text-amber-600 hover:bg-amber-950' : 'border-neutral-700 text-neutral-400 hover:border-neutral-500'}`}>
              {selectMode ? 'Done' : 'Select'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {filtered.map(asset => {
            const isChecked = selectedIds.has(asset.id)
            const displayUrl = getDisplayUrl(asset)
            return (
              <div key={asset.id} onClick={() => handleCardClick(asset)}
                className={`rounded-xl overflow-hidden border transition-all group relative cursor-pointer ${isChecked ? 'border-amber-600 ring-1 ring-amber-600' : selected?.id === asset.id ? 'border-amber-600' : 'border-neutral-800 hover:border-neutral-600'}`}>
                <div className="aspect-[4/3] bg-neutral-900 flex items-center justify-center relative">
                  {asset.type === 'image' && displayUrl
                    ? <img src={displayUrl} alt={asset.name} className="w-full h-full object-cover" />
                    : <div className="flex flex-col items-center gap-1">
                        <span className="text-neutral-600 text-2xl">play</span>
                        <span className="text-neutral-700 text-xs">{asset.type === 'video' ? 'Video' : 'No preview'}</span>
                      </div>}
                  {!asset.analyzed && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <span className="text-xs text-amber-400">Analyzing...</span>
                    </div>
                  )}
                  <div className={`absolute top-2 left-2 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-opacity ${selectMode || isChecked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} ${isChecked ? 'bg-amber-600 border-amber-600' : 'bg-black/60 border-neutral-500'}`}>
                    {isChecked && <span className="text-black text-xs font-bold">✓</span>}
                  </div>
                  {!selectMode && (
                    <button onClick={e => { e.stopPropagation(); deleteSingle(asset.id) }}
                      className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/70 text-neutral-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs">
                      X
                    </button>
                  )}
                </div>
                <div className="p-2.5 bg-neutral-900">
                  <p className="text-xs text-neutral-300 truncate mb-1.5">{asset.name}</p>
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

      {selected && !selectMode && (
        <div className="fixed inset-y-0 right-0 w-80 bg-neutral-900 border-l border-neutral-800 p-6 overflow-y-auto">
          <button onClick={() => setSelected(null)} className="absolute top-4 right-4 text-neutral-600 hover:text-white text-lg">X</button>
          {selected.type === 'image' && getDisplayUrl(selected) && (
            <img src={getDisplayUrl(selected)} alt={selected.name} className="w-full rounded-lg mb-4" />
          )}
          <p className="font-medium text-sm mb-1">{selected.name}</p>
          <p className="text-xs text-neutral-500 mb-2 capitalize">{selected.type}</p>
          {selected.dropbox_path && (
            <a href={selected.url} target="_blank" rel="noopener noreferrer"
              className="block text-xs text-amber-600 hover:text-amber-500 mb-4 truncate">
              Open in Dropbox
            </a>
          )}
          {selected.description && (
            <p className="text-xs text-neutral-400 mb-4 leading-relaxed">{selected.description}</p>
          )}
          <p className="text-xs text-neutral-600 uppercase tracking-wider mb-2">Tags</p>
          <div className="flex flex-wrap gap-1.5 mb-6">
            {(selected.tags || []).map(tag => (
              <span key={tag} className="text-xs px-2 py-1 rounded-lg bg-neutral-800 text-neutral-400">{tag}</span>
            ))}
          </div>
          <button onClick={() => deleteSingle(selected.id)}
            className="w-full py-2 rounded-lg border border-red-900 text-red-500 hover:bg-red-950 text-xs transition-colors">
            Delete asset
          </button>
        </div>
      )}
    </main>
  )
}
