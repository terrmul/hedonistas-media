import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { execSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function convertToJpeg(buffer: Buffer, fileName: string): Promise<Buffer> {
  const ext = fileName.toLowerCase().split('.').pop() || ''

  if (ext === 'pdf') {
    const tmpDir = tmpdir()
    const inputPath = join(tmpDir, `pdf_in_${Date.now()}_${fileName}`)
    const outputPath = join(tmpDir, `pdf_out_${Date.now()}.jpg`)
    writeFileSync(inputPath, buffer)
    const tmpOut = join(tmpDir, `ql_out_${Date.now()}`)
    mkdirSync(tmpOut, { recursive: true })
    execSync(`qlmanage -t -s 1600 -o "${tmpOut}" "${inputPath}" 2>/dev/null`)
    const qlFiles = readdirSync(tmpOut).filter((f: string) => f.endsWith('.png'))
    const qlFile = qlFiles.length > 0 ? join(tmpOut, qlFiles[0]) : null
    if (qlFile && existsSync(qlFile)) {
      const pdfBuffer = readFileSync(qlFile)
      const result = await sharp(pdfBuffer).jpeg({ quality: 85 }).toBuffer()
      try { unlinkSync(qlFile) } catch {}
      try { unlinkSync(inputPath) } catch {}
      return result
    }
    try { unlinkSync(inputPath) } catch {}
    return buffer
  }

  // Use sharp for all image formats
  try {
    return await sharp(buffer)
      .rotate()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer()
  } catch {
    return buffer
  }
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
      const converted = await convertToJpeg(rawBuffer, file.name)
      const base64 = converted.toString('base64')
      const sizeMB = (converted.length / (1024 * 1024)).toFixed(1)
      console.log(`Analyzing upload ${file.name} — ${sizeMB}MB`)

      messageContent = [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: base64 }
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
