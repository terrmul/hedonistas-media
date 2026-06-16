import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { Dropbox } from 'dropbox'
import { supabase } from '@/lib/supabase'
import { execSync, spawnSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const dbx = new Dropbox({ accessToken: process.env.DROPBOX_ACCESS_TOKEN, fetch: fetch })

function resizeAndConvert(buffer: Buffer): { buffer: Buffer, mediaType: 'image/jpeg' } {
  const tmpDir = tmpdir()
  const inputPath = join(tmpDir, `tag_in_${Date.now()}`)
  const outputPath = join(tmpDir, `tag_out_${Date.now()}.jpg`)
  writeFileSync(inputPath, buffer)
  execSync(`sips -s format jpeg -Z 1600 "${inputPath}" --out "${outputPath}"`)
  const result = readFileSync(outputPath)
  try { unlinkSync(inputPath) } catch {}
  try { unlinkSync(outputPath) } catch {}
  return { buffer: result, mediaType: 'image/jpeg' }
}

function extractVideoFrame(buffer: Buffer, fileName: string): Buffer | null {
  const tmpDir = tmpdir()
  const inputPath = join(tmpDir, `video_in_${Date.now()}_${fileName}`)
  const outputPath = join(tmpDir, `video_frame_${Date.now()}.jpg`)
  try {
    writeFileSync(inputPath, buffer)
    execSync(`/usr/local/bin/ffmpeg -i "${inputPath}" -ss 00:00:03 -vframes 1 -vf scale=1280:-1 "${outputPath}" -y 2>/dev/null`, { timeout: 30000 })
    if (existsSync(outputPath)) {
      const frame = readFileSync(outputPath)
      try { unlinkSync(inputPath) } catch {}
      try { unlinkSync(outputPath) } catch {}
      return frame
    }
    try { unlinkSync(inputPath) } catch {}
    return null
  } catch {
    try { unlinkSync(inputPath) } catch {}
    try { unlinkSync(outputPath) } catch {}
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

    if (asset.dropbox_path) {
      const download = await dbx.filesDownload({ path: asset.dropbox_path }) as any
      const arrayBuffer = await download.result.fileBlob.arrayBuffer()
      const rawBuffer = Buffer.from(arrayBuffer)

      let imageBuffer: Buffer | null = null
      let mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' = 'image/jpeg'

      if (asset.type === 'video') {
        console.log(`Extracting frame from video: ${asset.name}`)
        imageBuffer = extractVideoFrame(rawBuffer, asset.name)
        if (!imageBuffer) {
          console.log(`Frame extraction failed for ${asset.name}, using filename`)
          tags = asset.name.replace(/\.[^.]+$/, '').split(/[-_\s]+/).filter(Boolean).map((t: string) => t.toLowerCase())
          description = `Video: ${asset.name}`
          await supabase.from('assets').update({ tags, description, analyzed: true }).eq('id', asset.id)
          return NextResponse.json({ success: true, tags, description })
        }
      } else {
        const converted = resizeAndConvert(rawBuffer)
        imageBuffer = converted.buffer
        mediaType = converted.mediaType
      }

      const base64 = imageBuffer.toString('base64')
      const sizeMB = (imageBuffer.length / (1024 * 1024)).toFixed(1)
      console.log(`Analyzing ${asset.name} (${asset.type}) — ${sizeMB}MB`)

      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: asset.type === 'video'
              ? 'This is a frame extracted from a video for a mezcal brand media library. Analyze what you see and return ONLY a valid JSON object with: "tags" (array of 8-12 descriptive strings covering subjects, setting, mood, colors, objects, people, activities, camera angle) and "description" (1-2 sentences describing what is happening in the video). No markdown, no preamble.'
              : 'Analyze this image for a mezcal brand media library. Return ONLY a valid JSON object with: "tags" (array of 8-12 short descriptive strings covering subjects, setting, mood, colors, objects, people, activities) and "description" (1-2 sentences). No markdown, no preamble.'
            }
          ]
        }]
      })

      const text = response.content[0].type === 'text' ? response.content[0].text : ''
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
      tags = parsed.tags || []
      description = parsed.description || ''
    } else {
      tags = asset.name.replace(/\.[^.]+$/, '').split(/[-_\s]+/).filter(Boolean).map((t: string) => t.toLowerCase())
      description = `${asset.type === 'video' ? 'Video' : 'Image'}: ${asset.name}`
    }

    await supabase.from('assets').update({ tags, description, analyzed: true }).eq('id', asset.id)
    return NextResponse.json({ success: true, tags, description })
  } catch (err) {
    console.error('Tag error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
