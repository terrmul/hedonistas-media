import { NextRequest, NextResponse } from 'next/server'
import { Dropbox } from 'dropbox'
import { getDropboxToken } from '@/lib/dropbox'

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.tiff', '.tif']
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.m4v', '.webm', '.wmv']
const DOCUMENT_EXTENSIONS: string[] = []

function isMedia(name: string): boolean {
  const ext = name.toLowerCase().slice(name.lastIndexOf('.'))
  return IMAGE_EXTENSIONS.includes(ext) || VIDEO_EXTENSIONS.includes(ext) || DOCUMENT_EXTENSIONS.includes(ext)
}

export async function POST(req: NextRequest) {
  try {
    const { path = '' } = await req.json()
    const token = await getDropboxToken()
    const dbx = new Dropbox({ accessToken: token, fetch: fetch })
    const response = await dbx.filesListFolder({ path, recursive: false })
    const folders = response.result.entries
      .filter((e: any) => e['.tag'] === 'folder')
      .map((e: any) => ({ name: e.name, path: e.path_lower }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name))
    const files = response.result.entries
      .filter((e: any) => e['.tag'] === 'file' && isMedia(e.name))
      .map((e: any) => ({ name: e.name, path: e.path_lower, size: e.size }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name))
    return NextResponse.json({ folders, files, path })
  } catch (err) {
    console.error('Browse error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
