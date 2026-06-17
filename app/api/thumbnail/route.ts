import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { execSync, spawnSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

function isHeic(buffer: Buffer): boolean {
  const hex = buffer.slice(4, 12).toString('hex')
  return hex.includes('6674797068656963') || hex.includes('6674797068656966')
}

async function convertHeicToJpeg(buffer: Buffer): Promise<Buffer> {
  const tmpDir = tmpdir()
  const inputPath = join(tmpDir, `heic_in_${Date.now()}.heic`)
  const outputPath = join(tmpDir, `heic_out_${Date.now()}.jpg`)
  writeFileSync(inputPath, buffer)
  execSync(`sips -s format jpeg "${inputPath}" --out "${outputPath}" 2>/dev/null || /usr/local/bin/sips -s format jpeg "${inputPath}" --out "${outputPath}"`)
  const result = readFileSync(outputPath)
  try { unlinkSync(inputPath) } catch {}
  try { unlinkSync(outputPath) } catch {}
  return result
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const bytes = await file.arrayBuffer()
    let buffer = Buffer.from(bytes)

    if (isHeic(buffer)) {
      try {
        buffer = await convertHeicToJpeg(buffer)
      } catch {
        return NextResponse.json({ error: 'HEIC conversion failed' }, { status: 500 })
      }
    }

    const thumbnail = await sharp(buffer)
      .rotate()
      .resize(400, 300, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 80 })
      .toBuffer()

    return new NextResponse(thumbnail, {
      headers: { 'Content-Type': 'image/jpeg' }
    })
  } catch (err) {
    console.error('Thumbnail error:', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
