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

function isHeic(fileName: string): boolean {
  const ext = fileName.toLowerCase().split('.').pop() || ''
  return ext === 'heic' || ext === 'heif'
}

function filenameTags(name: string): string[] {
  return name.replace(/\.[^.]+$/, '').split(/[-_\s]+/).filter(Boolean).map(t => t.toLowerCase())
}

async function toJpegBuffer(buffer: Buffer, fileName: string): Promise<Buffer | null> {
  try {
    if (isHeic(fileName)) {
      const heicConvert = (await import('heic-convert')).default
      const converted = await heicConvert({ buffer, format: 'JPEG', quality: 0.85 })
      return Buffer.from(converted)
    }
    const sharp = (await import('sharp')).default
    return await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize(1600, 1600, { fit: 'inside' })
      .jpeg({ quality: 85 })
      .toBuffer()
  } catch (err) {
    console.error('Image conversion failed:', err)
    return null
  }
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

    if (asset.dropbox_path && (assetType === 'image' || assetType === 'document')) {
      const token = await getDropboxToken()
      const dbx = new Dropbox({ accessToken: token, fetch: fetch })
      const download = await dbx.filesDownload({ path: asset.dropbox_path }) as any
      const arrayBuffer = await download.result.fileBlob.arrayBuffer()
      const rawBuffer = Buffer.from(arrayBuffer)

      if (assetType === 'document') {
        // Send PDF directly to Claude as a document
        try {
          const base64 = rawBuffer.toString('base64')
          const response = await client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 1000,
            messages: [{
              role: 'user',
              content: [
                {
                  type: 'document',
                  source: { type: 'base64', media_type: 'application/pdf', data: base64 }
                } as any,
                {
                  type: 'text',
                  text: 'This is a PDF document for a mezcal brand media library. Analyze the content and return ONLY a valid JSON object with: "tags" (array of 8-12 descriptive strings covering the document type, topics, brand elements, key information) and "description" (1-2 sentences summarizing what this document is about). No markdown, no preamble.'
                }
              ]
            }]
          })
          const text = response.content[0].type === 'text' ? response.content[0].text : ''
          const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
          tags = parsed.tags || []
          description = parsed.description || ''
        } catch (err) {
          console.error('PDF tagging failed:', err)
          tags = filenameTags(asset.name)
          description = `Document: ${asset.name}`
        }
      } else {
        // Image
        const imageBuffer = await toJpegBuffer(rawBuffer, asset.name)

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
          } catch (claudeErr) {
            console.error('Claude failed:', claudeErr)
            tags = filenameTags(asset.name)
            description = `Image: ${asset.name}`
          }
        } else {
          tags = filenameTags(asset.name)
          description = `Image: ${asset.name}`
        }
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
