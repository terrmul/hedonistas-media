import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { execSync, spawnSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function detectAndConvert(buffer: Buffer, fileName: string): { buffer: Buffer, mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' } {
  const tmpDir = tmpdir()
  const inputPath = join(tmpDir, `analyze_in_${Date.now()}`)
  const outputPath = join(tmpDir, `analyze_out_${Date.now()}.jpg`)

  writeFileSync(inputPath, buffer)

  const result = spawnSync('sips', ['-g', 'format', inputPath])
  const formatOutput = result.stdout?.toString() || ''
  const isHeic = formatOutput.includes('heic') || formatOutput.includes('heif')
  const isPng = formatOutput.includes('png')
  const isGif = formatOutput.includes('gif')
  const isWebp = formatOutput.includes('webp')

  try { unlinkSync(inputPath) } catch {}

  if (isHeic) {
    const inputPath2 = join(tmpDir, `analyze_in2_${Date.now()}.heic`)
    writeFileSync(inputPath2, buffer)
    execSync(`sips -s format jpeg "${inputPath2}" --out "${outputPath}"`)
    const converted = readFileSync(outputPath)
    try { unlinkSync(inputPath2) } catch {}
    try { unlinkSync(outputPath) } catch {}
    return { buffer: converted, mediaType: 'image/jpeg' }
  }

  if (isPng) return { buffer, mediaType: 'image/png' }
  if (isGif) return { buffer, mediaType: 'image/gif' }
  if (isWebp) return { buffer, mediaType: 'image/webp' }
  return { buffer, mediaType: 'image/jpeg' }
}

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get('file') as File
  const type = formData.get('type') as string

  try {
    let messageContent: Anthropic.MessageParam['content']

    if (type === 'image') {
      const bytes = await file.arrayBuffer()
      const rawBuffer = Buffer.from(bytes)
      const { buffer, mediaType } = detectAndConvert(rawBuffer, file.name)
      const base64 = buffer.toString('base64')

      messageContent = [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64 }
        },
        {
          type: 'text',
          text: 'Analyze this image for a mezcal brand media library. Return ONLY a valid JSON object with exactly two fields: "tags" (array of 8-12 short descriptive strings covering subjects, setting, mood, colors, objects, people, activities) and "description" (a single string of 1-2 sentences). Do not include any text before or after the JSON object.'
        }
      ]
    } else {
      messageContent = [{
        type: 'text',
        text: `Suggest content tags for a mezcal brand video file named "${file.name}". Return ONLY a valid JSON object with exactly two fields: "tags" (array of 6-8 short descriptive strings) and "description" (a single string of 1 sentence). Do not include any text before or after the JSON object.`
      }]
    }

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: messageContent }]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const clean = text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)

    if (!parsed.tags || !Array.isArray(parsed.tags)) {
      throw new Error('Invalid response structure')
    }

    return NextResponse.json(parsed)
  } catch (err) {
    console.error('Analyze error:', err)
    return NextResponse.json({ tags: ['untagged'], description: 'Analysis failed.' })
  }
}
