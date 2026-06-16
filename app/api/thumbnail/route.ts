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
    const inputPath = join(tmpDir, `thumb_in_${Date.now()}.jpg`)
    const outputPath = join(tmpDir, `thumb_out_${Date.now()}.jpg`)

    writeFileSync(inputPath, buffer)
    execSync(`sips -s format jpeg -Z 400 "${inputPath}" --out "${outputPath}"`)
    const result = readFileSync(outputPath)

    try { unlinkSync(inputPath) } catch {}
    try { unlinkSync(outputPath) } catch {}

    return new NextResponse(result, {
      headers: { 'Content-Type': 'image/jpeg' }
    })
  } catch (err) {
    console.error('Thumbnail error:', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
