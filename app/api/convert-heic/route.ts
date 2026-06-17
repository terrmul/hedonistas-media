import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const converted = await sharp(buffer)
      .rotate()
      .jpeg({ quality: 90 })
      .toBuffer()

    return new NextResponse(converted as unknown as BodyInit, {
      headers: { 'Content-Type': 'image/jpeg' }
    })
  } catch (err) {
    console.error('Conversion error:', err)
    return NextResponse.json({ error: 'Conversion failed' }, { status: 500 })
  }
}
