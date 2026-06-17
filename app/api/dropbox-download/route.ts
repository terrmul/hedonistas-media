import { NextRequest, NextResponse } from 'next/server'
import { Dropbox } from 'dropbox'
import { getDropboxToken } from '@/lib/dropbox'

export async function GET(req: NextRequest) {
  try {
    const path = req.nextUrl.searchParams.get('path')
    const name = req.nextUrl.searchParams.get('name') || 'download'
    if (!path) return NextResponse.json({ error: 'No path' }, { status: 400 })

    const token = await getDropboxToken()
    const dbx = new Dropbox({ accessToken: token, fetch: fetch })
    const download = await dbx.filesDownload({ path }) as any
    const arrayBuffer = await download.result.fileBlob.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Disposition': `attachment; filename="${name}"`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': buffer.length.toString(),
      }
    })
  } catch (err) {
    console.error('Download error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
