import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { Dropbox } from 'dropbox'
import { getDropboxToken } from '@/lib/dropbox'
import { supabase } from '@/lib/supabase'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function getAssetType(fileName: string): 'image' | 'video' | 'document' {
  const ext = fileName.toLowerCase().split('.').pop() || ''
  if (['.mp4', '.mov', '.avi', '.mkv', '.m4v', '.webm', '.wmv'].includes(`.${ext}`)) return 'video'
  if (ext === 'pdf') return 'document'
  return 'image'
}

function detectMediaType(buffer: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' {
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) return 'image/jpeg'
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png'
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'image/webp'
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'image/gif'
  return 'image/jpeg'
}

export async function POST(req: NextRequest) {
  try {
    const { assetId } = await req.json()

    const { data: asset } = await supabase
      .from('assets')
      .select('*')
      .eq('id', assetId)
      .single()

    if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 })

    let tags: string[] = []
    let description = ''

    if (asset.dropbox_path) {
      const token = await getDropboxToken()
      const dbx = new Dropbox({ accessToken: token, fetch: fetch })
      const download = await dbx.filesDownload({ path: asset.dropbox_path }) as any
      const arrayBuffer = await download.result.fileBlob.arrayBuffer()
      const rawBuffer = Buffer.from(arrayBuffer)

      const assetType = getAssetType(asset.name)

      if (assetType === 'video') {
        tags = asset.name.replace(/\.[^.]+$/, '').split(/[-_\s]+/).filter(Boolean).map((t: string) => t.toLowerCase())
        description = `Video: ${asset.name}`
        await supabase.from('assets').update({ tags, description, analyzed: true }).eq('id', asset.id)
        return NextResponse.json({ success: true, tags, description })
      }

      let imageBuffer: Buffer = rawBuffer
      let mediaType = detectMediaType(rawBuffer)

      if (assetType === 'image') {
        try {
          const sharp = (await import('sharp')).default
          imageBuffer = await sharp(rawBuffer).rotate().resize(1600, 1600, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer()
          mediaType = 'image/jpeg'
        } catch {
          imageBuffer = rawBuffer
          mediaType = detectMediaType(rawBuffer)
        }
      }

      const base64 = imageBuffer.toString('base64')
      const promptText = assetType === 'document'
        ? 'This is a page from a PDF document for a mezcal brand media library. Analyze the content and return ONLY a valid JSON object with: "tags" (array of 8-12 descriptive strings covering the document type, topics, brand elements, key information) and "description" (1-2 sentences summarizing what this document is about). No markdown, no preamble.'
        : 'Analyze this image for a mezcal brand media library. Return ONLY a valid JSON object with: "tags" (array of 8-12 short descriptive strings covering subjects, setting, mood, colors, objects, people, activities) and "description" (1-2 sentences). No markdown, no preamble.'

      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: promptText }
          ]
        }]
      })

      const text = response.content[0].type === 'text' ? response.content[0].text : ''
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
      tags = parsed.tags || []
      description = parsed.description || ''
    } else {
      tags = asset.name.replace(/\.[^.]+$/, '').split(/[-_\s]+/).filter(Boolean).map((t: string) => t.toLowerCase())
      description = `${asset.type}: ${asset.name}`
    }

    await supabase.from('assets').update({ tags, description, analyzed: true }).eq('id', asset.id)
    return NextResponse.json({ success: true, tags, description })
  } catch (err) {
    console.error('Tag error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
