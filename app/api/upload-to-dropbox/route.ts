import { NextRequest, NextResponse } from 'next/server'
import { Dropbox } from 'dropbox'
import { getDropboxToken } from '@/lib/dropbox'

const UPLOAD_FOLDER = '/hdlf team/**marketing assets**/**content**/media uploads'

async function getDropboxUrl(dbx: Dropbox, filePath: string, fileId?: string): Promise<string> {
  try {
    const linkResult = await dbx.sharingCreateSharedLinkWithSettings({ path: filePath })
    return linkResult.result.url.replace('?dl=0', '?raw=1')
  } catch {
    try {
      const links = await dbx.sharingListSharedLinks({ path: filePath, direct_only: true })
      if (links.result.links.length > 0) {
        return links.result.links[0].url.replace('?dl=0', '?raw=1')
      }
    } catch {}
    const id = fileId?.replace('id:', '')
    return id
      ? `https://www.dropbox.com/home?quickview=id%3A${id}`
      : `https://www.dropbox.com/home${filePath}`
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const token = await getDropboxToken()
    const dbx = new Dropbox({ accessToken: token, fetch: fetch })

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const safeName = file.name
    const destPath = `${UPLOAD_FOLDER}/${safeName}`

    const uploadResult = await dbx.filesUpload({
      path: destPath,
      contents: buffer,
      mode: { '.tag': 'add' },
      autorename: true
    })

    const finalPath = uploadResult.result.path_lower || destPath.toLowerCase()
    const dropboxId = uploadResult.result.id ? uploadResult.result.id.replace('id:', '') : ''
    const url = await getDropboxUrl(dbx, finalPath, dropboxId)

    return NextResponse.json({
      success: true,
      dropbox_path: finalPath,
      dropbox_id: dropboxId,
      url,
      file_size: uploadResult.result.size || file.size
    })
  } catch (err) {
    console.error('Upload to Dropbox failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
