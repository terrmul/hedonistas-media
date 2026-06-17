import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // sharp handles HEIC/HEIF natively on Linux via libvips (built into the sharp npm package)
    const converted = await sharp(buffer)
      .rotate()           // honour EXIF orientation
      .jpeg({ quality: 90 })
      .toBuffer()

    return new NextResponse(converted, {
      headers: { 'Content-Type': 'image/jpeg' }
    })
  } catch (err) {
    console.error('Conversion error:', err)
    return NextResponse.json({ error: 'Conversion failed' }, { status: 500 })
  }
}
