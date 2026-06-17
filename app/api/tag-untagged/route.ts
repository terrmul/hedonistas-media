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

function filenameTags(name: string): string[] {
  return name.replace(/\.[^.]+$/, '').split(/[-_\s]+/).filter(Boolean).map(t => t.toLowerCase())
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

    const assetType = getAssetType(asset.name)

    if (asset.dropbox_path && assetType === 'image') {
      const token = await getDropboxToken()
      const dbx = new Dropbox({ accessToken: token, fetch: fetch })
      const download = await dbx.filesDownload({ path: asset.dropbox_path }) as any
      const arrayBuffer = await download.result.fileBlob.arrayBuffer()
      const rawBuffer = Buffer.from(arrayBuffer)

      let imageBuffer: Buffer | null = null

      try {
        const sharp = (await import('sharp')).default
        // failOn: 'none' tells sharp to be lenient with unusual files
        imageBuffer = await sharp(rawBuffer, { failOn: 'none' })
          .rotate()
          .resize(1600, 1600, { fit: 'inside' })
          .jpeg({ quality: 85 })
          .toBuffer()
        console.log('sharp conversion succeeded, size:', imageBuffer.length)
      } catch (sharpErr) {
        console.error('sharp failed:', sharpErr)
        imageBuffer = null
      }

      if (imageBuffer) {
        try {
          const base64 = imageBuffer.toString('base64')
          const response = await client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 1000,
            messages: [{
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
                { type: 'text', text: 'Analyze this image for a mezcal brand media library. Return ONLY a valid JSON object with: "tags" (array of 8-12 short descriptive strings covering subjects, setting, mood, colors, objects, people, activities) and "description" (1-2 sentences). No markdown, no preamble.' }
              ]
            }]
          })
          const text = response.content[0].type === 'text' ? response.content[0].text : ''
          const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
          tags = parsed.tags || []
          description = parsed.description || ''
          console.log('Claude tagging succeeded:', tags)
        } catch (claudeErr) {
          console.error('Claude failed:', claudeErr)
          tags = filenameTags(asset.name)
          description = `Image: ${asset.name}`
        }
      } else {
        tags = filenameTags(asset.name)
        description = `Image: ${asset.name}`
      }
    } else {
      tags = filenameTags(asset.name)
      description = `${assetType}: ${asset.name}`
    }

    await supabase.from('assets').update({ tags, description, analyzed: true }).eq('id', asset.id)
    return NextResponse.json({ success: true, tags, description })
  } catch (err) {
    console.error('Tag error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
