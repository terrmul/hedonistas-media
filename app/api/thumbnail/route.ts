import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const thumbnail = await sharp(buffer)
      .rotate()
      .resize(400, 300, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 80 })
      .toBuffer()

    return new NextResponse(thumbnail as unknown as BodyInit, {
      headers: { 'Content-Type': 'image/jpeg' }
    })
  } catch (err) {
    console.error('Thumbnail error:', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
