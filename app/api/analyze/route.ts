import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { execSync, spawnSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function convertToJpeg(buffer: Buffer, fileName: string): Buffer {
  const tmpDir = tmpdir()
  const ext = fileName.toLowerCase().split('.').pop() || 'jpg'
  const inputPath = join(tmpDir, `analyze_in_${Date.now()}.${ext}`)
  const outputPath = join(tmpDir, `analyze_out_${Date.now()}.jpg`)

  writeFileSync(inputPath, buffer)

  try {
    if (ext === 'pdf') {
      const { readdirSync } = require('fs')
      const tmpOut = join(tmpDir, `ql_out_${Date.now()}`)
      mkdirSync(tmpOut, { recursive: true })
      execSync(`qlmanage -t -s 1600 -o "${tmpOut}" "${inputPath}" 2>/dev/null`)
      const qlFiles = readdirSync(tmpOut).filter((f: string) => f.endsWith('.png'))
      const qlFile = qlFiles.length > 0 ? join(tmpOut, qlFiles[0]) : null
      if (qlFile && existsSync(qlFile)) {
        execSync(`sips -s format jpeg "${qlFile}" --out "${outputPath}"`)
        try { unlinkSync(qlFile) } catch {}
      }
    } else {
      execSync(`sips -s format jpeg -Z 1600 "${inputPath}" --out "${outputPath}"`)
    }

    if (existsSync(outputPath)) {
      const result = readFileSync(outputPath)
      try { unlinkSync(inputPath) } catch {}
      try { unlinkSync(outputPath) } catch {}
      return result
    }
  } catch (err) {
    console.error('Conversion error:', err)
  }

  try { unlinkSync(inputPath) } catch {}
  try { unlinkSync(outputPath) } catch {}
  return buffer
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
      const converted = convertToJpeg(rawBuffer, file.name)
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
