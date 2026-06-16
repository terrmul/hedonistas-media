import { NextRequest, NextResponse } from 'next/server'
import { execSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const tmpDir = tmpdir()
    const inputPath = join(tmpDir, `input_${Date.now()}.heic`)
    const outputPath = join(tmpDir, `output_${Date.now()}.jpg`)

    writeFileSync(inputPath, buffer)
    execSync(`sips -s format jpeg "${inputPath}" --out "${outputPath}"`)
    const converted = readFileSync(outputPath)

    try { unlinkSync(inputPath) } catch {}
    try { unlinkSync(outputPath) } catch {}

    return new NextResponse(converted, {
      headers: { 'Content-Type': 'image/jpeg' }
    })
  } catch (err) {
    console.error('Conversion error:', err)
    return NextResponse.json({ error: 'Conversion failed' }, { status: 500 })
  }
}