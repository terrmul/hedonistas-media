import { NextRequest, NextResponse } from 'next/server'
import { Dropbox } from 'dropbox'
import { getDropboxToken } from '@/lib/dropbox'

export async function GET(req: NextRequest) {
  try {
    const path = req.nextUrl.searchParams.get('path')
    if (!path) return NextResponse.json({ error: 'No path' }, { status: 400 })

    const token = await getDropboxToken()
    const dbx = new Dropbox({ accessToken: token, fetch: fetch })

    const download = await dbx.filesDownload({ path }) as any
    const arrayBuffer = await download.result.fileBlob.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const ext = path.toLowerCase().split('.').pop()
    const contentType = ext === 'mov' ? 'video/quicktime' :
                        ext === 'avi' ? 'video/x-msvideo' :
                        ext === 'mkv' ? 'video/x-matroska' : 'video/mp4'

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': buffer.length.toString(),
        'Accept-Ranges': 'bytes',
      }
    })
  } catch (err) {
    console.error('Video proxy error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
